import { type FormEvent, useEffect, useRef, useState } from "react";

import { useCreateFinanceTransaction } from "@/api/generated/core-console";
import {
  CreateFinanceTransactionBody,
  FinanceRequestDate,
  InternalTransferTransactionResponse,
  ProblemDetails,
  type AccountResponse,
  type CurrencyResponse,
  type FinanceTransactionResponseOutput,
} from "@/api/generated/schemas";
import { buildAccountWorkflowLabels } from "@/components/finance/account-identity";
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

type TransferField =
  | "amount"
  | "destinationAccountId"
  | "note"
  | "sourceAccountId"
  | "transactionDate";
type FormErrors = Partial<Record<TransferField, string>>;
type SelectedAccountIdentity = {
  currency: AccountResponse["currency"];
  id: string;
  label: string;
};
type AccountRecoveryReason = "accountReference" | "currencyMismatch";
type AccountRefreshResult =
  { accounts: AccountResponse[]; status: "success" } | { status: "error" };

type InternalTransferFormDialogProps = {
  accounts: AccountResponse[];
  currencies: CurrencyResponse[];
  ledgerId: string;
  onOpenChange: (open: boolean) => void;
  onRecorded: (transaction: FinanceTransactionResponseOutput) => Promise<void>;
  open: boolean;
  refreshAccounts: () => Promise<AccountRefreshResult>;
};

const positivePlainDecimalPattern = /^\d+(?:\.\d+)?$/;
const durableIntegerDigitsMax = 131_072;
const transferCurrencyMismatchDetail =
  "Transfer Accounts and amount must use the same currency.";

function localDateValue() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function isStrictlyPositiveDecimal(value: string) {
  return positivePlainDecimalPattern.test(value) && /[1-9]/.test(value);
}

function normalizedIntegerDigitCount(value: string) {
  return value.split(".", 1)[0]!.replace(/^0+/, "").length;
}

function selectedIdentity(
  account: AccountResponse,
  labels: ReadonlyMap<string, string>,
): SelectedAccountIdentity {
  return {
    currency: account.currency,
    id: account.id,
    label: labels.get(account.id) ?? account.name,
  };
}

function sourceCurrencyChangedMessage(label?: string) {
  return label
    ? `The selected Source Account — ${label} — changed currency. Choose a valid Source Account again; your other values have been kept.`
    : "The selected Source Account changed currency. Choose a valid Source Account again; your other values have been kept.";
}

function destinationCurrencyChangedMessage(label?: string) {
  return label
    ? `The selected Destination Account — ${label} — changed currency. Choose a compatible Destination Account again; your other values have been kept.`
    : "The selected Destination Account changed currency. Choose a compatible Destination Account again; your other values have been kept.";
}

function parseProblem(error: unknown) {
  return ProblemDetails.safeParse(
    typeof error === "object" && error !== null && "info" in error
      ? error.info
      : undefined,
  );
}

function serverMessage(error: unknown) {
  const result = parseProblem(error);
  if (!result.success) {
    return "The Internal Transfer could not be recorded. Try again.";
  }
  if (
    result.data.code === "database_unavailable" ||
    result.data.code === "database_not_configured"
  ) {
    return "Transactions are temporarily unavailable. Try again later.";
  }
  if (result.data.code === "validation_error") {
    return "Check the Internal Transfer fields and try again.";
  }
  return "The Internal Transfer could not be recorded. Try again.";
}

export function InternalTransferFormDialog({
  accounts,
  currencies,
  ledgerId,
  onOpenChange,
  onRecorded,
  open,
  refreshAccounts,
}: InternalTransferFormDialogProps) {
  const accountLabels = buildAccountWorkflowLabels(accounts);
  const selectableSources = accounts.filter(
    (source) =>
      source.status === "active" &&
      accounts.some(
        (destination) =>
          destination.status === "active" &&
          destination.id !== source.id &&
          destination.currency === source.currency,
      ),
  );
  const initialSource = selectableSources[0];
  const [sourceAccountId, setSourceAccountId] = useState(
    initialSource?.id ?? "",
  );
  const [sourceIdentity, setSourceIdentity] =
    useState<SelectedAccountIdentity | null>(() =>
      initialSource ? selectedIdentity(initialSource, accountLabels) : null,
    );
  const [destinationAccountId, setDestinationAccountId] = useState("");
  const [destinationIdentity, setDestinationIdentity] =
    useState<SelectedAccountIdentity | null>(null);
  const [amount, setAmount] = useState("");
  const [transactionDate, setTransactionDate] = useState(localDateValue);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState("");
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [accountRecoveryReason, setAccountRecoveryReason] =
    useState<AccountRecoveryReason | null>(null);
  const [
    sourceAccountIdRequiringReselection,
    setSourceAccountIdRequiringReselection,
  ] = useState("");
  const [
    destinationAccountIdRequiringReselection,
    setDestinationAccountIdRequiringReselection,
  ] = useState("");
  const [focusField, setFocusField] = useState<TransferField | null>(null);
  const sourceRef = useRef<HTMLSelectElement>(null);
  const destinationRef = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const transactionDateRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const retryAccountRefreshRef = useRef<HTMLButtonElement>(null);
  const submittingRef = useRef(false);
  const recoveryPendingRef = useRef(false);
  const sourceAccount = accounts.find(
    (account) => account.id === sourceAccountId,
  );
  const destinationAccount = accounts.find(
    (account) => account.id === destinationAccountId,
  );
  const sourceCurrency = sourceAccount?.currency ?? sourceIdentity?.currency;
  const currency = currencies.find((item) => item.code === sourceCurrency);
  const eligibleDestinations = accounts.filter(
    (account) =>
      account.status === "active" &&
      account.id !== sourceAccountId &&
      account.currency === sourceCurrency,
  );
  const sourceLabel =
    sourceIdentity?.id === sourceAccountId
      ? sourceIdentity.label
      : sourceAccount
        ? accountLabels.get(sourceAccount.id)
        : undefined;
  const destinationLabel =
    destinationIdentity?.id === destinationAccountId
      ? destinationIdentity.label
      : destinationAccount
        ? accountLabels.get(destinationAccount.id)
        : undefined;
  const recoverAccounts = async (reason: AccountRecoveryReason) => {
    if (recoveryPendingRef.current) return;
    recoveryPendingRef.current = true;
    setRecoveryPending(true);
    let result: AccountRefreshResult;
    try {
      result = await refreshAccounts();
    } catch {
      result = { status: "error" };
    }
    if (result.status === "error") {
      setAccountRecoveryReason(reason);
      setServerError(
        "Accounts could not be refreshed. Retry Account refresh before submitting this transfer.",
      );
      submittingRef.current = false;
      recoveryPendingRef.current = false;
      setRecoveryPending(false);
      return;
    }

    const refreshed = result.accounts;
    const refreshedSource = refreshed.find(
      (account) => account.id === sourceAccountId,
    );
    const refreshedDestination = refreshed.find(
      (account) => account.id === destinationAccountId,
    );
    const sourceAvailable = refreshedSource?.status === "active";
    const destinationAvailable = refreshedDestination?.status === "active";
    const nextErrors: FormErrors = {};
    if (reason === "currencyMismatch") {
      const sourceCurrencyChanged =
        sourceAvailable &&
        refreshedSource !== undefined &&
        sourceIdentity !== null &&
        refreshedSource.currency !== sourceIdentity.currency;
      const destinationCurrencyChanged =
        destinationAvailable &&
        refreshedDestination !== undefined &&
        destinationIdentity !== null &&
        refreshedDestination.currency !== destinationIdentity.currency;
      const pairCompatible =
        sourceAvailable &&
        destinationAvailable &&
        refreshedSource !== undefined &&
        refreshedDestination !== undefined &&
        refreshedSource.id !== refreshedDestination.id &&
        refreshedSource.currency === refreshedDestination.currency;

      setSourceAccountIdRequiringReselection(
        sourceCurrencyChanged ? sourceAccountId : "",
      );
      setDestinationAccountIdRequiringReselection(
        destinationCurrencyChanged ? destinationAccountId : "",
      );
      if (!sourceAvailable) {
        nextErrors.sourceAccountId = sourceLabel
          ? `The selected Source Account — ${sourceLabel} — is no longer available. Choose another active Account; your other values have been kept.`
          : "Choose another active Source Account; your other values have been kept.";
      } else if (sourceCurrencyChanged) {
        nextErrors.sourceAccountId = sourceCurrencyChangedMessage(sourceLabel);
      }
      if (!destinationAvailable) {
        nextErrors.destinationAccountId = destinationLabel
          ? `The selected Destination Account — ${destinationLabel} — is no longer available. Choose another compatible active Account; your other values have been kept.`
          : "Choose another compatible active Destination Account; your other values have been kept.";
      } else if (destinationCurrencyChanged) {
        nextErrors.destinationAccountId =
          destinationCurrencyChangedMessage(destinationLabel);
      } else if (sourceAvailable && !pairCompatible) {
        nextErrors.destinationAccountId = destinationLabel
          ? `The selected Destination Account — ${destinationLabel} — is no longer compatible with the refreshed Source Account. Choose another compatible active Account; your other values have been kept.`
          : "Choose another compatible active Destination Account; your other values have been kept.";
      }
    } else {
      if (!sourceAvailable || destinationAvailable) {
        nextErrors.sourceAccountId = sourceLabel
          ? `The selected Source Account — ${sourceLabel} — is no longer available. Choose another active Account; your other values have been kept.`
          : "Choose another active Source Account; your other values have been kept.";
      }
      if (!destinationAvailable || sourceAvailable) {
        nextErrors.destinationAccountId = destinationLabel
          ? `The selected Destination Account — ${destinationLabel} — is no longer available. Choose another compatible active Account; your other values have been kept.`
          : "Choose another compatible active Destination Account; your other values have been kept.";
      }
    }
    setAccountRecoveryReason(null);
    setErrors((current) => ({ ...current, ...nextErrors }));
    setServerError(
      Object.keys(nextErrors).length === 0
        ? "Accounts were refreshed. Review the transfer and try again."
        : "",
    );
    setFocusField(
      nextErrors.sourceAccountId ? "sourceAccountId" : "destinationAccountId",
    );
    submittingRef.current = false;
    recoveryPendingRef.current = false;
    setRecoveryPending(false);
  };
  const mutation = useCreateFinanceTransaction({
    mutation: {
      onError: async (error) => {
        const problem = parseProblem(error);
        const isCurrencyMismatch =
          problem.success &&
          problem.data.code === "validation_error" &&
          problem.data.detail === transferCurrencyMismatchDetail;
        if (
          problem.success &&
          (isCurrencyMismatch ||
            problem.data.code === "finance_account_archived" ||
            problem.data.code === "finance_account_not_found")
        ) {
          await recoverAccounts(
            isCurrencyMismatch ? "currencyMismatch" : "accountReference",
          );
          return;
        }
        submittingRef.current = false;
        setServerError(serverMessage(error));
        if (
          problem.success &&
          problem.data.code === "validation_error" &&
          problem.data.detail?.includes("Tracking Start Date")
        ) {
          setErrors((current) => ({
            ...current,
            transactionDate:
              "Choose a Transaction Date on or after both Accounts' Tracking Start Dates.",
          }));
          setServerError("");
          setFocusField("transactionDate");
        }
      },
      onSuccess: async (response) => {
        const transaction = InternalTransferTransactionResponse.parse(
          response.data,
        );
        const refresh = onRecorded(transaction);
        onOpenChange(false);
        await refresh;
      },
    },
  });
  const workflowPending = mutation.isPending || recoveryPending;

  useEffect(() => {
    if (!accountRecoveryReason || workflowPending) return;
    retryAccountRefreshRef.current?.focus();
  }, [accountRecoveryReason, workflowPending]);

  useEffect(() => {
    if (!focusField) return;
    const target =
      focusField === "sourceAccountId"
        ? sourceRef.current
        : focusField === "destinationAccountId"
          ? destinationRef.current
          : focusField === "amount"
            ? amountRef.current
            : focusField === "transactionDate"
              ? transactionDateRef.current
              : noteRef.current;
    if (!target?.isConnected) return;
    target.focus();
    setFocusField(null);
  }, [accounts, focusField]);

  const clearError = (field: TransferField) => {
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    if (!accountRecoveryReason) setServerError("");
    if (mutation.isError) mutation.reset();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || workflowPending || accountRecoveryReason) {
      return;
    }

    const nextErrors: FormErrors = {};
    const trimmedNote = note.trim();
    if (sourceAccountIdRequiringReselection === sourceAccountId) {
      nextErrors.sourceAccountId = sourceCurrencyChangedMessage(sourceLabel);
    } else if (!sourceAccount || sourceAccount.status !== "active") {
      nextErrors.sourceAccountId = "Choose an active Source Account.";
    }
    if (destinationAccountIdRequiringReselection === destinationAccountId) {
      nextErrors.destinationAccountId =
        destinationCurrencyChangedMessage(destinationLabel);
    } else if (
      !destinationAccount ||
      destinationAccount.status !== "active" ||
      destinationAccount.id === sourceAccount?.id ||
      destinationAccount.currency !== sourceAccount?.currency
    ) {
      nextErrors.destinationAccountId =
        "Choose a distinct active Destination Account in the same currency.";
    }
    if (!isStrictlyPositiveDecimal(amount)) {
      nextErrors.amount = "Enter a positive plain decimal amount.";
    } else if (normalizedIntegerDigitCount(amount) > durableIntegerDigitsMax) {
      nextErrors.amount = "Amount has too many integer digits.";
    } else if (!currency) {
      nextErrors.amount = "Amount currency is unavailable for this Account.";
    } else if ((amount.split(".")[1]?.length ?? 0) > currency.minorUnit) {
      nextErrors.amount =
        currency.minorUnit === 0
          ? `${currency.code} amounts cannot include fractional digits.`
          : `${currency.code} amounts support at most ${currency.minorUnit} fractional digits.`;
    }
    if (!FinanceRequestDate.safeParse(transactionDate).success) {
      nextErrors.transactionDate = "Enter a valid Transaction Date.";
    } else if (
      sourceAccount &&
      transactionDate < sourceAccount.trackingStartDate
    ) {
      nextErrors.transactionDate =
        "Choose a Transaction Date on or after the Source Account's Tracking Start Date.";
    } else if (
      destinationAccount &&
      transactionDate < destinationAccount.trackingStartDate
    ) {
      nextErrors.transactionDate =
        "Choose a Transaction Date on or after the Destination Account's Tracking Start Date.";
    }
    if ([...trimmedNote].length > 500) {
      nextErrors.note = "Note must be 500 characters or fewer.";
    }

    setErrors(nextErrors);
    const firstInvalid = (
      [
        "sourceAccountId",
        "destinationAccountId",
        "amount",
        "transactionDate",
        "note",
      ] as const
    ).find((field) => nextErrors[field]);
    if (firstInvalid) {
      setFocusField(firstInvalid);
      return;
    }
    if (!sourceAccount || !destinationAccount || !currency) return;

    const data = CreateFinanceTransactionBody.parse({
      amount: { amount, currency: sourceAccount.currency },
      destinationAccountId: destinationAccount.id,
      kind: "internalTransfer",
      note: trimmedNote || null,
      sourceAccountId: sourceAccount.id,
      transactionDate,
    });
    submittingRef.current = true;
    mutation.mutate({ data, ledgerId });
  };

  const formId = "record-internal-transfer";

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (
          !nextOpen &&
          (submittingRef.current ||
            recoveryPendingRef.current ||
            workflowPending)
        )
          return;
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
          <DialogTitle>Record internal transfer</DialogTitle>
          <DialogDescription>
            Move exact Money between two active Accounts in this Ledger. The
            Source Account supplies currency; no available-balance rule applies.
          </DialogDescription>
        </DialogHeader>
        <form
          aria-label="Record internal transfer"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit}
        >
          <FieldGroup>
            <Field
              data-disabled={workflowPending}
              data-invalid={Boolean(errors.sourceAccountId)}
            >
              <FieldLabel htmlFor={`${formId}-source`}>
                Source Account
              </FieldLabel>
              <NativeSelect
                aria-describedby={`${formId}-source-description`}
                aria-errormessage={
                  errors.sourceAccountId ? `${formId}-source-error` : undefined
                }
                aria-invalid={Boolean(errors.sourceAccountId)}
                autoFocus
                disabled={workflowPending}
                id={`${formId}-source`}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const nextAccount = selectableSources.find(
                    (account) => account.id === nextId,
                  );
                  setSourceAccountId(nextId);
                  setSourceIdentity(
                    nextAccount
                      ? selectedIdentity(nextAccount, accountLabels)
                      : null,
                  );
                  setSourceAccountIdRequiringReselection("");
                  if (
                    destinationAccount &&
                    (destinationAccount.id === nextId ||
                      destinationAccount.currency !== nextAccount?.currency)
                  ) {
                    setDestinationAccountId("");
                    setDestinationIdentity(null);
                    setDestinationAccountIdRequiringReselection("");
                  }
                  clearError("sourceAccountId");
                  clearError("destinationAccountId");
                  clearError("amount");
                  clearError("transactionDate");
                }}
                ref={sourceRef}
                value={sourceAccountId}
              >
                <NativeSelectOption value="">
                  Select a Source Account
                </NativeSelectOption>
                {sourceAccountId &&
                !selectableSources.some(
                  (account) => account.id === sourceAccountId,
                ) ? (
                  <NativeSelectOption disabled value={sourceAccountId}>
                    {sourceLabel ?? "Selected Source Account"} (unavailable)
                  </NativeSelectOption>
                ) : null}
                {selectableSources.map((account) => (
                  <NativeSelectOption key={account.id} value={account.id}>
                    {account.id === sourceAccountId && sourceIdentity
                      ? sourceIdentity.label
                      : accountLabels.get(account.id)}{" "}
                    · {account.currency}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription id={`${formId}-source-description`}>
                Only active Accounts with a same-currency destination are
                available. The Source Account supplies transfer currency.
              </FieldDescription>
              <FieldError id={`${formId}-source-error`}>
                {errors.sourceAccountId}
              </FieldError>
            </Field>
            <Field
              data-disabled={workflowPending || !sourceAccountId}
              data-invalid={Boolean(errors.destinationAccountId)}
            >
              <FieldLabel htmlFor={`${formId}-destination`}>
                Destination Account
              </FieldLabel>
              <NativeSelect
                aria-describedby={`${formId}-destination-description`}
                aria-errormessage={
                  errors.destinationAccountId
                    ? `${formId}-destination-error`
                    : undefined
                }
                aria-invalid={Boolean(errors.destinationAccountId)}
                disabled={workflowPending || !sourceAccountId}
                id={`${formId}-destination`}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const nextAccount = eligibleDestinations.find(
                    (account) => account.id === nextId,
                  );
                  setDestinationAccountId(nextId);
                  setDestinationIdentity(
                    nextAccount
                      ? selectedIdentity(nextAccount, accountLabels)
                      : null,
                  );
                  setDestinationAccountIdRequiringReselection("");
                  clearError("destinationAccountId");
                  clearError("transactionDate");
                }}
                ref={destinationRef}
                value={destinationAccountId}
              >
                <NativeSelectOption value="">
                  Select a Destination Account
                </NativeSelectOption>
                {destinationAccountId &&
                !eligibleDestinations.some(
                  (account) => account.id === destinationAccountId,
                ) ? (
                  <NativeSelectOption disabled value={destinationAccountId}>
                    {destinationLabel ?? "Selected Destination Account"}{" "}
                    (unavailable)
                  </NativeSelectOption>
                ) : null}
                {eligibleDestinations.map((account) => (
                  <NativeSelectOption key={account.id} value={account.id}>
                    {account.id === destinationAccountId && destinationIdentity
                      ? destinationIdentity.label
                      : accountLabels.get(account.id)}{" "}
                    · {account.currency}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription id={`${formId}-destination-description`}>
                Distinct active Accounts in{" "}
                {sourceCurrency ?? "the Source Account currency"}
                {sourceCurrency ? " only." : "."}
              </FieldDescription>
              <FieldError id={`${formId}-destination-error`}>
                {errors.destinationAccountId}
              </FieldError>
            </Field>
            <Field
              data-disabled={workflowPending}
              data-invalid={Boolean(errors.amount)}
            >
              <FieldLabel htmlFor={`${formId}-amount`}>Amount</FieldLabel>
              <Input
                aria-describedby={`${formId}-amount-description`}
                aria-errormessage={
                  errors.amount ? `${formId}-amount-error` : undefined
                }
                aria-invalid={Boolean(errors.amount)}
                disabled={workflowPending}
                id={`${formId}-amount`}
                inputMode="decimal"
                onChange={(event) => {
                  setAmount(event.target.value);
                  clearError("amount");
                }}
                ref={amountRef}
                value={amount}
              />
              <FieldDescription id={`${formId}-amount-description`}>
                Amount currency:{" "}
                <span>{sourceCurrency ?? "select a Source Account"}</span>.
              </FieldDescription>
              <FieldError id={`${formId}-amount-error`}>
                {errors.amount}
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
                aria-errormessage={
                  errors.transactionDate ? `${formId}-date-error` : undefined
                }
                aria-invalid={Boolean(errors.transactionDate)}
                disabled={workflowPending}
                id={`${formId}-date`}
                onChange={(event) => {
                  setTransactionDate(event.target.value);
                  clearError("transactionDate");
                }}
                ref={transactionDateRef}
                type="date"
                value={transactionDate}
              />
              <FieldError id={`${formId}-date-error`}>
                {errors.transactionDate}
              </FieldError>
            </Field>
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
          {serverError && accountRecoveryReason ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3"
              role="alert"
            >
              <p className="text-sm text-destructive">{serverError}</p>
              <Button
                disabled={workflowPending}
                onClick={() => void recoverAccounts(accountRecoveryReason)}
                ref={retryAccountRefreshRef}
                size="sm"
                type="button"
                variant="outline"
              >
                {recoveryPending
                  ? "Retrying Account refresh…"
                  : "Retry Account refresh"}
              </Button>
            </div>
          ) : serverError ? (
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={workflowPending}
              onClick={() => {
                if (
                  !submittingRef.current &&
                  !recoveryPendingRef.current &&
                  !workflowPending
                ) {
                  onOpenChange(false);
                }
              }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={workflowPending || accountRecoveryReason !== null}
              type="submit"
            >
              {recoveryPending
                ? "Refreshing Accounts…"
                : mutation.isPending
                  ? "Recording transfer…"
                  : "Record transfer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
