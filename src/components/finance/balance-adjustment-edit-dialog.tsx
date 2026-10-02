import { useQueryClient } from "@tanstack/react-query";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  getGetFinanceOverviewQueryKey,
  getGetBalanceAdjustmentContextQueryKey,
  getGetFinanceTransactionQueryKey,
  getListFinanceAccountsQueryKey,
  getListFinanceTransactionsQueryKey,
  useGetBalanceAdjustmentContext,
  useGetFinanceTransaction,
  useListFinanceAccounts,
  useListFinanceCurrencies,
  useReplaceBalanceAdjustment,
} from "@/api/generated/core-console";
import {
  AccountResponse,
  BalanceAdjustmentContextResponse,
  CurrencyResponse,
  FinanceRequestDate,
  FinanceTransactionResponse,
  ProblemDetails,
  ReplaceBalanceAdjustmentRequest,
  ReplaceBalanceAdjustmentResultResponse,
  type BalanceAdjustmentContextResponseOutput,
  type FinanceTransactionResponseOutput,
} from "@/api/generated/schemas";
import { buildAccountWorkflowLabels } from "@/components/finance/account-identity";
import {
  isMissingAdjustmentTransaction,
  reconcileMissingAdjustmentTransaction,
} from "@/components/finance/balance-adjustment-missing-transaction";
import {
  balanceAdjustmentReplacementKey,
  claimBalanceAdjustmentReplacement,
  observeBalanceAdjustmentTransactionMissing,
  releaseBalanceAdjustmentReplacement,
  useBalanceAdjustmentReplacementPending,
} from "@/components/finance/balance-adjustment-replacement-lock";
import { subtractExactDecimals } from "@/components/finance/finance-decimal";
import { formatFinanceMoney } from "@/components/finance/finance-money";
import {
  getTransactionDeletion,
  useTransactionDeletion,
} from "@/components/finance/transaction-deletion";
import {
  captureBalanceAdjustmentHistoryMembership,
  reconcileBalanceAdjustmentReplacementHistories,
} from "@/components/finance/transaction-history-cache";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

type Adjustment = Extract<
  FinanceTransactionResponseOutput,
  { kind: "balanceAdjustment" }
>;
type Context = BalanceAdjustmentContextResponseOutput;
type ConflictCode =
  "account_balance_changed" | "finance_account_semantics_changed";
type Completion = "updated" | "removed" | "unavailable";
type ReplacementOperation = (
  session: NonNullable<ReturnType<typeof claimBalanceAdjustmentReplacement>>,
) => Promise<Completion | undefined>;
const decimal = /^-?\d+(?:\.\d+)?$/;
function status(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error
    ? error.status
    : undefined;
}
function problemCode(error: unknown) {
  const parsed = ProblemDetails.safeParse(
    typeof error === "object" && error !== null && "info" in error
      ? error.info
      : undefined,
  );
  return parsed.success ? parsed.data.code : undefined;
}
function validDate(value: string, account: AccountResponse | undefined) {
  return (
    FinanceRequestDate.safeParse(value).success &&
    (!account || value >= account.trackingStartDate)
  );
}

export function BalanceAdjustmentEditDialog({
  ledgerId,
  transactionId,
  onClose,
  onSaved,
  onRemoved,
  onUnavailable,
}: {
  ledgerId: string;
  transactionId: string;
  onClose: () => void;
  onSaved: () => void;
  onRemoved: () => void;
  onUnavailable: () => void;
}) {
  const pending = useBalanceAdjustmentReplacementPending(
    ledgerId,
    transactionId,
  );
  const [needsFreshDetail, setNeedsFreshDetail] = useState(pending);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const completion = useRef<Completion | null>(null);
  const [unavailableCalled, setUnavailableCalled] = useState(false);
  const [initialized, setInitialized] = useState<{
    identity: string;
    transaction: Adjustment;
  } | null>(null);
  const queryClient = useQueryClient();
  const terminalDeletion = useTransactionDeletion(ledgerId, transactionId);
  const detail = useGetFinanceTransaction(ledgerId, transactionId, {
    query: {
      enabled: () =>
        !getTransactionDeletion(queryClient, ledgerId, transactionId),
      refetchOnMount: "always",
      retry: (count, error) => status(error) !== 404 && count < 3,
      select: (response) => FinanceTransactionResponse.parse(response.data),
    },
  });
  const refetchDetail = detail.refetch;
  const ready =
    detail.isFetchedAfterMount &&
    detail.isSuccess &&
    !detail.isFetching &&
    !detail.isRefetchError &&
    !needsFreshDetail &&
    (!pending || busy);
  const identity = balanceAdjustmentReplacementKey(ledgerId, transactionId);
  const matchingAdjustment =
    detail.data?.kind === "balanceAdjustment" &&
    detail.data.id === transactionId &&
    detail.data.ledgerId === ledgerId;
  const changedResource =
    detail.isSuccess && !detail.isFetching && !matchingAdjustment;
  // The host owns settlement, even if its form is no longer mounted.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const finish = useCallback(
    (outcome: Completion) => {
      if (!mounted.current || completion.current) return;
      completion.current = outcome;
      if (outcome === "updated") onSaved();
      else if (outcome === "removed") onRemoved();
      else onUnavailable();
    },
    [onSaved, onRemoved, onUnavailable],
  );

  async function runReplacement(operation: ReplacementOperation) {
    const session = claimBalanceAdjustmentReplacement(identity);
    if (!session) return;
    setBusy(true);
    try {
      const outcome = await operation(session);
      if (outcome) finish(outcome);
    } finally {
      // Neither releasing authority nor clearing the host's busy state belongs
      // to the form's mount lifetime. Cache reconciliation is awaited above.
      releaseBalanceAdjustmentReplacement(session);
      if (mounted.current) setBusy(false);
    }
  }

  const showForm =
    initialized?.identity === identity &&
    (busy ||
      (!pending &&
        !needsFreshDetail &&
        !isMissingAdjustmentTransaction(detail.error) &&
        !changedResource));

  useEffect(() => {
    if (!ready || !matchingAdjustment) return;
    const transaction = detail.data as Adjustment;
    setInitialized((current) =>
      current?.identity === identity ? current : { identity, transaction },
    );
  }, [ready, matchingAdjustment, detail.data, identity]);

  useEffect(() => {
    if (pending && !busy) setNeedsFreshDetail(true);
  }, [pending, busy]);
  useEffect(() => {
    if (
      pending ||
      !needsFreshDetail ||
      refreshFailed ||
      getTransactionDeletion(queryClient, ledgerId, transactionId)
    )
      return;
    let active = true;
    void refetchDetail().then((result) => {
      if (!active) return;
      if (
        result.isSuccess &&
        !result.isRefetchError &&
        result.data?.kind === "balanceAdjustment" &&
        result.data?.id === transactionId &&
        result.data.ledgerId === ledgerId
      ) {
        setNeedsFreshDetail(false);
      } else if (!isMissingAdjustmentTransaction(result.error)) {
        setRefreshFailed(true);
      }
    });
    return () => {
      active = false;
    };
  }, [
    pending,
    needsFreshDetail,
    refreshFailed,
    refetchDetail,
    ledgerId,
    transactionId,
    queryClient,
  ]);
  useEffect(() => {
    if (
      !unavailableCalled &&
      detail.isFetchedAfterMount &&
      detail.isError &&
      isMissingAdjustmentTransaction(detail.error)
    ) {
      if (observeBalanceAdjustmentTransactionMissing(identity) || busy) return;
      setUnavailableCalled(true);
      void (async () => {
        await reconcileMissingAdjustmentTransaction(
          queryClient,
          ledgerId,
          transactionId,
        );
        finish("unavailable");
      })();
    }
  }, [
    unavailableCalled,
    pending,
    busy,
    detail.isFetchedAfterMount,
    detail.isError,
    detail.error,
    ledgerId,
    transactionId,
    identity,
    queryClient,
    finish,
  ]);

  useEffect(() => {
    if (terminalDeletion) finish("unavailable");
  }, [terminalDeletion, finish]);
  if (terminalDeletion) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !pending) onClose();
      }}
    >
      <DialogContent
        aria-busy={busy || pending}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md"
        finalFocus={false}
        showCloseButton={!busy && !pending}
      >
        <DialogHeader>
          <DialogTitle>Edit Balance Adjustment</DialogTitle>
          <DialogDescription>
            Review the balance excluding this Adjustment and the Account nature.
            Set a known actual end-of-day target balance.
          </DialogDescription>
        </DialogHeader>
        {initialized?.identity === identity ? (
          <div hidden={!showForm}>
            <div className="grid gap-4">
              <EditForm
                key={identity}
                transaction={initialized.transaction}
                onClose={onClose}
                onUnavailable={() => finish("unavailable")}
                active={showForm}
                busy={busy}
                runReplacement={runReplacement}
              />
            </div>
          </div>
        ) : null}
        {!showForm ? (
          <>
            <p role="status" className="text-sm text-muted-foreground">
              {pending
                ? "Replacement in progress. Wait for it to finish before editing this Adjustment."
                : "Loading the current Adjustment before editing."}
            </p>
            {refreshFailed ||
            (detail.isError &&
              !isMissingAdjustmentTransaction(detail.error)) ? (
              <p role="alert">Adjustment could not be loaded. Try again.</p>
            ) : null}
            {ready && changedResource ? (
              <p role="alert">
                The response does not match this Balance Adjustment. Reload its
                detail.
              </p>
            ) : null}
            <DialogFooter>
              <Button
                onClick={onClose}
                disabled={pending || busy}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              {changedResource ||
              refreshFailed ||
              (detail.isError &&
                !isMissingAdjustmentTransaction(detail.error)) ? (
                <Button
                  onClick={() => {
                    setRefreshFailed(false);
                    void detail.refetch();
                  }}
                  type="button"
                >
                  Retry
                </Button>
              ) : null}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  transaction,
  onClose,
  onUnavailable,
  active,
  busy,
  runReplacement,
}: {
  transaction: Adjustment;
  onClose: () => void;
  onUnavailable: () => void;
  active: boolean;
  busy: boolean;
  runReplacement: (operation: ReplacementOperation) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const ledgerId = transaction.ledgerId;
  const transactionId = transaction.id;
  const pending = useBalanceAdjustmentReplacementPending(
    ledgerId,
    transactionId,
  );
  const key = balanceAdjustmentReplacementKey(ledgerId, transactionId);
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
  const mutation = useReplaceBalanceAdjustment();
  const mounted = useRef(true);
  const unavailableReported = useRef(false);
  const [accountId, setAccountId] = useState(transaction.account.id);
  const [transactionDate, setTransactionDate] = useState(
    transaction.transactionDate,
  );
  const [targetBalance, setTargetBalance] = useState("");
  const [note, setNote] = useState(transaction.note ?? "");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState<{
    code: ConflictCode;
    previous: Context;
    current?: Context;
    status: "refreshing" | "failed" | "ready";
  } | null>(null);
  const [freshContext, setFreshContext] = useState<{
    identity: string;
    context: Context;
  } | null>(null);
  const [accountRefreshFailed, setAccountRefreshFailed] = useState(false);
  const [missingAccountId, setMissingAccountId] = useState("");
  const accountRef = useRef<HTMLSelectElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);
  const selectedIdentity = `${accountId}:${transactionDate}`;
  const identityRef = useRef(selectedIdentity);
  identityRef.current = selectedIdentity;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const markUnavailable = useCallback(async () => {
    await reconcileMissingAdjustmentTransaction(
      queryClient,
      ledgerId,
      transactionId,
    );
    onUnavailable();
  }, [ledgerId, transactionId, queryClient, onUnavailable]);
  const accounts = accountsQuery.data ?? [];
  const labels = buildAccountWorkflowLabels(accounts);
  const selected = accounts.find((item) => item.id === accountId);
  const original = transaction.account;
  const originalAccount = accounts.find((item) => item.id === original.id);
  const originalAvailable = Boolean(
    originalAccount || accountId === original.id,
  );
  const selectable = accounts.filter(
    (item) => item.status === "active" && item.id !== missingAccountId,
  );
  const contextEnabled =
    validDate(transactionDate, selected) &&
    originalAvailable &&
    Boolean(accountId) &&
    accountId !== missingAccountId &&
    (accountId === original.id || selected?.status === "active");
  const contextQuery = useGetBalanceAdjustmentContext(
    ledgerId,
    accountId,
    { transactionDate, replacingTransactionId: transactionId },
    {
      query: {
        enabled: contextEnabled,
        retry: false,
        refetchOnMount: "always",
        select: (response) => {
          const parsed = BalanceAdjustmentContextResponse.parse(response.data);
          if (
            parsed.account.id !== accountId ||
            parsed.transactionDate !== transactionDate ||
            (accountId !== original.id && parsed.account.status !== "active")
          ) {
            throw new Error(
              "Adjustment context did not match the selected Account and date.",
            );
          }
          return parsed;
        },
      },
    },
  );
  useEffect(() => {
    if (
      !unavailableReported.current &&
      contextQuery.isFetchedAfterMount &&
      contextQuery.isError &&
      problemCode(contextQuery.error) === "finance_transaction_not_found"
    ) {
      if (observeBalanceAdjustmentTransactionMissing(key) || busy) return;
      unavailableReported.current = true;
      void markUnavailable();
    }
  }, [
    pending,
    busy,
    contextQuery.isFetchedAfterMount,
    contextQuery.isError,
    contextQuery.error,
    key,
    markUnavailable,
  ]);
  useEffect(() => {
    if (
      contextQuery.isFetchedAfterMount &&
      contextQuery.isError &&
      problemCode(contextQuery.error) === "finance_account_not_found" &&
      missingAccountId !== accountId
    ) {
      setMissingAccountId(accountId);
      setFreshContext(null);
      setConflict(null);
      setFieldError(
        "The selected Account is unavailable. Choose an active Account.",
      );
      void accountsQuery.refetch();
    }
  }, [
    contextQuery.isFetchedAfterMount,
    contextQuery.isError,
    contextQuery.error,
    missingAccountId,
    accountId,
    accountsQuery,
  ]);
  const freshQuery =
    contextQuery.isFetchedAfterMount &&
    contextQuery.isSuccess &&
    !contextQuery.isFetching &&
    !contextQuery.isRefetchError;
  const context = conflict
    ? conflict.status === "ready" &&
      freshQuery &&
      freshContext?.identity === selectedIdentity
      ? freshContext.context
      : undefined
    : freshQuery
      ? contextQuery.data
      : undefined;
  const authoritativeContext =
    accountId === missingAccountId ? undefined : context;
  const currency = currenciesQuery.data?.find(
    (item) =>
      item.code === authoritativeContext?.derivedComparisonBalance.currency,
  );
  const validTarget =
    decimal.test(targetBalance) &&
    targetBalance.replace(/^-/, "").split(".", 1)[0]!.replace(/^0+/, "")
      .length <= 131_072 &&
    Boolean(currency) &&
    (targetBalance.split(".")[1]?.length ?? 0) <= (currency?.minorUnit ?? -1);
  const preview =
    authoritativeContext && validTarget
      ? subtractExactDecimals(
          targetBalance,
          authoritativeContext.derivedComparisonBalance.amount,
        )
      : null;
  const dataReady =
    accountsQuery.isFetchedAfterMount &&
    !accountsQuery.isFetching &&
    accountsQuery.isSuccess &&
    !accountsQuery.isRefetchError &&
    currenciesQuery.isFetchedAfterMount &&
    !currenciesQuery.isFetching &&
    currenciesQuery.isSuccess &&
    !currenciesQuery.isRefetchError;

  function changeIdentity(nextAccount: string, nextDate: string) {
    identityRef.current = `${nextAccount}:${nextDate}`;
    setAccountId(nextAccount);
    setTransactionDate(nextDate);
    setFreshContext(null);
    setConflict(null);
    setError("");
    setFieldError("");
    setAccountRefreshFailed(false);
  }

  async function refreshConflict(code: ConflictCode, previous: Context) {
    const identity = identityRef.current;
    if (mounted.current) {
      setConflict({ code, previous, status: "refreshing" });
      setFreshContext(null);
    }
    const refreshed = await contextQuery.refetch({ cancelRefetch: true });
    if (!mounted.current || identityRef.current !== identity) return;
    if (
      refreshed.isSuccess &&
      !refreshed.isRefetchError &&
      !refreshed.isFetching &&
      refreshed.data?.account.id === accountId &&
      refreshed.data.transactionDate === transactionDate
    ) {
      setFreshContext({ identity, context: refreshed.data });
      setConflict({ code, previous, current: refreshed.data, status: "ready" });
    } else {
      setConflict({ code, previous, status: "failed" });
    }
  }

  async function reconcile(
    result: ReturnType<typeof ReplaceBalanceAdjustmentResultResponse.parse>,
    response: { data: unknown; status: number },
  ) {
    const historyKey = getListFinanceTransactionsQueryKey(ledgerId);
    const detailKey = getGetFinanceTransactionQueryKey(ledgerId, transactionId);
    if (
      result.outcome === "updated" &&
      (result.transaction.id !== transactionId ||
        result.transaction.ledgerId !== ledgerId)
    )
      throw new Error("Replacement response identity mismatch");
    void queryClient.invalidateQueries({
      queryKey: getGetFinanceOverviewQueryKey(ledgerId),
      refetchType: "none",
    });
    const historySnapshot = captureBalanceAdjustmentHistoryMembership(
      queryClient,
      ledgerId,
      transactionId,
    );
    function applyOutcome() {
      if (result.outcome === "updated") {
        queryClient.setQueryData(detailKey, {
          ...response,
          data: result.transaction,
        });
      } else {
        queryClient.removeQueries({ queryKey: detailKey, exact: true });
      }
      reconcileBalanceAdjustmentReplacementHistories(historySnapshot, result);
    }
    await Promise.all([
      queryClient.cancelQueries({ queryKey: historyKey }),
      queryClient.cancelQueries({ queryKey: detailKey }),
    ]);
    applyOutcome();
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: historyKey }),
      queryClient.invalidateQueries({
        queryKey: getListFinanceAccountsQueryKey(ledgerId),
      }),
      queryClient.invalidateQueries({
        queryKey: getGetFinanceOverviewQueryKey(ledgerId),
      }),
      ...[...new Set([original.id, accountId])].map((id) =>
        queryClient.resetQueries({
          predicate: (query) =>
            String(query.queryKey[0]).includes(
              `/finance/ledgers/${ledgerId}/accounts/${id}/balance-adjustment-context`,
            ),
        }),
      ),
    ]);
    await Promise.all([
      queryClient.cancelQueries({ queryKey: historyKey }),
      queryClient.cancelQueries({ queryKey: detailKey }),
    ]);
    applyOutcome();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || busy || pending || uncertain) return;
    if (
      !authoritativeContext ||
      !dataReady ||
      !contextEnabled ||
      !validTarget
    ) {
      setFieldError(
        "Load fresh context and enter a valid target balance before saving.",
      );
      targetRef.current?.focus();
      return;
    }
    const trimmedNote = note.trim();
    if ([...trimmedNote].length > 500) {
      setError("Note must be 500 characters or fewer.");
      return;
    }
    setError("");
    setFieldError("");
    await runReplacement(async (session) => {
      let responseReceived = false;
      const transactionMissing = () =>
        session.transactionMissingObserved ||
        isMissingAdjustmentTransaction(
          queryClient.getQueryState(
            getGetFinanceTransactionQueryKey(ledgerId, transactionId),
          )?.error,
        ) ||
        isMissingAdjustmentTransaction(
          queryClient.getQueryState(
            getGetBalanceAdjustmentContextQueryKey(ledgerId, accountId, {
              transactionDate,
              replacingTransactionId: transactionId,
            }),
          )?.error,
        );
      try {
        const data = ReplaceBalanceAdjustmentRequest.parse({
          accountId,
          expectedAccountNature: authoritativeContext.accountNature,
          expectedDerivedBalance: authoritativeContext.derivedComparisonBalance,
          note: trimmedNote || null,
          targetBalance: {
            amount: targetBalance,
            currency: authoritativeContext.derivedComparisonBalance.currency,
          },
          transactionDate,
        });
        const response = await mutation.mutateAsync({
          data,
          ledgerId,
          transactionId,
        });
        responseReceived = true;
        const result = ReplaceBalanceAdjustmentResultResponse.parse(
          response.data,
        );
        await reconcile(result, response);
        return result.outcome;
      } catch (failure) {
        if (responseReceived) {
          if (mounted.current) {
            setUncertain(true);
            setError(
              "Replacement may have succeeded, but the result could not be verified. Reload Transaction detail before editing again.",
            );
          }
        } else if (
          isMissingAdjustmentTransaction(failure) ||
          transactionMissing()
        ) {
          await reconcileMissingAdjustmentTransaction(
            queryClient,
            ledgerId,
            transactionId,
          );
          return "unavailable";
        } else {
          const code = problemCode(failure);
          if (
            code === "account_balance_changed" ||
            code === "finance_account_semantics_changed"
          ) {
            await refreshConflict(code, authoritativeContext);
          } else if (
            code === "finance_account_archived" ||
            code === "finance_account_not_found"
          ) {
            if (code === "finance_account_not_found") {
              setMissingAccountId(accountId);
              setFreshContext(null);
              setConflict(null);
              const contextKey = getGetBalanceAdjustmentContextQueryKey(
                ledgerId,
                accountId,
                { transactionDate, replacingTransactionId: transactionId },
              );
              await queryClient.cancelQueries({
                queryKey: contextKey,
                exact: true,
              });
              queryClient.removeQueries({ queryKey: contextKey, exact: true });
            }
            const refreshed = await accountsQuery.refetch();
            if (mounted.current) {
              setAccountRefreshFailed(
                !refreshed.isSuccess || refreshed.isRefetchError,
              );
              setFieldError(
                code === "finance_account_archived"
                  ? "The selected Account was archived. Retain only the original archived Account or choose an active Account."
                  : "The selected Account is unavailable. Choose an active Account.",
              );
              accountRef.current?.focus();
            }
          } else if (mounted.current) {
            setError(
              code === "validation_error"
                ? "Check the Adjustment fields and try again."
                : "Adjustment could not be replaced. Try again.",
            );
          }
        }
      }
      // A missing read can arrive while conflict/reference recovery is awaited.
      // Finish its reconciliation before the host releases session authority.
      if (!responseReceived && transactionMissing()) {
        await reconcileMissingAdjustmentTransaction(
          queryClient,
          ledgerId,
          transactionId,
        );
        return "unavailable";
      }
      return undefined;
    });
  }

  const selectedLabel =
    accountId === original.id
      ? (labels.get(accountId) ?? original.name)
      : (labels.get(accountId) ?? "Selected Account");
  const archivedOriginal =
    (originalAccount?.status ?? original.status) === "archived";

  return (
    <>
      <form
        aria-label="Edit Balance Adjustment"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <FieldGroup>
          <Field data-disabled={busy} data-invalid={Boolean(fieldError)}>
            <FieldLabel htmlFor="edit-adjustment-account">Account</FieldLabel>
            <NativeSelect
              id="edit-adjustment-account"
              ref={accountRef}
              disabled={busy || !accountsQuery.isSuccess}
              value={accountId}
              onChange={(event) =>
                changeIdentity(event.target.value, transactionDate)
              }
            >
              {accountId === original.id && missingAccountId === original.id ? (
                <NativeSelectOption disabled value={original.id}>
                  {selectedLabel} (unavailable)
                </NativeSelectOption>
              ) : accountId === original.id && archivedOriginal ? (
                <NativeSelectOption value={original.id}>
                  {selectedLabel} (archived) ·{" "}
                  {transaction.correctionDelta.currency}
                </NativeSelectOption>
              ) : null}
              {accountId !== original.id &&
              !selectable.some((item) => item.id === accountId) ? (
                <NativeSelectOption disabled value={accountId}>
                  {selectedLabel} (unavailable)
                </NativeSelectOption>
              ) : null}
              {selectable.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {labels.get(item.id)} · {item.currency}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              The existing archived Account may be retained. Alternatives must
              be active.
            </FieldDescription>
            <FieldError>
              {fieldError && !contextEnabled ? fieldError : undefined}
            </FieldError>
          </Field>
          <Field data-disabled={busy}>
            <FieldLabel htmlFor="edit-adjustment-date">
              Transaction date
            </FieldLabel>
            <Input
              id="edit-adjustment-date"
              type="date"
              value={transactionDate}
              disabled={busy}
              onChange={(event) =>
                changeIdentity(accountId, event.target.value)
              }
            />
            <FieldDescription>
              Target balance is the known end-of-day balance on this date.
            </FieldDescription>
            {!FinanceRequestDate.safeParse(transactionDate).success ? (
              <FieldError>Enter a valid Transaction Date.</FieldError>
            ) : selected && transactionDate < selected.trackingStartDate ? (
              <FieldError>
                Choose a date on or after the Account Tracking Start Date.
              </FieldError>
            ) : null}
          </Field>
          {contextQuery.isPending && contextEnabled ? (
            <div role="status" aria-label="Loading Balance Adjustment context">
              <Skeleton className="h-5 w-full" />
            </div>
          ) : null}
          {(!conflict && contextQuery.isError) ||
          accountRefreshFailed ||
          (!dataReady && (accountsQuery.isError || currenciesQuery.isError)) ? (
            <Alert variant="destructive">
              <AlertTitle>Adjustment context could not be loaded</AlertTitle>
              <AlertDescription>
                {problemCode(contextQuery.error) ===
                  "finance_account_not_found" ||
                problemCode(contextQuery.error) === "finance_account_archived"
                  ? "The selected Account is unavailable. Choose an active Account or retain this Adjustment's own archived Account if available. "
                  : null}
                Retry before saving. Cached information cannot authorize a
                replacement.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void contextQuery.refetch();
                    void accountsQuery.refetch();
                    void currenciesQuery.refetch();
                    setAccountRefreshFailed(false);
                  }}
                >
                  Retry context
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {conflict?.status === "refreshing" ? (
            <p role="status">Refreshing authoritative Adjustment context…</p>
          ) : null}
          {conflict?.status === "failed" ? (
            <Alert variant="destructive">
              <AlertTitle>Authoritative context refresh failed</AlertTitle>
              <AlertDescription>
                Retry the refresh before reviewing and submitting this target
                again.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void refreshConflict(conflict.code, conflict.previous)
                  }
                >
                  Retry context refresh
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {authoritativeContext ? (
            <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span>Derived balance excluding this Adjustment</span>
                <strong>
                  {formatFinanceMoney(
                    authoritativeContext.derivedComparisonBalance,
                  )}
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span>Account nature</span>
                <strong>
                  {authoritativeContext.accountNature === "asset"
                    ? "Asset"
                    : "Liability"}
                </strong>
              </div>
            </div>
          ) : null}
          {conflict?.status === "ready" && conflict.current ? (
            <Alert>
              <AlertTitle>
                {conflict.code === "account_balance_changed"
                  ? "Account balance changed"
                  : "Account nature changed"}
              </AlertTitle>
              <AlertDescription>
                {conflict.previous.derivedComparisonBalance.amount !==
                conflict.current.derivedComparisonBalance.amount ? (
                  <p>
                    Derived balance changed from{" "}
                    {formatFinanceMoney(
                      conflict.previous.derivedComparisonBalance,
                    )}{" "}
                    to{" "}
                    {formatFinanceMoney(
                      conflict.current.derivedComparisonBalance,
                    )}
                    .
                  </p>
                ) : null}
                {conflict.previous.accountNature !==
                conflict.current.accountNature ? (
                  <p>
                    Account nature changed from{" "}
                    {conflict.previous.accountNature} to{" "}
                    {conflict.current.accountNature}.
                  </p>
                ) : null}
                <p>
                  Review the refreshed context. Your Account, target, and note
                  were preserved. Submit again only if the target remains
                  correct.
                </p>
              </AlertDescription>
            </Alert>
          ) : null}
          <Field
            data-disabled={busy || !authoritativeContext}
            data-invalid={Boolean(fieldError)}
          >
            <FieldLabel htmlFor="edit-adjustment-target">
              Target balance
            </FieldLabel>
            <Input
              id="edit-adjustment-target"
              ref={targetRef}
              inputMode="decimal"
              disabled={busy || !authoritativeContext}
              value={targetBalance}
              onChange={(event) => {
                setTargetBalance(event.target.value);
                setFieldError("");
              }}
              aria-invalid={Boolean(fieldError)}
            />
            <FieldDescription>
              {authoritativeContext
                ? `Known actual Account Balance in ${authoritativeContext.derivedComparisonBalance.currency}. This target is workflow input only.`
                : "Available after authoritative context loads."}
            </FieldDescription>
            <FieldError>
              {fieldError && contextEnabled ? fieldError : undefined}
            </FieldError>
          </Field>
          {preview !== null && authoritativeContext ? (
            <p className="flex justify-between gap-2 text-sm">
              <span>Correction delta preview</span>
              <strong>
                {preview.startsWith("-") || /^0(?:\.0+)?$/.test(preview)
                  ? ""
                  : "+"}
                {formatFinanceMoney({
                  amount: preview,
                  currency:
                    authoritativeContext.derivedComparisonBalance.currency,
                })}
              </strong>
            </p>
          ) : null}
          <Field data-disabled={busy}>
            <FieldLabel htmlFor="edit-adjustment-note">Note</FieldLabel>
            <Textarea
              id="edit-adjustment-note"
              rows={3}
              disabled={busy}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <FieldDescription>Optional, up to 500 characters.</FieldDescription>
          </Field>
        </FieldGroup>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              busy ||
              uncertain ||
              !authoritativeContext ||
              !dataReady ||
              !contextEnabled ||
              !validTarget
            }
          >
            {" "}
            {busy ? "Saving adjustment…" : "Save adjustment"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
