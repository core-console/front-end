import {
  CreditApplicationPreview,
  CreditApplicationResponse,
  SettlementCreatedReceipt,
} from "../api/generated/schemas/index.ts";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
} from "./advance-fixtures.ts";
import {
  outstandingObligations,
  money,
  settlement,
} from "./settlement-fixtures.ts";
export const creditPreview = CreditApplicationPreview.parse({
  kind: "creditApplication",
  previewToken: "d".repeat(64),
  amount: money("25"),
  outstandingBefore: money("40"),
  outstandingAfter: money("15"),
  availableCreditBefore: money("50"),
  availableCreditAfter: money("25"),
  origins: [20, 30].map((value, index) => ({
    originSettlementId: index
      ? "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
      : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    originTransactionId: settlement.transactionIds[index],
    liabilityAccountId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    originDate: index ? "2026-01-01" : "2026-02-01",
    originConfirmationOrder: index + 1,
    amount: money(index ? "5" : "20"),
    availableBefore: money(String(value)),
    availableAfter: money(index ? "25" : "0"),
  })),
  allocations: [20, 5].map((value, index) => ({
    kind: "creditApplication",
    position: index + 1,
    obligationId: outstandingObligations[0]!.id,
    advanceId: outstandingObligations[0]!.advanceId,
    sourceDate: outstandingObligations[0]!.sourceDate,
    originSettlementId: index
      ? "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
      : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    creditApplied: money(String(value)),
    remainingAfter: money(index ? "15" : "20"),
  })),
});
export const creditApplication = CreditApplicationResponse.parse({
  kind: "creditApplication",
  id: settlement.id,
  ledgerId: ledger.id,
  participantId: person.id,
  transactionDate: "2026-10-27",
  amount: money("25"),
  note: null,
  selectedObligationIds: [outstandingObligations[0]!.id],
  confirmedAt: "2026-10-27T00:00:00Z",
  confirmationOrder: 3,
  origins: creditPreview.origins,
  allocations: creditPreview.allocations,
  transactionIds: settlement.transactionIds,
});
export const creditBody = {
  kind: "creditApplication" as const,
  participantId: person.id,
  selectedObligationIds: creditApplication.selectedObligationIds,
  transactionDate: creditApplication.transactionDate,
  amount: money("25"),
  note: null,
  previewToken: creditPreview.previewToken,
};
export function creditReceipt(submissionId: string) {
  return SettlementCreatedReceipt.parse({
    submissionId,
    operation: "createFinanceSettlement",
    commandVersion: "7",
    targetLedgerId: ledger.id,
    admittedAt: creditApplication.confirmedAt,
    resolvedAt: "2026-10-27T00:00:01Z",
    outcome: {
      kind: "created",
      resource: { type: "settlement", id: creditApplication.id },
    },
  });
}
