import { ProblemDetails } from "@/api/generated/schemas";

export function getLedgerProblemMessage(error: unknown, fallback: string) {
  const result = ProblemDetails.safeParse(
    typeof error === "object" && error !== null && "info" in error
      ? error.info
      : undefined,
  );

  if (!result.success) return fallback;

  switch (result.data.code) {
    case "finance_ledger_name_conflict":
      return "A Ledger with this name already exists.";
    case "validation_error":
      return "Enter a valid Ledger name and try again.";
    case "database_unavailable":
      return "Finance is temporarily unavailable. Try again later.";
    default:
      return fallback;
  }
}
