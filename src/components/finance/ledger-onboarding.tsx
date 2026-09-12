import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import {
  getListFinanceLedgersQueryKey,
  useCreateFinanceLedger,
} from "@/api/generated/core-console";
import { LedgerResponse } from "@/api/generated/schemas";
import { reconcileLedgerList } from "@/components/finance/ledger-list-cache";
import { getLedgerProblemMessage } from "@/components/finance/ledger-problem";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface LedgerOnboardingProps {
  onCreated: (ledger: LedgerResponse) => Promise<void> | void;
}

export function LedgerOnboarding({ onCreated }: LedgerOnboardingProps) {
  const queryClient = useQueryClient();
  const [nameError, setNameError] = useState<string | null>(null);
  const createLedgerMutation = useCreateFinanceLedger({
    mutation: {
      onSuccess: async (response) => {
        const ledger = LedgerResponse.parse(response.data);
        reconcileLedgerList(queryClient, ledger);
        await onCreated(ledger);
        await queryClient.invalidateQueries({
          queryKey: getListFinanceLedgersQueryKey(),
        });
      },
    },
  });
  const serverError = createLedgerMutation.isError
    ? getLedgerProblemMessage(
        createLedgerMutation.error,
        "The Ledger could not be created. Try again.",
      )
    : null;
  const fieldError = nameError ?? serverError;
  const descriptionId = "first-ledger-name-description";
  const errorId = "first-ledger-name-error";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();

    if (!name) {
      setNameError("Enter a Ledger name.");
      return;
    }
    if ([...name].length > 100) {
      setNameError("Ledger name must be 100 characters or fewer.");
      return;
    }

    setNameError(null);
    createLedgerMutation.mutate({ data: { name } });
  };

  return (
    <div className="flex max-w-xl flex-col gap-5 rounded-lg border border-border bg-card p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Create your first Ledger</h2>
        <p className="text-sm text-muted-foreground">
          Name the financial context you want to manage. Nothing is created
          until you confirm.
        </p>
      </div>
      <form noValidate onSubmit={handleSubmit}>
        <FieldGroup>
          <Field data-invalid={Boolean(fieldError)}>
            <FieldLabel htmlFor="first-ledger-name">Ledger name</FieldLabel>
            <Input
              aria-describedby={
                fieldError ? `${descriptionId} ${errorId}` : descriptionId
              }
              aria-errormessage={fieldError ? errorId : undefined}
              aria-invalid={Boolean(fieldError)}
              defaultValue="Personal"
              id="first-ledger-name"
              maxLength={100}
              name="name"
            />
            <FieldDescription id={descriptionId}>
              Use a distinct name you will recognize.
            </FieldDescription>
            {fieldError ? (
              <FieldError id={errorId}>{fieldError}</FieldError>
            ) : null}
          </Field>
          <Button disabled={createLedgerMutation.isPending} type="submit">
            {createLedgerMutation.isPending ? "Creating…" : "Create Ledger"}
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}
