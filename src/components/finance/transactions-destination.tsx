import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import {
  getListFinanceTransactionsQueryKey,
  listFinanceTransactions,
  useListFinanceAccounts,
  useListFinanceCategories,
} from "@/api/generated/core-console";
import {
  AccountResponse,
  CategoryResponse,
  ListFinanceTransactionsParams,
  TransactionHistoryPageResponse,
} from "@/api/generated/schemas";
import type { TransactionHistoryPageResponseOutput } from "@/api/generated/schemas";
import { formatFinanceMoney } from "@/components/finance/finance-money";
import {
  buildFinanceSearch,
  type FinanceRouteState,
  type PortableFinanceState,
} from "@/components/finance/finance-route-state";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";

type Transaction = TransactionHistoryPageResponseOutput["items"][number];
type TransactionKind = NonNullable<ListFinanceTransactionsParams["kind"]>;
type AppliedFilters = {
  portable: PortableFinanceState;
  resource: FinanceRouteState["resource"];
};
type FilterDraft = {
  accountId: string;
  category: string;
  from: string;
  kind: "" | TransactionKind;
  to: string;
};

const transactionDateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

const transactionKindLabels = {
  balanceAdjustment: "Balance Adjustment",
  expense: "Expense",
  income: "Income",
  internalTransfer: "Internal Transfer",
} as const;

function formatTransactionDate(value: string) {
  return transactionDateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function referenceLabel(reference: { name: string; status: string }) {
  return `${reference.name}${
    reference.status === "archived" ? " (archived)" : ""
  }`;
}

function formatSignedFinanceMoney(
  money: Parameters<typeof formatFinanceMoney>[0],
) {
  const formatted = formatFinanceMoney(money);
  return money.amount.startsWith("-") ? formatted : `+${formatted}`;
}

function filtersToDraft(filters: AppliedFilters): FilterDraft {
  return {
    accountId: filters.resource.accountId ?? "",
    category:
      filters.portable.uncategorized === "true"
        ? "uncategorized"
        : filters.resource.categoryId
          ? `category:${filters.resource.categoryId}`
          : "",
    from: filters.portable.from ?? "",
    kind: (filters.portable.kind as TransactionKind | undefined) ?? "",
    to: filters.portable.to ?? "",
  };
}

function appliedFilterKey(filters: AppliedFilters) {
  return [
    filters.portable.from,
    filters.portable.to,
    filters.portable.kind,
    filters.portable.uncategorized,
    filters.resource.accountId,
    filters.resource.categoryId,
  ].join("|");
}

function FilterForm({
  accounts,
  accountsUnavailable,
  appliedFilters,
  categories,
  ledgerId,
}: {
  accounts: AccountResponse[];
  accountsUnavailable: boolean;
  appliedFilters: AppliedFilters;
  categories: CategoryResponse[];
  ledgerId: string;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<FilterDraft>(() =>
    filtersToDraft(appliedFilters),
  );
  const [dateError, setDateError] = useState("");
  const fromDateRef = useRef<HTMLInputElement | null>(null);

  const apply = () => {
    if (draft.from && draft.to && draft.from > draft.to) {
      setDateError("From date must be on or before To date.");
      fromDateRef.current?.focus();
      return;
    }

    setDateError("");
    const categoryId = draft.category.startsWith("category:")
      ? draft.category.slice("category:".length)
      : undefined;
    navigate(
      `/finance/transactions${buildFinanceSearch(
        ledgerId,
        {
          date: appliedFilters.portable.date,
          ...(draft.from ? { from: draft.from } : {}),
          ...(draft.kind ? { kind: draft.kind } : {}),
          month: appliedFilters.portable.month,
          ...(draft.to ? { to: draft.to } : {}),
          ...(draft.category === "uncategorized"
            ? { uncategorized: "true" }
            : {}),
        },
        {
          ...(draft.accountId ? { accountId: draft.accountId } : {}),
          ...(categoryId ? { categoryId } : {}),
        },
      )}`,
    );
  };

  const clear = () => {
    setDraft({ accountId: "", category: "", from: "", kind: "", to: "" });
    setDateError("");
    navigate(
      `/finance/transactions${buildFinanceSearch(ledgerId, {
        date: appliedFilters.portable.date,
        month: appliedFilters.portable.month,
      })}`,
    );
  };

  return (
    <form
      aria-label="Transaction filters"
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <FieldGroup className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Field data-invalid={dateError ? true : undefined}>
          <FieldLabel htmlFor="transaction-filter-from">From date</FieldLabel>
          <Input
            aria-describedby={dateError ? "transaction-date-error" : undefined}
            aria-invalid={dateError ? true : undefined}
            id="transaction-filter-from"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                from: event.target.value,
              }))
            }
            ref={fromDateRef}
            type="date"
            value={draft.from}
          />
        </Field>
        <Field data-invalid={dateError ? true : undefined}>
          <FieldLabel htmlFor="transaction-filter-to">To date</FieldLabel>
          <Input
            aria-invalid={dateError ? true : undefined}
            id="transaction-filter-to"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                to: event.target.value,
              }))
            }
            type="date"
            value={draft.to}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="transaction-filter-account">Account</FieldLabel>
          <NativeSelect
            disabled={accountsUnavailable}
            id="transaction-filter-account"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                accountId: event.target.value,
              }))
            }
            value={draft.accountId}
          >
            <NativeSelectOption value="">All Accounts</NativeSelectOption>
            {draft.accountId &&
            !accounts.some((account) => account.id === draft.accountId) ? (
              <NativeSelectOption value={draft.accountId}>
                Selected Account unavailable
              </NativeSelectOption>
            ) : null}
            {accounts.map((account) => (
              <NativeSelectOption key={account.id} value={account.id}>
                {referenceLabel(account)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="transaction-filter-kind">
            Transaction kind
          </FieldLabel>
          <NativeSelect
            id="transaction-filter-kind"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                kind: event.target.value as FilterDraft["kind"],
              }))
            }
            value={draft.kind}
          >
            <NativeSelectOption value="">All kinds</NativeSelectOption>
            <NativeSelectOption value="income">Income</NativeSelectOption>
            <NativeSelectOption value="expense">Expense</NativeSelectOption>
            <NativeSelectOption value="internalTransfer">
              Internal Transfer
            </NativeSelectOption>
            <NativeSelectOption value="balanceAdjustment">
              Balance Adjustment
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="transaction-filter-category">
            Category
          </FieldLabel>
          <NativeSelect
            id="transaction-filter-category"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                category: event.target.value,
              }))
            }
            value={draft.category}
          >
            <NativeSelectOption value="">All Categories</NativeSelectOption>
            <NativeSelectOption value="uncategorized">
              Uncategorized
            </NativeSelectOption>
            {draft.category.startsWith("category:") &&
            !categories.some(
              (category) => `category:${category.id}` === draft.category,
            ) ? (
              <NativeSelectOption value={draft.category}>
                Selected Category unavailable
              </NativeSelectOption>
            ) : null}
            {categories.map((category) => (
              <NativeSelectOption
                key={category.id}
                value={`category:${category.id}`}
              >
                {referenceLabel(category)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </FieldGroup>
      {dateError ? (
        <p
          className="text-sm text-destructive"
          id="transaction-date-error"
          role="alert"
        >
          {dateError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button aria-label="Apply filters" size="sm" type="submit">
          Apply
        </Button>
        <Button
          aria-label="Clear filters"
          onClick={clear}
          size="sm"
          type="button"
          variant="ghost"
        >
          Clear
        </Button>
        <p className="text-sm text-muted-foreground">
          Editing filters does not change results until Apply.
        </p>
      </div>
    </form>
  );
}

function TransactionSemantics({ transaction }: { transaction: Transaction }) {
  if (transaction.kind === "income" || transaction.kind === "expense") {
    return (
      <>
        <p className="font-medium tabular-nums">
          {formatFinanceMoney(transaction.economicAmount)}
        </p>
        <p className="text-sm text-muted-foreground">
          {transaction.kind === "income" ? "Into" : "From"}{" "}
          {referenceLabel(transaction.account)}
        </p>
      </>
    );
  }

  if (transaction.kind === "internalTransfer") {
    return (
      <>
        <p className="font-medium tabular-nums">
          {formatFinanceMoney(transaction.sourceAmount)} from{" "}
          {referenceLabel(transaction.sourceAccount)}
        </p>
        <p className="text-sm text-muted-foreground">
          {formatFinanceMoney(transaction.destinationAmount)} to{" "}
          {referenceLabel(transaction.destinationAccount)}
        </p>
      </>
    );
  }

  return (
    <>
      <p className="font-medium tabular-nums">
        Correction {formatSignedFinanceMoney(transaction.correctionDelta)}
      </p>
      <p className="text-sm text-muted-foreground">
        Adjusts {referenceLabel(transaction.account)}
      </p>
    </>
  );
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const date = formatTransactionDate(transaction.transactionDate);
  const kind = transactionKindLabels[transaction.kind];

  return (
    <article
      aria-label={`${kind} on ${date}`}
      className="grid min-w-0 gap-3 border-b border-border p-4 last:border-b-0 md:grid-cols-2 xl:grid-cols-[8.5rem_10rem_minmax(15rem,1fr)_minmax(9rem,0.65fr)_minmax(10rem,0.8fr)_auto] xl:items-center"
    >
      <p className="text-sm font-medium">{date}</p>
      <p className="text-sm">{kind}</p>
      <div className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]">
        <TransactionSemantics transaction={transaction} />
      </div>
      <p className="min-w-0 text-sm [overflow-wrap:anywhere] text-muted-foreground">
        {transaction.kind === "income" || transaction.kind === "expense"
          ? transaction.categoryAllocations[0]!.category
            ? referenceLabel(transaction.categoryAllocations[0]!.category!)
            : "Uncategorized"
          : "Not applicable"}
      </p>
      <p className="line-clamp-2 text-sm text-muted-foreground">
        {transaction.note ?? "No note"}
      </p>
      <div className="flex flex-wrap gap-1 xl:justify-end">
        <Button
          aria-label={`View details for ${kind} on ${date}`}
          disabled
          size="xs"
          type="button"
          variant="ghost"
        >
          View
        </Button>
        <Button
          aria-label={`Edit ${kind} on ${date}`}
          disabled
          size="xs"
          type="button"
          variant="ghost"
        >
          Edit
        </Button>
        <Button
          aria-label={`Delete ${kind} on ${date}`}
          disabled
          size="xs"
          type="button"
          variant="ghost"
        >
          Delete
        </Button>
      </div>
    </article>
  );
}

export function TransactionsDestination({
  ledgerId,
  portable,
  resource,
}: {
  ledgerId: string;
  portable: PortableFinanceState;
  resource: FinanceRouteState["resource"];
}) {
  const navigate = useNavigate();
  const appliedFilters = useMemo<AppliedFilters>(
    () => ({
      portable: {
        date: portable.date,
        from: portable.from,
        kind: portable.kind,
        month: portable.month,
        to: portable.to,
        uncategorized: portable.uncategorized,
      },
      resource: {
        accountId: resource.accountId,
        categoryId: resource.categoryId,
      },
    }),
    [
      portable.from,
      portable.date,
      portable.kind,
      portable.month,
      portable.to,
      portable.uncategorized,
      resource.accountId,
      resource.categoryId,
    ],
  );
  const params = useMemo(
    () =>
      ListFinanceTransactionsParams.parse({
        accountId: resource.accountId,
        categoryId: resource.categoryId,
        fromDate: portable.from,
        kind: portable.kind,
        toDate: portable.to,
        uncategorized: portable.uncategorized === "true" ? true : undefined,
      }),
    [
      portable.from,
      portable.kind,
      portable.to,
      portable.uncategorized,
      resource.accountId,
      resource.categoryId,
    ],
  );
  const accountsQuery = useListFinanceAccounts(ledgerId, {
    query: {
      select: (response) => AccountResponse.array().parse(response.data),
    },
  });
  const categoriesQuery = useListFinanceCategories(ledgerId, {
    query: {
      select: (response) => CategoryResponse.array().parse(response.data),
    },
  });
  const [announcement, setAnnouncement] = useState("");
  const paginationSnapshot = useRef({ count: 0, key: "", pages: 0 });
  const transactionsQuery = useInfiniteQuery({
    initialPageParam: undefined as string | undefined,
    queryFn: async ({
      pageParam,
      signal,
    }): Promise<TransactionHistoryPageResponseOutput> => {
      const response = await listFinanceTransactions(
        ledgerId,
        {
          ...params,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        { signal },
      );
      return TransactionHistoryPageResponse.parse(response.data);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    queryKey: [
      ...getListFinanceTransactionsQueryKey(ledgerId, params),
      "infinite",
    ],
  });
  const transactions = useMemo(() => {
    const seen = new Set<string>();
    const result: Transaction[] = [];

    for (const page of transactionsQuery.data?.pages ?? []) {
      for (const transaction of page.items) {
        if (seen.has(transaction.id)) continue;
        seen.add(transaction.id);
        result.push(transaction);
      }
    }

    return result;
  }, [transactionsQuery.data?.pages]);
  const queryIdentity = `${ledgerId}|${appliedFilterKey(appliedFilters)}`;

  useEffect(() => {
    const pageCount = transactionsQuery.data?.pages.length ?? 0;
    const previous = paginationSnapshot.current;

    if (previous.key !== queryIdentity) {
      paginationSnapshot.current = {
        count: transactions.length,
        key: queryIdentity,
        pages: pageCount,
      };
      setAnnouncement("");
      return;
    }

    if (previous.pages > 0 && pageCount > previous.pages) {
      const added = transactions.length - previous.count;
      if (added > 0) {
        setAnnouncement(
          `${added} more transaction${added === 1 ? "" : "s"} loaded.`,
        );
      }
    }

    paginationSnapshot.current = {
      count: transactions.length,
      key: queryIdentity,
      pages: pageCount,
    };
  }, [
    queryIdentity,
    transactions.length,
    transactionsQuery.data?.pages.length,
  ]);
  const hasAppliedFilters = Boolean(
    portable.from ||
    portable.to ||
    portable.kind ||
    portable.uncategorized ||
    resource.accountId ||
    resource.categoryId,
  );
  const appliedAccount = accountsQuery.data?.find(
    (account) => account.id === resource.accountId,
  );
  const appliedCategory = categoriesQuery.data?.find(
    (category) => category.id === resource.categoryId,
  );
  const appliedFilterDescriptions = [
    portable.from ? `From ${portable.from}` : null,
    portable.to ? `To ${portable.to}` : null,
    resource.accountId
      ? `Account ${appliedAccount ? referenceLabel(appliedAccount) : "unavailable"}`
      : null,
    portable.kind
      ? transactionKindLabels[portable.kind as TransactionKind]
      : null,
    portable.uncategorized === "true"
      ? "Uncategorized"
      : resource.categoryId
        ? `Category ${appliedCategory ? referenceLabel(appliedCategory) : "unavailable"}`
        : null,
  ].filter((description): description is string => description !== null);

  let historyContent;

  if (transactionsQuery.isPending) {
    historyContent = (
      <div
        aria-label="Loading Transactions"
        className="flex flex-col gap-3"
        role="status"
      >
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  } else if (transactionsQuery.isError && !transactionsQuery.data) {
    historyContent = (
      <div
        className="flex flex-col gap-3 rounded-lg border border-border p-6"
        role="alert"
      >
        <p>Transactions could not be loaded. Try again.</p>
        <Button
          className="self-start"
          onClick={() => void transactionsQuery.refetch()}
          size="sm"
          variant="outline"
        >
          Retry
        </Button>
      </div>
    );
  } else if (transactions.length === 0) {
    historyContent = (
      <Empty className="border border-border bg-card">
        <EmptyHeader>
          <EmptyTitle>
            <h2>
              {hasAppliedFilters
                ? "No matching transactions"
                : "No transactions yet"}
            </h2>
          </EmptyTitle>
          <EmptyDescription>
            {hasAppliedFilters
              ? "No history matches every applied filter. Clear filters to see all activity."
              : "Recorded Finance activity for this Ledger will appear here."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {hasAppliedFilters ? (
            <Button
              onClick={() =>
                navigate(
                  `/finance/transactions${buildFinanceSearch(ledgerId, {
                    date: portable.date,
                    month: portable.month,
                  })}`,
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              Clear filters
            </Button>
          ) : (
            <Button disabled size="sm" type="button">
              Record transaction
            </Button>
          )}
        </EmptyContent>
      </Empty>
    );
  } else {
    historyContent = (
      <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
        <div
          aria-hidden="true"
          className="hidden grid-cols-[8.5rem_10rem_minmax(15rem,1fr)_minmax(9rem,0.65fr)_minmax(10rem,0.8fr)_auto] gap-3 border-b border-border px-4 py-2 text-sm font-medium xl:grid"
        >
          <span>Date</span>
          <span>Kind</span>
          <span>Amount / Account relationship</span>
          <span>Category</span>
          <span>Note</span>
          <span>Actions</span>
        </div>
        {transactions.map((transaction) => (
          <TransactionRow key={transaction.id} transaction={transaction} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere] text-muted-foreground">
          {hasAppliedFilters
            ? `Applied filters: ${appliedFilterDescriptions.join(" · ")}`
            : "No filters applied. Showing all transactions in backend order."}
        </p>
        <Button disabled size="sm" type="button">
          Record transaction
        </Button>
      </div>
      <FilterForm
        key={appliedFilterKey(appliedFilters)}
        accounts={accountsQuery.data ?? []}
        accountsUnavailable={accountsQuery.isError}
        appliedFilters={appliedFilters}
        categories={categoriesQuery.data ?? []}
        ledgerId={ledgerId}
      />
      {accountsQuery.isError || categoriesQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Some filter choices are temporarily unavailable. Applied filters and
          Transaction history remain available.
        </p>
      ) : null}
      {historyContent}
      {transactionsQuery.isFetchNextPageError ? (
        <div
          className="flex flex-wrap items-center justify-center gap-3 rounded-lg border border-border p-3"
          role="alert"
        >
          <p className="text-sm">
            More transactions could not be loaded. Existing results are still
            available.
          </p>
          <Button
            disabled={transactionsQuery.isFetchingNextPage}
            onClick={() =>
              void transactionsQuery.fetchNextPage({ cancelRefetch: false })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            {transactionsQuery.isFetchingNextPage
              ? "Loading more…"
              : "Retry loading more"}
          </Button>
        </div>
      ) : transactionsQuery.hasNextPage ? (
        <Button
          className="self-center"
          disabled={transactionsQuery.isFetchingNextPage}
          onClick={() =>
            void transactionsQuery.fetchNextPage({ cancelRefetch: false })
          }
          type="button"
          variant="outline"
        >
          {transactionsQuery.isFetchingNextPage ? "Loading more…" : "Load more"}
        </Button>
      ) : null}
      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  );
}
