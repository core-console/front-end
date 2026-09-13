import { useRef, useState } from "react";

import {
  useListFinanceAccounts,
  useListFinanceCurrencies,
} from "@/api/generated/core-console";
import {
  AccountResponse,
  CurrencyResponse,
  type AccountResponse as Account,
} from "@/api/generated/schemas";
import { formatFinanceMoney } from "@/components/finance/finance-money";
import { AccountFormDialog } from "@/components/finance/account-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type AccountsDestinationProps = {
  ledgerId: string;
  ledgerName: string;
};

type Lifecycle = Account["status"];
type Nature = Account["nature"];

const lifecycleLabels: Record<Lifecycle, string> = {
  active: "Active Accounts",
  archived: "Archived Accounts",
};

const natureLabels: Record<Nature, string> = {
  asset: "Assets",
  liability: "Liabilities",
};

function formatFinanceDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year!, month! - 1, day));
}

function AccountRow({
  account,
  changesAvailable,
  onEdit,
}: {
  account: Account;
  changesAvailable: boolean;
  onEdit: (account: Account, invoker: HTMLButtonElement) => void;
}) {
  const details = [
    {
      label: "Current balance",
      value: formatFinanceMoney(account.currentBalance),
      primary: true,
    },
    {
      label: "Opening balance",
      value: formatFinanceMoney(account.openingBalance),
    },
    {
      label: "Tracking start",
      value: formatFinanceDate(account.trackingStartDate),
    },
    {
      label: "Status",
      value: account.status === "active" ? "Active" : "Archived",
    },
  ];

  return (
    <article
      aria-label={account.name}
      className="grid gap-x-4 gap-y-3 border-b border-border px-4 py-3 last:border-b-0 @4xl/accounts:grid-cols-[minmax(10rem,1.4fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(8rem,0.9fr)_minmax(5rem,0.6fr)_auto] @4xl/accounts:items-center"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h4 className="truncate text-sm font-medium">{account.name}</h4>
        <p className="text-xs text-muted-foreground @4xl/accounts:hidden">
          {account.nature === "asset" ? "Asset" : "Liability"} ·{" "}
          {account.currency}
        </p>
      </div>
      {details.map(({ label, primary, value }) => (
        <div
          className="flex min-w-0 items-baseline justify-between gap-3 @4xl/accounts:block"
          key={label}
        >
          <span className="text-xs text-muted-foreground @4xl/accounts:hidden">
            {label}
          </span>
          <span
            className={cn(
              "text-sm tabular-nums",
              primary ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {value}
          </span>
        </div>
      ))}
      <Button
        aria-label={`Edit ${account.name}`}
        disabled={!changesAvailable}
        onClick={(event) => onEdit(account, event.currentTarget)}
        size="sm"
        variant="outline"
      >
        Edit
      </Button>
    </article>
  );
}

function AccountNatureGroup({
  accounts,
  changesAvailable,
  nature,
  onEdit,
}: {
  accounts: Account[];
  changesAvailable: boolean;
  nature: Nature;
  onEdit: (account: Account, invoker: HTMLButtonElement) => void;
}) {
  const matchingAccounts = accounts.filter(
    (account) => account.nature === nature,
  );
  if (matchingAccounts.length === 0) return null;

  return (
    <section
      aria-labelledby={`${accounts[0]!.status}-${nature}-accounts`}
      className="flex flex-col gap-2"
    >
      <h3
        className="text-sm font-medium text-muted-foreground"
        id={`${accounts[0]!.status}-${nature}-accounts`}
      >
        {natureLabels[nature]}
      </h3>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div
          aria-hidden="true"
          className="hidden grid-cols-[minmax(10rem,1.4fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(8rem,0.9fr)_minmax(5rem,0.6fr)_auto] gap-4 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground @4xl/accounts:grid"
        >
          <span>Account</span>
          <span>Current balance</span>
          <span>Opening balance</span>
          <span>Tracking start</span>
          <span>Status</span>
          <span>Actions</span>
        </div>
        {matchingAccounts.map((account) => (
          <AccountRow
            account={account}
            changesAvailable={changesAvailable}
            key={account.id}
            onEdit={onEdit}
          />
        ))}
      </div>
    </section>
  );
}

function LifecycleGroup({
  accounts,
  changesAvailable,
  lifecycle,
  onEdit,
}: {
  accounts: Account[];
  changesAvailable: boolean;
  lifecycle: Lifecycle;
  onEdit: (account: Account, invoker: HTMLButtonElement) => void;
}) {
  const matchingAccounts = accounts.filter(
    (account) => account.status === lifecycle,
  );
  if (matchingAccounts.length === 0) return null;
  const headingId = `${lifecycle}-accounts-heading`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 className="text-base font-semibold" id={headingId}>
        {lifecycleLabels[lifecycle]}
      </h2>
      {(["asset", "liability"] as const).map((nature) => (
        <AccountNatureGroup
          accounts={matchingAccounts}
          changesAvailable={changesAvailable}
          key={nature}
          nature={nature}
          onEdit={onEdit}
        />
      ))}
    </section>
  );
}

export function AccountsDestination({
  ledgerId,
  ledgerName,
}: AccountsDestinationProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [feedback, setFeedback] = useState("");
  const dialogInvoker = useRef<HTMLButtonElement | null>(null);
  const accountsQuery = useListFinanceAccounts(ledgerId, {
    query: {
      select: (response) => AccountResponse.array().parse(response.data),
    },
  });
  const currenciesQuery = useListFinanceCurrencies({
    query: {
      select: (response) => CurrencyResponse.array().parse(response.data),
    },
  });
  const changesAvailable = (currenciesQuery.data?.length ?? 0) > 0;

  const closeDialog = () => {
    setCreateOpen(false);
    setEditingAccount(null);
    queueMicrotask(() => dialogInvoker.current?.focus());
  };

  if (accountsQuery.isPending || currenciesQuery.isPending) {
    return (
      <div
        aria-label="Loading Accounts"
        className="@container/accounts flex flex-col gap-7"
        role="status"
      >
        <span className="sr-only">Loading Accounts…</span>
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-16" />
          <div className="overflow-hidden rounded-lg border border-border bg-card p-4">
            <Skeleton className="h-4 w-40" />
            <div className="mt-4 grid gap-3 @4xl/accounts:grid-cols-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (accountsQuery.isError || currenciesQuery.isError) {
    return (
      <div
        className="flex max-w-2xl items-center justify-between gap-4 rounded-lg border border-border bg-card p-6"
        role="alert"
      >
        <p className="text-sm">Accounts could not be loaded. Try again.</p>
        <Button
          disabled={accountsQuery.isFetching || currenciesQuery.isFetching}
          onClick={() =>
            void Promise.all([
              accountsQuery.refetch(),
              currenciesQuery.refetch(),
            ])
          }
          size="sm"
          variant="outline"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="@container/accounts flex flex-col gap-7" key={ledgerId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Accounts in {ledgerName}
        </p>
        <Button
          disabled={currenciesQuery.data.length === 0}
          onClick={(event) => {
            dialogInvoker.current = event.currentTarget;
            setCreateOpen(true);
          }}
        >
          Create account
        </Button>
      </div>
      {currenciesQuery.data.length === 0 ? (
        <Empty className="border bg-card py-8">
          <EmptyHeader>
            <EmptyTitle>
              <h2>Account changes unavailable</h2>
            </EmptyTitle>
            <EmptyDescription>
              No supported currencies are available for creating or editing an
              Account.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {accountsQuery.data.length === 0 ? (
        <Empty className="border bg-card py-12">
          <EmptyHeader>
            <EmptyTitle>
              <h2>No Accounts yet</h2>
            </EmptyTitle>
            <EmptyDescription>
              Create an Account to start tracking a position in this Ledger.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {accountsQuery.data.every(
            (account) => account.status === "archived",
          ) ? (
            <Empty className="border bg-card py-8">
              <EmptyHeader>
                <EmptyTitle>
                  <h2>No active Accounts</h2>
                </EmptyTitle>
                <EmptyDescription>
                  Archived positions remain part of this Ledger.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {(["active", "archived"] as const).map((lifecycle) => (
            <LifecycleGroup
              accounts={accountsQuery.data}
              changesAvailable={changesAvailable}
              key={lifecycle}
              lifecycle={lifecycle}
              onEdit={(account, invoker) => {
                dialogInvoker.current = invoker;
                setEditingAccount(account);
              }}
            />
          ))}
        </>
      )}
      <p className="sr-only" role="status">
        {feedback}
      </p>
      {currenciesQuery.data.length > 0 ? (
        <AccountFormDialog
          currencies={currenciesQuery.data}
          ledgerId={ledgerId}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          onSaved={(account) => setFeedback(`${account.name} created.`)}
          open={createOpen}
        />
      ) : null}
      {editingAccount && currenciesQuery.data.length > 0 ? (
        <AccountFormDialog
          account={editingAccount}
          currencies={currenciesQuery.data}
          ledgerId={ledgerId}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          onSaved={(account) => setFeedback(`${account.name} updated.`)}
          open
        />
      ) : null}
    </div>
  );
}
