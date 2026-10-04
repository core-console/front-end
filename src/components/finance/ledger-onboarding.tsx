import { useState, type FormEvent } from "react";

import type { LedgerResponse } from "@/api/generated/schemas";
import { useLedgerCreate } from "./use-ledger-create";
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
  const [nameError, setNameError] = useState<string | null>(null);
  const create = useLedgerCreate(
    "onboarding",
    (ledger) => void onCreated(ledger),
  );
  const fieldError = nameError ?? create.error;
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
    void create.submit(name);
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
              onChange={create.edited}
            />
            <FieldDescription id={descriptionId}>
              Use a distinct name you will recognize.
            </FieldDescription>
            {fieldError ? (
              <FieldError id={errorId}>{fieldError}</FieldError>
            ) : null}
          </Field>
          <Button
            disabled={create.pending || create.unresolved || !create.ready}
            type="submit"
          >
            {create.pending ? "Creating…" : "Create Ledger"}
          </Button>
          {create.unresolved && !create.pending ? (
            <Button
              onClick={create.startAnother}
              type="button"
              variant="outline"
            >
              Start a separate Ledger create
            </Button>
          ) : null}
        </FieldGroup>
      </form>
    </div>
  );
}
