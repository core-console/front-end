import type {
  IncomeSettlementPreview,
  IncomeSettlementResponse,
} from "../api/generated/schemas/index.ts";
import {
  money,
  repaymentPreview,
  settlement,
  settlementReceipt,
} from "./settlement-fixtures.ts";

export const incomeCategory = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name: "Gifts",
  status: "active" as const,
};
export const incomePreview: IncomeSettlementPreview = {
  ...repaymentPreview,
  amount: money("102.00"),
  receivingBalanceAfter: money("202.00"),
  outstandingAfter: money("0.00"),
  allocations: repaymentPreview.allocations.map((item, index) => ({
    ...item,
    cashPaid: money(index === 0 ? "40.00" : "60.00"),
    remainingAfter: money("0.00"),
  })),
  acceptedSurplus: money("2.00"),
  categoryAllocations: [
    { amount: money("2.00"), categoryId: incomeCategory.id },
  ],
  availableCreditBefore: money("5.00"),
  availableCreditAfter: money("5.00"),
};
export const incomeSettlement: IncomeSettlementResponse = {
  ...settlement,
  amount: money("102.00"),
  allocations: incomePreview.allocations,
  acceptedSurplus: money("2.00"),
  incomeTransactionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  transactionIds: [
    ...settlement.transactionIds,
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  ],
};
export function incomeReceipt(id: string) {
  return { ...settlementReceipt(id), commandVersion: "3" as const };
}
