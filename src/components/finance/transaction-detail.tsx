import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import {
  getGetFinanceOverviewQueryKey,
  getGetFinanceTransactionQueryKey,
  getListFinanceAccountsQueryKey,
  getListFinanceTransactionsQueryKey,
  useDeleteFinanceTransaction,
  useGetFinanceTransaction,
} from "@/api/generated/core-console";
import { FinanceTransactionResponse } from "@/api/generated/schemas";
import type {
  FinanceTransactionResponseOutput,
  TransactionHistoryPageResponseOutput,
} from "@/api/generated/schemas";
import { formatFinanceMoney } from "@/components/finance/finance-money";
import {
  buildFinanceSearch,
  type FinanceRouteState,
} from "@/components/finance/finance-route-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type Transaction = FinanceTransactionResponseOutput;

const transactionKindLabels = {
  balanceAdjustment: "Balance Adjustment",
  expense: "Expense",
  income: "Income",
  internalTransfer: "Internal Transfer",
} as const;

const detailDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

function formatTransactionDate(value: string) {
  return detailDateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function formatSignedCorrection(money: {
  amount: string;
  currency: "CNY" | "JPY" | "USD";
}) {
  const formatted = formatFinanceMoney(money);
  return money.amount.startsWith("-") ? formatted : `+${formatted}`;
}

function accountIds(transaction: Transaction) {
  return transaction.kind === "internalTransfer"
    ? [transaction.sourceAccount.id, transaction.destinationAccount.id]
    : [transaction.account.id];
}

function Reference({
  reference,
}: {
  reference: { id: string; name: string; status: string };
}) {
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <span>
        {reference.name}
        {reference.status === "archived" ? " (archived)" : ""}
      </span>
      <span className="block text-xs text-muted-foreground">
        {reference.id}
      </span>
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 border-b border-border py-3 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 font-medium [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

function TransactionProjection({ transaction }: { transaction: Transaction }) {
  if (transaction.kind === "income" || transaction.kind === "expense") {
    return (
      <>
        <DetailField
          label={
            transaction.kind === "income" ? "Into Account" : "From Account"
          }
        >
          <Reference reference={transaction.account} />
        </DetailField>
        <DetailField label="Economic amount">
          {formatFinanceMoney(transaction.economicAmount)}
        </DetailField>
        {transaction.categoryAllocations.map((allocation, index) => (
          <Fragment key={index}>
            <DetailField label="Category">
              {allocation.category ? (
                <Reference reference={allocation.category} />
              ) : (
                "Uncategorized"
              )}
            </DetailField>
            <DetailField label="Category allocation">
              {formatFinanceMoney(allocation.amount)}
            </DetailField>
          </Fragment>
        ))}
      </>
    );
  }
  if (transaction.kind === "internalTransfer") {
    return (
      <>
        <DetailField label="Source Account">
          <Reference reference={transaction.sourceAccount} />
        </DetailField>
        <DetailField label="Source amount">
          {formatFinanceMoney(transaction.sourceAmount)}
        </DetailField>
        <DetailField label="Destination Account">
          <Reference reference={transaction.destinationAccount} />
        </DetailField>
        <DetailField label="Destination amount">
          {formatFinanceMoney(transaction.destinationAmount)}
        </DetailField>
      </>
    );
  }
  return (
    <>
      <DetailField label="Account">
        <Reference reference={transaction.account} />
      </DetailField>
      <DetailField label="Correction delta">
        {formatSignedCorrection(transaction.correctionDelta)}
      </DetailField>
      <DetailField label="Adjustment semantics">
        This signed correction changes the Account balance. It does not store a
        target balance.
      </DetailField>
    </>
  );
}

function deleteSummary(transaction: Transaction) {
  const reference = (value: { id: string; name: string; status: string }) =>
    `${value.name}${value.status === "archived" ? " (archived)" : ""} (Account ID ${value.id})`;
  if (transaction.kind === "internalTransfer") {
    return `${formatFinanceMoney(transaction.sourceAmount)} leaves ${reference(transaction.sourceAccount)} and ${formatFinanceMoney(transaction.destinationAmount)} enters ${reference(transaction.destinationAccount)}.`;
  }
  if (transaction.kind === "balanceAdjustment") {
    return `The signed correction ${formatSignedCorrection(transaction.correctionDelta)} for ${reference(transaction.account)} will be removed.`;
  }
  return `${formatFinanceMoney(transaction.economicAmount)} ${transaction.kind === "income" ? "enters" : "leaves"} ${reference(transaction.account)}.`;
}

function isNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}

export function TransactionDeleteDialog({
  onClose,
  onDeleted,
  onUnavailable,
  open,
  transaction,
}: {
  onClose: () => void;
  onDeleted: () => void;
  onUnavailable: () => void;
  open: boolean;
  transaction: Transaction;
}) {
  const queryClient = useQueryClient();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const [error, setError] = useState("");
  const mutation = useDeleteFinanceTransaction();
  const ledgerId = transaction.ledgerId;
  const transactionId = transaction.id;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reconcile = async () => {
    const historyKey = getListFinanceTransactionsQueryKey(ledgerId);
    const detailKey = getGetFinanceTransactionQueryKey(ledgerId, transactionId);
    await Promise.all([
      queryClient.cancelQueries({ queryKey: historyKey }),
      queryClient.cancelQueries({ queryKey: detailKey }),
    ]);
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
    queryClient.removeQueries({ queryKey: detailKey, exact: true });
    void Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: historyKey }),
      queryClient.invalidateQueries({
        queryKey: getListFinanceAccountsQueryKey(ledgerId),
      }),
      queryClient.invalidateQueries({
        queryKey: getGetFinanceOverviewQueryKey(ledgerId),
      }),
      ...accountIds(transaction).map((accountId) =>
        queryClient.invalidateQueries({
          predicate: (query) =>
            String(query.queryKey[0]).includes(
              `/finance/ledgers/${ledgerId}/accounts/${accountId}/balance-adjustment-context`,
            ),
        }),
      ),
    ]);
  };

  const confirm = async () => {
    setError("");
    let stale = false;
    try {
      await mutation.mutateAsync({ ledgerId, transactionId });
    } catch (failure) {
      if (isNotFound(failure)) {
        stale = true;
      } else {
        if (mounted.current)
          setError("Transaction could not be deleted. Try again.");
        return;
      }
    }
    await reconcile();
    if (!mounted.current) return;
    if (stale) onUnavailable();
    else onDeleted();
  };

  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !mutation.isPending) onClose();
      }}
      open={open}
    >
      <AlertDialogContent
        aria-busy={mutation.isPending}
        initialFocus={cancelRef}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
          <AlertDialogDescription className="min-w-0 [overflow-wrap:anywhere]">
            <span className="block">Transaction ID {transactionId}</span>
            <span className="block">
              {formatTransactionDate(transaction.transactionDate)} ·{" "}
              {transactionKindLabels[transaction.kind]}.{" "}
              {deleteSummary(transaction)} Deletion immediately changes derived
              balances and statistics. This cannot be undone or restored.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending} ref={cancelRef}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            onClick={() => void confirm()}
            variant="destructive"
          >
            {mutation.isPending ? "Deleting…" : "Delete transaction"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function TransactionDetail({
  ledgerId,
  resource,
  routeState,
  transactionId,
  returnToOverview,
}: {
  ledgerId: string;
  resource: FinanceRouteState["resource"];
  routeState: FinanceRouteState;
  transactionId: string;
  returnToOverview: boolean;
}) {
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const unavailableHeading = useRef<HTMLHeadingElement>(null);
  const historyHref = `/finance/transactions${buildFinanceSearch(ledgerId, routeState.portable, resource)}`;
  const returnHref =
    returnToOverview && routeState.portable.month && routeState.portable.date
      ? `/finance/overview${buildFinanceSearch(ledgerId, { month: routeState.portable.month, date: routeState.portable.date })}`
      : historyHref;
  const transactionQuery = useGetFinanceTransaction(ledgerId, transactionId, {
    query: {
      enabled: !unavailable,
      retry: (count, error) => !isNotFound(error) && count < 3,
      select: (response) => FinanceTransactionResponse.parse(response.data),
    },
  });
  const transaction = transactionQuery.data;
  const notAvailable =
    unavailable ||
    isNotFound(transactionQuery.error) ||
    (transaction &&
      (transaction.id !== transactionId || transaction.ledgerId !== ledgerId));

  useEffect(() => {
    if (notAvailable) unavailableHeading.current?.focus();
  }, [notAvailable]);

  if (notAvailable) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        {announcement ? <p role="status">{announcement}</p> : null}
        <h2
          className="text-lg font-semibold"
          ref={unavailableHeading}
          tabIndex={-1}
        >
          Transaction unavailable
        </h2>
        <p className="text-sm text-muted-foreground">
          This Transaction is not available in the selected Ledger.
        </p>
        <Link className="text-sm underline" to={historyHref}>
          Transactions
        </Link>
      </div>
    );
  }
  if (transactionQuery.isPending) {
    return (
      <p role="status" aria-label="Loading Transaction detail">
        Loading Transaction detail…
      </p>
    );
  }
  if (transactionQuery.isError || !transaction) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p role="alert">Transaction detail could not be loaded. Try again.</p>
        <Button
          onClick={() => void transactionQuery.refetch()}
          size="sm"
          variant="outline"
        >
          Retry
        </Button>
        <Link className="ml-3 text-sm underline" to={historyHref}>
          Transactions
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Link className="text-sm underline" to={returnHref}>
        Back to {returnToOverview ? "Overview" : "Transactions"}
      </Link>
      <article
        className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-6"
        aria-labelledby="transaction-detail-title"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 className="text-xl font-semibold" id="transaction-detail-title">
              Transaction detail
            </h2>
            <p className="text-sm text-muted-foreground">
              {transactionKindLabels[transaction.kind]}
            </p>
          </div>
          <Button onClick={() => setDeleteOpen(true)} variant="destructive">
            Delete transaction
          </Button>
        </div>
        <dl className="min-w-0 divide-y divide-border">
          <DetailField label="Transaction Date">
            {formatTransactionDate(transaction.transactionDate)}
          </DetailField>
          <DetailField label="Kind">
            {transactionKindLabels[transaction.kind]}
          </DetailField>
          <TransactionProjection transaction={transaction} />
          <DetailField label="Note">
            {transaction.note ?? "No note"}
          </DetailField>
          <DetailField label="Transaction ID">{transaction.id}</DetailField>
        </dl>
      </article>
      {deleteOpen ? (
        <TransactionDeleteDialog
          open
          transaction={transaction}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => navigate(returnHref, { replace: true })}
          onUnavailable={() => {
            setDeleteOpen(false);
            setUnavailable(true);
            setAnnouncement("Transaction unavailable. It was already removed.");
          }}
        />
      ) : null}
    </div>
  );
}
