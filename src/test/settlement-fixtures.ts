import {
  SettlementCreatedReceipt,
  type SettlementResponse,
  type SettlementPreview,
} from "../api/generated/schemas/index.ts";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as account,
  confirmedAdvance,
} from "./advance-fixtures.ts";

export const money = (amount: string) => ({ amount, currency: "CNY" as const });
export const repaymentPreview: SettlementPreview = {
  previewToken: "a".repeat(64),
  amount: money("50.00"),
  receivingBalance: money("100.00"),
  receivingBalanceAfter: money("150.00"),
  outstandingBefore: money("100.00"),
  outstandingAfter: money("50.00"),
  allocations: [
    {
      position: 1,
      obligationId: confirmedAdvance.obligation.id,
      advanceId: confirmedAdvance.id,
      sourceDate: "2026-01-01",
      cashPaid: money("40.00"),
      remainingAfter: money("0.00"),
    },
    {
      position: 2,
      obligationId: "88888888-8888-4888-8888-888888888888",
      advanceId: "99999999-9999-4999-8999-999999999999",
      sourceDate: "2026-02-01",
      cashPaid: money("10.00"),
      remainingAfter: money("50.00"),
    },
  ],
};
export const settlement: SettlementResponse = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ledgerId: ledger.id,
  participantId: person.id,
  receivingAccountId: account.id,
  transactionDate: "2027-01-02",
  amount: money("50.00"),
  note: "Cash repayment",
  confirmedAt: "2026-10-20T00:00:00Z",
  confirmationOrder: 1,
  allocations: repaymentPreview.allocations,
  transactionIds: [
    confirmedAdvance.transactionId,
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ],
};
export const outstandingObligations = repaymentPreview.allocations.map(
  (item, index) => ({
    ...confirmedAdvance.obligation,
    id: item.obligationId,
    advanceId: item.advanceId,
    sourceDate: item.sourceDate,
    principal: money(index === 0 ? "40.00" : "60.00"),
    remaining: money(index === 0 ? "40.00" : "60.00"),
  }),
);
export const repaidObligations = outstandingObligations.map((item, index) => ({
  ...item,
  cashPaid: repaymentPreview.allocations[index]!.cashPaid,
  remaining: repaymentPreview.allocations[index]!.remainingAfter,
}));
export function settlementReceipt(submissionId: string) {
  return SettlementCreatedReceipt.parse({
    submissionId,
    operation: "createFinanceSettlement",
    commandVersion: "1",
    targetLedgerId: ledger.id,
    admittedAt: "2026-10-20T00:00:00Z",
    resolvedAt: "2026-10-20T00:00:01Z",
    outcome: {
      kind: "created",
      resource: { type: "settlement", id: settlement.id },
    },
  });
}
