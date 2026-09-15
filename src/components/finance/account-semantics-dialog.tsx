import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import {
  getListFinanceAccountsQueryKey,
  useUpdateFinanceAccount,
} from "@/api/generated/core-console";
import {
  AccountResponse,
  CorrectAccountSemanticsRequest,
  type AccountResponse as Account,
  type CurrencyResponse,
} from "@/api/generated/schemas";
import {
  reconcileAccountList,
  removeAccountFromList,
} from "@/components/finance/account-list-cache";
import { getAccountProblemFeedback } from "@/components/finance/account-problem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

type AccountSemanticsDialogProps = {
  account: Account;
  accountLabel: string;
  currencies: CurrencyResponse[];
  ledgerId: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (account: Account) => void;
  onUnavailable: (message: string) => void;
  open: boolean;
};

const natureLabels: Record<Account["nature"], string> = {
  asset: "Asset",
  liability: "Liability",
};

export function AccountSemanticsDialog({
  account,
  accountLabel,
  currencies,
  ledgerId,
  onOpenChange,
  onSaved,
  onUnavailable,
  open,
}: AccountSemanticsDialogProps) {
  const queryClient = useQueryClient();
  const [nature, setNature] = useState(account.nature);
  const [currencyCode, setCurrencyCode] = useState(account.currency);
  const mutation = useUpdateFinanceAccount({
    mutation: {
      onError: (error) => {
        const problem = getAccountProblemFeedback(
          error,
          "The Account semantics could not be corrected. Try again.",
        );
        if (problem.kind !== "accountNotFound") return;
        removeAccountFromList(queryClient, ledgerId, account.id);
        onUnavailable(problem.message);
        onOpenChange(false);
        void queryClient.invalidateQueries({
          queryKey: getListFinanceAccountsQueryKey(ledgerId),
        });
      },
      onSuccess: (response) => {
        const corrected = AccountResponse.parse(response.data);
        reconcileAccountList(queryClient, ledgerId, corrected);
        onSaved(corrected);
        onOpenChange(false);
        void queryClient.invalidateQueries({
          queryKey: getListFinanceAccountsQueryKey(ledgerId),
        });
      },
    },
  });
  const problemFeedback = mutation.isError
    ? getAccountProblemFeedback(
        mutation.error,
        "The Account semantics could not be corrected. Try again.",
      )
    : null;
  const semanticsLocked = problemFeedback?.kind === "semanticsLocked";
  const hasChanges =
    nature !== account.nature || currencyCode !== account.currency;
  const resetMutation = mutation.reset;

  useEffect(() => {
    if (!open) return;
    setNature(account.nature);
    setCurrencyCode(account.currency);
    resetMutation();
  }, [account, open, resetMutation]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasChanges) return;

    const data = CorrectAccountSemanticsRequest.parse({
      ...(currencyCode !== account.currency ? { currency: currencyCode } : {}),
      ...(nature !== account.nature ? { nature } : {}),
    });
    mutation.mutate({ accountId: account.id, data, ledgerId });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && mutation.isPending) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md"
        finalFocus={() =>
          document.getElementById(`account-actions-${account.id}`)
        }
        showCloseButton={!mutation.isPending}
      >
        <DialogHeader>
          <DialogTitle>Correct nature or currency</DialogTitle>
          <DialogDescription>
            Target Account: {accountLabel}. Correct its semantic classification
            separately from ordinary Account editing.
          </DialogDescription>
        </DialogHeader>
        <form
          aria-busy={mutation.isPending}
          className="flex flex-col gap-5"
          onSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Correction is allowed only while Opening Balance is zero and no
              Finance Transaction history exists. The backend makes the final
              eligibility decision.
            </p>
            <p className="text-muted-foreground">
              Currency correction changes denomination for a zero position. It
              is not foreign exchange or conversion.
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Account</dt>
              <dd>{account.name}</dd>
              <dt className="text-muted-foreground">Current nature</dt>
              <dd>{natureLabels[account.nature]}</dd>
              <dt className="text-muted-foreground">Current currency</dt>
              <dd>{account.currency}</dd>
            </dl>
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="correct-account-nature">
                New nature
              </FieldLabel>
              <NativeSelect
                id="correct-account-nature"
                onChange={(event) => {
                  setNature(event.target.value as Account["nature"]);
                  if (mutation.isError) mutation.reset();
                }}
                value={nature}
              >
                <NativeSelectOption value="asset">Asset</NativeSelectOption>
                <NativeSelectOption value="liability">
                  Liability
                </NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="correct-account-currency">
                New currency
              </FieldLabel>
              <NativeSelect
                id="correct-account-currency"
                onChange={(event) => {
                  setCurrencyCode(
                    event.target.value as CurrencyResponse["code"],
                  );
                  if (mutation.isError) mutation.reset();
                }}
                value={currencyCode}
              >
                {currencies.map((currency) => (
                  <NativeSelectOption key={currency.code} value={currency.code}>
                    {currency.code}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          {problemFeedback ? (
            <p className="text-sm text-destructive" role="alert">
              {problemFeedback.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={mutation.isPending}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="outline"
            >
              {semanticsLocked ? "Return to Accounts" : "Cancel"}
            </Button>
            <Button disabled={!hasChanges || mutation.isPending} type="submit">
              {mutation.isPending ? "Applying…" : "Apply correction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
