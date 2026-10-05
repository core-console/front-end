import { type FormEvent, useEffect, useRef, useState } from "react";

import { useFinanceCreate } from "./use-finance-create";
import {
  CreateFinanceTransactionBody,
  FinanceRequestDate,
  type AccountResponse,
  type CategoryResponse,
  type CurrencyResponse,
  type FinanceTransactionResponseOutput,
} from "@/api/generated/schemas";
import { buildAccountWorkflowLabels } from "@/components/finance/account-identity";
import { categoryWorkflowLabel } from "@/components/finance/category-identity";
import { getTransactionProblemFeedback } from "@/components/finance/transaction-problem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatOverviewDate } from "@/components/finance/overview-date";

type OrdinaryTransactionKind = "expense" | "income";
type FormErrors = Partial<
  Record<
    "accountId" | "amount" | "categoryId" | "note" | "transactionDate",
    string
  >
>;
type SelectedReferenceIdentity = {
  id: string;
  label: string;
};

type TransactionFormDialogProps = {
  accounts: AccountResponse[];
  categories: CategoryResponse[];
  currencies: CurrencyResponse[];
  kind: OrdinaryTransactionKind;
  ledgerId: string;
  onOpenChange: (open: boolean) => void;
  onRecorded: (transaction: FinanceTransactionResponseOutput) => Promise<void>;
  open: boolean;
  refreshReferences: () => Promise<unknown>;
  inlineDate?: string;
  submitBlocked?: boolean;
};

const positivePlainDecimalPattern = /^\d+(?:\.\d+)?$/;
const durableIntegerDigitsMax = 131_072;

function localDateValue() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function withoutError(errors: FormErrors, key: keyof FormErrors) {
  const nextErrors = { ...errors };
  delete nextErrors[key];
  return nextErrors;
}

function isStrictlyPositiveDecimal(value: string) {
  return positivePlainDecimalPattern.test(value) && /[1-9]/.test(value);
}

function normalizedIntegerDigitCount(value: string) {
  const integer = value.split(".", 1)[0]!.replace(/^0+/, "");
  return integer.length;
}

export function TransactionFormDialog({
  accounts,
  categories,
  currencies,
  kind,
  ledgerId,
  onOpenChange,
  onRecorded,
  open,
  refreshReferences,
  inlineDate,
  submitBlocked = false,
}: TransactionFormDialogProps) {
  const inline = inlineDate !== undefined;
  const accountLabels = buildAccountWorkflowLabels(accounts);
  const initialAccount = accounts.find(
    (account) => account.status === "active",
  );
  const initialAccountId = initialAccount?.id ?? "";
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(initialAccountId);
  const [selectedAccountIdentity, setSelectedAccountIdentity] =
    useState<SelectedReferenceIdentity | null>(() =>
      initialAccount
        ? {
            id: initialAccount.id,
            label: accountLabels.get(initialAccount.id) ?? initialAccount.name,
          }
        : null,
    );
  const [categoryId, setCategoryId] = useState("");
  const [selectedCategoryIdentity, setSelectedCategoryIdentity] =
    useState<SelectedReferenceIdentity | null>(null);
  const [transactionDate, setTransactionDate] = useState(localDateValue);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [unavailableAccountLabels, setUnavailableAccountLabels] = useState(
    () => new Map<string, string>(),
  );
  const [unavailableCategoryLabels, setUnavailableCategoryLabels] = useState(
    () => new Map<string, string>(),
  );
  const [focusField, setFocusField] = useState<
    "accountId" | "categoryId" | "transactionDate" | null
  >(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLSelectElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const transactionDateRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const inlineNoteRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const focusAfterSuccessRef = useRef(false);
  const effectiveDate = inlineDate ?? transactionDate;
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const selectedCategory = categories.find(
    (category) => category.id === categoryId,
  );
  const selectedAccountLabel =
    (selectedAccountIdentity?.id === accountId
      ? selectedAccountIdentity.label
      : undefined) ??
    (selectedAccount
      ? accountLabels.get(selectedAccount.id)
      : unavailableAccountLabels.get(accountId));
  const selectedCategoryLabel =
    (selectedCategoryIdentity?.id === categoryId
      ? selectedCategoryIdentity.label
      : undefined) ??
    (selectedCategory
      ? categoryWorkflowLabel(selectedCategory, categories)
      : unavailableCategoryLabels.get(categoryId));
  const selectedCurrency = currencies.find(
    (currency) => currency.code === selectedAccount?.currency,
  );

  const create = useFinanceCreate(
    async (result, isCurrent) => {
      if (!result.transaction) return;
      if (inline) {
        await onRecorded(result.transaction);
        if (!isCurrent()) return;
        setAmount("");
        setNote("");
        setErrors({});
        focusAfterSuccessRef.current = true;
      } else {
        void onRecorded(result.transaction);
        onOpenChange(false);
      }
    },
    ledgerId,
    open,
    {
      operation: "createFinanceTransaction",
      continueAfterCreated: inline,
      onRejected: async (problem, isCurrent) => {
        const error = { info: problem };

        const feedback = getTransactionProblemFeedback(
          error,
          `The ${kind} could not be recorded. Try again.`,
          {
            ...(selectedAccountLabel === undefined
              ? {}
              : { accountLabel: selectedAccountLabel }),
            ...(selectedCategoryLabel === undefined
              ? {}
              : { categoryLabel: selectedCategoryLabel }),
          },
        );
        if (!feedback.field) return;
        setErrors((current) => ({
          ...current,
          [feedback.field!]: feedback.message,
        }));
        if (feedback.field === "accountId") {
          setUnavailableAccountLabels((current) => {
            const next = new Map(current);
            next.set(
              accountId,
              selectedAccountLabel ??
                selectedAccount?.name ??
                "Selected Account",
            );
            return next;
          });
        }
        if (feedback.field === "categoryId") {
          setUnavailableCategoryLabels((current) => {
            const next = new Map(current);
            next.set(
              categoryId,
              selectedCategoryLabel ??
                selectedCategory?.name ??
                "Selected Category",
            );
            return next;
          });
        }
        if (feedback.field === "accountId" || feedback.field === "categoryId") {
          await refreshReferences();
        }
        if (isCurrent()) setFocusField(feedback.field);
      },
    },
  );

  useEffect(() => {
    if (!create.pending && focusAfterSuccessRef.current) {
      focusAfterSuccessRef.current = false;
      amountRef.current?.focus();
    }
  }, [create.pending]);

  useEffect(() => {
    if (!focusField) return;
    const target =
      focusField === "accountId"
        ? accountRef.current
        : focusField === "categoryId"
          ? categoryRef.current
          : transactionDateRef.current;
    if (!target?.isConnected) return;
    target.focus();
    setFocusField(null);
  }, [accounts, categories, focusField]);

  const serverError = create.error;
  const activeAccounts = accounts.filter(
    (account) =>
      account.status === "active" && !unavailableAccountLabels.has(account.id),
  );
  const activeCategories = categories.filter(
    (category) =>
      category.status === "active" &&
      !unavailableCategoryLabels.has(category.id),
  );
  const formId = inline ? "quick-entry" : `record-${kind}`;
  const kindLabel = kind === "expense" ? "Expense" : "Income";

  const markEdited = create.edited;
  useEffect(() => {
    markEdited();
  }, [inlineDate, kind, markEdited]);

  const clearFieldError = (key: keyof FormErrors) => {
    setErrors((current) => withoutError(current, key));
    create.edited();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      create.pending ||
      submittingRef.current ||
      submitBlocked ||
      create.unresolved ||
      !create.ready
    )
      return;

    const nextErrors: FormErrors = {};
    const trimmedNote = note.trim();
    if (!isStrictlyPositiveDecimal(amount)) {
      nextErrors.amount = "Enter a positive plain decimal amount.";
    } else if (normalizedIntegerDigitCount(amount) > durableIntegerDigitsMax) {
      nextErrors.amount = "Amount has too many integer digits.";
    } else if (!selectedCurrency) {
      nextErrors.amount = "Amount currency is unavailable for this Account.";
    } else if (
      (amount.split(".")[1]?.length ?? 0) > selectedCurrency.minorUnit
    ) {
      nextErrors.amount =
        selectedCurrency.minorUnit === 0
          ? `${selectedCurrency.code} amounts cannot include fractional digits.`
          : `${selectedCurrency.code} amounts support at most ${selectedCurrency.minorUnit} fractional digits.`;
    }
    if (!selectedAccount || selectedAccount.status !== "active") {
      nextErrors.accountId = "Choose an active Account.";
    }
    if (
      categoryId &&
      (!selectedCategory || selectedCategory.status !== "active")
    ) {
      nextErrors.categoryId =
        "Choose an active Category or explicit Uncategorized.";
    }
    if (!FinanceRequestDate.safeParse(effectiveDate).success) {
      nextErrors.transactionDate = "Enter a valid Transaction Date.";
    } else if (
      selectedAccount &&
      effectiveDate < selectedAccount.trackingStartDate
    ) {
      nextErrors.transactionDate =
        "Choose a Transaction Date on or after the Account's Tracking Start Date.";
    }
    if ([...trimmedNote].length > 500) {
      nextErrors.note = "Note must be 500 characters or fewer.";
    }

    setErrors(nextErrors);
    if (nextErrors.amount) {
      amountRef.current?.focus();
      return;
    }
    if (nextErrors.accountId) {
      accountRef.current?.focus();
      return;
    }
    if (nextErrors.categoryId) {
      categoryRef.current?.focus();
      return;
    }
    if (nextErrors.transactionDate) {
      (inline ? accountRef : transactionDateRef).current?.focus();
      return;
    }
    if (nextErrors.note) {
      (inline ? inlineNoteRef : noteRef).current?.focus();
      return;
    }
    if (!selectedAccount || !selectedCurrency) return;

    const money = {
      amount,
      currency: selectedAccount.currency,
    };
    const data = CreateFinanceTransactionBody.parse({
      accountId: selectedAccount.id,
      categoryAllocations: [
        {
          amount: money,
          categoryId: categoryId || null,
        },
      ],
      economicAmount: money,
      kind,
      note: trimmedNote || null,
      transactionDate: effectiveDate,
    });
    submittingRef.current = true;
    void create
      .submit({
        operation: "createFinanceTransaction",
        targetLedgerId: ledgerId,
        body: data,
        workflow: inline ? "quickEntry" : "transaction",
      })
      .finally(() => {
        submittingRef.current = false;
      });
  };

  const form = (
    <form
      aria-busy={create.pending}
      aria-describedby={inline ? "quick-entry-effective-date" : undefined}
      aria-label={inline ? "Quick Entry" : `Record ${kind}`}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={handleSubmit}
    >
      {inline ? (
        <>
          <div
            aria-label="Quick Entry kind"
            className="flex gap-2"
            role="group"
          >
            <Button
              aria-pressed={kind === "expense"}
              disabled={create.pending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant={kind === "expense" ? "default" : "outline"}
            >
              Expense
            </Button>
            <Button
              aria-pressed={kind === "income"}
              disabled={create.pending}
              onClick={() => onOpenChange(true)}
              type="button"
              variant={kind === "income" ? "default" : "outline"}
            >
              Income
            </Button>
          </div>
          <p
            className="text-sm text-muted-foreground"
            id="quick-entry-effective-date"
          >
            Effective Transaction Date:{" "}
            <time dateTime={effectiveDate}>
              {formatOverviewDate(effectiveDate)}
            </time>
          </p>
        </>
      ) : null}
      <FieldGroup>
        <Field data-invalid={Boolean(errors.amount)}>
          <FieldLabel htmlFor={`${formId}-amount`}>Amount</FieldLabel>
          <Input
            aria-describedby={`${formId}-amount-description${inline ? " quick-entry-effective-date" : ""}`}
            aria-errormessage={
              errors.amount ? `${formId}-amount-error` : undefined
            }
            aria-invalid={Boolean(errors.amount)}
            autoFocus={!inline}
            disabled={create.pending}
            id={`${formId}-amount`}
            inputMode="decimal"
            onChange={(event) => {
              setAmount(event.target.value);
              clearFieldError("amount");
            }}
            ref={amountRef}
            value={amount}
          />
          {selectedAccount ? (
            <FieldDescription id={`${formId}-amount-description`}>
              Amount currency: <span>{selectedAccount.currency}</span> from the
              selected Account.
            </FieldDescription>
          ) : (
            <FieldDescription id={`${formId}-amount-description`}>
              Select an Account to establish currency.
            </FieldDescription>
          )}
          <FieldError id={`${formId}-amount-error`}>{errors.amount}</FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.accountId)}>
          <FieldLabel htmlFor={`${formId}-account`}>Account</FieldLabel>
          <NativeSelect
            aria-describedby={`${formId}-account-description`}
            aria-errormessage={
              errors.accountId ? `${formId}-account-error` : undefined
            }
            aria-invalid={Boolean(errors.accountId)}
            disabled={create.pending}
            id={`${formId}-account`}
            onChange={(event) => {
              const nextAccountId = event.target.value;
              const nextAccount = activeAccounts.find(
                (account) => account.id === nextAccountId,
              );
              setAccountId(nextAccountId);
              setSelectedAccountIdentity(
                nextAccount
                  ? {
                      id: nextAccount.id,
                      label:
                        accountLabels.get(nextAccount.id) ?? nextAccount.name,
                    }
                  : null,
              );
              clearFieldError("accountId");
              clearFieldError("amount");
              clearFieldError("transactionDate");
            }}
            ref={accountRef}
            value={accountId}
          >
            <NativeSelectOption value="">Select an Account</NativeSelectOption>
            {accountId &&
            !activeAccounts.some((account) => account.id === accountId) ? (
              <NativeSelectOption disabled value={accountId}>
                {selectedAccountLabel ?? "Selected Account"} (unavailable)
              </NativeSelectOption>
            ) : null}
            {activeAccounts.map((account) => (
              <NativeSelectOption key={account.id} value={account.id}>
                {accountLabels.get(account.id)} · {account.currency}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription id={`${formId}-account-description`}>
            Only active Accounts can be selected. The selected Account supplies
            currency.
          </FieldDescription>
          <FieldError id={`${formId}-account-error`}>
            {errors.accountId}
          </FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.categoryId)}>
          <FieldLabel htmlFor={`${formId}-category`}>Category</FieldLabel>
          <NativeSelect
            aria-describedby={`${formId}-category-description`}
            aria-errormessage={
              errors.categoryId ? `${formId}-category-error` : undefined
            }
            aria-invalid={Boolean(errors.categoryId)}
            disabled={create.pending}
            id={`${formId}-category`}
            onChange={(event) => {
              const nextCategoryId = event.target.value;
              const nextCategory = activeCategories.find(
                (category) => category.id === nextCategoryId,
              );
              setCategoryId(nextCategoryId);
              setSelectedCategoryIdentity(
                nextCategory
                  ? {
                      id: nextCategory.id,
                      label: categoryWorkflowLabel(nextCategory, categories),
                    }
                  : null,
              );
              clearFieldError("categoryId");
            }}
            ref={categoryRef}
            value={categoryId}
          >
            <NativeSelectOption value="">Uncategorized</NativeSelectOption>
            {categoryId &&
            !activeCategories.some((category) => category.id === categoryId) ? (
              <NativeSelectOption disabled value={categoryId}>
                {selectedCategoryLabel ?? "Selected Category"} (unavailable)
              </NativeSelectOption>
            ) : null}
            {activeCategories.map((category) => (
              <NativeSelectOption key={category.id} value={category.id}>
                {categoryWorkflowLabel(category, categories)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription id={`${formId}-category-description`}>
            Categories are optional; Uncategorized is a complete allocation.
          </FieldDescription>
          <FieldError id={`${formId}-category-error`}>
            {errors.categoryId}
          </FieldError>
        </Field>
        {!inline ? (
          <Field data-invalid={Boolean(errors.transactionDate)}>
            <FieldLabel htmlFor={`${formId}-date`}>Transaction date</FieldLabel>
            <Input
              aria-errormessage={
                errors.transactionDate ? `${formId}-date-error` : undefined
              }
              aria-invalid={Boolean(errors.transactionDate)}
              disabled={create.pending}
              id={`${formId}-date`}
              onChange={(event) => {
                setTransactionDate(event.target.value);
                clearFieldError("transactionDate");
              }}
              ref={transactionDateRef}
              type="date"
              value={transactionDate}
            />
            <FieldError id={`${formId}-date-error`}>
              {errors.transactionDate}
            </FieldError>
          </Field>
        ) : errors.transactionDate ? (
          <p className="text-sm text-destructive" role="alert">
            {errors.transactionDate}
          </p>
        ) : null}
        <Field data-invalid={Boolean(errors.note)}>
          <FieldLabel htmlFor={`${formId}-note`}>Note</FieldLabel>
          {inline ? (
            <Input
              aria-errormessage={
                errors.note ? `${formId}-note-error` : undefined
              }
              aria-invalid={Boolean(errors.note)}
              disabled={create.pending}
              id={`${formId}-note`}
              onChange={(event) => {
                setNote(event.target.value);
                clearFieldError("note");
              }}
              placeholder="Optional"
              ref={inlineNoteRef}
              value={note}
            />
          ) : (
            <Textarea
              aria-errormessage={
                errors.note ? `${formId}-note-error` : undefined
              }
              aria-invalid={Boolean(errors.note)}
              disabled={create.pending}
              id={`${formId}-note`}
              onChange={(event) => {
                setNote(event.target.value);
                clearFieldError("note");
              }}
              placeholder="Optional"
              ref={noteRef}
              rows={3}
              value={note}
            />
          )}
          <FieldError id={`${formId}-note-error`}>{errors.note}</FieldError>
        </Field>
      </FieldGroup>
      {serverError ? (
        <p className="text-sm text-destructive" role="alert">
          {serverError}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        {!inline ? (
          <Button
            disabled={create.pending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
        ) : null}
        {create.unresolved && !create.integrityBlocked && !create.pending ? (
          <Button type="button" variant="outline" onClick={create.startAnother}>
            Start a separate Transaction create
          </Button>
        ) : null}
        <Button
          disabled={
            create.pending ||
            submitBlocked ||
            create.unresolved ||
            !create.ready
          }
          type="submit"
        >
          {create.pending ? `Recording ${kind}…` : `Record ${kind}`}
        </Button>
      </div>
    </form>
  );

  if (inline) return form;

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && create.pending) return;
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent
        aria-busy={create.pending}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md"
        finalFocus={false}
        showCloseButton={!create.pending}
      >
        <DialogHeader>
          <DialogTitle>Record {kind}</DialogTitle>
          <DialogDescription>
            Record a complete {kindLabel} in this Ledger. The selected Account
            supplies currency, and the Transaction Date may be in the future.
          </DialogDescription>
        </DialogHeader>
        {form}
      </DialogContent>
    </Dialog>
  );
}
