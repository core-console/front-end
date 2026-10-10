import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { notifyManager, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router";

import {
  getGetFinanceOverviewQueryKey,
  useGetFinanceOverview,
} from "@/api/generated/core-console";
import {
  FinanceOverviewResponse,
  type FinanceOverviewDayResponse,
  type FinanceOverviewResponse as Overview,
  type FinanceTransactionResponseOutput,
} from "@/api/generated/schemas";
import { formatFinanceMoney } from "@/components/finance/finance-money";
import { OverviewEntry } from "@/components/finance/overview-entry";
import { OverviewSelectedDay } from "@/components/finance/overview-selected-day";
import { buildFinanceSearch } from "@/components/finance/finance-route-state";
import {
  adjacentMonth,
  dateInMonth,
  daysInMonth,
  formatOverviewDate,
  formatOverviewMonth,
  localFinanceDate,
  weekday,
} from "@/components/finance/overview-date";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, messages } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type OverviewDestinationProps = {
  date: string;
  ledgerId: string;
  month: string;
};

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const kindLabels: [
  keyof FinanceOverviewDayResponse["transactionCountByKind"],
  string,
][] = [
  ["income", "Income"],
  ["expense", "Expense"],
  ["internalTransfer", "Internal Transfer"],
  ["balanceAdjustment", "Balance Adjustment"],
];

function byCurrency<T extends { currency: string }>(items: T[]) {
  return [...items].sort((left, right) =>
    left.currency < right.currency
      ? -1
      : left.currency > right.currency
        ? 1
        : 0,
  );
}

function Position({ data }: { data: Overview }) {
  return (
    <section
      aria-labelledby="current-position-title"
      className="rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <h2 className="text-base font-semibold" id="current-position-title">
        Current financial position
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Present balances, including recorded future-dated transactions.
      </p>
      {data.financialPositionByCurrency.length === 0 ? (
        <Empty className="mt-4 border border-dashed">
          <EmptyHeader>
            <EmptyTitle>No Account balances yet</EmptyTitle>
            <EmptyDescription>
              Create an Account to see your financial position.
            </EmptyDescription>
          </EmptyHeader>
          <Link
            className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            to={`/finance/accounts${buildFinanceSearch(data.ledger.id)}`}
          >
            Go to Accounts
          </Link>
        </Empty>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {byCurrency(data.financialPositionByCurrency).map((group) => (
            <div
              className="min-w-0 rounded-md border border-border p-4"
              key={group.currency}
            >
              <h3 className="font-medium">{group.currency}</h3>
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Assets</dt>
                <dd className="min-w-0 text-right [overflow-wrap:anywhere] tabular-nums">
                  {formatFinanceMoney(group.assetTotal)}
                </dd>
                <dt className="text-muted-foreground">Liabilities</dt>
                <dd className="min-w-0 text-right [overflow-wrap:anywhere] tabular-nums">
                  {formatFinanceMoney(group.liabilityTotal)}
                </dd>
                <dt className="font-medium">Net position</dt>
                <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere] tabular-nums">
                  {formatFinanceMoney(group.netPosition)}
                </dd>
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MonthSummary({
  data,
  month,
  navigation,
}: {
  data: Overview;
  month: string;
  navigation: ReactNode;
}) {
  return (
    <section
      aria-labelledby="month-activity-title"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold" id="month-activity-title">
          Selected-month activity
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            lang={locale}
            nativeButton={false}
            role="link"
            render={
              <Link
                to={`/finance/transactions${buildFinanceSearch(data.ledger.id, {
                  from: dateInMonth(month, 1),
                  to: dateInMonth(month, daysInMonth(month)),
                })}`}
              />
            }
            size="sm"
            variant="outline"
          >
            {messages.finance.viewMonthTransactions}
          </Button>
          {navigation}
        </div>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">
          Income, Expense, and net for {formatOverviewMonth(month)}.
        </p>
      </div>
      {data.monthSummaryByCurrency.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No Account currencies are represented in this Ledger yet.
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {byCurrency(data.monthSummaryByCurrency).map((group) => (
            <div
              className="min-w-0 rounded-md border border-border p-3"
              key={group.currency}
            >
              <h3 className="font-medium">{group.currency}</h3>
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Income</dt>
                <dd className="min-w-0 text-right [overflow-wrap:anywhere] tabular-nums">
                  {formatFinanceMoney(group.income)}
                </dd>
                <dt className="text-muted-foreground">Expense</dt>
                <dd className="min-w-0 text-right [overflow-wrap:anywhere] tabular-nums">
                  {formatFinanceMoney(group.expense)}
                </dd>
                <dt className="font-medium">Net</dt>
                <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere] tabular-nums">
                  {formatFinanceMoney(group.net)}
                </dd>
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AccountSummary({ data }: { data: Overview }) {
  const nameCounts = new Map<string, number>();
  for (const account of data.accounts) {
    nameCounts.set(account.name, (nameCounts.get(account.name) ?? 0) + 1);
  }

  return (
    <section
      aria-labelledby="account-summary-title"
      className="rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <h2 className="text-base font-semibold" id="account-summary-title">
          Account summary
        </h2>
        <Link
          className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          to={`/finance/accounts${buildFinanceSearch(data.ledger.id)}`}
        >
          Manage Accounts
        </Link>
      </div>
      {data.accounts.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          No Accounts in this Ledger yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {data.accounts.map((account) => (
            <li
              className="grid min-w-0 gap-1 px-4 py-3 text-sm @3xl/overview:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] @3xl/overview:items-center @3xl/overview:gap-4"
              key={account.id}
            >
              <div className="min-w-0">
                <p className="font-medium [overflow-wrap:anywhere]">
                  {account.name}
                </p>
                {nameCounts.get(account.name)! > 1 ? (
                  <p className="text-xs [overflow-wrap:anywhere] text-muted-foreground">
                    Account ID {account.id}
                  </p>
                ) : null}
              </div>
              <p className="text-muted-foreground">
                {account.nature === "asset" ? "Asset" : "Liability"} ·{" "}
                {account.currency}
              </p>
              <p className="[overflow-wrap:anywhere] tabular-nums">
                {formatFinanceMoney(account.currentBalance)}
              </p>
              <p className="text-muted-foreground">
                {account.status === "active" ? "Active" : "Archived"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Calendar({
  countStatus,
  data,
  date,
  focusAfterMonthChange,
  month,
  onMonthFocusRestored,
  onSelect,
}: {
  countStatus: "ready" | "updating" | "unavailable";
  data: Overview | undefined;
  date: string;
  focusAfterMonthChange: boolean;
  month: string;
  onMonthFocusRestored: () => void;
  onSelect: (date: string) => void;
}) {
  const [focusedDate, setFocusedDate] = useState(date);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const gridRef = useRef<HTMLDivElement>(null);
  const priorSelection = useRef(date);

  useEffect(() => {
    if (priorSelection.current !== date || focusAfterMonthChange) {
      const wasInGrid = gridRef.current?.contains(document.activeElement);
      setFocusedDate(date);
      if (wasInGrid || focusAfterMonthChange) {
        dayRefs.current.get(date)?.focus();
      }
      if (focusAfterMonthChange) onMonthFocusRestored();
      priorSelection.current = date;
    }
  }, [date, focusAfterMonthChange, onMonthFocusRestored]);

  const activity = new Map(data?.days.map((day) => [day.date, day]) ?? []);
  const firstDay = weekday(`${month}-01`);
  const count = daysInMonth(month);
  const cells = Array.from(
    { length: Math.ceil((firstDay + count) / 7) * 7 },
    (_, index) => {
      const day = index - firstDay + 1;
      return day >= 1 && day <= count ? dateInMonth(month, day) : null;
    },
  );

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, next: number) => {
    event.preventDefault();
    if (next < 1 || next > count) return;
    const nextDate = dateInMonth(month, next);
    setFocusedDate(nextDate);
    dayRefs.current.get(nextDate)?.focus();
  };

  return (
    <section
      aria-labelledby="calendar-title"
      className="rounded-lg border border-border bg-card"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold" id="calendar-title">
          Calendar
        </h2>
        <p className="text-sm text-muted-foreground">
          {formatOverviewMonth(month)} · Selected {formatOverviewDate(date)}
        </p>
        {countStatus !== "ready" ? (
          <p className="text-sm text-muted-foreground">
            {countStatus === "updating"
              ? "Updating Calendar activity."
              : "Calendar activity counts unavailable. Retry Overview."}
          </p>
        ) : null}
      </div>
      <div aria-label={`${month} Finance calendar`} ref={gridRef} role="grid">
        <div
          className="grid grid-cols-7 border-b border-border bg-muted/40"
          role="row"
        >
          {weekdays.map((name) => (
            <div
              className="px-1 py-2 text-center text-xs font-medium text-muted-foreground"
              key={name}
              role="columnheader"
            >
              <span className="hidden sm:inline">{name}</span>
              <span className="sm:hidden">{name[0]}</span>
            </div>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, week) => (
          <div className="grid grid-cols-7" key={week} role="row">
            {cells.slice(week * 7, week * 7 + 7).map((cell, column) => {
              const day =
                cell && countStatus === "ready"
                  ? activity.get(cell)
                  : undefined;
              const kinds = day
                ? kindLabels
                    .filter(([kind]) => day.transactionCountByKind[kind] > 0)
                    .map(([, label]) => label)
                : [];
              const currencies =
                day?.activityByCurrency.map((item) => item.currency).sort() ??
                [];
              const isToday = cell === localFinanceDate();
              const selected = cell === date;
              const accessibleName = cell
                ? [
                    cell,
                    formatOverviewDate(cell),
                    isToday ? "Today" : null,
                    selected ? "Selected" : null,
                    countStatus !== "ready"
                      ? countStatus === "updating"
                        ? "Updating activity"
                        : "Activity count unavailable"
                      : day
                        ? `${day.transactionCount} ${day.transactionCount === 1 ? "transaction" : "transactions"}`
                        : "No transactions",
                    ...kinds,
                    currencies.length > 0 ? currencies.join(" and ") : null,
                  ]
                    .filter(Boolean)
                    .join(", ")
                : undefined;

              return (
                <div
                  className="min-w-0 border-r border-b border-border last:border-r-0"
                  key={cell ?? `blank-${week}-${column}`}
                  role="gridcell"
                >
                  {cell ? (
                    <button
                      aria-label={accessibleName}
                      aria-pressed={selected}
                      className={cn(
                        "flex min-h-20 w-full min-w-0 flex-col items-start gap-1 p-1.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:min-h-24 sm:p-2",
                        selected && "bg-accent",
                        !selected && "hover:bg-muted/40",
                      )}
                      onClick={() => {
                        setFocusedDate(cell);
                        onSelect(cell);
                      }}
                      onFocus={() => setFocusedDate(cell)}
                      onKeyDown={(event) => {
                        const current = Number(cell.slice(8, 10));
                        if (event.key === "ArrowLeft")
                          moveFocus(event, current - 1);
                        if (event.key === "ArrowRight")
                          moveFocus(event, current + 1);
                        if (event.key === "ArrowUp")
                          moveFocus(event, current - 7);
                        if (event.key === "ArrowDown")
                          moveFocus(event, current + 7);
                        if (event.key === "Home")
                          moveFocus(
                            event,
                            Math.max(1, current - weekday(cell)),
                          );
                        if (event.key === "End")
                          moveFocus(
                            event,
                            Math.min(count, current + 6 - weekday(cell)),
                          );
                      }}
                      ref={(element) => {
                        if (element) dayRefs.current.set(cell, element);
                        else dayRefs.current.delete(cell);
                      }}
                      tabIndex={cell === focusedDate ? 0 : -1}
                      type="button"
                    >
                      <span className="flex w-full flex-wrap items-center gap-1 font-medium">
                        {Number(cell.slice(8, 10))}
                        {isToday ? (
                          <span className="text-[10px]">Today</span>
                        ) : null}
                        {selected ? (
                          <span className="text-[10px]">Selected</span>
                        ) : null}
                      </span>
                      {day ? (
                        <span className="min-w-0 [overflow-wrap:anywhere] text-muted-foreground">
                          {day.transactionCount}{" "}
                          {day.transactionCount === 1
                            ? "transaction"
                            : "transactions"}
                          <span className="block">{kinds.join(" · ")}</span>
                          {currencies.length > 0 ? (
                            <span className="block">
                              {currencies.length <= 2
                                ? currencies.join(" · ")
                                : `${currencies.length} currencies`}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                  ) : (
                    <div
                      aria-hidden="true"
                      className="min-h-20 bg-muted/30 sm:min-h-24"
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function OverviewLoading({ navigation }: { navigation: ReactNode }) {
  return (
    <div
      aria-label="Loading Finance Overview"
      className="flex flex-col gap-4"
      role="status"
    >
      <Skeleton className="h-40 w-full" />
      {navigation}
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
      <span className="sr-only">Loading Finance Overview…</span>
    </div>
  );
}

export function OverviewDestination({
  date,
  ledgerId,
  month,
}: OverviewDestinationProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [focusMonth, setFocusMonth] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const overviewKey = getGetFinanceOverviewQueryKey(ledgerId, { month });
  const overviewLifecycle = useSyncExternalStore(
    useCallback(
      (notify) =>
        queryClient.getQueryCache().subscribe(notifyManager.batchCalls(notify)),
      [queryClient],
    ),
    useCallback(() => {
      const state = queryClient.getQueryState(
        getGetFinanceOverviewQueryKey(ledgerId, { month }),
      );
      return state
        ? `${state.status}:${state.fetchStatus}:${state.isInvalidated}:${state.dataUpdateCount}`
        : "missing";
    }, [ledgerId, month, queryClient]),
  );
  const query = useGetFinanceOverview(
    ledgerId,
    { month },
    {
      query: {
        select: (response) => {
          const data = FinanceOverviewResponse.parse(response.data);
          if (data.ledger.id !== ledgerId || data.month !== month) {
            throw new Error(
              "Overview response does not match its requested context.",
            );
          }
          return data;
        },
      },
    },
  );
  const overviewState = queryClient.getQueryState(overviewKey);
  // The exact query's invalidation and fetch lifecycle is the count authority.
  // Reading the cache without this subscription would leave mounted counts stale.
  const countStatus =
    query.isSuccess &&
    query.data?.ledger.id === ledgerId &&
    query.data.month === month &&
    overviewState?.status === "success" &&
    overviewState.fetchStatus === "idle" &&
    !overviewState.isInvalidated &&
    overviewState.dataUpdateCount > 0
      ? "ready"
      : query.isError || overviewLifecycle === "missing"
        ? "unavailable"
        : "updating";

  const recordTransaction = async (
    transaction: FinanceTransactionResponseOutput,
  ) => {
    setAnnouncement(
      `${transaction.kind === "internalTransfer" ? "Internal Transfer" : transaction.kind === "income" ? "Income" : "Expense"} recorded.`,
    );
  };

  const recordAdjustment = async (outcome: "created" | "noChange") => {
    setAnnouncement(
      outcome === "created"
        ? "Balance Adjustment recorded."
        : "Balance already matched the target. No Balance Adjustment was created.",
    );
  };

  const navigateTo = (nextMonth: string, nextDate: string) => {
    navigate(
      `/finance/overview${buildFinanceSearch(ledgerId, {
        date: nextDate,
        month: nextMonth,
      })}`,
    );
  };

  const moveMonth = (offset: -1 | 1) => {
    const nextMonth = adjacentMonth(month, offset);
    if (!nextMonth) return;
    setFocusMonth(nextMonth);
    navigateTo(nextMonth, dateInMonth(nextMonth, Number(date.slice(8, 10))));
  };

  const navigation = (
    <div
      aria-label="Overview month navigation"
      className="flex items-center gap-2"
      role="group"
    >
      <Button
        aria-label="Previous month"
        disabled={adjacentMonth(month, -1) === null}
        onClick={() => moveMonth(-1)}
        size="icon-sm"
        variant="outline"
      >
        <ChevronLeftIcon />
      </Button>
      <time
        aria-label={`Selected month ${month}`}
        aria-live="polite"
        className="min-w-32 text-center text-sm font-medium"
        dateTime={month}
      >
        {formatOverviewMonth(month)}
      </time>
      <Button
        aria-label="Next month"
        disabled={adjacentMonth(month, 1) === null}
        onClick={() => moveMonth(1)}
        size="icon-sm"
        variant="outline"
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );

  return (
    <div className="@container/overview flex min-w-0 flex-col gap-5">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {!query.data && query.isError ? navigation : null}
      {query.isError ? (
        <div
          aria-label="Finance Overview error"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-5"
          role="alert"
        >
          <p>
            Finance Overview could not load for {formatOverviewMonth(month)}.
            {query.data ? " Showing the last loaded Overview." : ""} Try again.
          </p>
          <Button
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            size="sm"
            variant="outline"
          >
            Retry Overview
          </Button>
        </div>
      ) : null}
      {query.isPending && !query.data ? (
        <OverviewLoading navigation={navigation} />
      ) : query.data ? (
        <>
          {query.isFetching ? (
            <p className="text-sm text-muted-foreground" role="status">
              Refreshing Finance Overview…
            </p>
          ) : null}
          <Position data={query.data} />
          <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <MonthSummary
              data={query.data}
              month={month}
              navigation={navigation}
            />
          </div>
        </>
      ) : null}
      <div
        className={cn(
          "grid min-w-0 gap-5",
          query.data &&
            "@5xl/overview:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]",
        )}
      >
        <Calendar
          countStatus={countStatus}
          data={query.data}
          date={date}
          focusAfterMonthChange={focusMonth === month}
          month={month}
          onMonthFocusRestored={() => setFocusMonth(null)}
          onSelect={(selectedDate) => navigateTo(month, selectedDate)}
        />
        <div className="flex min-w-0 flex-col gap-5">
          <OverviewEntry
            date={date}
            ledgerId={ledgerId}
            onAdjusted={recordAdjustment}
            onRecorded={recordTransaction}
          />
          <OverviewSelectedDay
            countStatus={countStatus}
            count={
              query.data?.days.find((day) => day.date === date)
                ?.transactionCount
            }
            date={date}
            key={`${ledgerId}:${date}`}
            ledgerId={ledgerId}
            onAnnounce={setAnnouncement}
            onRecord={() =>
              document.getElementById("quick-entry-amount")?.focus()
            }
          />
        </div>
      </div>
      {query.data ? <AccountSummary data={query.data} /> : null}
    </div>
  );
}
