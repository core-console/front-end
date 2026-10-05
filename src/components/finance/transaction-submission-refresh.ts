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
  record: Extract<FinanceSubmission, { operation: "createFinanceTransaction" }>,
  id: string,
  matches: () => boolean,
  refreshFailed: () => void,
) {
  const ledgerId = record.targetLedgerId;
  const accountIds = new Set(
    record.body.kind === "internalTransfer"
      ? [record.body.sourceAccountId, record.body.destinationAccountId]
      : [record.body.accountId],
  );
  const historyKey = getListFinanceTransactionsQueryKey(ledgerId);
  const lockKey = replacementKey(ledgerId, id);
  const revision = replacementRevision();
  // Invalidation covers current balances, counts and selected-day authority,
  // including when the resource no longer exists. Receipts supply no snapshots.
  const refreshQueries = () => {
    if (!matches() || replacementPending(lockKey)) return Promise.resolve();
    return Promise.allSettled([
      queryClient.invalidateQueries(
        { queryKey: historyKey },
        { throwOnError: true },
      ),
      queryClient.invalidateQueries(
        { queryKey: getListFinanceAccountsQueryKey(ledgerId) },
        { throwOnError: true },
      ),
      queryClient.invalidateQueries(
        { queryKey: getGetFinanceOverviewQueryKey(ledgerId) },
        { throwOnError: true },
      ),
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
  if (getTransactionDeletion(queryClient, ledgerId, id)) {
    return { refreshing: refreshQueries() };
  }
  if (replacementPending(lockKey))
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
      transaction.kind !== record.body.kind
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
    if (replacementPending(lockKey) || replacementRevision() !== revision)
      throw new SubmissionRecoveryError(
        "Transaction changed during refresh. Refresh its current state again.",
      );
    reconcileLedgerTransactionHistories(queryClient, ledgerId, transaction);
    const refreshing = refreshQueries();
    if (
      !matches() ||
      getTransactionDeletion(queryClient, ledgerId, id) ||
      replacementPending(lockKey) ||
      replacementRevision() !== revision
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
