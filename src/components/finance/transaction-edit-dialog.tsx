import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  getGetFinanceOverviewQueryKey,
  getGetFinanceTransactionQueryKey,
  getListFinanceAccountsQueryKey,
  getListFinanceTransactionsQueryKey,
  useGetFinanceTransaction,
  useListFinanceAccounts,
  useListFinanceCategories,
  useListFinanceCurrencies,
  useReplaceFinanceTransaction,
} from "@/api/generated/core-console";
import {
  AccountResponse,
  CategoryResponse,
  CurrencyResponse,
  FinanceRequestDate,
  FinanceTransactionResponse,
  ListFinanceTransactionsParams,
  ProblemDetails,
  ReplaceFinanceTransactionBody,
  type FinanceTransactionResponseOutput,
  type TransactionHistoryPageResponseOutput,
} from "@/api/generated/schemas";
import { buildAccountWorkflowLabels } from "@/components/finance/account-identity";
import { categoryWorkflowLabel } from "@/components/finance/category-identity";
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
import { Textarea } from "@/components/ui/textarea";

type Ordinary = Extract<
  FinanceTransactionResponseOutput,
  { kind: "income" | "expense" | "internalTransfer" }
>;
type FieldName =
  | "amount"
  | "accountId"
  | "sourceAccountId"
  | "destinationAccountId"
  | "categoryId"
  | "transactionDate"
  | "note";
type Reference = { id: string; name: string; status: "active" | "archived" };
const label = {
  income: "Income",
  expense: "Expense",
  internalTransfer: "Internal Transfer",
} as const;
const decimal = /^\d+(?:\.\d+)?$/;

// A replacement owns its identity from preflight through cache reconciliation,
// even when navigation unmounts the form that started it.
const replacementLocks = new Set<string>();
const replacementListeners = new Set<() => void>();
const replacementKey = (ledgerId: string, transactionId: string) =>
  JSON.stringify([ledgerId, transactionId]);
const notifyReplacementListeners = () => {
  for (const listener of replacementListeners) listener();
};
const subscribeReplacement = (listener: () => void) => {
  replacementListeners.add(listener);
  return () => replacementListeners.delete(listener);
};
function claimReplacement(key: string) {
  if (replacementLocks.has(key)) return false;
  replacementLocks.add(key);
  notifyReplacementListeners();
  return true;
}
function releaseReplacement(key: string) {
  replacementLocks.delete(key);
  notifyReplacementListeners();
}

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

function matches(transaction: Ordinary, params: ListFinanceTransactionsParams) {
  if (params.fromDate && transaction.transactionDate < params.fromDate)
    return false;
  if (params.toDate && transaction.transactionDate > params.toDate)
    return false;
  if (params.kind && transaction.kind !== params.kind) return false;
  if (
    params.accountId &&
    !(transaction.kind === "internalTransfer"
      ? [
          transaction.sourceAccount.id,
          transaction.destinationAccount.id,
        ].includes(params.accountId)
      : transaction.account.id === params.accountId)
  )
    return false;
  if (
    params.categoryId &&
    !(
      transaction.kind !== "internalTransfer" &&
      transaction.categoryAllocations[0]?.category?.id === params.categoryId
    )
  )
    return false;
  if (
    params.uncategorized &&
    !(
      transaction.kind !== "internalTransfer" &&
      transaction.categoryAllocations[0]?.category === null
    )
  )
    return false;
  return true;
}

export function TransactionEditDialog({
  ledgerId,
  transactionId,
  onClose,
  onSaved,
  onUnavailable,
}: {
  ledgerId: string;
  transactionId: string;
  onClose: () => void;
  onSaved: (kind: Ordinary["kind"]) => void;
  onUnavailable: () => void;
}) {
  const pending = useRef(false);
  const unavailableCalled = useRef(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const [editTransaction, setEditTransaction] = useState<Ordinary | null>(null);
  const lockKey = replacementKey(ledgerId, transactionId);
  const replacementPending = useSyncExternalStore(subscribeReplacement, () =>
    replacementLocks.has(lockKey),
  );
  const [needsFreshDetail, setNeedsFreshDetail] = useState(replacementPending);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const unavailable = useCallback(async () => {
    const historyKey = getListFinanceTransactionsQueryKey(ledgerId);
    const detailKey = getGetFinanceTransactionQueryKey(ledgerId, transactionId);
    await Promise.all([
      queryClient.cancelQueries({ queryKey: historyKey }),
      queryClient.cancelQueries({ queryKey: detailKey }),
    ]);
    queryClient.removeQueries({ queryKey: detailKey, exact: true });
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
    void Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: historyKey }),
      queryClient.resetQueries({
        queryKey: getListFinanceAccountsQueryKey(ledgerId),
      }),
      queryClient.resetQueries({
        queryKey: getGetFinanceOverviewQueryKey(ledgerId),
      }),
      queryClient.resetQueries({
        predicate: (query) =>
          String(query.queryKey[0]).includes(
            `/finance/ledgers/${ledgerId}/accounts/`,
          ) &&
          String(query.queryKey[0]).includes("/balance-adjustment-context"),
      }),
    ]);
    onUnavailable();
  }, [ledgerId, transactionId, queryClient, onUnavailable]);
  const query = useGetFinanceTransaction(ledgerId, transactionId, {
    query: {
      refetchOnMount: "always",
      retry: (count, error) => status(error) !== 404 && count < 3,
      select: (response) => FinanceTransactionResponse.parse(response.data),
    },
  });
  // Cached detail cannot authorize an edit after a failed or unfinished refresh.
  const ready =
    query.isFetchedAfterMount &&
    query.isSuccess &&
    !query.isFetching &&
    !query.isRefetchError;
  const refetchDetail = query.refetch;
  useEffect(() => {
    if (replacementPending && !pending.current) {
      setNeedsFreshDetail(true);
      setEditTransaction(null);
    }
  }, [replacementPending]);
  useEffect(() => {
    if (replacementPending || !needsFreshDetail || refreshFailed) return;
    let active = true;
    void refetchDetail().then((result) => {
      if (!active) return;
      if (result.isError && status(result.error) === 404) return;
      if (
        result.isSuccess &&
        !result.isRefetchError &&
        result.data &&
        result.data.kind !== "balanceAdjustment" &&
        result.data.id === transactionId &&
        result.data.ledgerId === ledgerId
      ) {
        setEditTransaction(result.data as Ordinary);
        setNeedsFreshDetail(false);
      } else {
        setRefreshFailed(true);
      }
    });
    return () => {
      active = false;
    };
  }, [
    replacementPending,
    needsFreshDetail,
    refreshFailed,
    refetchDetail,
    ledgerId,
    transactionId,
  ]);
  useEffect(() => {
    if (
      ready &&
      !replacementPending &&
      !needsFreshDetail &&
      query.data &&
      query.data.kind !== "balanceAdjustment" &&
      query.data.id === transactionId &&
      query.data.ledgerId === ledgerId
    ) {
      setEditTransaction((current) => current ?? (query.data as Ordinary));
    }
  }, [
    ready,
    replacementPending,
    needsFreshDetail,
    query.data,
    ledgerId,
    transactionId,
  ]);
  useEffect(() => {
    if (
      query.isFetchedAfterMount &&
      query.isError &&
      status(query.error) === 404 &&
      !unavailableCalled.current
    ) {
      unavailableCalled.current = true;
      void unavailable();
    }
  }, [query.isFetchedAfterMount, query.isError, query.error, unavailable]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose();
      }}
    >
      <DialogContent
        finalFocus={false}
        showCloseButton={!busy}
        aria-busy={busy}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md"
      >
        {editTransaction && (!replacementPending || pending.current) ? (
          <EditForm
            key={`${ledgerId}:${transactionId}`}
            transaction={editTransaction}
            onClose={onClose}
            onSaved={onSaved}
            onUnavailable={() => void unavailable()}
            pending={pending}
            onBusyChange={setBusy}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Edit transaction</DialogTitle>
              <DialogDescription>
                {replacementPending
                  ? "Replacement in progress. Wait for it to finish before editing this Transaction."
                  : needsFreshDetail
                    ? "Refreshing the Transaction after its earlier replacement."
                    : "Loading the current Transaction before editing."}
              </DialogDescription>
            </DialogHeader>
            {refreshFailed || (query.isError && status(query.error) !== 404) ? (
              <p role="alert">Transaction could not be loaded. Try again.</p>
            ) : null}
            {ready && query.data?.kind === "balanceAdjustment" ? (
              <p role="alert">
                Balance Adjustment editing uses its own workflow.
              </p>
            ) : null}
            <DialogFooter>
              <Button onClick={onClose} type="button" variant="outline">
                Cancel
              </Button>
              {refreshFailed ||
              (query.isError && status(query.error) !== 404) ? (
                <Button
                  onClick={() => {
                    if (needsFreshDetail) setRefreshFailed(false);
                    else void query.refetch();
                  }}
                  type="button"
                >
                  Retry
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  transaction,
  onClose,
  onSaved,
  onUnavailable,
  pending,
  onBusyChange,
}: {
  transaction: Ordinary;
  onClose: () => void;
  onSaved: (kind: Ordinary["kind"]) => void;
  onUnavailable: () => void;
  pending: { current: boolean };
  onBusyChange: (busy: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const ledgerId = transaction.ledgerId;
  const accountsQuery = useListFinanceAccounts(ledgerId, {
    query: { select: (r) => AccountResponse.array().parse(r.data) },
  });
  const categoriesQuery = useListFinanceCategories(ledgerId, {
    query: { select: (r) => CategoryResponse.array().parse(r.data) },
  });
  const currenciesQuery = useListFinanceCurrencies({
    query: { select: (r) => CurrencyResponse.array().parse(r.data) },
  });
  const mutation = useReplaceFinanceTransaction();
  const mounted = useRef(true);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(
    transaction.kind === "internalTransfer"
      ? transaction.sourceAmount.amount
      : transaction.economicAmount.amount,
  );
  const [accountId, setAccountId] = useState(
    transaction.kind === "internalTransfer" ? "" : transaction.account.id,
  );
  const [sourceAccountId, setSourceAccountId] = useState(
    transaction.kind === "internalTransfer" ? transaction.sourceAccount.id : "",
  );
  const [destinationAccountId, setDestinationAccountId] = useState(
    transaction.kind === "internalTransfer"
      ? transaction.destinationAccount.id
      : "",
  );
  const [categoryId, setCategoryId] = useState(
    transaction.kind === "internalTransfer"
      ? ""
      : (transaction.categoryAllocations[0]?.category?.id ?? ""),
  );
  const originalCurrency =
    transaction.kind === "internalTransfer"
      ? transaction.sourceAmount.currency
      : transaction.economicAmount.currency;
  const [accountCurrency, setAccountCurrency] = useState<
    CurrencyResponse["code"] | undefined
  >(originalCurrency);
  const [sourceCurrency, setSourceCurrency] = useState<
    CurrencyResponse["code"] | undefined
  >(originalCurrency);
  const [destinationCurrency, setDestinationCurrency] = useState<
    CurrencyResponse["code"] | undefined
  >(originalCurrency);
  const [transactionDate, setTransactionDate] = useState(
    transaction.transactionDate,
  );
  const [note, setNote] = useState(transaction.note ?? "");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [serverFieldToFocus, setServerFieldToFocus] = useState<
    "accountId" | "categoryId" | null
  >(null);
  const [serverError, setServerError] = useState("");
  const [uncertainResult, setUncertainResult] = useState(false);
  const accountRef = useRef<HTMLSelectElement>(null);
  const sourceRef = useRef<HTMLSelectElement>(null);
  const destinationRef = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (busy || !serverFieldToFocus) return;
    if (serverFieldToFocus === "accountId") accountRef.current?.focus();
    else categoryRef.current?.focus();
    setServerFieldToFocus(null);
  }, [busy, serverFieldToFocus]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const accounts = accountsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const accountLabels = buildAccountWorkflowLabels(accounts);
  const originalAccount =
    transaction.kind === "internalTransfer" ? null : transaction.account;
  const originalSource =
    transaction.kind === "internalTransfer" ? transaction.sourceAccount : null;
  const originalDestination =
    transaction.kind === "internalTransfer"
      ? transaction.destinationAccount
      : null;
  const originalCategory =
    transaction.kind === "internalTransfer"
      ? null
      : (transaction.categoryAllocations[0]?.category ?? null);
  const currencyCode =
    transaction.kind === "internalTransfer" ? sourceCurrency : accountCurrency;
  const currency = currenciesQuery.data?.find(
    (item) => item.code === currencyCode,
  );
  const currentReferences =
    accountsQuery.isSuccess &&
    !accountsQuery.isRefetchError &&
    (transaction.kind === "internalTransfer" ||
      (categoriesQuery.isSuccess && !categoriesQuery.isRefetchError)) &&
    currenciesQuery.isSuccess &&
    !currenciesQuery.isRefetchError;

  const referenceLabel = (reference: Reference | null, id: string) => {
    if (!reference) return "Selected reference";
    const account = accounts.find((item) => item.id === id);
    const duplicate =
      accounts.filter((item) => item.name === reference.name).length > 1;
    const name = account
      ? (accountLabels.get(id) ?? reference.name)
      : duplicate
        ? `${reference.name}, Account ID ${id}`
        : reference.name;
    return `${name}${reference.status === "archived" || account?.status === "archived" ? " (archived)" : ""}`;
  };
  const selectableAccount = (
    id: string,
    original: Reference | null,
    list = accounts,
  ) =>
    list.some(
      (item) =>
        item.id === id && (item.status === "active" || id === original?.id),
    ) || id === original?.id;
  const clear = (field: FieldName) => {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setServerError("");
  };
  const focusError = (nextErrors: Partial<Record<FieldName, string>>) => {
    const fields =
      transaction.kind === "internalTransfer"
        ? ([
            "sourceAccountId",
            "destinationAccountId",
            "amount",
            "transactionDate",
            "note",
          ] as const)
        : ([
            "accountId",
            "amount",
            "categoryId",
            "transactionDate",
            "note",
          ] as const);
    const first = fields.find((field) => nextErrors[field]);
    const refs = {
      accountId: accountRef,
      sourceAccountId: sourceRef,
      destinationAccountId: destinationRef,
      amount: amountRef,
      categoryId: categoryRef,
      transactionDate: dateRef,
      note: noteRef,
    };
    if (first) refs[first].current?.focus();
  };

  async function reconcile(
    confirmed: Ordinary,
    response: { data: unknown; status: number },
  ) {
    const historyKey = getListFinanceTransactionsQueryKey(ledgerId);
    const detailKey = getGetFinanceTransactionQueryKey(
      ledgerId,
      transaction.id,
    );
    await Promise.all([
      queryClient.cancelQueries({ queryKey: historyKey }),
      queryClient.cancelQueries({ queryKey: detailKey }),
    ]);
    queryClient.setQueryData(detailKey, { ...response, data: confirmed });
    for (const [key, current] of queryClient.getQueriesData<
      InfiniteData<TransactionHistoryPageResponseOutput>
    >({ queryKey: historyKey })) {
      if (!current?.pages) continue;
      const parsed = ListFinanceTransactionsParams.safeParse(key[1] ?? {});
      const oldItems = current.pages.flatMap((page) => page.items);
      const items = oldItems.filter((item) => item.id !== transaction.id);
      if (
        oldItems.some((item) => item.id === transaction.id) &&
        parsed.success &&
        matches(confirmed, parsed.data)
      )
        items.push(confirmed);
      items.sort((left, right) =>
        left.transactionDate === right.transactionDate
          ? right.id.localeCompare(left.id)
          : right.transactionDate.localeCompare(left.transactionDate),
      );
      let offset = 0;
      queryClient.setQueryData(key, {
        ...current,
        pages: current.pages.map((page, index) => {
          const size =
            index === current.pages.length - 1
              ? items.length - offset
              : page.items.length;
          const next = { ...page, items: items.slice(offset, offset + size) };
          offset += size;
          return next;
        }),
      });
    }
    // Refetch histories after removing the obsolete projection; filters, date order, and cursors may change.
    const ids =
      transaction.kind === "internalTransfer"
        ? [transaction.sourceAccount.id, transaction.destinationAccount.id]
        : [transaction.account.id];
    const nextIds =
      confirmed.kind === "internalTransfer"
        ? [confirmed.sourceAccount.id, confirmed.destinationAccount.id]
        : [confirmed.account.id];
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: historyKey }),
      queryClient.resetQueries({
        queryKey: getListFinanceAccountsQueryKey(ledgerId),
      }),
      queryClient.resetQueries({
        queryKey: getGetFinanceOverviewQueryKey(ledgerId),
      }),
      ...[...new Set([...ids, ...nextIds])].map((id) =>
        queryClient.resetQueries({
          predicate: (query) =>
            String(query.queryKey[0]).includes(
              `/finance/ledgers/${ledgerId}/accounts/${id}/balance-adjustment-context`,
            ),
        }),
      ),
    ]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || uncertainResult) return;
    const lockKey = replacementKey(ledgerId, transaction.id);
    if (replacementLocks.has(lockKey)) {
      setServerError(
        "Replacement in progress. Wait for it to finish before editing this Transaction.",
      );
      return;
    }
    const next: Partial<Record<FieldName, string>> = {};
    const trimmedNote = note.trim();
    if (!decimal.test(amount) || !/[1-9]/.test(amount))
      next.amount = "Enter a positive plain decimal amount.";
    else if (amount.split(".", 1)[0]!.replace(/^0+/, "").length > 131_072)
      next.amount = "Amount has too many integer digits.";
    else if (!currency) next.amount = "Amount currency is unavailable.";
    else if ((amount.split(".")[1]?.length ?? 0) > currency.minorUnit)
      next.amount = `${currency.code} amounts support at most ${currency.minorUnit} fractional digits.`;
    if (!FinanceRequestDate.safeParse(transactionDate).success)
      next.transactionDate = "Enter a valid Transaction Date.";
    if ([...trimmedNote].length > 500)
      next.note = "Note must be 500 characters or fewer.";
    setErrors(next);
    if (Object.keys(next).length) {
      focusError(next);
      return;
    }

    locked.current = true;
    pending.current = true;
    if (!claimReplacement(lockKey)) {
      locked.current = false;
      pending.current = false;
      setServerError(
        "Replacement in progress. Wait for it to finish before editing this Transaction.",
      );
      return;
    }
    onBusyChange(true);
    setBusy(true);
    setServerError("");
    let responseReceived = false;
    try {
      // A cached list is presentation data. A fresh successful result authorizes replacement choices.
      const [accountResult, categoryResult, currencyResult] = await Promise.all(
        [
          accountsQuery.refetch(),
          transaction.kind === "internalTransfer"
            ? Promise.resolve(null)
            : categoriesQuery.refetch(),
          currenciesQuery.refetch(),
        ],
      );
      if (
        !accountResult.isSuccess ||
        accountResult.isRefetchError ||
        (categoryResult &&
          (!categoryResult.isSuccess || categoryResult.isRefetchError)) ||
        !currencyResult.isSuccess ||
        currencyResult.isRefetchError
      ) {
        if (mounted.current)
          setServerError(
            "References could not be refreshed. Retry before saving.",
          );
        return;
      }
      const freshAccounts = accountResult.data;
      const freshCategories = categoryResult?.data ?? [];
      const freshCurrencyCode =
        transaction.kind === "internalTransfer"
          ? sourceAccountId === originalSource?.id
            ? originalCurrency
            : freshAccounts.find((item) => item.id === sourceAccountId)
                ?.currency
          : accountId === originalAccount?.id
            ? originalCurrency
            : freshAccounts.find((item) => item.id === accountId)?.currency;
      const freshCurrency = currencyResult.data.find(
        (item) => item.code === freshCurrencyCode,
      );
      const referenceErrors: Partial<Record<FieldName, string>> = {};
      if (transaction.kind === "internalTransfer") {
        if (freshCurrencyCode !== sourceCurrency)
          referenceErrors.sourceAccountId =
            "The Source Account currency changed. Select it again before saving.";
        if (!selectableAccount(sourceAccountId, originalSource, freshAccounts))
          referenceErrors.sourceAccountId =
            "Choose the existing Source Account or an active Account.";
        if (
          !selectableAccount(
            destinationAccountId,
            originalDestination,
            freshAccounts,
          ) ||
          destinationAccountId === sourceAccountId
        )
          referenceErrors.destinationAccountId =
            "Choose a distinct existing or active Destination Account.";
        const freshDestinationCurrency =
          destinationAccountId === originalDestination?.id
            ? originalCurrency
            : freshAccounts.find((item) => item.id === destinationAccountId)
                ?.currency;
        if (freshDestinationCurrency !== destinationCurrency)
          referenceErrors.destinationAccountId =
            "The Destination Account currency changed. Select it again before saving.";
        else if (freshDestinationCurrency !== freshCurrencyCode)
          referenceErrors.destinationAccountId =
            "Choose a Destination Account in the Source Account currency.";
      } else {
        if (freshCurrencyCode !== accountCurrency)
          referenceErrors.accountId =
            "The Account currency changed. Select it again before saving.";
        if (!selectableAccount(accountId, originalAccount, freshAccounts))
          referenceErrors.accountId =
            "Choose the existing Account or an active Account.";
        if (
          categoryId &&
          categoryId !== originalCategory?.id &&
          !freshCategories.some(
            (item) => item.id === categoryId && item.status === "active",
          )
        )
          referenceErrors.categoryId =
            "Choose the existing Category, an active Category, or Uncategorized.";
      }
      if (
        !freshCurrency ||
        (amount.split(".")[1]?.length ?? 0) > freshCurrency.minorUnit
      )
        referenceErrors.amount =
          "Check the amount against the selected Account currency.";
      const relevant =
        transaction.kind === "internalTransfer"
          ? [sourceAccountId, destinationAccountId]
          : [accountId];
      if (
        relevant.some((id) => {
          const account = freshAccounts.find((item) => item.id === id);
          return account && transactionDate < account.trackingStartDate;
        })
      )
        referenceErrors.transactionDate =
          "Choose a Transaction Date on or after the Account Tracking Start Date.";
      if (Object.keys(referenceErrors).length) {
        if (mounted.current) {
          setErrors(referenceErrors);
          setServerError("Review the selected references and try again.");
          focusError(referenceErrors);
        }
        return;
      }
      if (!freshCurrencyCode) return;
      const money = { amount, currency: freshCurrencyCode };
      const data = ReplaceFinanceTransactionBody.parse(
        transaction.kind === "internalTransfer"
          ? {
              amount: money,
              destinationAccountId,
              kind: "internalTransfer",
              note: trimmedNote || null,
              sourceAccountId,
              transactionDate,
            }
          : {
              accountId,
              categoryAllocations: [
                { amount: money, categoryId: categoryId || null },
              ],
              economicAmount: money,
              kind: transaction.kind,
              note: trimmedNote || null,
              transactionDate,
            },
      );
      const response = await mutation.mutateAsync({
        ledgerId,
        transactionId: transaction.id,
        data,
      });
      responseReceived = true;
      const confirmed = FinanceTransactionResponse.parse(response.data);
      if (
        confirmed.kind === "balanceAdjustment" ||
        confirmed.kind !== transaction.kind ||
        confirmed.id !== transaction.id ||
        confirmed.ledgerId !== ledgerId
      )
        throw new Error("Replacement response identity mismatch");
      await reconcile(confirmed, response);
      if (mounted.current) onSaved(transaction.kind);
    } catch (error) {
      if (!mounted.current) return;
      if (
        problemCode(error) === "finance_transaction_not_found" ||
        (status(error) === 404 && !problemCode(error))
      ) {
        onUnavailable();
        return;
      }
      if (responseReceived) {
        setUncertainResult(true);
        setServerError(
          "Replacement may have succeeded, but the result could not be verified. Reload Transaction detail before editing again.",
        );
        return;
      }
      if (problemCode(error) === "finance_transaction_kind_immutable")
        setServerError(
          "Transaction kind changed or cannot be edited here. Reload Transaction detail.",
        );
      else if (
        transaction.kind !== "internalTransfer" &&
        (problemCode(error) === "finance_account_archived" ||
          problemCode(error) === "finance_account_not_found")
      ) {
        const next = {
          accountId:
            problemCode(error) === "finance_account_archived"
              ? "The selected Account is archived. Choose an active Account or retain this Transaction's original Account."
              : "The selected Account is no longer available. Choose another Account.",
        };
        setErrors(next);
        setServerFieldToFocus("accountId");
      } else if (
        transaction.kind !== "internalTransfer" &&
        (problemCode(error) === "finance_category_archived" ||
          problemCode(error) === "finance_category_not_found")
      ) {
        const next = {
          categoryId:
            problemCode(error) === "finance_category_archived"
              ? "The selected Category is archived. Choose an active Category or retain this Transaction's original Category."
              : "The selected Category is no longer available. Choose another Category or Uncategorized.",
        };
        setErrors(next);
        setServerFieldToFocus("categoryId");
      } else if (
        problemCode(error) === "finance_account_archived" ||
        problemCode(error) === "finance_account_not_found"
      )
        setServerError(
          "A selected Account changed. Review the Source and Destination Accounts, then retry.",
        );
      else if (problemCode(error) === "validation_error")
        setServerError("Check the Transaction fields and try again.");
      else setServerError("Transaction could not be replaced. Try again.");
    } finally {
      releaseReplacement(lockKey);
      locked.current = false;
      pending.current = false;
      if (mounted.current) {
        onBusyChange(false);
        setBusy(false);
      }
    }
  }

  function accountOptions(
    role: "accountId" | "sourceAccountId" | "destinationAccountId",
    value: string,
    original: Reference | null,
    currencyFilter?: string,
  ) {
    const selected = accounts.find((item) => item.id === value);
    const originalId = original?.id;
    const originalOption =
      original &&
      !accounts.some(
        (item) => item.id === originalId && item.status === "active",
      )
        ? original
        : null;
    const choices = accounts.filter(
      (item) =>
        item.status === "active" &&
        (!currencyFilter || item.currency === currencyFilter) &&
        (role !== "destinationAccountId" || item.id !== sourceAccountId),
    );
    return (
      <Field data-invalid={Boolean(errors[role])} key={role}>
        <FieldLabel htmlFor={`edit-${role}`}>
          {role === "accountId"
            ? "Account"
            : role === "sourceAccountId"
              ? "Source Account"
              : "Destination Account"}
        </FieldLabel>
        <NativeSelect
          id={`edit-${role}`}
          ref={
            role === "accountId"
              ? accountRef
              : role === "sourceAccountId"
                ? sourceRef
                : destinationRef
          }
          aria-invalid={Boolean(errors[role])}
          aria-errormessage={errors[role] ? `edit-${role}-error` : undefined}
          disabled={busy || !currentReferences}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (role === "accountId") setAccountId(next);
            if (role === "accountId")
              setAccountCurrency(
                next === originalAccount?.id
                  ? originalCurrency
                  : accounts.find((item) => item.id === next)?.currency,
              );
            if (role === "sourceAccountId") {
              setSourceAccountId(next);
              setSourceCurrency(
                next === originalSource?.id
                  ? originalCurrency
                  : accounts.find((item) => item.id === next)?.currency,
              );
            }
            if (role === "destinationAccountId") {
              setDestinationAccountId(next);
              setDestinationCurrency(
                next === originalDestination?.id
                  ? originalCurrency
                  : accounts.find((item) => item.id === next)?.currency,
              );
            }
            clear(role);
          }}
        >
          <NativeSelectOption value="">Select an Account</NativeSelectOption>
          {originalOption ? (
            <NativeSelectOption value={originalOption.id}>
              {referenceLabel(originalOption, originalOption.id)} ·{" "}
              {originalCurrency}
            </NativeSelectOption>
          ) : null}
          {value &&
          value !== originalOption?.id &&
          !choices.some((item) => item.id === value) ? (
            <NativeSelectOption disabled value={value}>
              {selected ? accountLabels.get(value) : "Selected Account"}{" "}
              (unavailable in this role), Account ID {value}
            </NativeSelectOption>
          ) : null}
          {choices.map((item) => (
            <NativeSelectOption key={item.id} value={item.id}>
              {accountLabels.get(item.id)} · {item.currency}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>
          Existing archived Account may stay in this role. Other choices must be
          active.
          {selected?.status === "archived"
            ? " Selected Account is archived."
            : ""}
        </FieldDescription>
        <FieldError id={`edit-${role}-error`}>{errors[role]}</FieldError>
      </Field>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {label[transaction.kind]}</DialogTitle>
        <DialogDescription>
          {label[transaction.kind]} is fixed for this Transaction. Replace every
          field; existing archived references may stay in their original roles.
        </DialogDescription>
      </DialogHeader>
      <form
        aria-label={`Edit ${label[transaction.kind]}`}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <FieldGroup>
          {transaction.kind === "internalTransfer" ? (
            <>
              {accountOptions(
                "sourceAccountId",
                sourceAccountId,
                originalSource,
              )}
              {accountOptions(
                "destinationAccountId",
                destinationAccountId,
                originalDestination,
                currencyCode,
              )}
            </>
          ) : (
            accountOptions("accountId", accountId, originalAccount)
          )}
          <Field data-invalid={Boolean(errors.amount)}>
            <FieldLabel htmlFor="edit-amount">Amount</FieldLabel>
            <Input
              id="edit-amount"
              aria-invalid={Boolean(errors.amount)}
              aria-errormessage={
                errors.amount ? "edit-amount-error" : undefined
              }
              disabled={busy}
              inputMode="decimal"
              ref={amountRef}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                clear("amount");
              }}
            />
            <FieldDescription>
              Amount currency: {currencyCode ?? "select an Account"}.
            </FieldDescription>
            <FieldError id="edit-amount-error">{errors.amount}</FieldError>
          </Field>
          {transaction.kind !== "internalTransfer" ? (
            <Field data-invalid={Boolean(errors.categoryId)}>
              <FieldLabel htmlFor="edit-category">Category</FieldLabel>
              <NativeSelect
                id="edit-category"
                ref={categoryRef}
                aria-invalid={Boolean(errors.categoryId)}
                aria-errormessage={
                  errors.categoryId ? "edit-category-error" : undefined
                }
                disabled={busy || !currentReferences}
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  clear("categoryId");
                }}
              >
                <NativeSelectOption value="">Uncategorized</NativeSelectOption>
                {originalCategory &&
                !categories.some(
                  (item) =>
                    item.id === originalCategory.id && item.status === "active",
                ) ? (
                  <NativeSelectOption value={originalCategory.id}>
                    {categoryWorkflowLabel(originalCategory, categories)}{" "}
                    (archived), Category ID {originalCategory.id}
                  </NativeSelectOption>
                ) : null}
                {categoryId &&
                categoryId !== originalCategory?.id &&
                !categories.some(
                  (item) => item.id === categoryId && item.status === "active",
                ) ? (
                  <NativeSelectOption disabled value={categoryId}>
                    {categories.find((item) => item.id === categoryId)?.name ??
                      "Selected Category"}{" "}
                    (unavailable), Category ID {categoryId}
                  </NativeSelectOption>
                ) : null}
                {categories
                  .filter((item) => item.status === "active")
                  .map((item) => (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {categoryWorkflowLabel(item, categories)}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
              <FieldDescription>
                Existing archived Category may stay; alternatives are active or
                Uncategorized.
              </FieldDescription>
              <FieldError id="edit-category-error">
                {errors.categoryId}
              </FieldError>
            </Field>
          ) : null}
          <Field data-invalid={Boolean(errors.transactionDate)}>
            <FieldLabel htmlFor="edit-date">Transaction date</FieldLabel>
            <Input
              id="edit-date"
              ref={dateRef}
              aria-invalid={Boolean(errors.transactionDate)}
              aria-errormessage={
                errors.transactionDate ? "edit-date-error" : undefined
              }
              disabled={busy}
              type="date"
              value={transactionDate}
              onChange={(event) => {
                setTransactionDate(event.target.value);
                clear("transactionDate");
              }}
            />
            <FieldError id="edit-date-error">
              {errors.transactionDate}
            </FieldError>
          </Field>
          <Field data-invalid={Boolean(errors.note)}>
            <FieldLabel htmlFor="edit-note">Note</FieldLabel>
            <Textarea
              id="edit-note"
              ref={noteRef}
              aria-invalid={Boolean(errors.note)}
              aria-errormessage={errors.note ? "edit-note-error" : undefined}
              disabled={busy}
              rows={3}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                clear("note");
              }}
            />
            <FieldError id="edit-note-error">{errors.note}</FieldError>
          </Field>
        </FieldGroup>
        {!currentReferences ? (
          <p role="alert">
            Reference choices are unavailable. Retry loading references before
            saving.
          </p>
        ) : null}
        {!currentReferences ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void Promise.all([
                accountsQuery.refetch(),
                ...(transaction.kind === "internalTransfer"
                  ? []
                  : [categoriesQuery.refetch()]),
                currenciesQuery.refetch(),
              ])
            }
          >
            Retry loading references
          </Button>
        ) : null}
        {serverError ? (
          <p role="alert" className="text-destructive">
            {serverError}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (!locked.current) onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || uncertainResult || !currentReferences}
          >
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
