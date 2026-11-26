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
export function settlementCorrectionEligible(source: SettlementSource) {
  return (
    !("kind" in source) ||
    source.kind === "combined" ||
    source.kind === "forgiveness"
  );
}

function validCreditCorrection(
  p: SettlementCorrectionPreview,
  ledgerId: string,
) {
  const credit = p.creditCorrection;
  if (!credit) return true;
  const { origin, applications, participantPosition } = credit;
  if (
    origin.ledgerId !== ledgerId ||
    origin.settlementId !== p.settlementId ||
    origin.participantId !== p.participantId ||
    origin.receivingAccountId !== p.receivingAccountId ||
    origin.confirmationOrder !== p.confirmationOrder ||
    origin.transactionDate !== p.transactionDate ||
    origin.confirmedAt !== p.originalConfirmedAt ||
    origin.hasReturnedCredit ||
    participantPosition.participantId !== p.participantId ||
    applications.length === 0
  )
    return false;
  const monies = [
    origin.amount,
    origin.available,
    credit.availableAfter,
    participantPosition.outstandingReceivablesBefore,
    participantPosition.outstandingReceivablesAfter,
    participantPosition.availableCreditBefore,
    participantPosition.availableCreditAfter,
    ...applications.flatMap((a) => [
      a.originalApplied,
      a.appliedBefore,
      a.appliedAfter,
      a.released,
    ]),
  ];
  if (
    !monies.every(
      (m) =>
        m.currency === p.before.amount.currency &&
        /^\d+(?:\.\d+)?$/.test(m.amount),
    )
  )
    return false;
  const before = new Map(p.obligationsBefore.map((o) => [o.id, o]));
  const after = new Map(p.obligationsAfter.map((o) => [o.id, o]));
  const releases = new Map<string, string>();
  const effects = new Map(
    p.financialEffectsAfter.map((e) => [e.transactionId, e]),
  );
  for (const a of applications) {
    if (
      !before.has(a.obligationId) ||
      !after.has(a.obligationId) ||
      !equal(
        subtract(a.appliedBefore.amount, a.appliedAfter.amount),
        a.released.amount,
      )
    )
      return false;
    if (equal(a.released.amount, "0")) {
      if (a.restatementTransactionId) return false;
    } else {
      const effect =
        a.restatementTransactionId && effects.get(a.restatementTransactionId);
      if (
        !effect ||
        effect.kind !== "internalTransfer" ||
        effect.transactionDate !== a.transactionDate
      )
        return false;
    }
    releases.set(
      a.obligationId,
      sum([releases.get(a.obligationId) ?? "0", a.released.amount]),
    );
  }
  return (
    equal(origin.amount.amount, p.before.retainedCredit.amount) &&
    equal(
      origin.available.amount,
      subtract(
        origin.amount.amount,
        sum(applications.map((a) => a.appliedBefore.amount)),
      ),
    ) &&
    equal(
      credit.availableAfter.amount,
      subtract(
        p.after.retainedCredit.amount,
        sum(applications.map((a) => a.appliedAfter.amount)),
      ),
    ) &&
    [...releases].every(([id, released]) =>
      equal(
        subtract(
          before.get(id)!.creditApplied.amount,
          after.get(id)!.creditApplied.amount,
        ),
        released,
      ),
    )
  );
}

function validCashPlan(p: SettlementCorrectionPreview, ledgerId: string) {
  const currency = p.before.amount.currency;
  const money = (m: MoneyResponse, nonnegative = true) =>
    m.currency === currency &&
    /^-?\d+(?:\.\d+)?$/.test(m.amount) &&
    (!nonnegative || !m.amount.startsWith("-"));
  if (!/^[0-9a-f]{64}$/.test(p.previewToken) || p.confirmationOrder < 1)
    return false;
  const affectedIds = new Set([
    ...p.before.allocations.map((a) => a.obligationId),
    ...(p.creditCorrection?.applications.map((a) => a.obligationId) ?? []),
  ]);
  if (
    !unique(p.before.allocations.map((a) => a.obligationId)) ||
    p.after.allocations.length !== p.before.allocations.length ||
    p.obligationsBefore.length !== affectedIds.size ||
    p.obligationsAfter.length !== affectedIds.size ||
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
      if (
        a.obligationId !== original.obligationId ||
        a.position !== original.position ||
        (i > 0 && a.position <= facts.allocations[i - 1]!.position) ||
        !money(a.cashPaid) ||
        !money(a.originalCashPaid) ||
        !equal(a.originalCashPaid.amount, original.originalCashPaid.amount) ||
        obligations[i]?.id !== a.obligationId
      )
        return false;
    }
    if (!unique(obligations.map((o) => o.id))) return false;
    for (const o of obligations) {
      if (
        !affectedIds.has(o.id) ||
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
        o.id === b.id &&
        o.advanceId === b.advanceId &&
        o.receivableAccountId === b.receivableAccountId &&
        o.sourceDate === b.sourceDate &&
        equal(o.principal.amount, b.principal.amount) &&
        equal(o.forgiven.amount, b.forgiven.amount) &&
        (p.creditCorrection ||
          equal(o.creditApplied.amount, b.creditApplied.amount)) &&
        equal(
          subtract(o.cashPaid.amount, b.cashPaid.amount),
          subtract(
            p.after.allocations[i]?.cashPaid.amount ?? "0",
            p.before.allocations[i]?.cashPaid.amount ?? "0",
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
        (e.transactionDate !== p.transactionDate &&
          (e.kind !== "internalTransfer" ||
            e.movements.some((m) => m.accountId === p.receivingAccountId))) ||
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
function validPlan(p: SettlementCorrectionPreview, ledgerId: string) {
  if (!validCreditCorrection(p, ledgerId)) return false;
  if (!p.before.forgivenessAmount) return validCashPlan(p, ledgerId);
  const selected = new Set(p.selectedObligationIds);
  const downstream = new Set(
    p.creditCorrection?.applications.map((a) => a.obligationId),
  );
  return (
    !!p.after.forgivenessAmount &&
    selected.size > 0 &&
    [...p.before.allocations, ...p.after.allocations].every((a) =>
      selected.has(a.obligationId),
    ) &&
    [...p.obligationsBefore, ...p.obligationsAfter].every(
      (o) =>
        (selected.has(o.id) || downstream.has(o.id)) &&
        o.ledgerId === ledgerId &&
        o.participantId === p.participantId,
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
      settlementCorrectionEligible(source) &&
      validPlan(p, source.ledgerId) &&
      p.settlementId === source.id &&
      p.settlementId === draft.settlementId &&
      p.participantId === source.participantId &&
      p.receivingAccountId ===
        ("receivingAccountId" in source ? source.receivingAccountId : null) &&
      p.transactionDate === source.transactionDate &&
      p.originalConfirmedAt === source.confirmedAt &&
      p.confirmationOrder === source.confirmationOrder &&
      p.before.amount.currency === source.amount.currency &&
      p.after.amount.currency === draft.amount.currency &&
      equal(p.after.amount.amount, draft.amount.amount) &&
      (draft.forgivenessAmount
        ? p.after.forgivenessAmount?.currency ===
            draft.forgivenessAmount.currency &&
          equal(
            p.after.forgivenessAmount.amount,
            draft.forgivenessAmount.amount,
          )
        : !p.after.forgivenessAmount) &&
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
