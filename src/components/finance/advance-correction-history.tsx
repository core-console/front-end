import { useListFinanceAdvanceCorrections } from "@/api/generated/core-console";
import type {
  AccountResponse,
  ParticipantResponse,
} from "@/api/generated/schemas";
import { parseCorrection } from "./advance-correction";
import { CorrectionConsequences } from "./correction-consequences";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
export function AdvanceCorrectionHistory({
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
  const query = useListFinanceAdvanceCorrections(ledgerId, advanceId, {
    query: {
      select: (response) => {
        const rows = response.data.map((data) =>
          parseCorrection(data, ledgerId, advanceId),
        );
        if (
          new Set(rows.map((r) => r.id)).size !== rows.length ||
          rows.some((r, i) => r.revision !== i + 1)
        )
          throw new Error("Correction history order is invalid.");
        return rows;
      },
    },
  });
  return (
    <section
      aria-label="Advance Correction history"
      className="flex min-w-0 flex-col gap-3"
    >
      <h3 className="text-lg font-semibold">Advance Correction history</h3>
      <Button
        variant="outline"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        Refresh Correction history
      </Button>
      {query.isPending ? (
        <p role="status">Loading Correction history…</p>
      ) : null}
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>
            Correction history is unavailable. Confirmed receipts stay
            confirmed. Retry the history read.
          </AlertTitle>
        </Alert>
      ) : null}
      {query.data?.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No Corrections recorded.</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}
      {query.data?.map((item) => (
        <section
          key={item.id}
          aria-label={`Correction revision ${item.revision}`}
          className="flex flex-col gap-3 rounded-lg border p-4"
        >
          <h4 className="font-semibold">
            Revision {item.revision} · Correction {item.id}
          </h4>
          <p>{item.reason}</p>
          <p>
            Correction confirmed at {item.confirmedAt} · Actor {item.actorId}
          </p>
          <CorrectionConsequences
            plan={item}
            accounts={accounts}
            participants={participants}
          />
        </section>
      ))}
    </section>
  );
}
