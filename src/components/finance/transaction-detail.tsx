import { useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate } from "react-router";

import {
  useDeleteFinanceTransaction,
  useGetFinanceTransaction,
} from "@/api/generated/core-console";
import { FinanceTransactionResponse } from "@/api/generated/schemas";
import type { FinanceTransactionResponseOutput } from "@/api/generated/schemas";
import { formatFinanceMoney } from "@/components/finance/finance-money";
import { BalanceAdjustmentEditDialog } from "@/components/finance/balance-adjustment-edit-dialog";
import {
  isMissingAdjustmentTransaction,
  reconcileMissingAdjustmentTransaction,
} from "@/components/finance/balance-adjustment-missing-transaction";
import {
  balanceAdjustmentReplacementKey,
  observeBalanceAdjustmentTransactionMissing,
  useBalanceAdjustmentReplacementPending,
} from "@/components/finance/balance-adjustment-replacement-lock";
import { TransactionEditDialog } from "@/components/finance/transaction-edit-dialog";
import {
  getTransactionDeletion,
  settleTransactionDeletion,
  useTransactionDeletion,
} from "@/components/finance/transaction-deletion";
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
  const terminalDeletion = useTransactionDeletion(ledgerId, transactionId);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const confirm = async () => {
    if (getTransactionDeletion(queryClient, ledgerId, transactionId)) return;
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
    await settleTransactionDeletion(
      queryClient,
      transaction,
      stale ? "unavailable" : "deleted",
    );
    if (mounted.current) {
      if (stale) onUnavailable();
      else onDeleted();
    }
  };

  if (terminalDeletion) return null;

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
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const terminalDeletion = useTransactionDeletion(ledgerId, transactionId);
  const [editOpen, setEditOpen] = useState(false);
  const [adjustmentEditOpen, setAdjustmentEditOpen] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const adjustmentCompletion = useRef<
    "updated" | "removed" | "unavailable" | null
  >(null);
  const mounted = useRef(true);
  const adjustmentReplacementPending = useBalanceAdjustmentReplacementPending(
    ledgerId,
    transactionId,
  );
  const unavailableHeading = useRef<HTMLHeadingElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreEditFocus = useRef(false);
  const historyHref = `/finance/transactions${buildFinanceSearch(ledgerId, routeState.portable, resource)}`;
  const returnHref =
    returnToOverview && routeState.portable.month && routeState.portable.date
      ? `/finance/overview${buildFinanceSearch(ledgerId, { month: routeState.portable.month, date: routeState.portable.date })}`
      : historyHref;
  const transactionQuery = useGetFinanceTransaction(ledgerId, transactionId, {
    query: {
      enabled: () =>
        !unavailable &&
        !getTransactionDeletion(queryClient, ledgerId, transactionId),
      retry: (count, error) => !isNotFound(error) && count < 3,
      select: (response) => FinanceTransactionResponse.parse(response.data),
    },
  });
  const transaction = transactionQuery.data;
  const detailMissing = isMissingAdjustmentTransaction(transactionQuery.error);
  const detailMismatch =
    transaction &&
    (transaction.id !== transactionId ||
      transaction.ledgerId !== ledgerId ||
      (adjustmentEditOpen && transaction.kind !== "balanceAdjustment"));
  const notAvailable =
    Boolean(terminalDeletion) ||
    unavailable ||
    (!adjustmentEditOpen && !adjustmentReplacementPending && detailMissing) ||
    (!adjustmentReplacementPending && detailMismatch);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const finishAdjustmentUnavailable = useCallback(() => {
    if (!mounted.current || adjustmentCompletion.current) return;
    adjustmentCompletion.current = "unavailable";
    setAdjustmentEditOpen(false);
    setUnavailable(true);
    setAnnouncement("Transaction unavailable. It was already removed.");
  }, []);
  useEffect(() => {
    if (!adjustmentEditOpen || !detailMissing || unavailable) return;
    if (
      observeBalanceAdjustmentTransactionMissing(
        balanceAdjustmentReplacementKey(ledgerId, transactionId),
      )
    )
      return;
    void reconcileMissingAdjustmentTransaction(
      queryClient,
      ledgerId,
      transactionId,
    ).then(finishAdjustmentUnavailable);
  }, [
    adjustmentEditOpen,
    adjustmentReplacementPending,
    detailMissing,
    unavailable,
    ledgerId,
    transactionId,
    queryClient,
    finishAdjustmentUnavailable,
  ]);

  useEffect(() => {
    if (notAvailable) unavailableHeading.current?.focus();
  }, [notAvailable]);
  useEffect(() => {
    if (editOpen || adjustmentEditOpen || !restoreEditFocus.current) return;
    const target = editButton.current?.isConnected
      ? editButton.current
      : document.getElementById("finance-title");
    target?.focus();
    restoreEditFocus.current = false;
  }, [editOpen, adjustmentEditOpen]);

  let content: ReactNode;
  if (notAvailable) {
    content = (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        {terminalDeletion || announcement ? (
          <p role="status">
            <span id="transaction-unavailable-message">
              {terminalDeletion === "deleted"
                ? "Transaction deleted."
                : terminalDeletion === "unavailable"
                  ? "Transaction unavailable. It was already removed."
                  : announcement}
            </span>
          </p>
        ) : null}
        <h2
          aria-describedby={
            terminalDeletion ? "transaction-unavailable-message" : undefined
          }
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
  } else if (adjustmentReplacementPending && detailMismatch) {
    content = <p role="status">Balance Adjustment replacement in progress…</p>;
  } else if (transactionQuery.isPending) {
    content = (
      <p role="status" aria-label="Loading Transaction detail">
        Loading Transaction detail…
      </p>
    );
  } else if ((transactionQuery.isError && !editOpen) || !transaction) {
    content = (
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
  } else {
    content = (
      <div className="flex min-w-0 flex-col gap-4">
        <p aria-live="polite" className="sr-only" role="status">
          {announcement}
        </p>
        <Link className="text-sm underline" to={returnHref}>
          Back to {returnToOverview ? "Overview" : "Transactions"}
        </Link>
        <article
          className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-6"
          aria-labelledby="transaction-detail-title"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <h2
                className="text-xl font-semibold"
                id="transaction-detail-title"
              >
                Transaction detail
              </h2>
              <p className="text-sm text-muted-foreground">
                {transactionKindLabels[transaction.kind]}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                ref={editButton}
                onClick={() => {
                  if (transaction.kind === "balanceAdjustment") {
                    adjustmentCompletion.current = null;
                    setAdjustmentEditOpen(true);
                  } else setEditOpen(true);
                }}
                variant="outline"
              >
                Edit {transactionKindLabels[transaction.kind]}
              </Button>
              <Button
                onClick={() => setDeleteTarget(transaction)}
                variant="destructive"
              >
                Delete transaction
              </Button>
            </div>
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
        {editOpen ? (
          <TransactionEditDialog
            ledgerId={ledgerId}
            transactionId={transactionId}
            onClose={() => {
              restoreEditFocus.current = true;
              setEditOpen(false);
            }}
            onSaved={(kind) => {
              restoreEditFocus.current = true;
              setEditOpen(false);
              setAnnouncement(`${transactionKindLabels[kind]} updated.`);
            }}
            onUnavailable={() => {
              setEditOpen(false);
              setUnavailable(true);
              setAnnouncement(
                "Transaction unavailable. It was already removed.",
              );
            }}
          />
        ) : null}
      </div>
    );
  }
  return (
    <>
      {content}
      {deleteTarget ? (
        <TransactionDeleteDialog
          open
          transaction={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            flushSync(() => {
              setDeleteTarget(null);
              setUnavailable(true);
            });
            navigate(returnHref, {
              flushSync: true,
              replace: true,
              state: { deletedTransactionLedgerId: ledgerId },
            });
          }}
          onUnavailable={() => {
            flushSync(() => {
              setDeleteTarget(null);
              setUnavailable(true);
              setAnnouncement(
                "Transaction unavailable. It was already removed.",
              );
            });
          }}
        />
      ) : null}
      {adjustmentEditOpen && !terminalDeletion ? (
        <BalanceAdjustmentEditDialog
          ledgerId={ledgerId}
          transactionId={transactionId}
          onClose={() => {
            restoreEditFocus.current = true;
            setAdjustmentEditOpen(false);
          }}
          onSaved={() => {
            if (adjustmentCompletion.current) return;
            adjustmentCompletion.current = "updated";
            restoreEditFocus.current = true;
            setAdjustmentEditOpen(false);
            setAnnouncement("Balance Adjustment updated.");
          }}
          onRemoved={() => {
            if (adjustmentCompletion.current) return;
            adjustmentCompletion.current = "removed";
            setAdjustmentEditOpen(false);
            setUnavailable(true);
            setAnnouncement("Balance Adjustment removed.");
          }}
          onUnavailable={finishAdjustmentUnavailable}
        />
      ) : null}
    </>
  );
}
