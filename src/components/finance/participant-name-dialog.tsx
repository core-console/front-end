import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ComponentProps, type FormEvent } from "react";

import {
  useCreateFinanceParticipant,
  useRenameFinanceParticipant,
} from "@/api/generated/core-console";
import type { ParticipantResponse } from "@/api/generated/schemas";
import {
  parseParticipant,
  participantError,
  participantProblem,
  reconcileParticipant,
} from "@/components/finance/participant-data";
import { Alert, AlertTitle } from "@/components/ui/alert";
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

export function ParticipantNameDialog({
  ledgerId,
  participant,
  finalFocus,
  onClose,
  onSaved,
}: {
  ledgerId: string;
  participant?: ParticipantResponse;
  finalFocus: ComponentProps<typeof DialogContent>["finalFocus"];
  onClose: () => void;
  onSaved: (item: ParticipantResponse) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(participant?.name ?? "");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const finish = async (response: {
    data: unknown;
    headers: Headers;
    status: number;
  }) => {
    const saved = parseParticipant(response.data, ledgerId, participant?.id);
    await reconcileParticipant(queryClient, saved, response);
    onSaved(saved);
    onClose();
  };
  const onError = (failure: unknown) => {
    const problem = participantProblem(failure);
    if (problem?.code === "validation_error") {
      setFieldError(participantError(failure));
      input.current?.focus();
    } else if (
      !participant &&
      problem?.code !== "finance_ledger_not_found" &&
      problem?.status !== 403
    ) {
      setUncertain(true);
      setError(
        "The create outcome is unknown. Close and refresh Participants to check whether the person was created before starting another create. Repeating it creates a separate identity.",
      );
    } else {
      setError(participantError(failure));
    }
  };
  const create = useCreateFinanceParticipant({
    mutation: { retry: false, onSuccess: finish, onError },
  });
  const rename = useRenameFinanceParticipant({
    mutation: { retry: false, onSuccess: finish, onError },
  });
  const pending = create.isPending || rename.isPending;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || uncertain) return;
    const normalized = name.trim();
    if (!normalized || [...normalized].length > 100) {
      setFieldError("Enter a Participant name of 1–100 characters.");
      input.current?.focus();
      return;
    }
    setError("");
    if (participant)
      rename.mutate({
        ledgerId,
        participantId: participant.id,
        data: { name: normalized },
      });
    else create.mutate({ ledgerId, data: { name: normalized } });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        aria-busy={pending}
        finalFocus={finalFocus}
        initialFocus={input}
        showCloseButton={!pending}
      >
        <DialogHeader>
          <DialogTitle>
            {participant ? "Rename Participant" : "Create Participant"}
          </DialogTitle>
          <DialogDescription>
            {participant
              ? "Changing a display name preserves identity and attribution."
              : "Record a private person in this Ledger. No invitation or access grant is needed."}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-disabled={uncertain} data-invalid={Boolean(fieldError)}>
              <FieldLabel htmlFor="participant-name">Name</FieldLabel>
              <Input
                id="participant-name"
                ref={input}
                value={name}
                disabled={uncertain}
                readOnly={pending}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={
                  fieldError ? "participant-name-error" : undefined
                }
                onChange={(event) => {
                  setName(event.target.value);
                  setFieldError("");
                }}
              />
              {fieldError ? (
                <FieldError id="participant-name-error">
                  {fieldError}
                </FieldError>
              ) : null}
            </Field>
          </FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              Close
            </Button>
            <Button type="submit" disabled={pending || uncertain}>
              {pending
                ? "Saving…"
                : participant
                  ? "Save name"
                  : "Create participant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
