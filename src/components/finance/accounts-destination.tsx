import { useMutationState, useQueryClient } from "@tanstack/react-query";
import { EllipsisIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import {
  getListFinanceAccountsQueryKey,
  useArchiveFinanceAccount,
  useListFinanceAccounts,
  useListFinanceCurrencies,
  useUnarchiveFinanceAccount,
} from "@/api/generated/core-console";
import {
  AccountResponse,
  CurrencyResponse,
  type AccountResponse as Account,
} from "@/api/generated/schemas";
import { buildAccountWorkflowLabels } from "@/components/finance/account-identity";
import { AccountFormDialog } from "@/components/finance/account-form-dialog";
import {
  reconcileAccountList,
  removeAccountFromList,
} from "@/components/finance/account-list-cache";
import { getAccountProblemFeedback } from "@/components/finance/account-problem";
import { AccountSemanticsDialog } from "@/components/finance/account-semantics-dialog";
import { buildFinanceSearch } from "@/components/finance/finance-route-state";
import { formatFinanceMoney } from "@/components/finance/finance-money";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

type AccountWorkflowTarget = {
  account: Account;
  label: string;
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

function accountMutationIdentity(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  if (!("accountId" in value) || !("ledgerId" in value)) return null;
  if (
    typeof value.accountId !== "string" ||
    typeof value.ledgerId !== "string"
  ) {
    return null;
  }
  return { accountId: value.accountId, ledgerId: value.ledgerId };
}

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
  actionLabel,
  changesAvailable,
  mutationPending,
  onArchive,
  onCorrect,
  onEdit,
  onUnarchive,
  onViewTransactions,
}: {
  account: Account;
  actionLabel: string;
  changesAvailable: boolean;
  mutationPending: boolean;
  onArchive: (account: Account, invoker: HTMLButtonElement) => void;
  onCorrect: (account: Account, invoker: HTMLButtonElement) => void;
  onEdit: (account: Account, invoker: HTMLButtonElement) => void;
  onUnarchive: (account: Account, invoker: HTMLButtonElement) => void;
  onViewTransactions: (account: Account) => void;
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
      aria-busy={mutationPending}
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
      <div className="flex items-center justify-end gap-2">
        <Button
          aria-label={`Edit ${actionLabel}`}
          disabled={!changesAvailable || mutationPending}
          id={`account-edit-${account.id}`}
          onClick={(event) => onEdit(account, event.currentTarget)}
          size="sm"
          variant="outline"
        >
          Edit
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${actionLabel}`}
            disabled={mutationPending}
            id={`account-actions-${account.id}`}
            render={<Button size="icon-sm" variant="ghost" />}
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                aria-label={`Correct nature or currency for ${actionLabel}`}
                disabled={!changesAvailable}
                onClick={() => {
                  const invoker = document.getElementById(
                    `account-actions-${account.id}`,
                  );
                  if (invoker instanceof HTMLButtonElement) {
                    onCorrect(account, invoker);
                  }
                }}
              >
                Correct nature or currency
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={`View transactions for ${actionLabel}`}
                onClick={() => onViewTransactions(account)}
              >
                View transactions
              </DropdownMenuItem>
              {account.status === "active" ? (
                <DropdownMenuItem
                  aria-label={`Archive ${actionLabel}`}
                  onClick={() => {
                    const invoker = document.getElementById(
                      `account-actions-${account.id}`,
                    );
                    if (invoker instanceof HTMLButtonElement) {
                      onArchive(account, invoker);
                    }
                  }}
                  variant="destructive"
                >
                  Archive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  aria-label={`Unarchive ${actionLabel}`}
                  onClick={() => {
                    const invoker = document.getElementById(
                      `account-actions-${account.id}`,
                    );
                    if (invoker instanceof HTMLButtonElement) {
                      onUnarchive(account, invoker);
                    }
                  }}
                >
                  Unarchive
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

function AccountNatureGroup({
  accountActionLabels,
  accounts,
  changesAvailable,
  pendingAccountIds,
  nature,
  onArchive,
  onCorrect,
  onEdit,
  onUnarchive,
  onViewTransactions,
}: {
  accountActionLabels: ReadonlyMap<string, string>;
  accounts: Account[];
  changesAvailable: boolean;
  pendingAccountIds: ReadonlySet<string>;
  nature: Nature;
  onArchive: (account: Account, invoker: HTMLButtonElement) => void;
  onCorrect: (account: Account, invoker: HTMLButtonElement) => void;
  onEdit: (account: Account, invoker: HTMLButtonElement) => void;
  onUnarchive: (account: Account, invoker: HTMLButtonElement) => void;
  onViewTransactions: (account: Account) => void;
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
            actionLabel={accountActionLabels.get(account.id)!}
            changesAvailable={changesAvailable}
            key={account.id}
            mutationPending={pendingAccountIds.has(account.id)}
            onArchive={onArchive}
            onCorrect={onCorrect}
            onEdit={onEdit}
            onUnarchive={onUnarchive}
            onViewTransactions={onViewTransactions}
          />
        ))}
      </div>
    </section>
  );
}

function LifecycleGroup({
  accountActionLabels,
  accounts,
  changesAvailable,
  pendingAccountIds,
  lifecycle,
  onArchive,
  onCorrect,
  onEdit,
  onUnarchive,
  onViewTransactions,
}: {
  accountActionLabels: ReadonlyMap<string, string>;
  accounts: Account[];
  changesAvailable: boolean;
  pendingAccountIds: ReadonlySet<string>;
  lifecycle: Lifecycle;
  onArchive: (account: Account, invoker: HTMLButtonElement) => void;
  onCorrect: (account: Account, invoker: HTMLButtonElement) => void;
  onEdit: (account: Account, invoker: HTMLButtonElement) => void;
  onUnarchive: (account: Account, invoker: HTMLButtonElement) => void;
  onViewTransactions: (account: Account) => void;
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
          accountActionLabels={accountActionLabels}
          accounts={matchingAccounts}
          changesAvailable={changesAvailable}
          key={nature}
          nature={nature}
          onArchive={onArchive}
          onCorrect={onCorrect}
          onEdit={onEdit}
          onUnarchive={onUnarchive}
          onViewTransactions={onViewTransactions}
          pendingAccountIds={pendingAccountIds}
        />
      ))}
    </section>
  );
}

export function AccountsDestination({
  ledgerId,
  ledgerName,
}: AccountsDestinationProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [semanticTarget, setSemanticTarget] =
    useState<AccountWorkflowTarget | null>(null);
  const [archiveTarget, setArchiveTarget] =
    useState<AccountWorkflowTarget | null>(null);
  const [feedback, setFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const [focusAccountActionId, setFocusAccountActionId] = useState("");
  const dialogInvoker = useRef<HTMLButtonElement | null>(null);
  const archiveCancelRef = useRef<HTMLButtonElement | null>(null);
  const archiveAccountIdRef = useRef("");
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
  const pendingAccountMutationVariables = [
    ...useMutationState({
      filters: { mutationKey: ["updateFinanceAccount"], status: "pending" },
      select: (mutation) => mutation.state.variables,
    }),
    ...useMutationState({
      filters: { mutationKey: ["archiveFinanceAccount"], status: "pending" },
      select: (mutation) => mutation.state.variables,
    }),
    ...useMutationState({
      filters: {
        mutationKey: ["unarchiveFinanceAccount"],
        status: "pending",
      },
      select: (mutation) => mutation.state.variables,
    }),
  ];
  const pendingAccountIds = new Set(
    pendingAccountMutationVariables.flatMap((variables) => {
      const identity = accountMutationIdentity(variables);
      return identity?.ledgerId === ledgerId ? [identity.accountId] : [];
    }),
  );

  useEffect(() => {
    if (!focusAccountActionId) return;
    const action = document.getElementById(
      `account-actions-${focusAccountActionId}`,
    );
    if (!action) return;
    action.focus();
    setFocusAccountActionId("");
  }, [accountsQuery.data, focusAccountActionId]);

  const archiveMutation = useArchiveFinanceAccount({
    mutation: {
      onError: (error, variables) => {
        const problem = getAccountProblemFeedback(
          error,
          "The Account could not be archived. Try again.",
        );
        if (problem.kind !== "accountNotFound") return;
        removeAccountFromList(queryClient, ledgerId, variables.accountId);
        setActionError(problem.message);
        setArchiveTarget(null);
        void queryClient.invalidateQueries({
          queryKey: getListFinanceAccountsQueryKey(ledgerId),
        });
      },
      onSuccess: (response) => {
        const archived = AccountResponse.parse(response.data);
        reconcileAccountList(queryClient, ledgerId, archived);
        setFeedback(`${archived.name} archived.`);
        setActionError("");
        setArchiveTarget(null);
        void queryClient.invalidateQueries({
          queryKey: getListFinanceAccountsQueryKey(ledgerId),
        });
      },
    },
  });
  const archiveError = archiveMutation.isError
    ? getAccountProblemFeedback(
        archiveMutation.error,
        "The Account could not be archived. Try again.",
      ).message
    : null;
  const unarchiveMutation = useUnarchiveFinanceAccount({
    mutation: {
      onError: (error, variables) => {
        const problem = getAccountProblemFeedback(
          error,
          "The Account could not be unarchived. Try again.",
        );
        setActionError(problem.message);
        if (problem.kind !== "accountNotFound") return;
        removeAccountFromList(queryClient, ledgerId, variables.accountId);
        void queryClient.invalidateQueries({
          queryKey: getListFinanceAccountsQueryKey(ledgerId),
        });
      },
      onSuccess: (response) => {
        const active = AccountResponse.parse(response.data);
        reconcileAccountList(queryClient, ledgerId, active);
        setFeedback(`${active.name} unarchived.`);
        setActionError("");
        void queryClient.invalidateQueries({
          queryKey: getListFinanceAccountsQueryKey(ledgerId),
        });
        setFocusAccountActionId(active.id);
      },
    },
  });

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

  const accountActionLabels = buildAccountWorkflowLabels(accountsQuery.data);

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
            setActionError("");
            setFeedback("");
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
              accountActionLabels={accountActionLabels}
              accounts={accountsQuery.data}
              changesAvailable={changesAvailable}
              key={lifecycle}
              lifecycle={lifecycle}
              onArchive={(account, invoker) => {
                dialogInvoker.current = invoker;
                archiveAccountIdRef.current = account.id;
                setActionError("");
                setFeedback("");
                archiveMutation.reset();
                setArchiveTarget({
                  account,
                  label: accountActionLabels.get(account.id)!,
                });
              }}
              onCorrect={(account, invoker) => {
                dialogInvoker.current = invoker;
                setActionError("");
                setFeedback("");
                setSemanticTarget({
                  account,
                  label: accountActionLabels.get(account.id)!,
                });
              }}
              onEdit={(account, invoker) => {
                dialogInvoker.current = invoker;
                setActionError("");
                setFeedback("");
                setEditingAccount(account);
              }}
              onUnarchive={(account, invoker) => {
                dialogInvoker.current = invoker;
                setActionError("");
                setFeedback("");
                unarchiveMutation.mutate({
                  accountId: account.id,
                  ledgerId,
                });
              }}
              onViewTransactions={(account) =>
                navigate(
                  `/finance/transactions${buildFinanceSearch(
                    ledgerId,
                    {},
                    { accountId: account.id },
                  )}`,
                )
              }
              pendingAccountIds={pendingAccountIds}
            />
          ))}
        </>
      )}
      <p className="sr-only" role="status">
        {feedback}
      </p>
      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}
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
      {semanticTarget && currenciesQuery.data.length > 0 ? (
        <AccountSemanticsDialog
          account={semanticTarget.account}
          accountLabel={semanticTarget.label}
          currencies={currenciesQuery.data}
          ledgerId={ledgerId}
          onOpenChange={(open) => {
            if (!open) setSemanticTarget(null);
          }}
          onSaved={(account) => setFeedback(`${account.name} corrected.`)}
          onUnavailable={setActionError}
          open
        />
      ) : null}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !archiveMutation.isPending) setArchiveTarget(null);
        }}
        open={archiveTarget !== null}
      >
        <AlertDialogContent
          aria-busy={archiveMutation.isPending}
          finalFocus={() =>
            document.getElementById(
              `account-actions-${archiveAccountIdRef.current}`,
            ) ??
            document.getElementById(
              `account-edit-${archiveAccountIdRef.current}`,
            )
          }
          initialFocus={archiveCancelRef}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveTarget?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Target Account: {archiveTarget?.label}. Archiving does not delete
              this Account, keeps its historical Transactions, keeps it in
              current financial-position calculations, and excludes it from
              ordinary new Transaction references.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiveError ? (
            <p className="text-sm text-destructive" role="alert">
              {archiveError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={archiveMutation.isPending}
              ref={archiveCancelRef}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveMutation.isPending}
              onClick={() => {
                if (!archiveTarget) return;
                archiveMutation.mutate({
                  accountId: archiveTarget.account.id,
                  ledgerId,
                });
              }}
              variant="destructive"
            >
              {archiveMutation.isPending ? "Archiving…" : "Archive Account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
