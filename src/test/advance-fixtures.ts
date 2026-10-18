import {
  AdvanceCreatedReceipt,
  type AccountResponse,
  type AdvanceResponse,
  type ParticipantResponse,
} from "../api/generated/schemas/index.ts";

export const advanceLedger = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Personal",
};
export const advanceParticipant: ParticipantResponse = {
  id: "22222222-2222-4222-8222-222222222222",
  ledgerId: advanceLedger.id,
  name: "Alex",
  status: "active",
};
export const advanceFunding: AccountResponse = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Checking",
  currency: "CNY",
  nature: "asset",
  status: "active",
  trackingStartDate: "2026-01-01",
  openingBalance: { amount: "100.00", currency: "CNY" },
  currentBalance: { amount: "100.00", currency: "CNY" },
};
export const advancePreview = {
  previewToken: "a".repeat(64),
  fundingBalance: { amount: "100.00", currency: "CNY" as const },
  fundingBalanceAfter: { amount: "74.99", currency: "CNY" as const },
  ownerExpense: { amount: "0.00", currency: "CNY" as const },
  receivableIncrease: { amount: "25.01", currency: "CNY" as const },
};
export const confirmedAdvance: AdvanceResponse = {
  id: "44444444-4444-4444-8444-444444444444",
  ledgerId: advanceLedger.id,
  fundingAccountId: advanceFunding.id,
  transactionId: "55555555-5555-4555-8555-555555555555",
  transactionDate: "2027-01-02",
  confirmedAt: "2026-10-18T00:00:00Z",
  note: "Travel cash",
  amount: { amount: "25.01", currency: "CNY" },
  ownerShare: { amount: "0.00", currency: "CNY" },
  obligation: {
    id: "66666666-6666-4666-8666-666666666666",
    ledgerId: advanceLedger.id,
    participantId: advanceParticipant.id,
    advanceId: "44444444-4444-4444-8444-444444444444",
    receivableAccountId: "77777777-7777-4777-8777-777777777777",
    sourceDate: "2027-01-02",
    principal: { amount: "25.01", currency: "CNY" },
    remaining: { amount: "25.01", currency: "CNY" },
    cashPaid: { amount: "0.00", currency: "CNY" },
    forgiven: { amount: "0.00", currency: "CNY" },
    creditApplied: { amount: "0.00", currency: "CNY" },
  },
};
export function createdAdvanceReceipt(submissionId: string) {
  return AdvanceCreatedReceipt.parse({
    submissionId,
    operation: "createFinanceAdvance",
    commandVersion: "1",
    targetLedgerId: advanceLedger.id,
    admittedAt: "2026-10-18T00:00:00Z",
    resolvedAt: "2026-10-18T00:00:01Z",
    outcome: {
      kind: "created",
      resource: { type: "advance", id: confirmedAdvance.id },
    },
  });
}

export const sharedParticipant: ParticipantResponse = {
  ...advanceParticipant,
  id: "88888888-8888-4888-8888-888888888888",
  name: "Blair",
};
export const cardFunding: AccountResponse = {
  ...advanceFunding,
  id: "99999999-9999-4999-8999-999999999999",
  name: "Credit card",
  nature: "liability",
};
export const sharedPreview = {
  ...advancePreview,
  fundingBalanceAfter: { amount: "400.00", currency: "CNY" as const },
  ownerExpense: { amount: "100.00", currency: "CNY" as const },
  receivableIncrease: { amount: "200.00", currency: "CNY" as const },
  participantReceivables: [
    {
      participantId: advanceParticipant.id,
      principal: { amount: "120.00", currency: "CNY" as const },
    },
    {
      participantId: sharedParticipant.id,
      principal: { amount: "80.00", currency: "CNY" as const },
    },
  ],
};
export const sharedAdvance = {
  id: confirmedAdvance.id,
  ledgerId: advanceLedger.id,
  fundingAccountId: cardFunding.id,
  transactionDate: confirmedAdvance.transactionDate,
  confirmedAt: confirmedAdvance.confirmedAt,
  note: "Shared purchase",
  amount: { amount: "300.00", currency: "CNY" as const },
  ownerShare: { amount: "100.00", currency: "CNY" as const },
  transactionIds: [
    confirmedAdvance.transactionId,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ],
  obligations: sharedPreview.participantReceivables.map((share, index) => ({
    ...confirmedAdvance.obligation,
    id:
      index === 0
        ? confirmedAdvance.obligation.id
        : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    participantId: share.participantId,
    receivableAccountId:
      index === 0
        ? confirmedAdvance.obligation.receivableAccountId
        : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    principal: share.principal,
    remaining: share.principal,
  })),
};
export function sharedAdvanceReceipt(submissionId: string) {
  return AdvanceCreatedReceipt.parse({
    ...createdAdvanceReceipt(submissionId),
    commandVersion: "2",
  });
}
