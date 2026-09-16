import { ProblemDetails } from "@/api/generated/schemas";

export type CategoryProblemFeedback = {
  field?: "name";
  kind?: "categoryNotFound" | "nameConflict";
  message: string;
};

export function getCategoryProblemFeedback(
  error: unknown,
  fallback: string,
): CategoryProblemFeedback {
  const result = ProblemDetails.safeParse(
    typeof error === "object" && error !== null && "info" in error
      ? error.info
      : undefined,
  );

  if (!result.success) return { message: fallback };

  switch (result.data.code) {
    case "validation_error":
      return {
        field: "name",
        message: "Check the Category name and try again.",
      };
    case "finance_category_name_conflict":
      return {
        field: "name",
        kind: "nameConflict",
        message: "A Category with this name already exists.",
      };
    case "finance_category_not_found":
      return {
        kind: "categoryNotFound",
        message:
          "This Category is no longer available. Refresh the list and try again.",
      };
    case "database_unavailable":
      return {
        message: "Categories are temporarily unavailable. Try again later.",
      };
    default:
      return { message: fallback };
  }
}
