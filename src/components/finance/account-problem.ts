import { ProblemDetails } from "@/api/generated/schemas";

type AccountProblemFeedback = {
  field?: "trackingStartDate";
  message: string;
};

const trackingStartHistoryDetail =
  "Tracking Start Date cannot be later than associated Transaction history.";

export function getAccountProblemFeedback(
  error: unknown,
  fallback: string,
): AccountProblemFeedback {
  const result = ProblemDetails.safeParse(
    typeof error === "object" && error !== null && "info" in error
      ? error.info
      : undefined,
  );

  if (!result.success) return { message: fallback };

  if (
    result.data.code === "validation_error" &&
    result.data.detail === trackingStartHistoryDetail
  ) {
    return {
      field: "trackingStartDate",
      message:
        "Choose a Tracking Start Date on or before the Account's earliest Transaction.",
    };
  }

  switch (result.data.code) {
    case "validation_error":
      return { message: "Check the Account fields and try again." };
    case "finance_account_not_found":
      return {
        message:
          "This Account is no longer available. Refresh the list and try again.",
      };
    case "database_unavailable":
      return {
        message: "Accounts are temporarily unavailable. Try again later.",
      };
    default:
      return { message: fallback };
  }
}
