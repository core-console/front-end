import { locale, messages } from "@/lib/i18n";

import { ProblemDetails } from "@/api/generated/schemas";

const copy = messages.finance.quickEntry.validation;

export type TransactionProblemFeedback = {
  field?: "accountId" | "categoryId" | "transactionDate";
  message: string;
};

type TransactionProblemContext = {
  locale?: typeof locale;
  accountLabel?: string;
  categoryLabel?: string;
};

const trackingStartDetail =
  "Transaction Date cannot be before the Account Tracking Start Date.";

export function getTransactionProblemFeedback(
  error: unknown,
  fallback: string,
  context: TransactionProblemContext = {},
): TransactionProblemFeedback {
  const localized = context.locale === locale;
  const result = ProblemDetails.safeParse(
    typeof error === "object" && error !== null && "info" in error
      ? error.info
      : undefined,
  );

  if (!result.success) return { message: fallback };

  if (
    result.data.code === "validation_error" &&
    result.data.detail === trackingStartDetail
  ) {
    return {
      field: "transactionDate",
      message: localized
        ? copy.trackingDate
        : "Choose a Transaction Date on or after the Account's Tracking Start Date.",
    };
  }

  switch (result.data.code) {
    case "validation_error":
      return {
        message: localized
          ? copy.fields
          : "Check the Transaction fields and try again.",
      };
    case "finance_account_archived":
      return {
        field: "accountId",
        message: localized
          ? copy.accountArchived(context.accountLabel)
          : context.accountLabel
            ? `The selected Account — ${context.accountLabel} — was archived. Choose another active Account; your other values have been kept.`
            : "This Account was archived. Choose another active Account; your other values have been kept.",
      };
    case "finance_account_not_found":
      return {
        field: "accountId",
        message: localized
          ? copy.accountMissing(context.accountLabel)
          : context.accountLabel
            ? `The selected Account — ${context.accountLabel} — is no longer available. Choose another active Account; your other values have been kept.`
            : "This Account is no longer available. Choose another active Account; your other values have been kept.",
      };
    case "finance_category_archived":
      return {
        field: "categoryId",
        message: localized
          ? copy.categoryArchived(context.categoryLabel)
          : context.categoryLabel
            ? `The selected Category — ${context.categoryLabel} — was archived. Choose another active Category or Uncategorized; your other values have been kept.`
            : "This Category was archived. Choose another active Category or Uncategorized; your other values have been kept.",
      };
    case "finance_category_not_found":
      return {
        field: "categoryId",
        message: localized
          ? copy.categoryMissing(context.categoryLabel)
          : context.categoryLabel
            ? `The selected Category — ${context.categoryLabel} — is no longer available. Choose another active Category or Uncategorized; your other values have been kept.`
            : "This Category is no longer available. Choose another active Category or Uncategorized; your other values have been kept.",
      };
    case "database_unavailable":
    case "database_not_configured":
      return {
        message: localized
          ? copy.unavailable
          : "Transactions are temporarily unavailable. Try again later.",
      };
    default:
      return { message: fallback };
  }
}
