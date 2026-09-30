import {
  type InfiniteData,
  type QueryClient,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

import {
  getGetFinanceOverviewQueryKey,
  getGetFinanceTransactionQueryKey,
  getListFinanceAccountsQueryKey,
  getListFinanceTransactionsQueryKey,
} from "@/api/generated/core-console";
import type {
  FinanceTransactionResponseOutput,
  TransactionHistoryPageResponseOutput,
} from "@/api/generated/schemas";

type TerminalDeletion = "deleted" | "unavailable";
const deletionKey = (ledgerId: string, transactionId: string) =>
  ["finance-transaction-deletion", ledgerId, transactionId] as const;

export function getTransactionDeletion(
  queryClient: QueryClient,
  ledgerId: string,
  transactionId: string,
) {
  return queryClient.getQueryData<TerminalDeletion>(
    deletionKey(ledgerId, transactionId),
  );
}

export function useTransactionDeletion(
  ledgerId: string,
  transactionId: string,
) {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (listener: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        if (
          key[0] === "finance-transaction-deletion" &&
          key[1] === ledgerId &&
          key[2] === transactionId
        )
          listener();
      }),
    [queryClient, ledgerId, transactionId],
  );
  const snapshot = useCallback(
    () => getTransactionDeletion(queryClient, ledgerId, transactionId),
    [queryClient, ledgerId, transactionId],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export async function settleTransactionDeletion(
  queryClient: QueryClient,
  transaction: FinanceTransactionResponseOutput,
  result: TerminalDeletion,
) {
  const ledgerId = transaction.ledgerId;
  const transactionId = transaction.id;
  const markerKey = deletionKey(ledgerId, transactionId);
  // This separate entry retains the irreversible result for the QueryClient session.
  queryClient
    .getQueryCache()
    .build(queryClient, { queryKey: markerKey, gcTime: Infinity });
  queryClient.setQueryData<TerminalDeletion>(markerKey, result);
  const detailKey = getGetFinanceTransactionQueryKey(ledgerId, transactionId);
  const historyKey = getListFinanceTransactionsQueryKey(ledgerId);
  await Promise.all([
    queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
    queryClient.cancelQueries({ queryKey: historyKey }),
  ]);
  void queryClient.invalidateQueries({
    queryKey: getGetFinanceOverviewQueryKey(ledgerId),
    refetchType: "none",
  });
  queryClient.removeQueries({ queryKey: detailKey, exact: true });
  queryClient.setQueriesData<
    InfiniteData<TransactionHistoryPageResponseOutput>
  >({ queryKey: historyKey }, (current) =>
    current?.pages
      ? {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== transactionId),
          })),
        }
      : current,
  );
  const accountIds =
    transaction.kind === "internalTransfer"
      ? [transaction.sourceAccount.id, transaction.destinationAccount.id]
      : [transaction.account.id];
  void Promise.allSettled([
    queryClient.invalidateQueries({ queryKey: historyKey }),
    queryClient.invalidateQueries({
      queryKey: getListFinanceAccountsQueryKey(ledgerId),
    }),
    queryClient.invalidateQueries({
      queryKey: getGetFinanceOverviewQueryKey(ledgerId),
    }),
    ...accountIds.map((accountId) =>
      queryClient.invalidateQueries({
        predicate: (query) =>
          String(query.queryKey[0]).includes(
            `/finance/ledgers/${ledgerId}/accounts/${accountId}/balance-adjustment-context`,
          ),
      }),
    ),
  ]);
}
