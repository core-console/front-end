import { Link } from "react-router";
import { useListFinanceParticipantObligations } from "@/api/generated/core-console";
import { ObligationResponse } from "@/api/generated/schemas";
import { formatFinanceMoney } from "./finance-money";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";

export function ParticipantObligations({
  ledgerId,
  participantId,
}: {
  ledgerId: string;
  participantId: string;
}) {
  const query = useListFinanceParticipantObligations(ledgerId, participantId, {
    query: {
      select: (response) =>
        ObligationResponse.array()
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
      aria-label="Participant receivables"
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Receivable composition</h2>
        <Link
          className="text-sm underline underline-offset-4"
          to={`/finance/repayments?ledger=${ledgerId}&participant_id=${participantId}`}
        >
          Record or inspect repayments
        </Link>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh receivables
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Principal, cash paid, forgiven, credit applied and remaining debt are
        shown separately. These explain the receivable already included in
        Accounts.
      </p>
      {query.isPending ? <p role="status">Loading receivables…</p> : null}
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>
            Receivables could not be refreshed. Retry the read; do not confirm
            the Advance again.
          </AlertTitle>
        </Alert>
      ) : null}
      {query.data?.length === 0 ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyTitle>No receivables for this Participant</EmptyTitle>
            <EmptyDescription>
              A confirmed Advance creates a traceable Obligation.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {query.data?.length ? (
        <Table aria-label="Participant receivable composition">
          <TableHeader>
            <TableRow>
              {[
                "Source",
                "Principal",
                "Cash paid",
                "Forgiven",
                "Credit applied",
                "Remaining",
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-normal">
                  <Link
                    className="underline underline-offset-4"
                    to={`/finance/advances?ledger=${ledgerId}&participant_id=${participantId}&advance_id=${item.advanceId}`}
                  >
                    {item.sourceDate}
                  </Link>
                  <p className="max-w-40 text-xs break-all text-muted-foreground">
                    Obligation {item.id}
                  </p>
                </TableCell>
                {[
                  item.principal,
                  item.cashPaid,
                  item.forgiven,
                  item.creditApplied,
                  item.remaining,
                ].map((money, index) => (
                  <TableCell className="tabular-nums" key={index}>
                    {formatFinanceMoney(money)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}
