import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import {
  getListFinanceLedgersQueryKey,
  useUpdateFinanceLedger,
} from "@/api/generated/core-console";
import { LedgerResponse } from "@/api/generated/schemas";
import {
  reconcileLedgerList,
  removeLedgerFromList,
} from "@/components/finance/ledger-list-cache";
import { getLedgerProblemMessage } from "@/components/finance/ledger-problem";
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useLedgerCreate } from "./use-ledger-create";

type LedgerNameDialogProps = {
  ledger?: LedgerResponse;
  mode: "create" | "rename";
  onComplete: (ledger: LedgerResponse) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function LedgerNameDialog({ ...props }: LedgerNameDialogProps) {
  if (props.mode === "create")
    return props.open ? <LedgerCreateDialog {...props} /> : null;
  return <LedgerRenameDialog {...props} />;
}

function LedgerCreateDialog({
  onComplete,
  onOpenChange,
  open,
}: LedgerNameDialogProps) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const create = useLedgerCreate("additional", (ledger) => {
    onComplete(ledger);
    onOpenChange(false);
  });
  const error = nameError ?? create.error;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Ledger</DialogTitle>
          <DialogDescription>
            Create another financial context and switch to it.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = name.trim();
            if (!normalized || [...normalized].length > 100) {
              setNameError(
                !normalized
                  ? "Enter a Ledger name."
                  : "Ledger name must be 100 characters or fewer.",
              );
              return;
            }
            setNameError(null);
            void create.submit(normalized);
          }}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="create-ledger-name">Ledger name</FieldLabel>
              <Input
                autoFocus
                id="create-ledger-name"
                maxLength={100}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  create.edited();
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={
                  error ? "create-ledger-name-error" : undefined
                }
                aria-errormessage={
                  error ? "create-ledger-name-error" : undefined
                }
              />
              {error ? (
                <FieldError id="create-ledger-name-error">{error}</FieldError>
              ) : null}
            </Field>
            {create.unresolved && !create.pending ? (
              <Button
                onClick={create.startAnother}
                type="button"
                variant="outline"
              >
                Start a separate Ledger create
              </Button>
            ) : null}
            <DialogFooter>
              <Button
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={create.pending || create.unresolved || !create.ready}
              >
                {create.pending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LedgerRenameDialog({
  ledger,
  mode,
  onComplete,
  onOpenChange,
  open,
}: LedgerNameDialogProps) {
  const queryClient = useQueryClient();
  const initialName = mode === "rename" ? (ledger?.name ?? "") : "";
  const [name, setName] = useState(initialName);
  const [nameError, setNameError] = useState<string | null>(null);

  const finish = async (response: { data: unknown }) => {
    const updatedLedger = LedgerResponse.parse(response.data);
    reconcileLedgerList(queryClient, updatedLedger);
    onComplete(updatedLedger);
    onOpenChange(false);
    await queryClient.invalidateQueries({
      queryKey: getListFinanceLedgersQueryKey(),
    });
  };
  const renameMutation = useUpdateFinanceLedger({
    mutation: {
      onError: async (error) => {
        if (error.status !== 404 || !ledger) return;
        removeLedgerFromList(queryClient, ledger.id);
        onOpenChange(false);
        await queryClient.invalidateQueries({
          queryKey: getListFinanceLedgersQueryKey(),
        });
      },
      onSuccess: finish,
    },
  });
  const mutation = renameMutation;
  const resetRenameMutation = renameMutation.reset;

  useEffect(() => {
    if (open) {
      setName(initialName);
      setNameError(null);
      resetRenameMutation();
    }
  }, [initialName, open, resetRenameMutation]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) {
      setNameError("Enter a Ledger name.");
      return;
    }
    if ([...normalizedName].length > 100) {
      setNameError("Ledger name must be 100 characters or fewer.");
      return;
    }

    setNameError(null);
    if (ledger) {
      renameMutation.mutate({
        ledgerId: ledger.id,
        data: { name: normalizedName },
      });
    }
  };
  const serverError = mutation.isError
    ? getLedgerProblemMessage(
        mutation.error,
        `The Ledger could not be ${mode === "create" ? "created" : "renamed"}. Try again.`,
      )
    : null;
  const title = mode === "create" ? "Create Ledger" : "Rename Ledger";
  const fieldError = nameError ?? serverError;
  const errorId = `${mode}-ledger-name-error`;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create another financial context and switch to it."
              : "Change the display name of the current Ledger."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit}
        >
          <Field data-invalid={Boolean(fieldError)}>
            <FieldLabel htmlFor={`${mode}-ledger-name`}>Ledger name</FieldLabel>
            <Input
              aria-describedby={fieldError ? errorId : undefined}
              aria-errormessage={fieldError ? errorId : undefined}
              aria-invalid={Boolean(fieldError)}
              autoFocus
              id={`${mode}-ledger-name`}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
            {fieldError ? (
              <FieldError id={errorId}>{fieldError}</FieldError>
            ) : null}
          </Field>
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
                ? mode === "create"
                  ? "Creating…"
                  : "Renaming…"
                : mode === "create"
                  ? "Create"
                  : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
