import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import {
  getListFinanceLedgersQueryKey,
  useCreateFinanceLedger,
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type LedgerNameDialogProps = {
  ledger?: LedgerResponse;
  mode: "create" | "rename";
  onComplete: (ledger: LedgerResponse) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function LedgerNameDialog({
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
  const createMutation = useCreateFinanceLedger({
    mutation: { onSuccess: finish },
  });
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
  const mutation = mode === "create" ? createMutation : renameMutation;
  const resetCreateMutation = createMutation.reset;
  const resetRenameMutation = renameMutation.reset;

  useEffect(() => {
    if (open) {
      setName(initialName);
      setNameError(null);
      resetCreateMutation();
      resetRenameMutation();
    }
  }, [initialName, open, resetCreateMutation, resetRenameMutation]);

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
    if (mode === "create") {
      createMutation.mutate({ data: { name: normalizedName } });
    } else if (ledger) {
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
