import { Link } from "react-router";
import type {
  AccountResponse,
  ParticipantResponse,
  AdvanceCorrectionPreview,
} from "@/api/generated/schemas";
import { advanceObligations } from "./advance-source";
import { formatFinanceMoney as money } from "./finance-money";
export function CorrectionConsequences({
  plan,
  accounts,
  participants,
}: {
  plan: AdvanceCorrectionPreview;
  accounts: AccountResponse[];
  participants: ParticipantResponse[];
}) {
  const account = (id: string) => {
    const a = accounts.find((a) => a.id === id);
    return a ? `${a.name} · ${a.nature} · ${id}` : id;
  };
  const person = (id: string) => {
    const p = participants.find((p) => p.id === id);
    return p ? `${p.name} (${p.status}) · ${id}` : id;
  };
  return (
    <div className="flex min-w-0 flex-col gap-3 [overflow-wrap:anywhere]">
      <p>
        {plan.fundingChanged
          ? "Funding changed: recorded amount or funding Account is corrected."
          : "Funding unchanged: the truthful funded total is retained; shares are explicitly restated."}
      </p>
      <p>
        Original confirmation: {plan.before.confirmedAt}. Advance identity:{" "}
        {plan.advanceId}.
      </p>
      {(
        [
          ["Before", plan.before, plan.financialEffectsBefore],
          ["After", plan.after, plan.financialEffectsAfter],
        ] as const
      ).map(([label, source, effects]) => (
        <section
          key={label}
          aria-label={`${label} correction facts`}
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          <h4 className="font-semibold">{label}</h4>
          <p>Funding Account: {account(source.fundingAccountId)}</p>
          <p>Original financial date: {source.transactionDate}</p>
          <p>
            Total funding: {money(source.amount)} · Owner purchase Expense:{" "}
            {money(source.ownerShare)}
          </p>
          <p>Note: {source.note ?? "—"}</p>
          {advanceObligations(source).map((o) => (
            <div key={o.id} className="flex flex-col gap-1">
              <p>
                {person(o.participantId)} · Principal {money(o.principal)} ·
                Remaining {money(o.remaining)}
              </p>
              <p>
                Cash paid {money(o.cashPaid)} · Forgiven {money(o.forgiven)} ·
                Credit applied {money(o.creditApplied)}
              </p>
              <p>
                Obligation {o.id} · Receivable Account {o.receivableAccountId} ·
                Source date {o.sourceDate}
              </p>
            </div>
          ))}
          <h5 className="font-semibold">Linked financial effects</h5>
          {effects.map((e) => (
            <div key={e.transactionId} className="flex flex-col gap-1">
              <p>
                {e.kind === "expense" ? "Expense" : "Internal Transfer"} ·{" "}
                {e.transactionDate} · Owner Expense {money(e.ownerExpense)} ·
                Note: {e.note ?? "—"}
              </p>
              <span>Transaction {e.transactionId}</span>
              {e.movements.map((m) => (
                <p key={m.accountId}>
                  {account(m.accountId)} · {m.role} · {money(m.amount)}
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
        {plan.accountEffects.map((a) => (
          <p key={a.accountId}>
            {account(a.accountId)} · {a.nature} · {money(a.balanceBefore)} →{" "}
            {money(a.balanceAfter)}
          </p>
        ))}
      </section>
      <p>
        Original financial facts are restated at the corrected date. Recorded
        future-dated effects apply immediately. No cash repayment, forgiveness,
        credit use, Income or Balance Adjustment is introduced.
      </p>
      <Link
        className="underline underline-offset-4"
        to={`/finance/advances?ledger=${plan.after.ledgerId}&advance_id=${plan.advanceId}`}
      >
        Open effective Advance
      </Link>
    </div>
  );
}
