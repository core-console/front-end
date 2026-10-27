import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { z } from "zod";
import { useIsMutating } from "@tanstack/react-query";
import {
  useListFinanceAccounts,
  useListFinanceParticipants,
  useListFinanceCurrencies,
  useListFinanceParticipantSettlements,
  useGetFinanceSettlement,
} from "@/api/generated/core-console";
import {
  AccountResponse,
  ParticipantResponse,
  CurrencyResponse,
} from "@/api/generated/schemas";
import { useFinanceSubmissions } from "./finance-submission-context";
import { CreditApplicationFormDialog } from "./credit-application-form-dialog";
import { CreditApplicationOrigins } from "./credit-application-origins";
import { RepaymentFormDialog } from "./repayment-form-dialog";
import { ForgivenessFormDialog } from "./forgiveness-form-dialog";
import { ParticipantObligations } from "./participant-obligations";
import { ParticipantCredits } from "./participant-credits";
import { SettlementAllocations } from "./settlement-allocations";
import {
  parseSettlementSource,
  settlementSourceSchema,
} from "./settlement-source";
import { formatFinanceMoney } from "./finance-money";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";

function SettlementDetail({
  ledgerId,
  id,
  participantId,
  accounts,
  participants,
}: {
  ledgerId: string;
  id: string;
  participantId?: string | undefined;
  accounts: AccountResponse[];
  participants: ParticipantResponse[];
}) {
  const query = useGetFinanceSettlement(ledgerId, id, {
    query: {
      select: (response) =>
        parseSettlementSource(response.data, ledgerId, id, participantId),
    },
  });
  const item = query.data;
  const person = participants.find(
    (person) => person.id === item?.participantId,
  );
  const account = accounts.find(
    (account) =>
      item &&
      "receivingAccountId" in item &&
      account.id === item.receivingAccountId,
  );
  return (
    <section
      aria-label="Confirmed Settlement"
      className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 [overflow-wrap:anywhere]"
    >
      <h2 className="text-lg font-semibold">Confirmed Settlement</h2>
      {query.isPending ? <p role="status">Loading Settlement…</p> : null}
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>
            Settlement source is unavailable. A confirmed receipt stays
            confirmed; do not record it again.
          </AlertTitle>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry source
          </Button>
        </Alert>
      ) : null}
      {item ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              ["Settlement ID", item.id],
              [
                "Participant",
                `${person?.name ?? item.participantId} (${person?.status ?? "unavailable"}) · ${item.participantId}`,
              ],
              ...("receivingAccountId" in item
                ? [
                    [
                      "Receiving Account",
                      `${account?.name ?? item.receivingAccountId} · ${account?.nature ?? ""} · ${item.receivingAccountId}`,
                    ],
                  ]
                : []),
              ...("reason" in item ? [["Reason", item.reason]] : []),
              [
                "kind" in item && item.kind === "forgiveness"
                  ? "Forgiveness date"
                  : "kind" in item && item.kind === "creditApplication"
                    ? "Application date"
                    : "Receipt date",
                item.transactionDate,
              ],
              [
                "kind" in item && item.kind === "forgiveness"
                  ? "Forgiven principal / Expense"
                  : "kind" in item && item.kind === "creditApplication"
                    ? "Credit applied"
                    : "Cash received",
                formatFinanceMoney(item.amount),
              ],
              ...("forgivenessAmount" in item
                ? [
                    [
                      "Forgiven principal / Expense",
                      formatFinanceMoney(item.forgivenessAmount),
                    ],
                  ]
                : []),
              ...("acceptedSurplus" in item
                ? [
                    [
                      "Accepted surplus Income",
                      formatFinanceMoney(item.acceptedSurplus),
                    ],
                  ]
                : []),
              ...("creditOrigin" in item
                ? [
                    [
                      "Retained credit Liability",
                      formatFinanceMoney(item.creditOrigin.amount),
                    ],
                    [
                      "Available from this receipt",
                      formatFinanceMoney(item.creditOrigin.available),
                    ],
                    [
                      "Credit Liability Account",
                      item.creditOrigin.liabilityAccountId,
                    ],
                  ]
                : []),
              ["Confirmed at", item.confirmedAt],
              ["Confirmation order", String(item.confirmationOrder)],
              ["Note", item.note || "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">
            {"kind" in item && item.kind === "creditApplication" ? (
              "Receivables and credit Liability decrease equally. No new cash, Income, Expense or forgiveness. Allocations and origin consumption retain their confirmed order and balances."
            ) : "kind" in item && item.kind === "combined" ? (
              "Cash and forgiveness are retained separately in confirmed order: cash first, then explicit forgiveness with matching Expense. Income and available credit are unchanged. Later Advances do not redistribute this Settlement."
            ) : "kind" in item ? (
              "Retained forgiveness Allocations and remaining amounts at confirmation. No cash receipt or payment is recorded. Expense increases by the forgiven principal. Income and available credit remain unchanged."
            ) : (
              <>
                Retained cash Allocations and remaining amounts at confirmation.
                Current debt appears separately below. Later backdated Advances
                do not redistribute this receipt. Principal creates no Income or
                Expense; no forgiveness or credit is applied.
              </>
            )}
          </p>
          {"creditOrigin" in item ? (
            <p>
              Retained credit is owed to the Participant. The full receipt is
              preserved; no Income or Expense is created.
            </p>
          ) : null}
          {"acceptedSurplus" in item ? (
            <p>
              Accepted surplus increases Income and creates no Participant
              credit. Principal remains neutral to Income and Expense; the full
              cash receipt is preserved. Open the Income Transaction for its
              Category classification.
            </p>
          ) : null}
          {"selectedObligationIds" in item ? (
            <div className="text-sm [overflow-wrap:anywhere]">
              <h3 className="font-medium">Confirmed selected scope</h3>
              <p>{item.selectedObligationIds.join(", ")}</p>
              <p>
                Unselected debt was not resolved by this Settlement. Current
                unpaid composition remains visible below.
              </p>
            </div>
          ) : null}
          {"origins" in item ? (
            <CreditApplicationOrigins
              origins={item.origins}
              ledgerId={ledgerId}
              participantId={item.participantId}
            />
          ) : null}
          <SettlementAllocations
            confirmed
            allocations={item.allocations}
            ledgerId={ledgerId}
            participantId={item.participantId}
          />
          {item.transactionIds.map((transactionId) => (
            <Link
              key={transactionId}
              className="underline underline-offset-4"
              to={`/finance/transactions/${transactionId}?ledger=${ledgerId}`}
            >
              {"incomeTransactionId" in item &&
              transactionId === item.incomeTransactionId
                ? "View accepted Income Transaction"
                : "kind" in item && item.kind === "creditApplication"
                  ? "View linked credit application Internal Transfer"
                  : "kind" in item && item.kind === "combined"
                    ? "View linked cash / Expense Transaction"
                    : "kind" in item
                      ? "View linked Expense Transaction"
                      : "View linked Transaction"}{" "}
              · {transactionId}
            </Link>
          ))}
          <Link
            className="underline underline-offset-4"
            to={`/finance/repayments?ledger=${ledgerId}&participant_id=${item.participantId}&settlement_id=${item.id}`}
          >
            Inspect current Participant debt and Settlement history
          </Link>
        </>
      ) : null}
    </section>
  );
}
function RepaymentHistory({
  ledgerId,
  participantId,
}: {
  ledgerId: string;
  participantId: string;
}) {
  const query = useListFinanceParticipantSettlements(ledgerId, participantId, {
    query: {
      select: (response) =>
        settlementSourceSchema
          .array()
          .refine((items) =>
            items.every(
              (item) =>
                item.ledgerId === ledgerId &&
                item.participantId === participantId,
            ),
          )
          .parse(response.data),
    },
  });
  return (
    <section
      aria-label="Settlement history"
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Settlement history</h2>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh Settlement history
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Chronological cash, forgiveness and credit application activity by event
        date, then immutable confirmation order. Follow each source for its
        retained Allocation composition.
      </p>
      {query.isPending ? (
        <p role="status">Loading Settlement history…</p>
      ) : null}
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>
            Settlement history could not refresh. Retry the read; confirmed
            actions remain confirmed.
          </AlertTitle>
        </Alert>
      ) : null}
      {query.data?.length === 0 ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyTitle>No Settlements</EmptyTitle>
            <EmptyDescription>
              Confirmed cash receipts, forgiveness and credit applications will
              appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {query.data?.length ? (
        <ol className="flex flex-col gap-2">
          {query.data.map((item) => (
            <li key={item.id}>
              <Link
                className="underline underline-offset-4"
                to={`/finance/repayments?ledger=${ledgerId}&participant_id=${participantId}&settlement_id=${item.id}`}
              >
                {item.transactionDate} ·{" "}
                {"kind" in item && item.kind === "forgiveness"
                  ? "Forgiven"
                  : "kind" in item && item.kind === "creditApplication"
                    ? "Credit applied"
                    : "Cash received"}{" "}
                {formatFinanceMoney(item.amount)}
                {"forgivenessAmount" in item
                  ? ` · Forgiven ${formatFinanceMoney(item.forgivenessAmount)}`
                  : ""}{" "}
                · Confirmation {item.confirmationOrder}
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
export function RepaymentsDestination({ ledgerId }: { ledgerId: string }) {
  const [creditOpen, setCreditOpen] = useState(false);
  const creditTrigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [forgivenessOpen, setForgivenessOpen] = useState(false);
  const [combinedOpen, setCombinedOpen] = useState(false);
  const combinedTrigger = useRef<HTMLButtonElement>(null);
  const forgivenessTrigger = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
  const [params, setParams] = useSearchParams();
  const journal = useFinanceSubmissions();
  const pending =
    useIsMutating({ mutationKey: ["createFinanceSettlement"] }) > 0;
  const retained = journal.records.some(
    (record) =>
      record.operation === "createFinanceSettlement" &&
      record.targetLedgerId === ledgerId &&
      record.state === "unresolved",
  );
  function address(name: string) {
    const values = params.getAll(name);
    if (!values.length) return { valid: true, id: undefined };
    const parsed = z.uuid().safeParse(values.length === 1 ? values[0] : "");
    return {
      valid: parsed.success,
      id: parsed.success ? parsed.data : undefined,
    };
  }
  const person = address("participant_id");
  const settlement = address("settlement_id");
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
        Record accumulated or partial cash repayments. Allocate
        deterministically within all eligible debt or an explicitly selected
        subset in one currency, oldest Advance date first. Explicitly retain
        surplus as Participant credit, including receipts without eligible debt.
        Record standalone forgiveness separately to waive selected debt with a
        matching Expense and unchanged cash. Apply existing credit explicitly to
        selected debt without new cash or P&L.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={creditTrigger}
          variant="outline"
          disabled={
            !ready ||
            !journal.ready ||
            !journal.recoveryLoaded ||
            pending ||
            retained
          }
          onClick={() => {
            confirmed.current = false;
            setCreditOpen(true);
          }}
        >
          Apply credit
        </Button>
        <Button
          ref={trigger}
          disabled={
            !ready ||
            !journal.ready ||
            !journal.recoveryLoaded ||
            pending ||
            retained
          }
          onClick={() => {
            confirmed.current = false;
            setOpen(true);
          }}
        >
          Record repayment
        </Button>
        <Button
          ref={forgivenessTrigger}
          variant="outline"
          disabled={
            !ready ||
            !journal.ready ||
            !journal.recoveryLoaded ||
            pending ||
            retained
          }
          onClick={() => {
            confirmed.current = false;
            setForgivenessOpen(true);
          }}
        >
          Record forgiveness
        </Button>
        <Button
          ref={combinedTrigger}
          variant="outline"
          disabled={
            !ready ||
            !journal.ready ||
            !journal.recoveryLoaded ||
            pending ||
            retained
          }
          onClick={() => {
            confirmed.current = false;
            setCombinedOpen(true);
          }}
        >
          Record combined Settlement
        </Button>
        <Button variant="outline" onClick={refresh}>
          Refresh dependencies
        </Button>
      </div>
      {!ready &&
      !accounts.isError &&
      !participants.isError &&
      !currencies.isError ? (
        <p role="status">Loading repayment dependencies…</p>
      ) : null}
      {accounts.isError || participants.isError || currencies.isError ? (
        <Alert variant="destructive">
          <AlertTitle>
            Repayment dependencies could not be loaded. Refresh dependencies to
            try again.
          </AlertTitle>
        </Alert>
      ) : null}
      {retained ? (
        <p role="status">
          Resolve the retained Settlement in Finance recovery before recording
          another Settlement in this Ledger.
        </p>
      ) : null}
      {participants.data ? (
        <Field>
          <FieldLabel htmlFor="repayment-history-participant">
            Inspect Participant repayments
          </FieldLabel>
          <NativeSelect
            id="repayment-history-participant"
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
      !settlement.valid ||
      (person.id && participants.isSuccess && !selected) ? (
        <Alert variant="destructive">
          <AlertTitle>
            The addressed Participant or Settlement is unavailable in this
            Ledger. Choose a valid Participant to continue.
          </AlertTitle>
        </Alert>
      ) : null}
      {person.valid &&
      settlement.valid &&
      settlement.id &&
      (!person.id || selected) ? (
        <SettlementDetail
          key={settlement.id}
          ledgerId={ledgerId}
          id={settlement.id}
          participantId={person.id}
          accounts={accounts.data ?? []}
          participants={participants.data ?? []}
        />
      ) : null}
      {person.valid && selected ? (
        <>
          <ParticipantCredits
            key={`credits-${selected.id}`}
            ledgerId={ledgerId}
            participantId={selected.id}
          />
          <RepaymentHistory
            key={`history-${selected.id}`}
            ledgerId={ledgerId}
            participantId={selected.id}
          />
          <ParticipantObligations
            key={selected.id}
            ledgerId={ledgerId}
            participantId={selected.id}
          />
        </>
      ) : null}
      {creditOpen && participants.data && currencies.data ? (
        <CreditApplicationFormDialog
          ledgerId={ledgerId}
          participants={participants.data}
          currencies={currencies.data}
          initialParticipantId={selected?.id}
          onClose={() => setCreditOpen(false)}
          onConfirmed={(id, participantId) => {
            confirmed.current = true;
            setCreditOpen(false);
            setParams({
              ledger: ledgerId,
              participant_id: participantId,
              settlement_id: id,
            });
          }}
          finalFocus={() =>
            confirmed.current
              ? document.getElementById("finance-title")
              : creditTrigger.current
          }
          refreshDependencies={refresh}
        />
      ) : null}
      {open && accounts.data && participants.data && currencies.data ? (
        <RepaymentFormDialog
          ledgerId={ledgerId}
          accounts={accounts.data}
          participants={participants.data}
          currencies={currencies.data}
          initialParticipantId={selected?.id}
          onClose={() => setOpen(false)}
          onConfirmed={(id, participantId) => {
            confirmed.current = true;
            setOpen(false);
            setParams({
              ledger: ledgerId,
              participant_id: participantId,
              settlement_id: id,
            });
          }}
          finalFocus={() =>
            // Let dialog cleanup own focus so it cannot overwrite success focus.
            confirmed.current
              ? document.getElementById("finance-title")
              : trigger.current
          }
          refreshDependencies={refresh}
        />
      ) : null}
      {combinedOpen && accounts.data && participants.data && currencies.data ? (
        <ForgivenessFormDialog
          combined
          accounts={accounts.data}
          ledgerId={ledgerId}
          participants={participants.data}
          currencies={currencies.data}
          initialParticipantId={selected?.id}
          onClose={() => setCombinedOpen(false)}
          onConfirmed={(id, participantId) => {
            confirmed.current = true;
            setCombinedOpen(false);
            setParams({
              ledger: ledgerId,
              participant_id: participantId,
              settlement_id: id,
            });
          }}
          finalFocus={() =>
            confirmed.current
              ? document.getElementById("finance-title")
              : combinedTrigger.current
          }
          refreshDependencies={refresh}
        />
      ) : null}
      {forgivenessOpen && participants.data && currencies.data ? (
        <ForgivenessFormDialog
          ledgerId={ledgerId}
          participants={participants.data}
          currencies={currencies.data}
          initialParticipantId={selected?.id}
          onClose={() => setForgivenessOpen(false)}
          onConfirmed={(id, participantId) => {
            confirmed.current = true;
            setForgivenessOpen(false);
            setParams({
              ledger: ledgerId,
              participant_id: participantId,
              settlement_id: id,
            });
          }}
          finalFocus={() =>
            confirmed.current
              ? document.getElementById("finance-title")
              : forgivenessTrigger.current
          }
          refreshDependencies={refresh}
        />
      ) : null}
    </div>
  );
}
