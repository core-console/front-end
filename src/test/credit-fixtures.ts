import type {
  CreditSettlementPreview,
  CreditSettlementResponse,
  ParticipantPositionResponse,
} from "../api/generated/schemas/index.ts";
import {
  money,
  repaymentPreview,
  settlement,
  settlementReceipt,
} from "./settlement-fixtures.ts";

export const creditPreview: CreditSettlementPreview = {
  ...repaymentPreview,
  amount: money("102.00"),
  receivingBalanceAfter: money("202.00"),
  outstandingAfter: money("0.00"),
  allocations: repaymentPreview.allocations.map((item, index) => ({
    ...item,
    cashPaid: money(index === 0 ? "40.00" : "60.00"),
    remainingAfter: money("0.00"),
  })),
  retainedCredit: money("2.00"),
  availableCreditBefore: money("0.00"),
  availableCreditAfter: money("2.00"),
};
export const creditSettlement: CreditSettlementResponse = {
  ...settlement,
  amount: money("102.00"),
  allocations: creditPreview.allocations,
  creditOrigin: {
    ledgerId: settlement.ledgerId,
    participantId: settlement.participantId,
    settlementId: settlement.id,
    receivingAccountId: settlement.receivingAccountId,
    liabilityAccountId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    transactionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    transactionDate: settlement.transactionDate,
    confirmedAt: settlement.confirmedAt,
    confirmationOrder: settlement.confirmationOrder,
    amount: money("2.00"),
    available: money("2.00"),
  },
  transactionIds: [
    ...settlement.transactionIds,
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  ],
};
export const noDebtPreview: CreditSettlementPreview = {
  ...creditPreview,
  amount: money("50.00"),
  receivingBalanceAfter: money("150.00"),
  outstandingBefore: money("0.00"),
  outstandingAfter: money("0.00"),
  allocations: [],
  retainedCredit: money("50.00"),
  availableCreditBefore: money("2.00"),
  availableCreditAfter: money("52.00"),
};
export const zeroNetPositions: ParticipantPositionResponse[] = [
  {
    currency: "CNY",
    outstandingReceivables: money("2.00"),
    availableCredits: money("2.00"),
    netExposure: money("0.00"),
  },
  {
    currency: "USD",
    outstandingReceivables: { amount: "10.00", currency: "USD" },
    availableCredits: { amount: "50.00", currency: "USD" },
    netExposure: { amount: "-40.00", currency: "USD" },
  },
];
export function creditReceipt(id: string) {
  return { ...settlementReceipt(id), commandVersion: "2" as const };
}
