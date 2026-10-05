import { z } from "zod";

import {
  AccountCreatedReceipt,
  AccountSubmissionReceipt,
  AccountTerminalProblem,
  AccountValidationProblem,
  CategoryCreatedReceipt,
  CategorySubmissionReceipt,
  CategoryTerminalProblem,
  CategoryValidationProblem,
  LedgerCreatedReceipt,
  LedgerSubmissionReceipt,
  LedgerTerminalProblem,
  LedgerValidationProblem,
  SubmissionNonterminalProblem,
  TransactionCreatedReceipt,
  TransactionSubmissionReceipt,
  TransactionArchivedTerminalProblem,
  TransactionMissingTerminalProblem,
  TransactionInvalidTerminalProblem,
  TransactionValidationProblem,
} from "@/api/generated/schemas";

const receiptSchema = z.union([
  LedgerSubmissionReceipt,
  AccountSubmissionReceipt,
  CategorySubmissionReceipt,
  TransactionSubmissionReceipt,
]);
const createdReceiptSchema = z.union([
  LedgerCreatedReceipt,
  AccountCreatedReceipt,
  CategoryCreatedReceipt,
  TransactionCreatedReceipt,
]);
const terminalProblemSchema = z.union([
  LedgerTerminalProblem,
  AccountTerminalProblem,
  CategoryTerminalProblem,
  TransactionArchivedTerminalProblem,
  TransactionMissingTerminalProblem,
  TransactionInvalidTerminalProblem,
]);
const validationProblemSchema = z.union([
  LedgerValidationProblem,
  AccountValidationProblem,
  CategoryValidationProblem,
  TransactionValidationProblem,
]);

export const submissionResolutionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("receipt"),
    receipt: receiptSchema,
  }),
  z.strictObject({
    kind: z.literal("notAdmitted"),
    problem: validationProblemSchema,
  }),
]);
export type SubmissionResolution = z.infer<typeof submissionResolutionSchema>;

type SubmittedCommand = {
  ownerId: string;
  submissionId: string;
  commandVersion: string;
  operation: string;
  targetLedgerId: string | null;
  body: unknown;
  integrityBlocked: boolean;
};

export function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => equalJson(value, right[index]))
    );
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const a = Object.entries(left);
    const b = Object.entries(right);
    return (
      a.length === b.length &&
      a.every(
        ([key, value]) =>
          Object.hasOwn(right, key) &&
          equalJson(value, Reflect.get(right, key)),
      )
    );
  }
  return false;
}

export function correlates(
  command: SubmittedCommand,
  evidence: {
    submissionId: string;
    commandVersion: string;
    operation: string;
    targetLedgerId: string | null;
  },
): boolean {
  return (
    !command.integrityBlocked &&
    command.submissionId === evidence.submissionId &&
    command.commandVersion === evidence.commandVersion &&
    command.operation === evidence.operation &&
    command.targetLedgerId === evidence.targetLedgerId
  );
}

export function validResolution(
  command: SubmittedCommand,
  resolution: SubmissionResolution,
): boolean {
  if (resolution.kind === "receipt")
    return (
      correlates(command, resolution.receipt) &&
      Date.parse(resolution.receipt.resolvedAt) >=
        Date.parse(resolution.receipt.admittedAt)
    );
  const proof = resolution.problem.commandValidationRejection;
  return (
    correlates(command, proof) &&
    command.ownerId === proof.ownerId &&
    z.json().safeParse(proof.attemptedBody).success &&
    equalJson(command.body, proof.attemptedBody)
  );
}

export function createResponseResolution(
  command: SubmittedCommand,
  data: unknown,
): SubmissionResolution | null {
  const receipt = createdReceiptSchema.safeParse(data);
  if (!receipt.success) return null;
  const resolution = { kind: "receipt", receipt: receipt.data } as const;
  return validResolution(command, resolution) ? resolution : null;
}

export function errorResolution(
  command: SubmittedCommand,
  data: unknown,
): SubmissionResolution | null {
  const terminal = terminalProblemSchema.safeParse(data);
  if (terminal.success) {
    const resolution = {
      kind: "receipt",
      receipt: terminal.data.submissionReceipt,
    } as const;
    return validResolution(command, resolution) ? resolution : null;
  }
  const invalid = validationProblemSchema.safeParse(data);
  if (invalid.success) {
    const resolution = { kind: "notAdmitted", problem: invalid.data } as const;
    return validResolution(command, resolution) ? resolution : null;
  }
  return null;
}

export function nonterminalProblem(error: unknown) {
  const info =
    error && typeof error === "object" && "info" in error
      ? error.info
      : undefined;
  return SubmissionNonterminalProblem.safeParse(info);
}

export function errorBody(error: unknown): unknown {
  return error && typeof error === "object" && "info" in error
    ? error.info
    : undefined;
}
