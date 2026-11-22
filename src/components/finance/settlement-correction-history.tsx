import { useListFinanceSettlementCorrections } from "@/api/generated/core-console";
import { parseSettlementCorrection } from "./settlement-correction";
import { SettlementCorrectionConsequences } from "./settlement-correction-consequences";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export function SettlementCorrectionHistory({
  ledgerId,
  settlementId,
  includesForgiveness = false,
}: {
  ledgerId: string;
  settlementId: string;
  includesForgiveness?: boolean;
}) {
  const historyName = includesForgiveness
    ? "Settlement Correction history"
    : "Cash repayment Correction history";
  const query = useListFinanceSettlementCorrections(ledgerId, settlementId, {
    query: {
      select: (response) => {
        const rows = response.data.map((data) =>
          parseSettlementCorrection(data, ledgerId, settlementId),
        );
        if (
          new Set(rows.map((r) => r.id)).size !== rows.length ||
          rows.some((r, i) => r.revision !== i + 1)
        )
          throw new Error("Invalid Correction history order.");
        return rows;
      },
    },
  });
  return (
    <section aria-label={historyName} className="flex min-w-0 flex-col gap-3">
      <h3 className="text-lg font-semibold">{historyName}</h3>
      <Button
        variant="outline"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        {includesForgiveness
          ? "Refresh Settlement Correction history"
          : "Refresh cash Correction history"}
      </Button>
      {query.isPending ? (
        <p role="status">Loading Correction history…</p>
      ) : null}
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>
            Correction history is unavailable. Retry the read; confirmed actions
            remain confirmed.
          </AlertTitle>
        </Alert>
      ) : null}
      {query.data?.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {includesForgiveness
                ? "No Settlement Corrections recorded."
                : "No cash repayment Corrections recorded."}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}
      {query.data?.map((r) => (
        <section
          key={r.id}
          aria-label={`${includesForgiveness ? "Settlement" : "Cash"} Correction revision ${r.revision}`}
          className="flex flex-col gap-3 rounded-lg border p-3"
        >
          <h4 className="font-semibold">
            Revision {r.revision} · Correction {r.id}
          </h4>
          <p>Reason: {r.reason}</p>
          <p>
            Actor {r.actorId} · Correction confirmed {r.confirmedAt}
          </p>
          <SettlementCorrectionConsequences plan={r} ledgerId={ledgerId} />
        </section>
      ))}
    </section>
  );
}
