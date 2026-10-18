import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { z } from "zod";
import { useIsMutating } from "@tanstack/react-query";
import {
  useListFinanceAccounts,
  useListFinanceParticipants,
  useListFinanceCurrencies,
} from "@/api/generated/core-console";
import {
  AccountResponse,
  ParticipantResponse,
  CurrencyResponse,
} from "@/api/generated/schemas";
import { AdvanceFormDialog } from "./advance-form-dialog";
import { AdvanceDetail } from "./advance-detail";
import { ParticipantObligations } from "./participant-obligations";
import { useFinanceSubmissions } from "./finance-submission-context";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle } from "@/components/ui/alert";

export function AdvancesDestination({ ledgerId }: { ledgerId: string }) {
  const [open, setOpen] = useState<"pure" | "shared" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const sharedTrigger = useRef<HTMLButtonElement>(null);
  const [params, setParams] = useSearchParams();
  const journal = useFinanceSubmissions();
  const pending = useIsMutating({ mutationKey: ["createFinanceAdvance"] }) > 0;
  const retained = journal.records.some(
    (record) =>
      record.operation === "createFinanceAdvance" &&
      record.targetLedgerId === ledgerId &&
      record.state === "unresolved",
  );
  const parseAddress = (name: string) => {
    const values = params.getAll(name);
    if (!values.length) return { valid: true, id: undefined };
    const result = z.uuid().safeParse(values.length === 1 ? values[0] : "");
    return {
      valid: result.success,
      id: result.success ? result.data : undefined,
    };
  };
  const person = parseAddress("participant_id");
  const advance = parseAddress("advance_id");
  const accounts = useListFinanceAccounts(ledgerId, {
    query: {
      select: (response) => AccountResponse.array().parse(response.data),
    },
  });
  const participants = useListFinanceParticipants(ledgerId, {
    query: {
      select: (response) =>
        ParticipantResponse.array()
          .refine((items) => items.every((item) => item.ledgerId === ledgerId))
          .parse(response.data),
    },
  });
  const currencies = useListFinanceCurrencies({
    query: {
      select: (response) => CurrencyResponse.array().parse(response.data),
    },
  });
  const ready =
    accounts.isSuccess && participants.isSuccess && currencies.isSuccess;
  const selected = participants.data?.find((item) => item.id === person.id);
  const refresh = async () => {
    await Promise.allSettled([
      accounts.refetch(),
      participants.refetch(),
      currencies.refetch(),
    ]);
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Record Advances or shared purchases with explicit shares, funded by an
        Asset or Liability Account. Inspect each Participant's remaining
        receivable.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={trigger}
          disabled={
            !ready ||
            !journal.ready ||
            !journal.recoveryLoaded ||
            pending ||
            retained
          }
          onClick={() => setOpen("pure")}
        >
          Record Advance
        </Button>
        <Button
          ref={sharedTrigger}
          disabled={
            !ready ||
            !journal.ready ||
            !journal.recoveryLoaded ||
            pending ||
            retained
          }
          onClick={() => setOpen("shared")}
        >
          Record shared purchase
        </Button>
        <Button variant="outline" onClick={refresh}>
          Refresh dependencies
        </Button>
      </div>
      {accounts.isPending || participants.isPending || currencies.isPending ? (
        <p role="status">Loading Advance dependencies…</p>
      ) : null}
      {accounts.isError || participants.isError || currencies.isError ? (
        <Alert variant="destructive">
          <AlertTitle>
            Advance dependencies could not be loaded. Refresh dependencies to
            try again.
          </AlertTitle>
        </Alert>
      ) : null}
      {retained ? (
        <p role="status">
          Resolve the retained Advance in Finance recovery before recording
          another Advance in this Ledger.
        </p>
      ) : null}
      {participants.data ? (
        <Field>
          <FieldLabel htmlFor="receivable-participant">
            Inspect Participant receivables
          </FieldLabel>
          <NativeSelect
            id="receivable-participant"
            value={selected?.id ?? ""}
            onChange={(event) => {
              const next = new URLSearchParams({ ledger: ledgerId });
              if (event.target.value)
                next.set("participant_id", event.target.value);
              setParams(next);
            }}
          >
            <NativeSelectOption value="">Choose Participant</NativeSelectOption>
            {participants.data.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name} ({item.status}) · {item.id}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      {!person.valid ||
      !advance.valid ||
      (person.id && participants.isSuccess && !selected) ? (
        <Alert variant="destructive">
          <AlertTitle>
            The addressed Participant or Advance is unavailable in this Ledger.
            Choose a valid Participant to continue.
          </AlertTitle>
        </Alert>
      ) : null}
      {person.valid && selected ? (
        <ParticipantObligations
          key={selected.id}
          ledgerId={ledgerId}
          participantId={selected.id}
        />
      ) : null}
      {advance.valid && advance.id ? (
        <AdvanceDetail
          ledgerId={ledgerId}
          advanceId={advance.id}
          accounts={accounts.data ?? []}
          participants={participants.data ?? []}
        />
      ) : null}
      {open && accounts.data && participants.data && currencies.data ? (
        <AdvanceFormDialog
          shared={open === "shared"}
          ledgerId={ledgerId}
          accounts={accounts.data}
          participants={participants.data}
          currencies={currencies.data}
          onClose={() => setOpen(null)}
          onConfirmed={(id, participantId) => {
            setOpen(null);
            setParams({
              ledger: ledgerId,
              participant_id: participantId,
              advance_id: id,
            });
          }}
          finalFocus={open === "shared" ? sharedTrigger : trigger}
          refreshDependencies={refresh}
        />
      ) : null}
    </div>
  );
}
