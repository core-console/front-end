import { type FormEvent, useEffect, useRef, useState } from "react";

import { useCreateFinanceTransaction } from "@/api/generated/core-console";
import {
  CreateFinanceTransactionBody,
  ExpenseTransactionResponse,
  FinanceRequestDate,
  IncomeTransactionResponse,
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
}: TransactionFormDialogProps) {
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

  const finish = async (response: { data: unknown }) => {
    const transaction =
      kind === "expense"
        ? ExpenseTransactionResponse.parse(response.data)
        : IncomeTransactionResponse.parse(response.data);
    const refresh = onRecorded(transaction);
    onOpenChange(false);
    await refresh;
  };
  const mutation = useCreateFinanceTransaction({
    mutation: {
      onError: async (error) => {
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
        setFocusField(feedback.field);
      },
      onSuccess: finish,
    },
  });

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

  const problemFeedback = mutation.isError
    ? getTransactionProblemFeedback(
        mutation.error,
        `The ${kind} could not be recorded. Try again.`,
      )
    : null;
  const serverError = problemFeedback?.field
    ? null
    : (problemFeedback?.message ?? null);
  const activeAccounts = accounts.filter(
    (account) =>
      account.status === "active" && !unavailableAccountLabels.has(account.id),
  );
  const activeCategories = categories.filter(
    (category) =>
      category.status === "active" &&
      !unavailableCategoryLabels.has(category.id),
  );
  const formId = `record-${kind}`;
  const kindLabel = kind === "expense" ? "Expense" : "Income";

  const clearFieldError = (key: keyof FormErrors) => {
    setErrors((current) => withoutError(current, key));
    if (mutation.isError) mutation.reset();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;

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
    if (!FinanceRequestDate.safeParse(transactionDate).success) {
      nextErrors.transactionDate = "Enter a valid Transaction Date.";
    } else if (
      selectedAccount &&
      transactionDate < selectedAccount.trackingStartDate
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
      transactionDateRef.current?.focus();
      return;
    }
    if (nextErrors.note) {
      noteRef.current?.focus();
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
      transactionDate,
    });
    mutation.mutate({ data, ledgerId });
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && mutation.isPending) return;
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent
        aria-busy={mutation.isPending}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md"
        finalFocus={false}
        showCloseButton={!mutation.isPending}
      >
        <DialogHeader>
          <DialogTitle>Record {kind}</DialogTitle>
          <DialogDescription>
            Record a complete {kindLabel} in this Ledger. The selected Account
            supplies currency, and the Transaction Date may be in the future.
          </DialogDescription>
        </DialogHeader>
        <form
          aria-label={`Record ${kind}`}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(errors.amount)}>
              <FieldLabel htmlFor={`${formId}-amount`}>Amount</FieldLabel>
              <Input
                aria-describedby={`${formId}-amount-description`}
                aria-errormessage={
                  errors.amount ? `${formId}-amount-error` : undefined
                }
                aria-invalid={Boolean(errors.amount)}
                autoFocus
                disabled={mutation.isPending}
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
                  Amount currency: <span>{selectedAccount.currency}</span> from
                  the selected Account.
                </FieldDescription>
              ) : (
                <FieldDescription id={`${formId}-amount-description`}>
                  Select an Account to establish currency.
                </FieldDescription>
              )}
              <FieldError id={`${formId}-amount-error`}>
                {errors.amount}
              </FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.accountId)}>
              <FieldLabel htmlFor={`${formId}-account`}>Account</FieldLabel>
              <NativeSelect
                aria-describedby={`${formId}-account-description`}
                aria-errormessage={
                  errors.accountId ? `${formId}-account-error` : undefined
                }
                aria-invalid={Boolean(errors.accountId)}
                disabled={mutation.isPending}
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
                            accountLabels.get(nextAccount.id) ??
                            nextAccount.name,
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
                <NativeSelectOption value="">
                  Select an Account
                </NativeSelectOption>
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
                Only active Accounts can be selected. The selected Account
                supplies currency.
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
                disabled={mutation.isPending}
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
                          label: categoryWorkflowLabel(
                            nextCategory,
                            categories,
                          ),
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
                !activeCategories.some(
                  (category) => category.id === categoryId,
                ) ? (
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
            <Field data-invalid={Boolean(errors.transactionDate)}>
              <FieldLabel htmlFor={`${formId}-date`}>
                Transaction date
              </FieldLabel>
              <Input
                aria-errormessage={
                  errors.transactionDate ? `${formId}-date-error` : undefined
                }
                aria-invalid={Boolean(errors.transactionDate)}
                disabled={mutation.isPending}
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
            <Field data-invalid={Boolean(errors.note)}>
              <FieldLabel htmlFor={`${formId}-note`}>Note</FieldLabel>
              <Textarea
                aria-errormessage={
                  errors.note ? `${formId}-note-error` : undefined
                }
                aria-invalid={Boolean(errors.note)}
                disabled={mutation.isPending}
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
              <FieldError id={`${formId}-note-error`}>{errors.note}</FieldError>
            </Field>
          </FieldGroup>
          {serverError ? (
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending ? `Recording ${kind}…` : `Record ${kind}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
