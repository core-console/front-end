import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  getListFinanceAccountsQueryKey,
  useCreateFinanceAccount,
  useUpdateFinanceAccount,
} from "@/api/generated/core-console";
import {
  AccountResponse,
  CreateAccountRequest,
  FinanceRequestDate,
  UpdateAccountRequest,
  type AccountResponse as Account,
  type CurrencyResponse,
} from "@/api/generated/schemas";
import { reconcileAccountList } from "@/components/finance/account-list-cache";
import { getAccountProblemFeedback } from "@/components/finance/account-problem";
import { formatFinanceMoney } from "@/components/finance/finance-money";
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

type AccountFormDialogProps = {
  account?: Account;
  currencies: CurrencyResponse[];
  ledgerId: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (account: Account) => void;
  open: boolean;
};

type FormErrors = Partial<
  Record<"name" | "openingBalance" | "trackingStartDate", string>
>;

const plainDecimalPattern = /^-?\d+(?:\.\d+)?$/;
const CreateAccountRequestWithoutName = CreateAccountRequest.omit({
  name: true,
});
const UpdateAccountRequestWithoutName = UpdateAccountRequest.omit({
  name: true,
});

function withoutError(errors: FormErrors, key: keyof FormErrors) {
  const nextErrors = { ...errors };
  delete nextErrors[key];
  return nextErrors;
}

function localDateValue() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

const zeroAmount = "0";

export function AccountFormDialog({
  account,
  currencies,
  ledgerId,
  onOpenChange,
  onSaved,
  open,
}: AccountFormDialogProps) {
  const queryClient = useQueryClient();
  const initialCurrency = currencies[0]!;
  const [name, setName] = useState(account?.name ?? "");
  const [nature, setNature] = useState<Account["nature"]>(
    account?.nature ?? "asset",
  );
  const [currencyCode, setCurrencyCode] = useState(
    account?.currency ?? initialCurrency.code,
  );
  const [openingBalance, setOpeningBalance] = useState(
    account?.openingBalance.amount ?? zeroAmount,
  );
  const [trackingStartDate, setTrackingStartDate] = useState(
    account?.trackingStartDate ?? localDateValue,
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const openingBalanceRef = useRef<HTMLInputElement>(null);
  const trackingStartRef = useRef<HTMLInputElement>(null);

  const finish = async (response: { data: unknown }) => {
    const savedAccount = AccountResponse.parse(response.data);
    reconcileAccountList(queryClient, ledgerId, savedAccount);
    onSaved(savedAccount);
    onOpenChange(false);
    await queryClient.invalidateQueries({
      queryKey: getListFinanceAccountsQueryKey(ledgerId),
    });
  };
  const createMutation = useCreateFinanceAccount({
    mutation: { onSuccess: finish },
  });
  const updateMutation = useUpdateFinanceAccount({
    mutation: {
      onError: (error) => {
        const feedback = getAccountProblemFeedback(
          error,
          "The Account could not be updated. Try again.",
        );
        if (feedback.field !== "trackingStartDate") return;
        setErrors((current) => ({
          ...current,
          trackingStartDate: feedback.message,
        }));
        queueMicrotask(() => trackingStartRef.current?.focus());
      },
      onSuccess: finish,
    },
  });
  const mutation = account ? updateMutation : createMutation;
  const problemFeedback = mutation.isError
    ? getAccountProblemFeedback(
        mutation.error,
        `The Account could not be ${account ? "updated" : "created"}. Try again.`,
      )
    : null;
  const serverError = problemFeedback?.field
    ? null
    : (problemFeedback?.message ?? null);
  const resetCreateMutation = createMutation.reset;
  const resetUpdateMutation = updateMutation.reset;

  useEffect(() => {
    if (!open) return;
    setName(account?.name ?? "");
    setNature(account?.nature ?? "asset");
    setCurrencyCode(account?.currency ?? initialCurrency.code);
    setOpeningBalance(account?.openingBalance.amount ?? zeroAmount);
    setTrackingStartDate(account?.trackingStartDate ?? localDateValue());
    setErrors({});
    resetCreateMutation();
    resetUpdateMutation();
  }, [
    account,
    initialCurrency,
    open,
    resetCreateMutation,
    resetUpdateMutation,
  ]);

  const selectedCurrency =
    currencies.find((currency) => currency.code === currencyCode) ??
    initialCurrency;
  const formId = account ? "edit-account" : "create-account";

  const clearFieldError = (key: keyof FormErrors) => {
    setErrors((current) => withoutError(current, key));
    if (mutation.isError) mutation.reset();
  };

  const handleCurrencyChange = (nextCode: CurrencyResponse["code"]) => {
    const nextCurrency = currencies.find(
      (currency) => currency.code === nextCode,
    );
    if (!nextCurrency) return;
    if (openingBalance === zeroAmount) {
      setOpeningBalance(zeroAmount);
    }
    setCurrencyCode(nextCode);
    setErrors((current) => withoutError(current, "openingBalance"));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    const fractionLength = openingBalance.split(".")[1]?.length ?? 0;
    const nextErrors: FormErrors = {};
    if (!normalizedName) {
      nextErrors.name = "Enter an Account name.";
    } else if ([...normalizedName].length > 100) {
      nextErrors.name = "Account name must be 100 characters or fewer.";
    }
    if (!plainDecimalPattern.test(openingBalance)) {
      nextErrors.openingBalance = "Enter a plain decimal amount.";
    } else if (fractionLength > selectedCurrency.minorUnit) {
      nextErrors.openingBalance =
        selectedCurrency.minorUnit === 0
          ? `${currencyCode} amounts cannot include fractional digits.`
          : `${currencyCode} amounts support at most ${selectedCurrency.minorUnit} fractional digits.`;
    }
    if (!FinanceRequestDate.safeParse(trackingStartDate).success) {
      nextErrors.trackingStartDate = "Enter a valid tracking start date.";
    }

    setErrors(nextErrors);
    if (nextErrors.name) {
      nameRef.current?.focus();
      return;
    }
    if (nextErrors.openingBalance) {
      openingBalanceRef.current?.focus();
      return;
    }
    if (nextErrors.trackingStartDate) {
      trackingStartRef.current?.focus();
      return;
    }

    if (account) {
      updateMutation.mutate({
        accountId: account.id,
        data: {
          ...UpdateAccountRequestWithoutName.parse({
            openingBalance: { amount: openingBalance, currency: currencyCode },
            trackingStartDate,
          }),
          name: normalizedName,
        } satisfies UpdateAccountRequest,
        ledgerId,
      });
    } else {
      createMutation.mutate({
        data: {
          ...CreateAccountRequestWithoutName.parse({
            currency: currencyCode,
            nature,
            openingBalance: { amount: openingBalance, currency: currencyCode },
            trackingStartDate,
          }),
          name: normalizedName,
        } satisfies CreateAccountRequest,
        ledgerId,
      });
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {account ? `Edit ${account.name}` : "Create account"}
          </DialogTitle>
          <DialogDescription>
            {account
              ? "Change ordinary Account details without changing its financial semantics."
              : "Add a position to the current Ledger. Every value can be edited before creation."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor={`${formId}-name`}>Account name</FieldLabel>
              <Input
                aria-describedby={
                  errors.name ? `${formId}-name-error` : undefined
                }
                aria-errormessage={
                  errors.name ? `${formId}-name-error` : undefined
                }
                aria-invalid={Boolean(errors.name)}
                autoFocus
                id={`${formId}-name`}
                onChange={(event) => {
                  setName(event.target.value);
                  clearFieldError("name");
                }}
                ref={nameRef}
                value={name}
              />
              {errors.name ? (
                <FieldError id={`${formId}-name-error`}>
                  {errors.name}
                </FieldError>
              ) : null}
            </Field>

            {account ? (
              <dl className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">Nature</dt>
                  <dd className="text-sm font-medium">
                    {account.nature === "asset" ? "Asset" : "Liability"}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">Currency</dt>
                  <dd className="text-sm font-medium">{account.currency}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">
                    Current balance
                  </dt>
                  <dd className="text-sm font-medium tabular-nums">
                    {formatFinanceMoney(account.currentBalance)}
                  </dd>
                </div>
              </dl>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="create-account-nature">
                    Nature
                  </FieldLabel>
                  <NativeSelect
                    id="create-account-nature"
                    onChange={(event) =>
                      setNature(event.target.value as Account["nature"])
                    }
                    value={nature}
                  >
                    <NativeSelectOption value="asset">Asset</NativeSelectOption>
                    <NativeSelectOption value="liability">
                      Liability
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="create-account-currency">
                    Currency
                  </FieldLabel>
                  <NativeSelect
                    id="create-account-currency"
                    onChange={(event) =>
                      handleCurrencyChange(
                        event.target.value as CurrencyResponse["code"],
                      )
                    }
                    value={currencyCode}
                  >
                    {currencies.map((currency) => (
                      <NativeSelectOption
                        key={currency.code}
                        value={currency.code}
                      >
                        {currency.code}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </>
            )}

            <Field data-invalid={Boolean(errors.openingBalance)}>
              <FieldLabel htmlFor={`${formId}-opening-balance`}>
                Opening balance
              </FieldLabel>
              <Input
                aria-describedby={
                  errors.openingBalance
                    ? `${formId}-opening-description ${formId}-opening-error`
                    : `${formId}-opening-description`
                }
                aria-errormessage={
                  errors.openingBalance ? `${formId}-opening-error` : undefined
                }
                aria-invalid={Boolean(errors.openingBalance)}
                id={`${formId}-opening-balance`}
                inputMode="decimal"
                onChange={(event) => {
                  setOpeningBalance(event.target.value);
                  clearFieldError("openingBalance");
                }}
                ref={openingBalanceRef}
                value={openingBalance}
              />
              <FieldDescription id={`${formId}-opening-description`}>
                Exact amount in {currencyCode}.
              </FieldDescription>
              {errors.openingBalance ? (
                <FieldError id={`${formId}-opening-error`}>
                  {errors.openingBalance}
                </FieldError>
              ) : null}
            </Field>
            <Field data-invalid={Boolean(errors.trackingStartDate)}>
              <FieldLabel htmlFor={`${formId}-tracking-start`}>
                Tracking start date
              </FieldLabel>
              <Input
                aria-describedby={
                  errors.trackingStartDate
                    ? `${formId}-tracking-start-error`
                    : undefined
                }
                aria-errormessage={
                  errors.trackingStartDate
                    ? `${formId}-tracking-start-error`
                    : undefined
                }
                aria-invalid={Boolean(errors.trackingStartDate)}
                id={`${formId}-tracking-start`}
                onChange={(event) => {
                  setTrackingStartDate(event.target.value);
                  clearFieldError("trackingStartDate");
                }}
                ref={trackingStartRef}
                type="date"
                value={trackingStartDate}
              />
              {errors.trackingStartDate ? (
                <FieldError id={`${formId}-tracking-start-error`}>
                  {errors.trackingStartDate}
                </FieldError>
              ) : null}
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
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending
                ? account
                  ? "Saving…"
                  : "Creating…"
                : account
                  ? "Save changes"
                  : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
