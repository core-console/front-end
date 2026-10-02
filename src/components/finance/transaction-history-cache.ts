import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";

import { getListFinanceTransactionsQueryKey } from "@/api/generated/core-console";
import {
  ListFinanceTransactionsParams,
  type FinanceTransactionResponseOutput,
  type ReplaceBalanceAdjustmentResultResponseOutput,
  type TransactionHistoryPageResponseOutput,
} from "@/api/generated/schemas";

type OrdinaryFinanceTransaction = Extract<
  FinanceTransactionResponseOutput,
  { kind: "income" | "expense" | "internalTransfer" }
>;
type History = InfiniteData<
  TransactionHistoryPageResponseOutput,
  string | undefined
>;

// Private fields keep the temporary membership snapshot opaque to callers.
class BalanceAdjustmentHistoryMembership {
  readonly #queryClient: QueryClient;
  readonly #ledgerId: string;
  readonly #transactionId: string;
  readonly #originallyPresent: ReadonlySet<string>;

  constructor(
    queryClient: QueryClient,
    ledgerId: string,
    transactionId: string,
  ) {
    this.#queryClient = queryClient;
    this.#ledgerId = ledgerId;
    this.#transactionId = transactionId;
    this.#originallyPresent = new Set(
      queryClient
        .getQueriesData<History>({
          queryKey: getListFinanceTransactionsQueryKey(ledgerId),
        })
        .filter(([, current]) =>
          current?.pages?.some((page) =>
            page.items.some((item) => item.id === transactionId),
          ),
        )
        .map(([queryKey]) => JSON.stringify(queryKey)),
    );
  }

  static reconcile(
    snapshot: BalanceAdjustmentHistoryMembership,
    result: ReplaceBalanceAdjustmentResultResponseOutput,
  ): void {
    const queryClient = snapshot.#queryClient;
    const transactionId = snapshot.#transactionId;
    const historyRoot = getListFinanceTransactionsQueryKey(snapshot.#ledgerId);
    for (const [key, current] of queryClient.getQueriesData<History>({
      queryKey: historyRoot,
    })) {
      if (!current?.pages) continue;
      const parsed = ListFinanceTransactionsParams.safeParse(key[1] ?? {});
      const oldItems = current.pages.flatMap((page) => page.items);
      const items = oldItems.filter((item) => item.id !== transactionId);
      if (
        result.outcome === "updated" &&
        (oldItems.some((item) => item.id === transactionId) ||
          snapshot.#originallyPresent.has(JSON.stringify(key))) &&
        parsed.success &&
        matches(result.transaction, parsed.data)
      )
        items.push(result.transaction);
      queryClient.setQueryData(key, projectPages(current, items));
    }
  }
}

export type BalanceAdjustmentHistorySnapshot =
  BalanceAdjustmentHistoryMembership;

export function captureBalanceAdjustmentHistoryMembership(
  queryClient: QueryClient,
  ledgerId: string,
  transactionId: string,
): BalanceAdjustmentHistorySnapshot {
  return new BalanceAdjustmentHistoryMembership(
    queryClient,
    ledgerId,
    transactionId,
  );
}

export function reconcileBalanceAdjustmentReplacementHistories(
  snapshot: BalanceAdjustmentHistorySnapshot,
  result: ReplaceBalanceAdjustmentResultResponseOutput,
): void {
  BalanceAdjustmentHistoryMembership.reconcile(snapshot, result);
}

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

function projectPages(
  current: History,
  items: FinanceTransactionResponseOutput[],
) {
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
}

function reconcileOne(
  queryClient: QueryClient,
  key: QueryKey,
  params: ListFinanceTransactionsParams,
  confirmed: FinanceTransactionResponseOutput,
) {
  queryClient.setQueryData<History>(key, (current) => {
    if (!current) return current;
    const items = current.pages
      .flatMap((page) => page.items)
      .filter((item) => item.id !== confirmed.id);
    if (matches(confirmed, params)) items.push(confirmed);
    return projectPages(current, items);
  });
}

export function reconcileOrdinaryReplacementHistories(
  queryClient: QueryClient,
  ledgerId: string,
  transactionId: string,
  confirmed: OrdinaryFinanceTransaction,
): void {
  const historyRoot = getListFinanceTransactionsQueryKey(ledgerId);
  for (const [key, current] of queryClient.getQueriesData<History>({
    queryKey: historyRoot,
  })) {
    if (!current?.pages) continue;
    const parsed = ListFinanceTransactionsParams.safeParse(key[1] ?? {});
    const oldItems = current.pages.flatMap((page) => page.items);
    const items = oldItems.filter((item) => item.id !== transactionId);
    if (
      oldItems.some((item) => item.id === transactionId) &&
      parsed.success &&
      matches(confirmed, parsed.data)
    )
      items.push(confirmed);
    queryClient.setQueryData(key, projectPages(current, items));
  }
}

export function reconcileLedgerTransactionHistories(
  queryClient: QueryClient,
  ledgerId: string,
  confirmed: FinanceTransactionResponseOutput,
): void {
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
