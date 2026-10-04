import {
  LedgerCreatedReceipt,
  LedgerRejectedReceipt,
  LedgerTerminalProblem,
} from "../api/generated/schemas/index.ts";

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
