import {
  SettlementCorrectionCreatedReceipt,
  type SettlementCorrectionPreview,
  type SettlementCorrectionResponse,
} from "../api/generated/schemas/index.ts";
import {
  settlement,
  money,
  outstandingObligations,
} from "./settlement-fixtures.ts";
export {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as account,
} from "./advance-fixtures.ts";

export const receiptBefore = {
  ...settlement,
  amount: money("100.00"),
  allocations: settlement.allocations.map((a, i) => ({
    ...a,
    cashPaid: money(i === 0 ? "40.00" : "60.00"),
    remainingAfter: money("0.00"),
  })),
};
export const receiptAfter = {
  ...receiptBefore,
  amount: money("70.00"),
  allocations: receiptBefore.allocations.map((a, i) => ({
    ...a,
    cashPaid: money(i === 0 ? "40.00" : "30.00"),
    remainingAfter: money(i === 0 ? "0.00" : "30.00"),
  })),
  transactionIds: [
    ...receiptBefore.transactionIds,
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ],
};
export const receiptCorrectionDraft = {
  settlementId: receiptBefore.id,
  amount: money("70.00"),
  reason: "Receipt was 70, not 100",
  excessDisposition: "none" as const,
  categoryId: null,
};
const facts = (source: typeof receiptBefore) => ({
  amount: source.amount,
  allocations: source.allocations.map((a, i) => ({
    position: a.position,
    obligationId: a.obligationId,
    originalCashPaid: receiptBefore.allocations[i]!.cashPaid,
    cashPaid: a.cashPaid,
  })),
  retainedCredit: money("0.00"),
  acceptedSurplus: money("0.00"),
  categoryId: null,
});
const effects = receiptBefore.allocations.map((a, i) => ({
  transactionId: receiptBefore.transactionIds[i]!,
  kind: "internalTransfer" as const,
  transactionDate: receiptBefore.transactionDate,
  note: receiptBefore.note,
  income: money("0.00"),
  categoryId: null,
  movements: [
    {
      accountId: receiptBefore.receivingAccountId,
      role: "destination" as const,
      amount: a.cashPaid,
    },
    {
      accountId: outstandingObligations[i]!.receivableAccountId,
      role: "source" as const,
      amount: money(`-${a.cashPaid.amount}`),
    },
  ],
}));
export const receiptCorrectionPreview: SettlementCorrectionPreview = {
  previewToken: "d".repeat(64),
  settlementId: receiptBefore.id,
  participantId: receiptBefore.participantId,
  receivingAccountId: receiptBefore.receivingAccountId,
  transactionDate: receiptBefore.transactionDate,
  originalConfirmedAt: receiptBefore.confirmedAt,
  confirmationOrder: receiptBefore.confirmationOrder,
  selectedObligationIds: null,
  reason: receiptCorrectionDraft.reason,
  excessDisposition: "none",
  before: facts(receiptBefore),
  after: facts(receiptAfter),
  obligationsBefore: outstandingObligations.map((o, i) => ({
    ...o,
    cashPaid: receiptBefore.allocations[i]!.cashPaid,
    remaining: money("0.00"),
  })),
  obligationsAfter: outstandingObligations.map((o, i) => ({
    ...o,
    cashPaid: receiptAfter.allocations[i]!.cashPaid,
    remaining: money(i === 0 ? "0.00" : "30.00"),
  })),
  financialEffectsBefore: effects,
  financialEffectsAfter: [
    ...effects,
    {
      ...effects[1]!,
      transactionId: receiptAfter.transactionIds[2]!,
      movements: [
        {
          accountId: receiptBefore.receivingAccountId,
          role: "source",
          amount: money("-30.00"),
        },
        {
          accountId: outstandingObligations[1]!.receivableAccountId,
          role: "destination",
          amount: money("30.00"),
        },
      ],
    },
  ],
  accountEffects: [
    {
      accountId: receiptBefore.receivingAccountId,
      nature: "asset",
      balanceBefore: money("200.00"),
      balanceAfter: money("170.00"),
    },
    {
      accountId: outstandingObligations[0]!.receivableAccountId,
      nature: "asset",
      balanceBefore: money("0.00"),
      balanceAfter: money("30.00"),
    },
  ],
};
export const receiptCorrection: SettlementCorrectionResponse = {
  ...receiptCorrectionPreview,
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  ledgerId: receiptBefore.ledgerId,
  actorId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  confirmedAt: "2026-11-03T00:00:00Z",
  revision: 1,
};
export function receiptCorrectionReceipt(submissionId: string) {
  return SettlementCorrectionCreatedReceipt.parse({
    submissionId,
    operation: "createFinanceSettlementCorrection",
    commandVersion: "1",
    targetLedgerId: receiptBefore.ledgerId,
    admittedAt: "2026-11-03T00:00:00Z",
    resolvedAt: "2026-11-03T00:00:01Z",
    outcome: {
      kind: "created",
      resource: { type: "settlementCorrection", id: receiptCorrection.id },
    },
  });
}
