import { Link } from "react-router";
import { useGetFinanceAdvance } from "@/api/generated/core-console";
import {
  AdvanceResponse,
  type AccountResponse,
  type ParticipantResponse,
} from "@/api/generated/schemas";
import { formatFinanceMoney } from "./finance-money";
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
        AdvanceResponse.refine(
          (item) =>
            item.id === advanceId &&
            item.ledgerId === ledgerId &&
            item.obligation.ledgerId === ledgerId &&
            item.obligation.advanceId === advanceId,
        ).parse(response.data),
    },
  });
  const item = query.data;
  const funding = accounts.find(
    (account) => account.id === item?.fundingAccountId,
  );
  const person = participants.find(
    (participant) => participant.id === item?.obligation.participantId,
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
                "Participant",
                person
                  ? `${person.name} (${person.status}) · ${person.id}`
                  : item.obligation.participantId,
              ],
              [
                "Funding Asset Account",
                funding
                  ? `${funding.name} · ${funding.id}`
                  : item.fundingAccountId,
              ],
              ["Source date", item.transactionDate],
              ["Principal", formatFinanceMoney(item.amount)],
              ["Owner share", formatFinanceMoney(item.ownerShare)],
              ["Receivable Account ID", item.obligation.receivableAccountId],
              ["Transaction ID", item.transactionId],
              ["Confirmed at", item.confirmedAt],
              ["Note", item.note || "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">
            Funding decreased and the dedicated receivable increased by{" "}
            {formatFinanceMoney(item.amount)}. Owner purchase Expense and Income
            are unchanged. The receivable is already included in the Ledger
            financial position.
          </p>
          <Link
            className="underline underline-offset-4"
            to={`/finance/transactions/${item.transactionId}?ledger=${ledgerId}`}
          >
            View linked Transaction
          </Link>
        </>
      ) : null}
    </section>
  );
}
