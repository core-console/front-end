import { expect, it } from "vitest";
import {
  correctionDraft,
  correctionPreview,
  cashCorrectionDraft,
  correctionMoney,
  cashCorrectionPreview,
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
it("accepts cash release linked to its receipt and rejects unreconciled credit", () => {
  expect(
    parseCorrectionPreview(
      cashCorrectionPreview,
      ledger.id,
      cashCorrectionDraft,
    ),
  ).toEqual(cashCorrectionPreview);
  const invalid = structuredClone(cashCorrectionPreview);
  invalid.cashReleases![0]!.creditAfter.amount = "4.98";
  expect(() =>
    parseCorrectionPreview(invalid, ledger.id, cashCorrectionDraft),
  ).toThrow();
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

it("requires a matching Expense restatement when reducing effective forgiveness", () => {
  const plan = structuredClone(cashCorrectionPreview);
  if (!("obligation" in plan.before))
    throw new Error("Expected single Advance");
  plan.before.obligation.forgiven = correctionMoney("5.01");
  plan.before.obligation.remaining = correctionMoney("0.00");
  plan.accountEffects[1]!.balanceBefore = correctionMoney("0.00");
  plan.forgivenessRestatements = [
    {
      settlementId: "01234567-890a-4bcd-8def-0123456789ab",
      confirmationOrder: 8,
      position: 1,
      obligationId: before.obligation.id,
      transactionDate: "2027-01-03",
      expenseTransactionId: "12345678-90ab-4cde-8f00-1234567890ab",
      originalForgiven: correctionMoney("5.01"),
      forgivenBefore: correctionMoney("5.01"),
      forgivenAfter: correctionMoney("0.00"),
    },
  ];

  expect(parseCorrectionPreview(plan, ledger.id, cashCorrectionDraft)).toEqual(
    plan,
  );
  plan.forgivenessRestatements[0]!.forgivenAfter = correctionMoney("0.01");
  expect(() =>
    parseCorrectionPreview(plan, ledger.id, cashCorrectionDraft),
  ).toThrow();
});

it("requires the original receipt, restored Amount and gross Credit in a complete plan", () => {
  const plan = structuredClone(cashCorrectionPreview);
  if (!("obligation" in plan.before))
    throw new Error("Expected single Advance");
  const [release] = plan.cashReleases!;
  plan.before.obligation.cashPaid = correctionMoney("0.00");
  plan.before.obligation.creditApplied = correctionMoney("20.00");
  plan.after.obligations[0]!.cashPaid = correctionMoney("0.00");
  plan.after.obligations[0]!.creditApplied = correctionMoney("15.01");
  plan.cashReleases = [];
  plan.creditApplications = [
    {
      settlementId: crypto.randomUUID(),
      confirmationOrder: 8,
      transactionDate: "2027-01-03",
      applicationTransactionId: crypto.randomUUID(),
      obligationId: before.obligation.id,
      position: 1,
      origin: {
        settlementId: release!.settlementId,
        ledgerId: ledger.id,
        participantId: before.obligation.participantId,
        receivingAccountId: before.fundingAccountId,
        liabilityAccountId: release!.creditAccountId,
        transactionId: crypto.randomUUID(),
        transactionDate: release!.transactionDate,
        confirmedAt: release!.confirmedAt,
        confirmationOrder: 7,
        amount: correctionMoney("20.00"),
        available: correctionMoney("0.00"),
      },
      originalApplied: correctionMoney("20.00"),
      appliedBefore: correctionMoney("20.00"),
      appliedAfter: correctionMoney("15.01"),
      restored: correctionMoney("4.99"),
      financialEffect: {
        ...release!.financialEffect,
        transactionDate: "2027-01-03",
      },
    },
  ];
  plan.participantPositions = [
    {
      participantId: before.obligation.participantId,
      outstandingReceivablesBefore: correctionMoney("5.01"),
      outstandingReceivablesAfter: correctionMoney("0.00"),
      availableCreditBefore: correctionMoney("0.00"),
      availableCreditAfter: correctionMoney("4.99"),
    },
  ];
  expect(parseCorrectionPreview(plan, ledger.id, cashCorrectionDraft)).toEqual(
    plan,
  );
  for (const incomplete of [
    { ...plan, creditApplications: [] },
    { ...plan, participantPositions: [] },
    {
      ...plan,
      creditApplications: [
        { ...plan.creditApplications[0]!, financialEffect: null },
      ],
    },
  ]) {
    expect(() =>
      parseCorrectionPreview(incomplete, ledger.id, cashCorrectionDraft),
    ).toThrow();
  }
});
