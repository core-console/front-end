import {
  CombinedSettlementPreview,
  CombinedSettlementResponse,
  SettlementCreatedReceipt,
} from "../api/generated/schemas/index.ts";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as account,
} from "./advance-fixtures.ts";
import {
  money,
  outstandingObligations,
  settlement,
} from "./settlement-fixtures.ts";

export const combinedPreview = CombinedSettlementPreview.parse({
  kind: "combined",
  previewToken: "c".repeat(64),
  amount: money("90.00"),
  forgivenessAmount: money("10.00"),
  expense: money("10.00"),
  receivingBalance: money("100.00"),
  receivingBalanceAfter: money("190.00"),
  outstandingBefore: money("100.00"),
  outstandingAfter: money("0.00"),
  allocations: [
    {
      ...settlement.allocations[0],
      kind: "cash",
      cashPaid: money("40.00"),
      remainingAfter: money("0.00"),
    },
    {
      ...settlement.allocations[1],
      kind: "cash",
      cashPaid: money("50.00"),
      remainingAfter: money("10.00"),
    },
    {
      position: 3,
      kind: "forgiveness",
      obligationId: outstandingObligations[1]!.id,
      advanceId: outstandingObligations[1]!.advanceId,
      sourceDate: outstandingObligations[1]!.sourceDate,
      forgiven: money("10.00"),
      remainingAfter: money("0.00"),
    },
  ],
});
export const combinedSettlement = CombinedSettlementResponse.parse({
  id: settlement.id,
  ledgerId: ledger.id,
  participantId: person.id,
  receivingAccountId: account.id,
  kind: "combined",
  selectedObligationIds: outstandingObligations.map((row) => row.id),
  transactionDate: "2026-10-25",
  amount: combinedPreview.amount,
  forgivenessAmount: combinedPreview.forgivenessAmount,
  reason: "Explicitly waive the remaining ten",
  note: null,
  confirmedAt: "2026-10-25T00:00:00Z",
  confirmationOrder: 1,
  allocations: combinedPreview.allocations,
  transactionIds: [
    ...settlement.transactionIds,
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ],
});
export function combinedReceipt(submissionId: string) {
  return SettlementCreatedReceipt.parse({
    submissionId,
    operation: "createFinanceSettlement",
    commandVersion: "6",
    targetLedgerId: ledger.id,
    admittedAt: combinedSettlement.confirmedAt,
    resolvedAt: "2026-10-25T00:00:01Z",
    outcome: {
      kind: "created",
      resource: { type: "settlement", id: combinedSettlement.id },
    },
  });
}
export const combinedObligations = outstandingObligations.map((row, index) => ({
  ...row,
  cashPaid: money(index === 0 ? "40.00" : "50.00"),
  forgiven: money(index === 0 ? "0.00" : "10.00"),
  remaining: money("0.00"),
}));
