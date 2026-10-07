import {
  AdjustmentSubmissionReceipt,
  type CreateBalanceAdjustmentBody,
} from "../api/generated/schemas/index.ts";
import { createdTransactionReceipt } from "./submission-fixtures.ts";
import {
  transactionTestAccounts,
  transactionTestDate,
  transactionTestId,
  transactionTestLedger,
} from "./transaction-submission-fixtures.ts";

export const adjustmentTestBody: CreateBalanceAdjustmentBody = {
  accountId: transactionTestAccounts[0].id,
  transactionDate: transactionTestDate,
  expectedAccountNature: "asset",
  expectedDerivedBalance: { amount: "-9007199254740993.01", currency: "USD" },
  targetBalance: { amount: "-0.00", currency: "USD" },
  note: "Immutable adjustment note",
};
export const adjustmentTestContext = {
  account: {
    id: transactionTestAccounts[0].id,
    name: "Cash",
    status: "active",
  },
  accountNature: "asset",
  transactionDate: transactionTestDate,
  derivedComparisonBalance: adjustmentTestBody.expectedDerivedBalance,
} as const;
export const adjustmentTestResource = {
  id: transactionTestId,
  ledgerId: transactionTestLedger.id,
  kind: "balanceAdjustment",
  transactionDate: transactionTestDate,
  note: "Current edited adjustment note",
  account: adjustmentTestContext.account,
  correctionDelta: { amount: "9007199254740993.01", currency: "USD" },
} as const;

export function adjustmentReceipt(
  submissionId: string,
  outcome: AdjustmentSubmissionReceipt["outcome"] = { kind: "noChange" },
) {
  return AdjustmentSubmissionReceipt.parse({
    ...createdTransactionReceipt(
      submissionId,
      transactionTestLedger.id,
      transactionTestId,
    ),
    operation: "createBalanceAdjustment",
    outcome,
  });
}
