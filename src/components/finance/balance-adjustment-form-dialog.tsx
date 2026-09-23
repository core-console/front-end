import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  useCreateBalanceAdjustment,
  useGetBalanceAdjustmentContext,
} from "@/api/generated/core-console";
import {
  BalanceAdjustmentContextResponse,
  BalanceAdjustmentResultResponse,
  CreateBalanceAdjustmentRequest,
  FinanceRequestDate,
  ProblemDetails,
  type AccountResponse,
  type BalanceAdjustmentContextResponseOutput,
  type BalanceAdjustmentResultResponseOutput,
  type CurrencyResponse,
} from "@/api/generated/schemas";
import { buildAccountWorkflowLabels } from "@/components/finance/account-identity";
import { formatFinanceMoney } from "@/components/finance/finance-money";
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

type AdjustmentField =
  "accountId" | "note" | "targetBalance" | "transactionDate";
type FormErrors = Partial<Record<AdjustmentField, string>>;
type SelectedAccountIdentity = {
  id: string;
  label: string;
};
type ConflictCode =
  "account_balance_changed" | "finance_account_semantics_changed";
type ConflictReview = {
  code: ConflictCode;
  current: BalanceAdjustmentContextResponseOutput;
  previous: BalanceAdjustmentContextResponseOutput;
};
type ContextRecovery = {
  code: ConflictCode;
  previous: BalanceAdjustmentContextResponseOutput;
  status: "failed" | "refreshing";
};
type FreshContext = {
  accountId: string;
  context: BalanceAdjustmentContextResponseOutput;
  transactionDate: string;
};
type AccountRecovery = {
  code: "finance_account_archived" | "finance_account_not_found";
  status: "failed" | "refreshing";
};
type AccountRefreshResult =
  { accounts: AccountResponse[]; status: "success" } | { status: "error" };

type BalanceAdjustmentFormDialogProps = {
  accounts: AccountResponse[];
  currencies: CurrencyResponse[];
  ledgerId: string;
  onAdjusted: (
    result: BalanceAdjustmentResultResponseOutput,
    accountId: string,
  ) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  refreshAccounts: () => Promise<AccountRefreshResult>;
};

const signedPlainDecimalPattern = /^-?\d+(?:\.\d+)?$/;
const durableIntegerDigitsMax = 131_072;

function localDateValue() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function normalizedIntegerDigitCount(value: string) {
  return value.replace(/^-/, "").split(".", 1)[0]!.replace(/^0+/, "").length;
}

function transactionDateError(
  value: string,
  account: AccountResponse | undefined,
) {
  if (!FinanceRequestDate.safeParse(value).success) {
    return "Enter a valid Transaction Date.";
  }
  if (account && value < account.trackingStartDate) {
    return "Choose a Transaction Date on or after the Account's Tracking Start Date.";
  }
  return undefined;
}

function compareMagnitudes(left: string, right: string) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

function addMagnitudes(left: string, right: string) {
  let carry = 0;
  let result = "";
  for (
    let leftIndex = left.length - 1, rightIndex = right.length - 1;
    leftIndex >= 0 || rightIndex >= 0 || carry > 0;
    leftIndex -= 1, rightIndex -= 1
  ) {
    const sum =
      (leftIndex >= 0 ? Number(left[leftIndex]) : 0) +
      (rightIndex >= 0 ? Number(right[rightIndex]) : 0) +
      carry;
    result = String(sum % 10) + result;
    carry = Math.floor(sum / 10);
  }
  return result;
}

function subtractMagnitudes(larger: string, smaller: string) {
  let borrow = 0;
  let result = "";
  for (
    let largerIndex = larger.length - 1, smallerIndex = smaller.length - 1;
    largerIndex >= 0;
    largerIndex -= 1, smallerIndex -= 1
  ) {
    let digit =
      Number(larger[largerIndex]) -
      borrow -
      (smallerIndex >= 0 ? Number(smaller[smallerIndex]) : 0);
    if (digit < 0) {
      digit += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }
    result = String(digit) + result;
  }
  return result.replace(/^0+(?=\d)/, "");
}

function decimalCoefficient(value: string, scale: number) {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  const magnitude = `${integer}${fraction.padEnd(scale, "0")}`.replace(
    /^0+(?=\d)/,
    "",
  );
  return {
    magnitude,
    sign: /^0+$/.test(magnitude) ? 0 : negative ? -1 : 1,
  };
}

function subtractExactDecimals(minuend: string, subtrahend: string) {
  const scale = Math.max(
    minuend.split(".")[1]?.length ?? 0,
    subtrahend.split(".")[1]?.length ?? 0,
  );
  const left = decimalCoefficient(minuend, scale);
  const right = decimalCoefficient(subtrahend, scale);
  const rightSign = -right.sign;
  let sign = 0;
  let magnitude = "0";

  if (left.sign === 0) {
    sign = rightSign;
    magnitude = right.magnitude;
  } else if (rightSign === 0) {
    sign = left.sign;
    magnitude = left.magnitude;
  } else if (left.sign === rightSign) {
    sign = left.sign;
    magnitude = addMagnitudes(left.magnitude, right.magnitude);
  } else {
    const comparison = compareMagnitudes(left.magnitude, right.magnitude);
    if (comparison !== 0) {
      const leftIsLarger = comparison > 0;
      sign = leftIsLarger ? left.sign : rightSign;
      magnitude = subtractMagnitudes(
        leftIsLarger ? left.magnitude : right.magnitude,
        leftIsLarger ? right.magnitude : left.magnitude,
      );
    }
  }

  const padded = magnitude.padStart(scale + 1, "0");
  const integer = scale === 0 ? padded : padded.slice(0, -scale);
  const fraction = scale === 0 ? "" : `.${padded.slice(-scale)}`;
  return `${sign < 0 ? "-" : ""}${integer}${fraction}`;
}

function problemMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "info" in error &&
    typeof error.info === "object" &&
    error.info !== null &&
    "code" in error.info
  ) {
    if (
      error.info.code === "database_unavailable" ||
      error.info.code === "database_not_configured"
    ) {
      return "Balance Adjustments are temporarily unavailable. Try again later.";
    }
    if (error.info.code === "validation_error") {
      return "Check the Balance Adjustment fields and try again.";
    }
  }
  return "The Balance Adjustment could not be recorded. Try again.";
}

function parseProblem(error: unknown) {
  return ProblemDetails.safeParse(
    typeof error === "object" && error !== null && "info" in error
      ? error.info
      : undefined,
  );
}

function conflictCode(error: unknown): ConflictCode | null {
  const problem = parseProblem(error);
  if (!problem.success) return null;
  return problem.data.code === "account_balance_changed" ||
    problem.data.code === "finance_account_semantics_changed"
    ? problem.data.code
    : null;
}

function staleAccountCode(error: unknown): AccountRecovery["code"] | null {
  const problem = parseProblem(error);
  if (!problem.success) return null;
  return problem.data.code === "finance_account_archived" ||
    problem.data.code === "finance_account_not_found"
    ? problem.data.code
    : null;
}

function ContextReview({
  context,
}: {
  context: BalanceAdjustmentContextResponseOutput;
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-muted-foreground">Derived balance</span>
        <span className="font-medium">
          {formatFinanceMoney(context.derivedComparisonBalance)}
        </span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-muted-foreground">Account nature</span>
        <span className="font-medium">
          {context.accountNature === "asset" ? "Asset" : "Liability"}
        </span>
      </div>
    </div>
  );
}

function ConflictReviewAlert({ review }: { review: ConflictReview }) {
  const balanceChanged =
    review.previous.derivedComparisonBalance.amount !==
      review.current.derivedComparisonBalance.amount ||
    review.previous.derivedComparisonBalance.currency !==
      review.current.derivedComparisonBalance.currency;
  const natureChanged =
    review.previous.accountNature !== review.current.accountNature;
  const natureLabel = (nature: "asset" | "liability") =>
    nature === "asset" ? "Asset" : "Liability";

  return (
    <Alert>
      <AlertTitle>
        {review.code === "account_balance_changed"
          ? "Account balance changed"
          : "Account nature changed"}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        {balanceChanged ? (
          <p>
            Derived balance changed from{" "}
            {formatFinanceMoney(review.previous.derivedComparisonBalance)} to{" "}
            {formatFinanceMoney(review.current.derivedComparisonBalance)}.
          </p>
        ) : null}
        {natureChanged ? (
          <p>
            Account nature changed from{" "}
            {natureLabel(review.previous.accountNature)} to{" "}
            {natureLabel(review.current.accountNature)}.
          </p>
        ) : null}
        <p>
          Review the refreshed context. Your Account, target balance, and note
          were preserved; submit again only when the target is still correct.
        </p>
      </AlertDescription>
    </Alert>
  );
}

export function BalanceAdjustmentFormDialog({
  accounts,
  currencies,
  ledgerId,
  onAdjusted,
  onOpenChange,
  open,
  refreshAccounts,
}: BalanceAdjustmentFormDialogProps) {
  const accountLabels = buildAccountWorkflowLabels(accounts);
  const selectableAccounts = accounts.filter(
    (account) =>
      account.status === "active" &&
      currencies.some((currency) => currency.code === account.currency),
  );
  const initialAccount = selectableAccounts[0];
  const [accountId, setAccountId] = useState(initialAccount?.id ?? "");
  const [selectedAccountIdentity, setSelectedAccountIdentity] =
    useState<SelectedAccountIdentity | null>(() =>
      initialAccount
        ? {
            id: initialAccount.id,
            label: accountLabels.get(initialAccount.id) ?? initialAccount.name,
          }
        : null,
    );
  const [transactionDate, setTransactionDate] = useState(localDateValue);
  const [targetBalance, setTargetBalance] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [conflictReview, setConflictReview] = useState<ConflictReview | null>(
    null,
  );
  const [contextRecovery, setContextRecovery] =
    useState<ContextRecovery | null>(null);
  const [conflictRequirement, setConflictRequirement] = useState<
    Pick<ContextRecovery, "code" | "previous"> | undefined
  >();
  const [freshContext, setFreshContext] = useState<FreshContext | null>(null);
  const [accountRecovery, setAccountRecovery] =
    useState<AccountRecovery | null>(null);
  const [accountIdRequiringReselection, setAccountIdRequiringReselection] =
    useState("");
  const [focusAccount, setFocusAccount] = useState(false);
  const accountRef = useRef<HTMLSelectElement>(null);
  const transactionDateRef = useRef<HTMLInputElement>(null);
  const targetBalanceRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const finishRecoveryRef = useRef<(() => void) | null>(null);
  const selectedContextRef = useRef({ accountId, transactionDate });
  selectedContextRef.current = { accountId, transactionDate };
  const submittedContextRef =
    useRef<BalanceAdjustmentContextResponseOutput | null>(null);
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const selectedAccountLabel =
    selectedAccountIdentity?.id === accountId
      ? selectedAccountIdentity.label
      : selectedAccount
        ? accountLabels.get(selectedAccount.id)
        : undefined;
  const contextEnabled = Boolean(
    open &&
    selectedAccount?.status === "active" &&
    FinanceRequestDate.safeParse(transactionDate).success &&
    transactionDate >= selectedAccount.trackingStartDate,
  );
  const contextQuery = useGetBalanceAdjustmentContext(
    ledgerId,
    accountId,
    { transactionDate },
    {
      query: {
        enabled: contextEnabled,
        retry: false,
        select: (response) => {
          const parsed = BalanceAdjustmentContextResponse.parse(response.data);
          if (
            parsed.account.id !== accountId ||
            parsed.account.status !== "active" ||
            parsed.transactionDate !== transactionDate ||
            parsed.derivedComparisonBalance.currency !==
              selectedAccount?.currency
          ) {
            throw new Error(
              "Balance Adjustment context did not match the selected Account and date.",
            );
          }
          return parsed;
        },
      },
    },
  );
  const refetchContext = contextQuery.refetch;
  const context = conflictRequirement
    ? !contextRecovery &&
      freshContext?.accountId === accountId &&
      freshContext.transactionDate === transactionDate
      ? freshContext.context
      : undefined
    : contextQuery.data;
  const currency = currencies.find(
    (item) =>
      item.code ===
      (context ?? contextQuery.data)?.derivedComparisonBalance.currency,
  );
  const targetIsValid =
    signedPlainDecimalPattern.test(targetBalance) &&
    normalizedIntegerDigitCount(targetBalance) <= durableIntegerDigitsMax &&
    Boolean(currency) &&
    (targetBalance.split(".")[1]?.length ?? 0) <= (currency?.minorUnit ?? -1);
  const previewAmount =
    context && !contextQuery.isRefetchError && targetIsValid
      ? subtractExactDecimals(
          targetBalance,
          context.derivedComparisonBalance.amount,
        )
      : null;
  const refreshConflictContext = ({
    code,
    previous,
  }: Pick<ContextRecovery, "code" | "previous">) => {
    setConflictRequirement({ code, previous });
    setFreshContext(null);
    setConflictReview(null);
    setContextRecovery({ code, previous, status: "refreshing" });
    return new Promise<void>((resolve) => {
      finishRecoveryRef.current = resolve;
    });
  };
  const finishRecovery = () => {
    finishRecoveryRef.current?.();
    finishRecoveryRef.current = null;
  };
  useEffect(
    () => () => {
      finishRecoveryRef.current?.();
      finishRecoveryRef.current = null;
    },
    [],
  );
  useEffect(() => {
    if (contextRecovery?.status !== "refreshing") return;
    if (!contextEnabled) {
      setContextRecovery({ ...contextRecovery, status: "failed" });
      submittingRef.current = false;
      finishRecovery();
      return;
    }

    let current = true;
    const { code, previous } = contextRecovery;
    void refetchContext({ cancelRefetch: false }).then((refreshed) => {
      if (
        !current ||
        selectedContextRef.current.accountId !== accountId ||
        selectedContextRef.current.transactionDate !== transactionDate
      ) {
        return;
      }
      if (
        refreshed.isSuccess &&
        !refreshed.isRefetchError &&
        refreshed.data?.account.id === accountId &&
        refreshed.data.transactionDate === transactionDate
      ) {
        setFreshContext({
          accountId,
          context: refreshed.data,
          transactionDate,
        });
        setConflictReview(
          previous.account.id === accountId &&
            previous.transactionDate === transactionDate
            ? { code, current: refreshed.data, previous }
            : null,
        );
        setContextRecovery(null);
      } else {
        setContextRecovery({ code, previous, status: "failed" });
      }
      submittingRef.current = false;
      finishRecovery();
    });
    return () => {
      current = false;
    };
  }, [
    accountId,
    contextEnabled,
    contextRecovery,
    refetchContext,
    transactionDate,
  ]);
  const recoverAccountReference = async (code: AccountRecovery["code"]) => {
    setAccountRecovery({ code, status: "refreshing" });
    let result: AccountRefreshResult;
    try {
      result = await refreshAccounts();
    } catch {
      result = { status: "error" };
    }
    if (result.status === "error") {
      setAccountRecovery({ code, status: "failed" });
      submittingRef.current = false;
      return;
    }

    const refreshedAccount = result.accounts.find(
      (account) => account.id === accountId,
    );
    if (refreshedAccount?.status !== "active") {
      setAccountIdRequiringReselection(accountId);
      setErrors((current) => ({
        ...current,
        accountId:
          code === "finance_account_archived"
            ? `The selected Account — ${selectedAccountLabel ?? "Selected Account"} — was archived. Choose another active Account; your target balance and note have been kept.`
            : `The selected Account — ${selectedAccountLabel ?? "Selected Account"} — is no longer available. Choose another active Account; your target balance and note have been kept.`,
      }));
      setFocusAccount(true);
    }
    setAccountRecovery(null);
    submittingRef.current = false;
  };
  const mutation = useCreateBalanceAdjustment({
    mutation: {
      onError: async (error) => {
        const code = conflictCode(error);
        const previous = submittedContextRef.current;
        if (code && previous) {
          await refreshConflictContext({ code, previous });
          return;
        }
        const accountCode = staleAccountCode(error);
        if (accountCode) {
          await recoverAccountReference(accountCode);
          return;
        }
        submittingRef.current = false;
        setErrors((current) => ({
          ...current,
          targetBalance: problemMessage(error),
        }));
      },
      onSuccess: async (response) => {
        const result = BalanceAdjustmentResultResponse.parse(response.data);
        const refresh = onAdjusted(result, accountId);
        onOpenChange(false);
        await refresh;
      },
    },
  });
  const workflowPending =
    mutation.isPending ||
    contextRecovery?.status === "refreshing" ||
    accountRecovery?.status === "refreshing";
  const formId = "record-balance-adjustment";

  useEffect(() => {
    if (!focusAccount || workflowPending) return;
    accountRef.current?.focus();
    setFocusAccount(false);
  }, [accounts, focusAccount, workflowPending]);

  const clearError = (field: AdjustmentField) => {
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    if (mutation.isError) mutation.reset();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || workflowPending) return;

    const nextErrors: FormErrors = {};
    const trimmedNote = note.trim();
    if (accountIdRequiringReselection === accountId) {
      nextErrors.accountId =
        errors.accountId ?? "Choose another active Account.";
    } else if (!selectedAccount || selectedAccount.status !== "active") {
      nextErrors.accountId = "Choose an active Account.";
    }
    const dateError = transactionDateError(transactionDate, selectedAccount);
    if (dateError) nextErrors.transactionDate = dateError;
    if (!signedPlainDecimalPattern.test(targetBalance)) {
      nextErrors.targetBalance =
        "Enter a signed or unsigned plain decimal balance.";
    } else if (
      normalizedIntegerDigitCount(targetBalance) > durableIntegerDigitsMax
    ) {
      nextErrors.targetBalance = "Target balance has too many integer digits.";
    } else if (!currency) {
      nextErrors.targetBalance =
        "Target currency is unavailable for this Account context.";
    } else if (
      (targetBalance.split(".")[1]?.length ?? 0) > currency.minorUnit
    ) {
      nextErrors.targetBalance =
        currency.minorUnit === 0
          ? `${currency.code} balances cannot include fractional digits.`
          : `${currency.code} balances support at most ${currency.minorUnit} fractional digits.`;
    }
    if ([...trimmedNote].length > 500) {
      nextErrors.note = "Note must be 500 characters or fewer.";
    }
    if (!context || contextQuery.isError || contextQuery.isRefetchError) {
      nextErrors.targetBalance =
        "Load fresh adjustment context before recording this target balance.";
    }

    setErrors(nextErrors);
    const firstInvalid = (
      ["accountId", "transactionDate", "targetBalance", "note"] as const
    ).find((field) => nextErrors[field]);
    if (firstInvalid) {
      const target =
        firstInvalid === "accountId"
          ? accountRef.current
          : firstInvalid === "transactionDate"
            ? transactionDateRef.current
            : firstInvalid === "targetBalance"
              ? targetBalanceRef.current
              : noteRef.current;
      target?.focus();
      return;
    }
    if (!selectedAccount || !context) return;

    const data = CreateBalanceAdjustmentRequest.parse({
      accountId: selectedAccount.id,
      expectedAccountNature: context.accountNature,
      expectedDerivedBalance: context.derivedComparisonBalance,
      note: trimmedNote || null,
      targetBalance: {
        amount: targetBalance,
        currency: context.derivedComparisonBalance.currency,
      },
      transactionDate,
    });
    setConflictReview(null);
    submittedContextRef.current = context;
    submittingRef.current = true;
    mutation.mutate({ data, ledgerId });
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && (submittingRef.current || workflowPending)) return;
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent
        aria-busy={workflowPending}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md"
        finalFocus={false}
        showCloseButton={!workflowPending}
      >
        <DialogHeader>
          <DialogTitle>Record balance adjustment</DialogTitle>
          <DialogDescription>
            Review the backend-derived Account balance and Nature before setting
            a known actual target balance.
          </DialogDescription>
        </DialogHeader>
        <form
          aria-label="Record balance adjustment"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit}
        >
          <FieldGroup>
            <Field
              data-disabled={workflowPending}
              data-invalid={Boolean(errors.accountId)}
            >
              <FieldLabel htmlFor={`${formId}-account`}>Account</FieldLabel>
              <NativeSelect
                aria-describedby={`${formId}-account-description`}
                aria-errormessage={
                  errors.accountId ? `${formId}-account-error` : undefined
                }
                aria-invalid={Boolean(errors.accountId)}
                autoFocus
                disabled={workflowPending}
                id={`${formId}-account`}
                onChange={(event) => {
                  const nextId = event.target.value;
                  selectedContextRef.current = {
                    accountId: nextId,
                    transactionDate,
                  };
                  const nextAccount = selectableAccounts.find(
                    (account) => account.id === nextId,
                  );
                  setAccountId(nextId);
                  setSelectedAccountIdentity(
                    nextAccount
                      ? {
                          id: nextAccount.id,
                          label:
                            accountLabels.get(nextAccount.id) ??
                            nextAccount.name,
                        }
                      : null,
                  );
                  setConflictReview(null);
                  setContextRecovery(
                    conflictRequirement
                      ? { ...conflictRequirement, status: "refreshing" }
                      : null,
                  );
                  setAccountRecovery(null);
                  setAccountIdRequiringReselection("");
                  setTargetBalance("");
                  clearError("accountId");
                  clearError("targetBalance");
                  clearError("transactionDate");
                  const nextDateError = transactionDateError(
                    transactionDate,
                    nextAccount,
                  );
                  if (nextDateError) {
                    setErrors((current) => ({
                      ...current,
                      transactionDate: nextDateError,
                    }));
                  }
                }}
                ref={accountRef}
                value={accountId}
              >
                <NativeSelectOption value="">
                  Select an Account
                </NativeSelectOption>
                {accountId &&
                !selectableAccounts.some(
                  (account) => account.id === accountId,
                ) ? (
                  <NativeSelectOption disabled value={accountId}>
                    {selectedAccountLabel ?? "Selected Account"} (unavailable)
                  </NativeSelectOption>
                ) : null}
                {selectableAccounts.map((account) => (
                  <NativeSelectOption key={account.id} value={account.id}>
                    {accountLabels.get(account.id)} · {account.currency}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription id={`${formId}-account-description`}>
                Only active Accounts can be adjusted. The selected Account
                supplies target currency.
              </FieldDescription>
              <FieldError id={`${formId}-account-error`}>
                {errors.accountId}
              </FieldError>
            </Field>
            <Field
              data-disabled={workflowPending}
              data-invalid={Boolean(errors.transactionDate)}
            >
              <FieldLabel htmlFor={`${formId}-date`}>
                Transaction date
              </FieldLabel>
              <Input
                aria-describedby={`${formId}-date-description`}
                aria-errormessage={
                  errors.transactionDate ? `${formId}-date-error` : undefined
                }
                aria-invalid={Boolean(errors.transactionDate)}
                disabled={workflowPending}
                id={`${formId}-date`}
                onChange={(event) => {
                  const nextDate = event.target.value;
                  selectedContextRef.current = {
                    accountId,
                    transactionDate: nextDate,
                  };
                  setTransactionDate(nextDate);
                  setConflictReview(null);
                  setContextRecovery(
                    conflictRequirement
                      ? { ...conflictRequirement, status: "refreshing" }
                      : null,
                  );
                  clearError("transactionDate");
                  clearError("targetBalance");
                  const nextDateError = transactionDateError(
                    nextDate,
                    selectedAccount,
                  );
                  if (nextDateError) {
                    setErrors((current) => ({
                      ...current,
                      transactionDate: nextDateError,
                    }));
                  }
                }}
                ref={transactionDateRef}
                type="date"
                value={transactionDate}
              />
              <FieldDescription id={`${formId}-date-description`}>
                Target balance means the known end-of-day Account Balance on
                this date; Finance does not imply intra-day ordering.
              </FieldDescription>
              <FieldError id={`${formId}-date-error`}>
                {errors.transactionDate}
              </FieldError>
            </Field>
            {contextRecovery?.status === "refreshing" ? (
              <div
                aria-label="Refreshing authoritative Balance Adjustment context"
                className="flex flex-col gap-2"
                role="status"
              >
                <p className="text-sm text-muted-foreground">
                  Refreshing authoritative Account context…
                </p>
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : contextRecovery?.status === "failed" ? (
              <Alert variant="destructive">
                <AlertTitle>Authoritative context refresh failed</AlertTitle>
                <AlertDescription>
                  <p>
                    The refreshed Account context could not be loaded. Retry the
                    refresh before submitting this target again.
                  </p>
                  <Button
                    className="mt-2"
                    onClick={() => void refreshConflictContext(contextRecovery)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Retry context refresh
                  </Button>
                </AlertDescription>
              </Alert>
            ) : contextQuery.isPending && contextEnabled ? (
              <div
                aria-label="Loading Balance Adjustment context"
                className="flex flex-col gap-2"
                role="status"
              >
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : contextQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Adjustment context could not be loaded</AlertTitle>
                <AlertDescription>
                  Refresh the authoritative Account context before entering a
                  target balance.
                  <Button
                    className="mt-2"
                    onClick={() => void contextQuery.refetch()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Retry context
                  </Button>
                </AlertDescription>
              </Alert>
            ) : context ? (
              <ContextReview context={context} />
            ) : null}
            {conflictReview ? (
              <ConflictReviewAlert review={conflictReview} />
            ) : null}
            {accountRecovery?.status === "failed" ? (
              <Alert variant="destructive">
                <AlertTitle>Accounts could not be refreshed</AlertTitle>
                <AlertDescription>
                  <p>
                    Retry the Account refresh before submitting this target
                    again. The selected Account, target balance, and note remain
                    unchanged.
                  </p>
                  <Button
                    className="mt-2"
                    onClick={() =>
                      void recoverAccountReference(accountRecovery.code)
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Retry Account refresh
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <Field
              data-disabled={!contextQuery.data || workflowPending}
              data-invalid={Boolean(errors.targetBalance)}
            >
              <FieldLabel htmlFor={`${formId}-target`}>
                Target balance
              </FieldLabel>
              <Input
                aria-describedby={`${formId}-target-description`}
                aria-errormessage={
                  errors.targetBalance ? `${formId}-target-error` : undefined
                }
                aria-invalid={Boolean(errors.targetBalance)}
                disabled={!contextQuery.data || workflowPending}
                id={`${formId}-target`}
                inputMode="decimal"
                onChange={(event) => {
                  setTargetBalance(event.target.value);
                  clearError("targetBalance");
                }}
                ref={targetBalanceRef}
                value={targetBalance}
              />
              <FieldDescription id={`${formId}-target-description`}>
                {contextQuery.data
                  ? `Known actual Account Balance in ${contextQuery.data.derivedComparisonBalance.currency}. This target is workflow input only.`
                  : "Available after authoritative context loads."}
              </FieldDescription>
              <FieldError id={`${formId}-target-error`}>
                {errors.targetBalance}
              </FieldError>
            </Field>
            {context && previewAmount !== null ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Correction delta</span>
                <span className="font-medium">
                  {previewAmount.startsWith("-") ||
                  /^0(?:\.0+)?$/.test(previewAmount)
                    ? ""
                    : "+"}
                  {formatFinanceMoney({
                    amount: previewAmount,
                    currency: context.derivedComparisonBalance.currency,
                  })}
                </span>
              </div>
            ) : null}
            <Field
              data-disabled={workflowPending}
              data-invalid={Boolean(errors.note)}
            >
              <FieldLabel htmlFor={`${formId}-note`}>Note</FieldLabel>
              <Textarea
                aria-describedby={`${formId}-note-description`}
                aria-errormessage={
                  errors.note ? `${formId}-note-error` : undefined
                }
                aria-invalid={Boolean(errors.note)}
                disabled={workflowPending}
                id={`${formId}-note`}
                onChange={(event) => {
                  setNote(event.target.value);
                  clearError("note");
                }}
                ref={noteRef}
                rows={3}
                value={note}
              />
              <FieldDescription id={`${formId}-note-description`}>
                Optional, up to 500 characters.
              </FieldDescription>
              <FieldError id={`${formId}-note-error`}>{errors.note}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={workflowPending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                !context ||
                workflowPending ||
                selectedAccount?.status !== "active" ||
                contextQuery.isRefetchError ||
                contextRecovery?.status === "failed" ||
                accountRecovery?.status === "failed" ||
                accountIdRequiringReselection === accountId
              }
              type="submit"
            >
              {workflowPending ? "Recording adjustment…" : "Record adjustment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
