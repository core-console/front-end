import {
  LedgerCreatedReceipt,
  LedgerRejectedReceipt,
  LedgerTerminalProblem,
  AccountCreatedReceipt,
  CategoryCreatedReceipt,
  AccountTerminalProblem,
  CategoryTerminalProblem,
  TransactionCreatedReceipt,
  TransactionSubmissionReceipt,
} from "../api/generated/schemas/index.ts";

export function createdTransactionReceipt(
  submissionId: string,
  ledgerId: string,
  transactionId: string,
) {
  return TransactionCreatedReceipt.parse({
    ...createdLedgerReceipt(submissionId, transactionId),
    operation: "createFinanceTransaction",
    targetLedgerId: ledgerId,
    outcome: {
      kind: "created",
      resource: { type: "transaction", id: transactionId },
    },
  });
}

export function rejectedTransactionReceipt(
  submissionId: string,
  ledgerId: string,
  problem: unknown,
) {
  return TransactionSubmissionReceipt.parse({
    ...createdTransactionReceipt(submissionId, ledgerId, ledgerId),
    outcome: { kind: "rejected", problem },
  });
}

export const submissionTestUser = {
  id: "edb4ee80-17c6-46b5-863e-2afa18e84043",
  displayName: "Core Console Operator",
  email: "operator@example.com",
  username: "operator",
};

export function createdLedgerReceipt(submissionId: string, ledgerId: string) {
  return LedgerCreatedReceipt.parse({
    submissionId,
    commandVersion: "1",
    operation: "createFinanceLedger",
    targetLedgerId: null,
    admittedAt: "2026-10-03T00:00:00Z",
    resolvedAt: "2026-10-03T00:00:01Z",
    outcome: { kind: "created", resource: { type: "ledger", id: ledgerId } },
  });
}

export function createdAccountReceipt(
  submissionId: string,
  ledgerId: string,
  accountId: string,
) {
  return AccountCreatedReceipt.parse({
    ...createdLedgerReceipt(submissionId, accountId),
    operation: "createFinanceAccount",
    targetLedgerId: ledgerId,
    outcome: { kind: "created", resource: { type: "account", id: accountId } },
  });
}

export function createdCategoryReceipt(
  submissionId: string,
  ledgerId: string,
  categoryId: string,
) {
  return CategoryCreatedReceipt.parse({
    ...createdLedgerReceipt(submissionId, categoryId),
    operation: "createFinanceCategory",
    targetLedgerId: ledgerId,
    outcome: {
      kind: "created",
      resource: { type: "category", id: categoryId },
    },
  });
}

export function rejectedNestedProblem(
  operation: "createFinanceAccount" | "createFinanceCategory",
  submissionId: string,
  ledgerId: string,
) {
  const account = operation === "createFinanceAccount";
  const problem = {
    type: "about:blank",
    title: account ? "Validation Error" : "Conflict",
    status: account ? 422 : 409,
    code: account ? "validation_error" : "finance_category_name_conflict",
    detail: account
      ? "The Account command was rejected."
      : "A Category with this name already exists.",
  };
  return (account ? AccountTerminalProblem : CategoryTerminalProblem).parse({
    ...problem,
    submissionReceipt: {
      ...createdLedgerReceipt(submissionId, ledgerId),
      operation,
      targetLedgerId: ledgerId,
      outcome: { kind: "rejected", problem },
    },
  });
}

export function rejectedLedgerProblem(submissionId: string) {
  const problem = {
    code: "finance_ledger_name_conflict",
    status: 409,
    title: "Conflict",
    type: "about:blank",
    detail: "A Ledger with this name already exists.",
  } as const;
  return LedgerTerminalProblem.parse({
    ...problem,
    submissionReceipt: LedgerRejectedReceipt.parse({
      submissionId,
      commandVersion: "1",
      operation: "createFinanceLedger",
      targetLedgerId: null,
      admittedAt: "2026-10-03T00:00:00Z",
      resolvedAt: "2026-10-03T00:00:01Z",
      outcome: { kind: "rejected", problem },
    }),
  });
}
