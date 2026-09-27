import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";

import { getListFinanceTransactionsQueryKey } from "@/api/generated/core-console";
import {
  ListFinanceTransactionsParams,
  type FinanceTransactionResponseOutput,
  type TransactionHistoryPageResponseOutput,
} from "@/api/generated/schemas";

function matches(
  transaction: FinanceTransactionResponseOutput,
  params: ListFinanceTransactionsParams,
) {
  if (params.fromDate && transaction.transactionDate < params.fromDate)
    return false;
  if (params.toDate && transaction.transactionDate > params.toDate)
    return false;
  if (params.kind && transaction.kind !== params.kind) return false;
  if (params.accountId) {
    const accountIds =
      transaction.kind === "internalTransfer"
        ? [transaction.sourceAccount.id, transaction.destinationAccount.id]
        : [transaction.account.id];
    if (!accountIds.includes(params.accountId)) return false;
  }
  if (
    params.categoryId &&
    ((transaction.kind !== "income" && transaction.kind !== "expense") ||
      transaction.categoryAllocations[0]?.category?.id !== params.categoryId)
  )
    return false;
  if (
    params.uncategorized &&
    ((transaction.kind !== "income" && transaction.kind !== "expense") ||
      transaction.categoryAllocations[0]?.category !== null)
  )
    return false;
  return true;
}

function reconcileOne(
  queryClient: QueryClient,
  key: QueryKey,
  params: ListFinanceTransactionsParams,
  confirmed: FinanceTransactionResponseOutput,
) {
  queryClient.setQueryData<
    InfiniteData<TransactionHistoryPageResponseOutput, string | undefined>
  >(key, (current) => {
    if (!current) return current;
    const items = current.pages
      .flatMap((page) => page.items)
      .filter((item) => item.id !== confirmed.id);
    if (matches(confirmed, params)) items.push(confirmed);
    items.sort(
      (left, right) =>
        right.transactionDate.localeCompare(left.transactionDate) ||
        right.id.localeCompare(left.id),
    );
    let offset = 0;
    return {
      ...current,
      pages: current.pages.map((page, index) => {
        const length =
          index === current.pages.length - 1
            ? items.length - offset
            : page.items.length;
        const result = { ...page, items: items.slice(offset, offset + length) };
        offset += length;
        return result;
      }),
    };
  });
}

export function reconcileLedgerTransactionHistories(
  queryClient: QueryClient,
  ledgerId: string,
  confirmed: FinanceTransactionResponseOutput,
) {
  const historyRoot = getListFinanceTransactionsQueryKey(ledgerId);
  for (const [key] of queryClient.getQueriesData({ queryKey: historyRoot })) {
    if (key.at(-1) !== "infinite") continue;
    const parsed = ListFinanceTransactionsParams.safeParse(
      typeof key[1] === "object" && key[1] !== null ? key[1] : {},
    );
    if (!parsed.success) continue;
    reconcileOne(queryClient, key, parsed.data, confirmed);
  }
}
