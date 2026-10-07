import type { QueryClient } from "@tanstack/react-query";
import {
  getFinanceTransaction,
  getGetFinanceOverviewQueryKey,
  getListFinanceAccountsQueryKey,
  getListFinanceTransactionsQueryKey,
  getGetBalanceAdjustmentContextQueryKey,
} from "@/api/generated/core-console";
import { FinanceTransactionResponse } from "@/api/generated/schemas";
import { getTransactionDeletion } from "./transaction-deletion";
import {
  balanceAdjustmentReplacementKey,
  balanceAdjustmentReplacementPending,
  balanceAdjustmentReplacementRevision,
} from "./balance-adjustment-replacement-lock";
import { reconcileLedgerTransactionHistories } from "./transaction-history-cache";
import {
  replacementKey,
  replacementPending,
  replacementRevision,
} from "./ordinary-transaction-replacement";
import {
  SubmissionRecoveryError,
  type FinanceSubmission,
} from "./submission-journal";

export async function refreshSubmittedTransaction(
  queryClient: QueryClient,
  record: Extract<
    FinanceSubmission,
    { operation: "createFinanceTransaction" | "createBalanceAdjustment" }
  >,
  id: string | undefined,
  matches: () => boolean,
  refreshFailed: () => void,
) {
  const ledgerId = record.targetLedgerId;
  const adjustment = record.operation === "createBalanceAdjustment";
  const accountIds = new Set(
    record.operation === "createBalanceAdjustment"
      ? [record.body.accountId]
      : record.body.kind === "internalTransfer"
        ? [record.body.sourceAccountId, record.body.destinationAccountId]
        : [record.body.accountId],
  );
  const historyKey = getListFinanceTransactionsQueryKey(ledgerId);
  const lockKey = id
    ? adjustment
      ? balanceAdjustmentReplacementKey(ledgerId, id)
      : replacementKey(ledgerId, id)
    : "";
  const pending = () =>
    adjustment
      ? balanceAdjustmentReplacementPending(lockKey)
      : replacementPending(lockKey);
  const currentRevision = adjustment
    ? balanceAdjustmentReplacementRevision
    : replacementRevision;
  const revision = currentRevision();
  // Invalidation covers current balances, counts and selected-day authority,
  // including when the resource no longer exists. Receipts supply no snapshots.
  const refreshQueries = () => {
    if (!matches() || pending()) return Promise.resolve();
    return Promise.allSettled([
      ...(id
        ? [
            queryClient.invalidateQueries(
              { queryKey: historyKey },
              { throwOnError: true },
            ),
          ]
        : []),
      queryClient.invalidateQueries(
        { queryKey: getListFinanceAccountsQueryKey(ledgerId) },
        { throwOnError: true },
      ),
      ...(id
        ? [
            queryClient.invalidateQueries(
              { queryKey: getGetFinanceOverviewQueryKey(ledgerId) },
              { throwOnError: true },
            ),
          ]
        : []),
      ...[...accountIds].map((accountId) =>
        queryClient.invalidateQueries(
          {
            queryKey: getGetBalanceAdjustmentContextQueryKey(
              ledgerId,
              accountId,
            ),
          },
          { throwOnError: true },
        ),
      ),
    ]).then((results) => {
      if (matches() && results.some((result) => result.status === "rejected"))
        refreshFailed();
    });
  };
  // noChange has no Transaction identity; refresh current context only.
  if (!id || getTransactionDeletion(queryClient, ledgerId, id)) {
    return { refreshing: refreshQueries() };
  }
  if (pending())
    throw new SubmissionRecoveryError(
      "Transaction replacement is still in progress. Refresh after it completes.",
    );
  try {
    const response = await getFinanceTransaction(ledgerId, id, {
      cache: "no-store",
    });
    const transaction = FinanceTransactionResponse.parse(response.data);
    if (
      transaction.id !== id ||
      transaction.ledgerId !== ledgerId ||
      transaction.kind !==
        (record.operation === "createFinanceTransaction"
          ? record.body.kind
          : "balanceAdjustment")
    )
      throw new SubmissionRecoveryError(
        "Current Transaction does not match the created identity.",
      );
    if (!matches()) return {};
    if (transaction.kind === "internalTransfer") {
      accountIds.add(transaction.sourceAccount.id);
      accountIds.add(transaction.destinationAccount.id);
    } else {
      accountIds.add(transaction.account.id);
    }
    await queryClient.cancelQueries({ queryKey: historyKey });
    if (!matches()) return {};
    if (getTransactionDeletion(queryClient, ledgerId, id)) {
      return { refreshing: refreshQueries() };
    }
    if (pending() || currentRevision() !== revision)
      throw new SubmissionRecoveryError(
        "Transaction changed during refresh. Refresh its current state again.",
      );
    reconcileLedgerTransactionHistories(queryClient, ledgerId, transaction);
    const refreshing = refreshQueries();
    if (
      !matches() ||
      getTransactionDeletion(queryClient, ledgerId, id) ||
      pending() ||
      currentRevision() !== revision
    )
      return { refreshing };
    return { transaction, refreshing };
  } catch (error) {
    const refreshing = refreshQueries();
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 404
    )
      return { refreshing };
    throw error;
  }
}
