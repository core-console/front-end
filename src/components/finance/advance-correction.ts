import { z } from "zod";
import {
  CreateFinanceAdvanceCorrectionBody,
  PreviewFinanceAdvanceCorrectionBody,
} from "@/api/generated/schemas";
// P trims Python whitespace and counts Unicode code points, preserving the authored command.
export const correctionText = (value: string) =>
  value.replace(
    /^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu,
    "",
  );
const reason = z.string().refine((value) => {
  const n = [...correctionText(value)].length;
  return n > 0 && n <= 500;
});
const note = z
  .string()
  .refine((value) => [...correctionText(value)].length <= 500)
  .nullable()
  .optional();
export const correctionDraftBody = PreviewFinanceAdvanceCorrectionBody.extend({
  reason,
  note,
});
export const correctionCommandBody = CreateFinanceAdvanceCorrectionBody.extend({
  reason,
  note,
});
import {
  AdvanceCorrectionPreview,
  AdvanceCorrectionResponse,
  type MoneyResponse,
} from "@/api/generated/schemas";
import { advanceObligations, type AdvanceSource } from "./advance-source";
import { subtractExactDecimals } from "./finance-decimal";
export const correctionEqual = (a: string, b: string) =>
  /^0(?:\.0+)?$/.test(subtractExactDecimals(a, b));
const sum = (values: string[]) =>
  values.reduce(
    (total, value) =>
      subtractExactDecimals(
        total,
        value.startsWith("-") ? value.slice(1) : `-${value}`,
      ),
    "0",
  );
const zero = (value: string) => correctionEqual(value, "0");
const signed = (value: string) => /^-?\d+(?:\.\d+)?$/.test(value);
export function correctionEligible(source: AdvanceSource) {
  return advanceObligations(source).every((o) =>
    [o.cashPaid, o.forgiven, o.creditApplied].every(
      (m) => signed(m.amount) && zero(m.amount),
    ),
  );
}
function validPlan(plan: AdvanceCorrectionPreview, ledgerId: string) {
  const unit = plan.before.amount.currency;
  const money = (m: MoneyResponse, nonnegative = false) =>
    m.currency === unit &&
    signed(m.amount) &&
    (!nonnegative || !m.amount.startsWith("-"));
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  const identities = advanceObligations(plan.before);
  if (
    plan.advanceId !== plan.before.id ||
    plan.after.id !== plan.advanceId ||
    plan.before.ledgerId !== ledgerId ||
    plan.after.ledgerId !== ledgerId ||
    plan.before.confirmedAt !== plan.after.confirmedAt ||
    !correctionEligible(plan.before) ||
    !correctionEligible(plan.after) ||
    !/^[0-9a-f]{64}$/.test(plan.previewToken)
  )
    return false;
  if (
    plan.fundingChanged !==
    (plan.before.fundingAccountId !== plan.after.fundingAccountId ||
      !correctionEqual(plan.before.amount.amount, plan.after.amount.amount))
  )
    return false;
  if (
    !unique(plan.accountEffects.map((a) => a.accountId)) ||
    !plan.accountEffects.every(
      (a) => money(a.balanceBefore) && money(a.balanceAfter),
    )
  )
    return false;
  for (const [source, effects] of [
    [plan.before, plan.financialEffectsBefore],
    [plan.after, plan.financialEffectsAfter],
  ] as const) {
    const obligations = advanceObligations(source);
    if (
      !money(source.amount, true) ||
      zero(source.amount.amount) ||
      !money(source.ownerShare, true) ||
      !unique(obligations.map((o) => o.id)) ||
      !unique(obligations.map((o) => o.participantId)) ||
      !unique(obligations.map((o) => o.receivableAccountId)) ||
      !correctionEqual(
        sum([
          source.ownerShare.amount,
          ...obligations.map((o) => o.principal.amount),
        ]),
        source.amount.amount,
      )
    )
      return false;
    if (
      !obligations.every(
        (o) =>
          o.ledgerId === ledgerId &&
          o.advanceId === source.id &&
          o.sourceDate === source.transactionDate &&
          [
            o.principal,
            o.remaining,
            o.cashPaid,
            o.forgiven,
            o.creditApplied,
          ].every((m) => money(m, true)) &&
          correctionEqual(o.principal.amount, o.remaining.amount),
      )
    )
      return false;
    const ids =
      "transactionIds" in source
        ? source.transactionIds
        : [source.transactionId];
    if (
      !unique(ids) ||
      !unique(effects.map((e) => e.transactionId)) ||
      ids.length !== effects.length ||
      !effects.every(
        (e) =>
          ids.includes(e.transactionId) &&
          e.transactionDate === source.transactionDate &&
          e.note === source.note &&
          money(e.ownerExpense, true),
      )
    )
      return false;
    const funding = plan.accountEffects.find(
      (a) => a.accountId === source.fundingAccountId,
    );
    if (!funding) return false;
    const fundingDelta = (amount: string) =>
      funding.nature === "asset" ? `-${amount}` : amount;
    const active = obligations.filter((o) => !zero(o.principal.amount));
    if (
      effects.length !==
      active.length + (zero(source.ownerShare.amount) ? 0 : 1)
    )
      return false;
    if (
      !active.every(
        (o) =>
          effects.filter(
            (e) =>
              e.kind === "internalTransfer" &&
              zero(e.ownerExpense.amount) &&
              e.movements.length === 2 &&
              e.movements.some(
                (m) =>
                  m.accountId === source.fundingAccountId &&
                  m.role === "source" &&
                  money(m.amount) &&
                  correctionEqual(
                    m.amount.amount,
                    fundingDelta(o.principal.amount),
                  ),
              ) &&
              e.movements.some(
                (m) =>
                  m.accountId === o.receivableAccountId &&
                  m.role === "destination" &&
                  money(m.amount) &&
                  correctionEqual(m.amount.amount, o.principal.amount),
              ),
          ).length === 1,
      )
    )
      return false;
    if (
      !zero(source.ownerShare.amount) &&
      effects.filter(
        (e) =>
          e.kind === "expense" &&
          correctionEqual(e.ownerExpense.amount, source.ownerShare.amount) &&
          e.movements.length === 1 &&
          e.movements[0]!.accountId === source.fundingAccountId &&
          e.movements[0]!.role === "primary" &&
          money(e.movements[0]!.amount) &&
          correctionEqual(
            e.movements[0]!.amount.amount,
            fundingDelta(source.ownerShare.amount),
          ),
      ).length !== 1
    )
      return false;
  }
  if (
    !identities.every((old) =>
      plan.after.obligations.some(
        (o) =>
          o.id === old.id &&
          o.participantId === old.participantId &&
          o.receivableAccountId === old.receivableAccountId,
      ),
    )
  )
    return false;
  const delta = new Map<string, string>();
  for (const [sign, effects] of [
    [-1, plan.financialEffectsBefore],
    [1, plan.financialEffectsAfter],
  ] as const)
    for (const e of effects)
      for (const m of e.movements) {
        const v =
          sign === 1
            ? m.amount.amount
            : subtractExactDecimals("0", m.amount.amount);
        delta.set(m.accountId, sum([delta.get(m.accountId) ?? "0", v]));
      }
  return (
    [...delta.keys()].every((id) =>
      plan.accountEffects.some((a) => a.accountId === id),
    ) &&
    plan.accountEffects.every((a) =>
      correctionEqual(
        subtractExactDecimals(a.balanceAfter.amount, a.balanceBefore.amount),
        delta.get(a.accountId) ?? "0",
      ),
    )
  );
}
export function parseCorrectionPreview(
  data: unknown,
  ledgerId: string,
  draft: PreviewFinanceAdvanceCorrectionBody,
) {
  return AdvanceCorrectionPreview.refine(
    (plan) =>
      validPlan(plan, ledgerId) &&
      plan.advanceId === draft.advanceId &&
      plan.reason === correctionText(draft.reason) &&
      plan.after.fundingAccountId === draft.fundingAccountId &&
      plan.after.transactionDate === draft.transactionDate &&
      plan.after.note ===
        (draft.note == null ? null : correctionText(draft.note) || null) &&
      plan.after.amount.currency === draft.amount.currency &&
      correctionEqual(plan.after.amount.amount, draft.amount.amount) &&
      correctionEqual(plan.after.ownerShare.amount, draft.ownerShare.amount) &&
      plan.after.obligations.filter((o) => !zero(o.principal.amount)).length ===
        draft.participantShares.length &&
      draft.participantShares.every((s) =>
        plan.after.obligations.some(
          (o) =>
            o.participantId === s.participantId &&
            o.principal.currency === s.amount.currency &&
            correctionEqual(o.principal.amount, s.amount.amount),
        ),
      ),
  ).parse(data);
}
export function parseCorrection(
  data: unknown,
  ledgerId: string,
  advanceId: string,
  id?: string,
) {
  return AdvanceCorrectionResponse.refine(
    (p) =>
      p.ledgerId === ledgerId &&
      p.advanceId === advanceId &&
      (!id || p.id === id) &&
      p.revision > 0 &&
      validPlan(p, ledgerId),
  ).parse(data);
}
