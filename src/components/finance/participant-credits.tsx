import { Link } from "react-router";
import {
  useGetFinanceParticipantPositions,
  useListFinanceParticipantCredits,
} from "@/api/generated/core-console";
import {
  CreditOriginResponse,
  ParticipantPositionResponse,
} from "@/api/generated/schemas";
import { formatFinanceMoney } from "./finance-money";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export function ParticipantCredits({
  ledgerId,
  participantId,
}: {
  ledgerId: string;
  participantId: string;
}) {
  const positions = useGetFinanceParticipantPositions(ledgerId, participantId, {
    query: {
      select: (response) =>
        ParticipantPositionResponse.array()
          .refine(
            (items) =>
              items.every((item) =>
                [
                  item.outstandingReceivables,
                  item.availableCredits,
                  item.netExposure,
                ].every((money) => money.currency === item.currency),
              ) &&
              new Set(items.map((item) => item.currency)).size === items.length,
          )
          .parse(response.data),
    },
  });
  const credits = useListFinanceParticipantCredits(ledgerId, participantId, {
    query: {
      select: (response) =>
        CreditOriginResponse.array()
          .refine((items) =>
            items.every(
              (item) =>
                item.ledgerId === ledgerId &&
                item.participantId === participantId &&
                item.amount.currency === item.available.currency,
            ),
          )
          .parse(response.data),
    },
  });
  return (
    <section
      aria-label="Participant credit and positions"
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Receivables and credits</h2>
        <Button
          variant="outline"
          disabled={positions.isFetching || credits.isFetching}
          onClick={() =>
            void Promise.allSettled([positions.refetch(), credits.refetch()])
          }
        >
          Refresh positions and credits
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Gross receivables and available credit stay separate in each currency,
        including at zero net exposure. Credit is owed to the Participant and is
        already included in its Liability Account. New Advances leave it
        unapplied.
      </p>
      {positions.isPending ? (
        <p role="status">Loading Participant positions…</p>
      ) : null}
      {positions.isError ? (
        <Alert variant="destructive">
          <AlertTitle>
            Participant positions could not refresh. Retry the read; no receipt
            needs to be recorded again.
          </AlertTitle>
        </Alert>
      ) : null}
      {positions.data && !positions.isError ? (
        positions.data.length ? (
          <Table aria-label="Participant positions by currency">
            <TableHeader>
              <TableRow>
                {[
                  "Currency",
                  "Outstanding receivables",
                  "Available credits",
                  "Net exposure",
                ].map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.data.map((item) => (
                <TableRow key={item.currency}>
                  <TableCell>{item.currency}</TableCell>
                  {[
                    item.outstandingReceivables,
                    item.availableCredits,
                    item.netExposure,
                  ].map((money, index) => (
                    <TableCell key={index} className="tabular-nums">
                      {formatFinanceMoney(money)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p>No receivable or credit positions for this Participant.</p>
        )
      ) : null}
      <h3 className="font-semibold">Receipt-backed credit origins</h3>
      <p className="text-sm text-muted-foreground">
        Immutable receipt confirmation order, including backdated receipts. Each
        origin retains its actual receipt and financial date.
      </p>
      {credits.isPending ? <p role="status">Loading credit origins…</p> : null}
      {credits.isError ? (
        <Alert variant="destructive">
          <AlertTitle>
            Credit origins could not refresh. Retry the read; confirmed receipts
            remain confirmed.
          </AlertTitle>
        </Alert>
      ) : null}
      {credits.data && !credits.isError ? (
        credits.data.length ? (
          <ol
            aria-label="Receipt-backed credit origins"
            className="flex min-w-0 flex-col gap-3"
          >
            {credits.data.map((item) => (
              <li
                key={item.settlementId}
                className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 [overflow-wrap:anywhere]"
              >
                <p>
                  {item.transactionDate} · Confirmation {item.confirmationOrder}{" "}
                  · Confirmed at {item.confirmedAt}
                </p>
                <p>
                  Retained {formatFinanceMoney(item.amount)} · Available{" "}
                  {formatFinanceMoney(item.available)}
                </p>
                <p>Receiving Account · {item.receivingAccountId}</p>
                <p>Credit Liability Account · {item.liabilityAccountId}</p>
                <Link
                  className="underline underline-offset-4"
                  to={`/finance/repayments?ledger=${ledgerId}&participant_id=${participantId}&settlement_id=${item.settlementId}`}
                >
                  View source Settlement · {item.settlementId}
                </Link>
                <Link
                  className="underline underline-offset-4"
                  to={`/finance/transactions/${item.transactionId}?ledger=${ledgerId}`}
                >
                  View credit Internal Transfer · {item.transactionId}
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p>No retained credit origins for this Participant.</p>
        )
      ) : null}
    </section>
  );
}
