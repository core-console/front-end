import type { SettlementCorrectionPreview } from "@/api/generated/schemas";
import { formatFinanceMoney as money } from "./finance-money";
import { Link } from "react-router";

export function SettlementCorrectionConsequences({
  plan: p,
  ledgerId,
}: {
  plan: SettlementCorrectionPreview;
  ledgerId: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 [overflow-wrap:anywhere]">
      <p>
        Settlement {p.settlementId} · Participant {p.participantId} · Receiving
        Account {p.receivingAccountId}
      </p>
      <p>
        Original receipt date {p.transactionDate} · Confirmed{" "}
        {p.originalConfirmedAt} · Confirmation order {p.confirmationOrder}
      </p>
      <p>
        Confirmed selected scope:{" "}
        {p.selectedObligationIds?.join(", ") ?? "All originally eligible debt"}.
        Only retained Allocation identities can change.
      </p>
      {(
        [
          ["Before", p.before, p.obligationsBefore, p.financialEffectsBefore],
          ["After", p.after, p.obligationsAfter, p.financialEffectsAfter],
        ] as const
      ).map(([label, facts, obligations, effects]) => (
        <section
          key={label}
          aria-label={`${label} receipt facts`}
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          <h4 className="font-semibold">{label} receipt facts</h4>
          <p>
            Cash receipt {money(facts.amount)} · Retained credit{" "}
            {money(facts.retainedCredit)} · Accepted Income{" "}
            {money(facts.acceptedSurplus)} · Category{" "}
            {facts.categoryId ?? "Uncategorized"}
          </p>
          <h5 className="font-semibold">
            Allocations in original confirmed order
          </h5>
          <ol className="flex flex-col gap-2">
            {facts.allocations.map((a) => (
              <li key={a.position}>
                Position {a.position} · Obligation {a.obligationId} · Original
                confirmed cash {money(a.originalCashPaid)} · Effective cash{" "}
                {money(a.cashPaid)}
              </li>
            ))}
          </ol>
          <h5 className="font-semibold">Complete affected debt composition</h5>
          {obligations.map((o) => (
            <div key={o.id}>
              <Link
                className="underline underline-offset-4"
                to={`/finance/advances?ledger=${ledgerId}&advance_id=${o.advanceId}`}
              >
                Advance {o.advanceId} · {o.sourceDate}
              </Link>
              <p>
                Obligation {o.id} · Principal {money(o.principal)} · Cash paid{" "}
                {money(o.cashPaid)} · Forgiven {money(o.forgiven)} · Credit
                applied {money(o.creditApplied)} · Remaining{" "}
                {money(o.remaining)}
              </p>
            </div>
          ))}
          <h5 className="font-semibold">Linked financial snapshots</h5>
          {effects.map((e) => (
            <div key={e.transactionId}>
              <p>
                {e.kind === "income" ? "Income" : "Internal Transfer"} ·
                Transaction {e.transactionId} · {e.transactionDate} · Income{" "}
                {money(e.income)} · Category {e.categoryId ?? "Uncategorized"} ·
                Note {e.note ?? "—"}
              </p>
              {e.movements.map((m) => (
                <p key={m.accountId}>
                  Account {m.accountId} · {m.role} · {money(m.amount)}
                </p>
              ))}
            </div>
          ))}
        </section>
      ))}
      <section
        aria-label="Affected Account balances"
        className="flex flex-col gap-2"
      >
        <h4 className="font-semibold">Affected Account balances</h4>
        {p.accountEffects.map((a) => (
          <p key={a.accountId}>
            {a.accountId} · {a.nature} · {money(a.balanceBefore)} →{" "}
            {money(a.balanceAfter)}
          </p>
        ))}
      </section>
      <p>
        Excess disposition: {p.excessDisposition}. These effects restate the
        original receipt at its original date, including future dates applied
        immediately. They do not record a new cash payment or return,
        forgiveness, credit consumption or Balance Adjustment. Unrelated
        Settlements retain their confirmed scope.
      </p>
    </div>
  );
}
