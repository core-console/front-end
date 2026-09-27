import { type InfiniteData, type QueryClient } from "@tanstack/react-query";

import {
  getGetFinanceOverviewQueryKey,
  getGetFinanceTransactionQueryKey,
  getListFinanceAccountsQueryKey,
  getListFinanceTransactionsQueryKey,
} from "@/api/generated/core-console";
import {
  ProblemDetails,
  type TransactionHistoryPageResponseOutput,
} from "@/api/generated/schemas";
import { balanceAdjustmentReplacementKey } from "@/components/finance/balance-adjustment-replacement-lock";

const inFlight = new WeakMap<QueryClient, Map<string, Promise<void>>>();

export function isMissingAdjustmentTransaction(error: unknown) {
  const parsed = ProblemDetails.safeParse(
    typeof error === "object" && error !== null && "info" in error
      ? error.info
      : undefined,
  );
  const code = parsed.success ? parsed.data.code : undefined;
  return (
    code === "finance_transaction_not_found" ||
    (code !== "finance_account_not_found" &&
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 404)
  );
}

export function reconcileMissingAdjustmentTransaction(
  queryClient: QueryClient,
  ledgerId: string,
  transactionId: string,
) {
  const key = balanceAdjustmentReplacementKey(ledgerId, transactionId);
  let runs = inFlight.get(queryClient);
  if (!runs) {
    runs = new Map();
    inFlight.set(queryClient, runs);
  }
  const existing = runs.get(key);
  if (existing) return existing;

  const run = (async () => {
    const detailKey = getGetFinanceTransactionQueryKey(ledgerId, transactionId);
    const historyKey = getListFinanceTransactionsQueryKey(ledgerId);
    void queryClient.invalidateQueries({
      queryKey: getGetFinanceOverviewQueryKey(ledgerId),
      refetchType: "none",
    });
    await Promise.all([
      queryClient.cancelQueries({ queryKey: detailKey }),
      queryClient.cancelQueries({ queryKey: historyKey }),
    ]);
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
    void Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: historyKey }),
      queryClient.invalidateQueries({
        queryKey: getListFinanceAccountsQueryKey(ledgerId),
      }),
      queryClient.invalidateQueries({
        queryKey: getGetFinanceOverviewQueryKey(ledgerId),
      }),
      queryClient.resetQueries({
        predicate: (query) =>
          String(query.queryKey[0]).includes(
            `/finance/ledgers/${ledgerId}/accounts/`,
          ) &&
          String(query.queryKey[0]).includes("/balance-adjustment-context"),
      }),
    ]);
  })();
  runs.set(key, run);
  void run.then(
    () => runs.delete(key),
    () => runs.delete(key),
  );
  return run;
}
