import { z } from "zod";
import {
  CreateFinanceSettlementCorrectionBody,
  PreviewFinanceSettlementCorrectionBody,
  SettlementCorrectionPreview,
  SettlementCorrectionResponse,
  type MoneyResponse,
} from "@/api/generated/schemas";
import { correctionEqual as equal, correctionText } from "./advance-correction";
import { subtractExactDecimals as subtract } from "./finance-decimal";
import type { SettlementSource } from "./settlement-source";

// Match P's trimmed Unicode code-point limit without changing authored recovery text.
const reason = z.string().refine((value) => {
  const length = [...correctionText(value)].length;
  return length > 0 && length <= 500;
});
export const settlementCorrectionDraft =
  PreviewFinanceSettlementCorrectionBody.extend({ reason });
export const settlementCorrectionCommand =
  CreateFinanceSettlementCorrectionBody.extend({ reason });

const sum = (values: string[]) =>
  values.reduce((a, b) => subtract(a, subtract("0", b)), "0");
const unique = (ids: string[]) => new Set(ids).size === ids.length;
export function cashCorrectionEligible(source: SettlementSource) {
  return !("kind" in source);
}
function validPlan(p: SettlementCorrectionPreview, ledgerId: string) {
  const currency = p.before.amount.currency;
  const money = (m: MoneyResponse, nonnegative = true) =>
    m.currency === currency &&
    /^-?\d+(?:\.\d+)?$/.test(m.amount) &&
    (!nonnegative || !m.amount.startsWith("-"));
  if (!/^[0-9a-f]{64}$/.test(p.previewToken) || p.confirmationOrder < 1)
    return false;
  if (
    !unique(p.before.allocations.map((a) => a.obligationId)) ||
    p.after.allocations.length !== p.before.allocations.length ||
    p.obligationsBefore.length !== p.before.allocations.length ||
    p.obligationsAfter.length !== p.before.allocations.length ||
    !unique(p.accountEffects.map((a) => a.accountId))
  )
    return false;
  for (const [facts, obligations] of [
    [p.before, p.obligationsBefore],
    [p.after, p.obligationsAfter],
  ] as const) {
    if (
      ![facts.amount, facts.retainedCredit, facts.acceptedSurplus].every((m) =>
        money(m),
      ) ||
      !equal(
        facts.amount.amount,
        sum([
          ...facts.allocations.map((a) => a.cashPaid.amount),
          facts.retainedCredit.amount,
          facts.acceptedSurplus.amount,
        ]),
      )
    )
      return false;
    for (const [i, a] of facts.allocations.entries()) {
      const original = p.before.allocations[i]!;
      const o = obligations[i]!;
      if (
        a.obligationId !== original.obligationId ||
        a.position !== original.position ||
        (i > 0 && a.position <= facts.allocations[i - 1]!.position) ||
        !money(a.cashPaid) ||
        !money(a.originalCashPaid) ||
        !equal(a.originalCashPaid.amount, original.originalCashPaid.amount) ||
        o.id !== a.obligationId ||
        o.ledgerId !== ledgerId ||
        o.participantId !== p.participantId ||
        ![
          o.principal,
          o.cashPaid,
          o.forgiven,
          o.creditApplied,
          o.remaining,
        ].every((m) => money(m)) ||
        !equal(
          o.principal.amount,
          sum([
            o.cashPaid.amount,
            o.forgiven.amount,
            o.creditApplied.amount,
            o.remaining.amount,
          ]),
        )
      )
        return false;
    }
  }
  if (
    !p.obligationsAfter.every((o, i) => {
      const b = p.obligationsBefore[i]!;
      return (
        o.advanceId === b.advanceId &&
        o.receivableAccountId === b.receivableAccountId &&
        o.sourceDate === b.sourceDate &&
        equal(o.principal.amount, b.principal.amount) &&
        equal(o.forgiven.amount, b.forgiven.amount) &&
        equal(o.creditApplied.amount, b.creditApplied.amount) &&
        equal(
          subtract(o.cashPaid.amount, b.cashPaid.amount),
          subtract(
            p.after.allocations[i]!.cashPaid.amount,
            p.before.allocations[i]!.cashPaid.amount,
          ),
        )
      );
    })
  )
    return false;
  const delta = new Map<string, string>();
  for (const [effects, negative] of [
    [p.financialEffectsBefore, true],
    [p.financialEffectsAfter, false],
  ] as const) {
    if (!unique(effects.map((e) => e.transactionId))) return false;
    for (const e of effects) {
      if (
        e.transactionDate !== p.transactionDate ||
        !money(e.income) ||
        !unique(e.movements.map((m) => m.accountId)) ||
        !e.movements.every((m) => money(m.amount, false))
      )
        return false;
      for (const m of e.movements)
        delta.set(
          m.accountId,
          sum([
            delta.get(m.accountId) ?? "0",
            negative ? subtract("0", m.amount.amount) : m.amount.amount,
          ]),
        );
    }
  }
  return (
    [...delta.keys()].every((id) =>
      p.accountEffects.some((a) => a.accountId === id),
    ) &&
    p.accountEffects.every(
      (a) =>
        money(a.balanceBefore, false) &&
        money(a.balanceAfter, false) &&
        equal(
          subtract(a.balanceAfter.amount, a.balanceBefore.amount),
          delta.get(a.accountId) ?? "0",
        ),
    )
  );
}
export function parseSettlementCorrectionPreview(
  data: unknown,
  source: SettlementSource,
  draft: PreviewFinanceSettlementCorrectionBody,
) {
  return SettlementCorrectionPreview.refine(
    (p) =>
      cashCorrectionEligible(source) &&
      "receivingAccountId" in source &&
      validPlan(p, source.ledgerId) &&
      p.settlementId === source.id &&
      p.settlementId === draft.settlementId &&
      p.participantId === source.participantId &&
      p.receivingAccountId === source.receivingAccountId &&
      p.transactionDate === source.transactionDate &&
      p.originalConfirmedAt === source.confirmedAt &&
      p.confirmationOrder === source.confirmationOrder &&
      p.before.amount.currency === source.amount.currency &&
      p.after.amount.currency === draft.amount.currency &&
      equal(p.after.amount.amount, draft.amount.amount) &&
      p.reason === correctionText(draft.reason) &&
      p.excessDisposition === draft.excessDisposition &&
      p.after.categoryId === draft.categoryId &&
      JSON.stringify(p.selectedObligationIds) ===
        JSON.stringify(
          "selectedObligationIds" in source
            ? source.selectedObligationIds
            : null,
        ),
  ).parse(data);
}
export function parseSettlementCorrection(
  data: unknown,
  ledgerId: string,
  settlementId: string,
  id?: string,
) {
  return SettlementCorrectionResponse.refine(
    (p) =>
      p.ledgerId === ledgerId &&
      p.settlementId === settlementId &&
      (!id || p.id === id) &&
      p.revision > 0 &&
      validPlan(p, ledgerId),
  ).parse(data);
}
