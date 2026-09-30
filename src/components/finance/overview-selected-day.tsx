import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import {
  getListFinanceTransactionsQueryKey,
  listFinanceTransactions,
  useListFinanceAccounts,
} from "@/api/generated/core-console";
import {
  AccountResponse,
  TransactionHistoryPageResponse,
  type TransactionHistoryPageResponseOutput,
} from "@/api/generated/schemas";
import { BalanceAdjustmentEditDialog } from "@/components/finance/balance-adjustment-edit-dialog";
import { formatFinanceMoney } from "@/components/finance/finance-money";
import { buildFinanceSearch } from "@/components/finance/finance-route-state";
import { formatOverviewDate } from "@/components/finance/overview-date";
import { TransactionDeleteDialog } from "@/components/finance/transaction-detail";
import { TransactionEditDialog } from "@/components/finance/transaction-edit-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

type Transaction = TransactionHistoryPageResponseOutput["items"][number];
const kindLabel = {
  balanceAdjustment: "Balance Adjustment",
  expense: "Expense",
  income: "Income",
  internalTransfer: "Internal Transfer",
} as const;

function reference(value: { id: string; name: string; status: string }) {
  return `${value.name}${value.status === "archived" ? " (archived)" : ""} (Account ID ${value.id})`;
}

function meaning(transaction: Transaction) {
  if (transaction.kind === "internalTransfer") {
    return `${formatFinanceMoney(transaction.sourceAmount)} from ${reference(transaction.sourceAccount)} to ${reference(transaction.destinationAccount)} (${formatFinanceMoney(transaction.destinationAmount)})`;
  }
  if (transaction.kind === "balanceAdjustment") {
    const delta = formatFinanceMoney(transaction.correctionDelta);
    return `Signed correction ${transaction.correctionDelta.amount.startsWith("-") ? delta : `+${delta}`} for ${reference(transaction.account)}`;
  }
  return `${formatFinanceMoney(transaction.economicAmount)} ${transaction.kind === "income" ? "into" : "from"} ${reference(transaction.account)}`;
}

export function OverviewSelectedDay({
  countStatus,
  count,
  date,
  ledgerId,
  onAnnounce,
  onRecord,
}: {
  countStatus: "ready" | "updating" | "unavailable";
  count: number | undefined;
  date: string;
  ledgerId: string;
  onAnnounce: (message: string) => void;
  onRecord: () => void;
}) {
  const [editTarget, setEditTarget] = useState<Transaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const restoreDeleteFocus = useRef(false);
  useEffect(() => {
    if (deleteTarget || !restoreDeleteFocus.current) return;
    document.getElementById("finance-title")?.focus();
    restoreDeleteFocus.current = false;
  }, [deleteTarget]);
  const accountsQuery = useListFinanceAccounts(ledgerId, {
    query: {
      select: (response) => AccountResponse.array().parse(response.data),
    },
  });
  const canRecord =
    accountsQuery.isSuccess &&
    !accountsQuery.isFetching &&
    accountsQuery.data.some((account) => account.status === "active");
  const params = useMemo(() => ({ fromDate: date, toDate: date }), [date]);
  const queryKey = useMemo(
    () => [...getListFinanceTransactionsQueryKey(ledgerId, params), "infinite"],
    [ledgerId, params],
  );
  const query = useInfiniteQuery({
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const response = await listFinanceTransactions(
        ledgerId,
        { ...params, ...(pageParam ? { cursor: pageParam } : {}) },
        { signal },
      );
      const page = TransactionHistoryPageResponse.parse(response.data);
      if (
        page.items.some(
          (item) => item.ledgerId !== ledgerId || item.transactionDate !== date,
        )
      ) {
        throw new Error(
          "Selected-day response does not match its requested context.",
        );
      }
      return page;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryKey,
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages.flatMap((page) => page.items) ?? []).filter(
      (item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      },
    );
  }, [query.data]);

  return (
    <section
      aria-labelledby="selected-day-title"
      className="min-w-0 rounded-lg border border-border bg-card"
    >
      <div className="border-b border-border p-4">
        <h2 className="text-base font-semibold" id="selected-day-title">
          Selected-day activity
        </h2>
        <p className="text-sm text-muted-foreground">
          <time dateTime={date}>{formatOverviewDate(date)}</time> ·{" "}
          {countStatus !== "ready"
            ? countStatus === "updating"
              ? "Updating activity count…"
              : "Activity count unavailable"
            : count === undefined
              ? "Activity count unavailable"
              : `${count} ${count === 1 ? "transaction" : "transactions"}`}
        </p>
      </div>
      {query.isPending ? (
        <div
          aria-label="Loading selected-day activity"
          className="flex flex-col gap-2 p-4"
          role="status"
        >
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : query.isError && !query.data ? (
        <div
          aria-label="Selected-day error"
          className="flex flex-col items-start gap-2 p-4"
          role="alert"
        >
          <p>Selected-day activity could not load. Try again.</p>
          <Button
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            size="sm"
            variant="outline"
          >
            Retry selected day
          </Button>
        </div>
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No transactions for this date</EmptyTitle>
            <EmptyDescription>
              Choose another day or record an Expense or Income for this date.
            </EmptyDescription>
          </EmptyHeader>
          <Button
            disabled={!canRecord}
            onClick={onRecord}
            size="sm"
            type="button"
            variant="outline"
          >
            Record for this date
          </Button>
        </Empty>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li className="flex min-w-0 flex-col gap-2 p-4" key={item.id}>
              <p className="font-medium">{kindLabel[item.kind]}</p>
              <p className="min-w-0 text-sm [overflow-wrap:anywhere]">
                {meaning(item)}
              </p>
              {item.kind === "income" || item.kind === "expense" ? (
                <p className="min-w-0 text-sm [overflow-wrap:anywhere] text-muted-foreground">
                  {item.categoryAllocations
                    .map((allocation) =>
                      allocation.category
                        ? `${allocation.category.name}${allocation.category.status === "archived" ? " (archived)" : ""} (Category ID ${allocation.category.id}): ${formatFinanceMoney(allocation.amount)}`
                        : `Uncategorized: ${formatFinanceMoney(allocation.amount)}`,
                    )
                    .join(" · ")}
                </p>
              ) : null}
              {item.note ? (
                <p className="min-w-0 text-sm [overflow-wrap:anywhere] text-muted-foreground">
                  {item.note}
                </p>
              ) : null}
              <p className="text-xs [overflow-wrap:anywhere] text-muted-foreground">
                Transaction ID {item.id}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      aria-label={`View details for ${kindLabel[item.kind]}, Transaction ID ${item.id}`}
                      to={`/finance/transactions/${item.id}${buildFinanceSearch(ledgerId, { date, month: date.slice(0, 7) })}&return=overview`}
                    />
                  }
                  size="xs"
                  variant="outline"
                >
                  View
                </Button>
                <Button
                  aria-label={`Edit ${kindLabel[item.kind]}, Transaction ID ${item.id}`}
                  onClick={() => setEditTarget(item)}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  Edit
                </Button>
                <Button
                  aria-label={`Delete ${kindLabel[item.kind]}, Transaction ID ${item.id}`}
                  onClick={() => setDeleteTarget(item)}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {query.isRefetchError && query.data ? (
        <div className="flex flex-wrap items-center gap-2 p-4" role="alert">
          <p>
            Selected-day activity could not refresh. Showing the last loaded
            results.
          </p>
          <Button
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            size="sm"
            variant="outline"
          >
            Retry selected day
          </Button>
        </div>
      ) : null}
      {query.isFetchNextPageError ? (
        <div className="flex items-center gap-2 p-4" role="alert">
          <p>More transactions could not load.</p>
          <Button
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
            size="sm"
            variant="outline"
          >
            Retry loading more
          </Button>
        </div>
      ) : query.hasNextPage ? (
        <Button
          className="m-4"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
          size="sm"
          variant="outline"
        >
          {query.isFetchingNextPage ? "Loading more…" : "Load more"}
        </Button>
      ) : null}
      {deleteTarget ? (
        <TransactionDeleteDialog
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            restoreDeleteFocus.current = true;
            onAnnounce("Transaction deleted.");
            setDeleteTarget(null);
          }}
          onUnavailable={() => {
            restoreDeleteFocus.current = true;
            onAnnounce("Transaction unavailable. It was already removed.");
            setDeleteTarget(null);
          }}
          open
          transaction={deleteTarget}
        />
      ) : null}
      {editTarget?.kind === "balanceAdjustment" ? (
        <BalanceAdjustmentEditDialog
          ledgerId={ledgerId}
          transactionId={editTarget.id}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            onAnnounce("Balance Adjustment updated.");
            setEditTarget(null);
          }}
          onRemoved={() => {
            onAnnounce("Balance Adjustment removed.");
            setEditTarget(null);
          }}
          onUnavailable={() => {
            onAnnounce("Transaction unavailable. It was already removed.");
            setEditTarget(null);
          }}
        />
      ) : editTarget ? (
        <TransactionEditDialog
          ledgerId={ledgerId}
          transactionId={editTarget.id}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            onAnnounce("Transaction updated.");
            setEditTarget(null);
          }}
          onUnavailable={() => {
            onAnnounce("Transaction unavailable. It was already removed.");
            setEditTarget(null);
          }}
        />
      ) : null}
    </section>
  );
}
