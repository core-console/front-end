import { Link } from "react-router";
import { useGetFinanceAdvance } from "@/api/generated/core-console";
import {
  type AccountResponse,
  type ParticipantResponse,
} from "@/api/generated/schemas";
import { formatFinanceMoney } from "./finance-money";
import { parseAdvanceSource, advanceObligations } from "./advance-source";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function AdvanceDetail({
  ledgerId,
  advanceId,
  accounts,
  participants,
}: {
  ledgerId: string;
  advanceId: string;
  accounts: AccountResponse[];
  participants: ParticipantResponse[];
}) {
  const query = useGetFinanceAdvance(ledgerId, advanceId, {
    query: {
      select: (response) =>
        parseAdvanceSource(response.data, ledgerId, advanceId),
    },
  });
  const item = query.data;
  const funding = accounts.find(
    (account) => account.id === item?.fundingAccountId,
  );
  return (
    <section
      aria-label="Confirmed Advance source"
      className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 [overflow-wrap:anywhere]"
    >
      <h2 className="text-lg font-semibold">Confirmed Advance source</h2>
      {query.isPending ? <p role="status">Loading Advance source…</p> : null}
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>
            Advance source is unavailable. A confirmed receipt stays confirmed;
            do not record it again.
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
              ["Advance ID", item.id],
              [
                "Funding Account",
                funding
                  ? `${funding.name} · ${funding.nature === "liability" ? "Liability" : "Asset"} · ${funding.id}`
                  : item.fundingAccountId,
              ],
              ["Source date", item.transactionDate],
              ["Total funding", formatFinanceMoney(item.amount)],
              ["Owner share", formatFinanceMoney(item.ownerShare)],
              ["Confirmed at", item.confirmedAt],
              ["Note", item.note || "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {advanceObligations(item).map((obligation) => {
            const person = participants.find(
              (participant) => participant.id === obligation.participantId,
            );
            return (
              <section
                key={obligation.id}
                aria-label={`Participant ${obligation.participantId}`}
                className="flex flex-col gap-2"
              >
                <h3 className="font-semibold">
                  {person
                    ? `${person.name} (${person.status}) · ${person.id}`
                    : obligation.participantId}
                </h3>
                <dl className="grid gap-2 sm:grid-cols-2">
                  {[
                    ["Obligation ID", obligation.id],
                    ["Receivable Account ID", obligation.receivableAccountId],
                    ["Principal", formatFinanceMoney(obligation.principal)],
                    ["Remaining", formatFinanceMoney(obligation.remaining)],
                    ["Cash paid", formatFinanceMoney(obligation.cashPaid)],
                    ["Forgiven", formatFinanceMoney(obligation.forgiven)],
                    [
                      "Credit applied",
                      formatFinanceMoney(obligation.creditApplied),
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-sm text-muted-foreground">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <Link
                  className="underline underline-offset-4"
                  to={`/finance/advances?ledger=${ledgerId}&participant_id=${obligation.participantId}&advance_id=${item.id}`}
                >
                  Inspect Participant receivables
                </Link>
              </section>
            );
          })}
          <p className="text-sm text-muted-foreground">
            Total funding: {formatFinanceMoney(item.amount)}. Owner purchase
            Expense: {formatFinanceMoney(item.ownerShare)}. Participant
            principal is not personal Expense. Income is unchanged. Receivables
            are already included in the Ledger financial position.
          </p>
          {("transactionIds" in item
            ? item.transactionIds
            : [item.transactionId]
          ).map((transactionId) => (
            <div key={transactionId} className="flex flex-col gap-1">
              <span>{transactionId}</span>
              <Link
                className="underline underline-offset-4"
                to={`/finance/transactions/${transactionId}?ledger=${ledgerId}`}
              >
                View linked Transaction
              </Link>
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}
