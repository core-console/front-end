import { ProblemDetails } from "@/api/generated/schemas";

export function getUserProblemMessage(error: unknown, fallback: string) {
  const result = ProblemDetails.safeParse(
    typeof error === "object" && error !== null && "info" in error
      ? error.info
      : undefined,
  );

  if (!result.success) return fallback;

  switch (result.data.code) {
    case "user_conflict":
      return "A user with this external identity already exists.";
    case "user_not_found":
      return "This user no longer exists. Refresh the list and try again.";
    case "cannot_deactivate_self":
      return "You cannot deactivate your own account.";
    case "validation_error":
      return "Check the user fields and try again.";
    case "database_unavailable":
      return "Core Console cannot reach the user database. Try again later.";
    default:
      return fallback;
  }
}
