import {
  ForgivenessPreview,
  ForgivenessResponse,
  SettlementCreatedReceipt,
} from "../api/generated/schemas/index.ts";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
} from "./advance-fixtures.ts";
import {
  money,
  outstandingObligations,
  settlement,
} from "./settlement-fixtures.ts";

export const forgivenessPreview = ForgivenessPreview.parse({
  previewToken: "f".repeat(64),
  amount: money("20.00"),
  expense: money("20.00"),
  outstandingBefore: money("60.00"),
  outstandingAfter: money("40.00"),
  allocations: [
    {
      position: 1,
      kind: "forgiveness",
      obligationId: outstandingObligations[1]!.id,
      advanceId: outstandingObligations[1]!.advanceId,
      sourceDate: "2026-02-01",
      forgiven: money("20.00"),
      remainingAfter: money("40.00"),
    },
  ],
});
export const forgiveness = ForgivenessResponse.parse({
  id: settlement.id,
  ledgerId: ledger.id,
  participantId: person.id,
  kind: "forgiveness",
  selectedObligationIds: [outstandingObligations[1]!.id],
  transactionDate: "2026-10-25",
  amount: money("20.00"),
  reason: "Waive the remaining agreed amount",
  note: null,
  confirmedAt: "2026-10-25T00:00:00Z",
  confirmationOrder: 1,
  allocations: forgivenessPreview.allocations,
  transactionIds: [settlement.transactionIds[0]!],
});
export function forgivenessReceipt(submissionId: string) {
  return SettlementCreatedReceipt.parse({
    submissionId,
    operation: "createFinanceSettlement",
    commandVersion: "5",
    targetLedgerId: ledger.id,
    admittedAt: forgiveness.confirmedAt,
    resolvedAt: "2026-10-25T00:00:01Z",
    outcome: {
      kind: "created",
      resource: { type: "settlement", id: forgiveness.id },
    },
  });
}
export const forgivenObligations = outstandingObligations.map((row, index) =>
  index === 1
    ? { ...row, forgiven: money("20.00"), remaining: money("40.00") }
    : row,
);
