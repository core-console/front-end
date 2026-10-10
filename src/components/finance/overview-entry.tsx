import { useMutationState } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import {
  useListFinanceAccounts,
  useListFinanceCategories,
  useListFinanceCurrencies,
} from "@/api/generated/core-console";
import {
  AccountResponse,
  CategoryResponse,
  CurrencyResponse,
  type FinanceTransactionResponseOutput,
} from "@/api/generated/schemas";
import { BalanceAdjustmentFormDialog } from "@/components/finance/balance-adjustment-form-dialog";
import { buildFinanceSearch } from "@/components/finance/finance-route-state";
import { InternalTransferFormDialog } from "@/components/finance/internal-transfer-form-dialog";
import { TransactionFormDialog } from "@/components/finance/transaction-form-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { glossary, locale, messages } from "@/lib/i18n";

const copy = messages.finance.quickEntry;

type SecondaryKind = "internalTransfer" | "balanceAdjustment";

function mutationLedgerId(variables: unknown) {
  return typeof variables === "object" &&
    variables !== null &&
    "ledgerId" in variables &&
    typeof variables.ledgerId === "string"
    ? variables.ledgerId
    : undefined;
}

export function OverviewEntry({
  date,
  ledgerId,
  onAdjusted,
  onRecorded,
}: {
  date: string;
  ledgerId: string;
  onAdjusted: (outcome: "created" | "noChange") => Promise<void>;
  onRecorded: (transaction: FinanceTransactionResponseOutput) => Promise<void>;
}) {
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [secondaryKind, setSecondaryKind] = useState<SecondaryKind | null>(
    null,
  );
  const hadActiveAccount = useRef(false);
  const secondaryInvoker = useRef<HTMLButtonElement>(null);
  const restoreSecondaryFocus = useRef(false);
  const accountsQuery = useListFinanceAccounts(ledgerId, {
    query: {
      placeholderData: (previousData) => previousData,
      select: (response) => AccountResponse.array().parse(response.data),
    },
  });
  const categoriesQuery = useListFinanceCategories(ledgerId, {
    query: {
      placeholderData: (previousData) => previousData,
      select: (response) => CategoryResponse.array().parse(response.data),
    },
  });
  const currenciesQuery = useListFinanceCurrencies({
    query: {
      placeholderData: (previousData) => previousData,
      select: (response) => CurrencyResponse.array().parse(response.data),
    },
  });
  const createPending = useMutationState({
    filters: { mutationKey: ["createFinanceTransaction"], status: "pending" },
    select: (mutation) => mutation.state.variables,
  }).some((variables) => mutationLedgerId(variables) === ledgerId);
  const adjustmentPending = useMutationState({
    filters: { mutationKey: ["createBalanceAdjustment"], status: "pending" },
    select: (mutation) => mutation.state.variables,
  }).some((variables) => mutationLedgerId(variables) === ledgerId);
  const accounts = accountsQuery.data ?? [];
  const activeAccounts = accounts.filter(
    (account) => account.status === "active",
  );
  if (accountsQuery.isSuccess && activeAccounts.length > 0)
    hadActiveAccount.current = true;
  const hasTransferPair = activeAccounts.some((source) =>
    activeAccounts.some(
      (destination) =>
        destination.id !== source.id &&
        destination.currency === source.currency,
    ),
  );
  const hasReferences =
    accountsQuery.data !== undefined &&
    categoriesQuery.data !== undefined &&
    currenciesQuery.data !== undefined;
  const referencesFresh =
    accountsQuery.isSuccess &&
    categoriesQuery.isSuccess &&
    currenciesQuery.isSuccess &&
    accountsQuery.isFetchedAfterMount &&
    categoriesQuery.isFetchedAfterMount &&
    currenciesQuery.isFetchedAfterMount &&
    !accountsQuery.isFetching &&
    !categoriesQuery.isFetching &&
    !currenciesQuery.isFetching &&
    !accountsQuery.isRefetchError &&
    !categoriesQuery.isRefetchError &&
    !currenciesQuery.isRefetchError &&
    !accountsQuery.isPlaceholderData &&
    !categoriesQuery.isPlaceholderData &&
    !currenciesQuery.isPlaceholderData;
  const canCreate =
    referencesFresh &&
    activeAccounts.length > 0 &&
    !createPending &&
    !adjustmentPending;
  const referenceProblem =
    accountsQuery.isRefetchError ||
    categoriesQuery.isRefetchError ||
    currenciesQuery.isRefetchError;

  useEffect(() => {
    if (secondaryKind || !restoreSecondaryFocus.current) return;
    const target =
      secondaryInvoker.current?.isConnected &&
      !secondaryInvoker.current.disabled
        ? secondaryInvoker.current
        : document.getElementById("finance-title");
    target?.focus();
    restoreSecondaryFocus.current = false;
  }, [secondaryKind]);

  const closeSecondaryDialog = (open: boolean) => {
    if (open) return;
    restoreSecondaryFocus.current = true;
    setSecondaryKind(null);
  };

  return (
    <section
      aria-labelledby="quick-entry-title"
      lang={locale}
      className="min-w-0 rounded-lg border border-border bg-card p-4"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold" id="quick-entry-title">
          {copy.title}
        </h2>
        <DropdownMenu>
          {/* Enabled text must not fade in from the disabled opacity. */}
          <DropdownMenuTrigger
            render={
              <Button
                className="transition-colors"
                disabled={!canCreate}
                ref={secondaryInvoker}
                size="sm"
                variant="outline"
              />
            }
          >
            {copy.otherActions}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={!hasTransferPair}
                onClick={() => setSecondaryKind("internalTransfer")}
              >
                <span lang="en">{glossary.internalTransfer}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSecondaryKind("balanceAdjustment")}
              >
                <span lang="en">{glossary.balanceAdjustment}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {hasReferences && activeAccounts.length > 0 && !hasTransferPair ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {copy.transferGuidance}{" "}
          <Link
            className="text-primary underline"
            to={`/finance/accounts${buildFinanceSearch(ledgerId, { date, month: date.slice(0, 7) })}`}
          >
            {copy.manageTransferAccounts}
          </Link>
        </p>
      ) : null}
      {accountsQuery.isSuccess &&
      activeAccounts.length === 0 &&
      !hadActiveAccount.current ? (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p>{copy.needsAccount}</p>
          <Link
            className="text-primary underline"
            to={`/finance/accounts${buildFinanceSearch(ledgerId, { date, month: date.slice(0, 7) })}`}
          >
            {copy.manageAccounts}
          </Link>
        </div>
      ) : hasReferences ? (
        <TransactionFormDialog
          accounts={accounts}
          categories={categoriesQuery.data}
          currencies={currenciesQuery.data}
          inlineDate={date}
          kind={kind}
          ledgerId={ledgerId}
          onOpenChange={(income) => setKind(income ? "income" : "expense")}
          onRecorded={onRecorded}
          open
          refreshReferences={() =>
            Promise.all([accountsQuery.refetch(), categoriesQuery.refetch()])
          }
          submitBlocked={
            !referencesFresh ||
            activeAccounts.length === 0 ||
            createPending ||
            adjustmentPending
          }
        />
      ) : (
        <div
          className="flex flex-col items-start gap-2"
          role={
            accountsQuery.isError ||
            categoriesQuery.isError ||
            currenciesQuery.isError
              ? "alert"
              : "status"
          }
        >
          <p>
            {accountsQuery.isError ||
            categoriesQuery.isError ||
            currenciesQuery.isError
              ? copy.referencesFailed
              : copy.loadingReferences}
          </p>
          {accountsQuery.isError ||
          categoriesQuery.isError ||
          currenciesQuery.isError ? (
            <Button
              onClick={() =>
                void Promise.all([
                  accountsQuery.refetch(),
                  categoriesQuery.refetch(),
                  currenciesQuery.refetch(),
                ])
              }
              size="sm"
              variant="outline"
            >
              {copy.retryReferences}
            </Button>
          ) : null}
        </div>
      )}
      {accountsQuery.isSuccess &&
      activeAccounts.length === 0 &&
      hadActiveAccount.current ? (
        <p className="mt-3 text-sm" role="alert">
          {copy.noActiveAccount}{" "}
          <Link
            className="text-primary underline"
            to={`/finance/accounts${buildFinanceSearch(ledgerId, { date, month: date.slice(0, 7) })}`}
          >
            {copy.manageAccounts}
          </Link>{" "}
        </p>
      ) : null}
      {hasReferences && !referencesFresh ? (
        <div
          className="flex items-center gap-2 text-sm"
          role={referenceProblem ? "alert" : "status"}
        >
          <p>
            {referenceProblem
              ? copy.referenceRefreshFailed
              : copy.refreshingReferences}
          </p>
          {referenceProblem ? (
            <Button
              onClick={() =>
                void Promise.all([
                  accountsQuery.refetch(),
                  categoriesQuery.refetch(),
                  currenciesQuery.refetch(),
                ])
              }
              size="sm"
              variant="outline"
            >
              {copy.retryReferences}
            </Button>
          ) : null}
        </div>
      ) : null}
      {secondaryKind === "internalTransfer" ? (
        <InternalTransferFormDialog
          accounts={accounts}
          currencies={currenciesQuery.data ?? []}
          initialDate={date}
          ledgerId={ledgerId}
          onOpenChange={closeSecondaryDialog}
          onRecorded={onRecorded}
          open
          refreshAccounts={async () => {
            const result = await accountsQuery.refetch();
            return result.isSuccess && !result.isRefetchError
              ? { accounts: result.data, status: "success" }
              : { status: "error" };
          }}
        />
      ) : secondaryKind === "balanceAdjustment" ? (
        <BalanceAdjustmentFormDialog
          accounts={accounts}
          currencies={currenciesQuery.data ?? []}
          initialDate={date}
          ledgerId={ledgerId}
          onAdjusted={onAdjusted}
          onOpenChange={closeSecondaryDialog}
          open
          refreshAccounts={async () => {
            const result = await accountsQuery.refetch();
            return result.isSuccess && !result.isRefetchError
              ? { accounts: result.data, status: "success" }
              : { status: "error" };
          }}
        />
      ) : null}
    </section>
  );
}
