import { expect, it } from "vitest";
import {
  correctionDraft,
  correctionPreview,
  ledger,
  before,
} from "@/test/advance-correction-fixtures";
import { parseCorrectionPreview } from "./advance-correction";
it("accepts retained zero attribution, original date restatement and exact owner Expense", () => {
  expect(
    parseCorrectionPreview(correctionPreview, ledger.id, correctionDraft).after
      .id,
  ).toBe(before.id);
});
it.each([
  "funding",
  "expense",
  "principal",
  "currency",
  "owner",
  "date",
  "downstream",
  "account",
  "identity",
])("rejects an inconsistent %s plan before confirmation", (kind) => {
  const plan = structuredClone(correctionPreview);
  if (kind === "funding") plan.after.amount.amount = "25.02";
  if (kind === "expense")
    plan.financialEffectsAfter[0]!.ownerExpense.amount = "25.02";
  if (kind === "principal") plan.after.obligations[0]!.remaining.amount = "1";
  if (kind === "currency")
    plan.accountEffects[0]!.balanceAfter.currency = "USD";
  if (kind === "owner") plan.after.ledgerId = crypto.randomUUID();
  if (kind === "date")
    plan.financialEffectsAfter[0]!.transactionDate = "2026-10-21";
  if (kind === "downstream" && "obligation" in plan.before)
    plan.before.obligation.cashPaid.amount = "1";
  if (kind === "account") plan.accountEffects[1]!.balanceAfter.amount = "1";
  if (kind === "identity") plan.after.obligations[0]!.id = crypto.randomUUID();
  expect(() =>
    parseCorrectionPreview(plan, ledger.id, correctionDraft),
  ).toThrow();
});
