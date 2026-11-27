import type { SettlementCorrectionPreview } from "@/api/generated/schemas";
import { formatFinanceMoney as money } from "./finance-money";
import { Link } from "react-router";
import { CorrectionCreditReturns } from "./correction-credit-returns";

export function SettlementCorrectionConsequences({
  plan: p,
  ledgerId,
}: {
  plan: SettlementCorrectionPreview;
  ledgerId: string;
}) {
  const forgiveness = !!p.before.forgivenessAmount;
  const credit = p.creditCorrection;
  const returns = credit?.returns ?? [];
  const creditHeading = returns.length
    ? "Credit applications and actual returns"
    : "Applied credit consequences";
  return (
    <div className="flex min-w-0 flex-col gap-3 [overflow-wrap:anywhere]">
      <p>
        Settlement {p.settlementId} · Participant {p.participantId}
        {p.receivingAccountId && ` · Receiving Account ${p.receivingAccountId}`}
      </p>
      <p>
        {forgiveness ? "Original financial date" : "Original receipt date"}{" "}
        {p.transactionDate} · Confirmed {p.originalConfirmedAt} · Confirmation
        order {p.confirmationOrder}
      </p>
      <p>
        Confirmed selected scope:{" "}
        {p.selectedObligationIds?.join(", ") ?? "All originally eligible debt"}.
      </p>
      {credit && (
        <section
          aria-label={creditHeading}
          className="flex flex-col gap-3 rounded-md border p-3"
        >
          <h4 className="font-semibold">{creditHeading}</h4>
          <p>
            Credit origin {credit.origin.settlementId} · Confirmation order{" "}
            {credit.origin.confirmationOrder}
          </p>
          <p>
            Retained from receipt {money(credit.origin.amount)} →{" "}
            {money(p.after.retainedCredit)} · Available from receipt{" "}
            {money(credit.origin.available)} → {money(credit.availableAfter)}
          </p>
          <p>
            Participant outstanding receivables{" "}
            {money(credit.participantPosition.outstandingReceivablesBefore)} →{" "}
            {money(credit.participantPosition.outstandingReceivablesAfter)}
          </p>
          <p>
            Participant available credit{" "}
            {money(credit.participantPosition.availableCreditBefore)} →{" "}
            {money(credit.participantPosition.availableCreditAfter)}
          </p>
          {returns.length > 0 && (
            <CorrectionCreditReturns
              returns={returns}
              ledgerId={ledgerId}
              participantId={p.participantId}
            />
          )}
          {credit.directCashReleasedForReturns &&
            /[1-9]/.test(credit.directCashReleasedForReturns.amount) && (
              <p>
                Reduce direct cash Allocations by{" "}
                {money(credit.directCashReleasedForReturns)} to preserve the
                actual returns.
              </p>
            )}
          {credit.applications.length > 0 && (
            <h5 className="font-semibold">Applications from this receipt</h5>
          )}
          <ol className="flex flex-col gap-2">
            {credit.applications.map((a) => (
              <li key={a.applicationTransactionId}>
                <Link
                  className="underline underline-offset-4"
                  to={`/finance/repayments?ledger=${ledgerId}&participant_id=${p.participantId}&settlement_id=${a.settlementId}`}
                >
                  Credit application {a.settlementId}
                </Link>{" "}
                · Confirmation order {a.confirmationOrder} · Allocation{" "}
                {a.position}
                <p>
                  Obligation {a.obligationId} · Originally applied{" "}
                  {money(a.originalApplied)} · Applied {money(a.appliedBefore)}{" "}
                  → {money(a.appliedAfter)} ·{" "}
                  {a.restatementTransactionId
                    ? `Released ${money(a.released)} to reopen debt`
                    : "Application preserved"}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {(
        [
          ["Before", p.before, p.obligationsBefore, p.financialEffectsBefore],
          ["After", p.after, p.obligationsAfter, p.financialEffectsAfter],
        ] as const
      ).map(([label, facts, obligations, effects]) => (
        <section
          key={label}
          aria-label={`${label} ${forgiveness ? "Settlement" : "receipt"} facts`}
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          <h4 className="font-semibold">
            {label} {forgiveness ? "Settlement" : "receipt"} facts
          </h4>
          {p.receivingAccountId && (
            <p>
              Cash receipt {money(facts.amount)} · Retained credit{" "}
              {money(facts.retainedCredit)} · Accepted Income{" "}
              {money(facts.acceptedSurplus)} · Category{" "}
              {facts.categoryId ?? "Uncategorized"}
            </p>
          )}
          {facts.forgivenessAmount && (
            <p>Forgiveness Expense {money(facts.forgivenessAmount)}</p>
          )}
          <h5 className="font-semibold">Allocations in confirmed order</h5>
          <ol className="flex flex-col gap-2">
            {facts.allocations.map((a) => (
              <li key={a.position}>
                Position {a.position} · Obligation {a.obligationId} ·{" "}
                {a.forgiven && a.originalForgiven ? (
                  <>
                    Originally forgiven {money(a.originalForgiven)} · Effective
                    forgiveness {money(a.forgiven)}
                  </>
                ) : (
                  <>
                    Original confirmed cash {money(a.originalCashPaid)} ·
                    Effective cash {money(a.cashPaid)}
                  </>
                )}
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
                {e.kind === "expense"
                  ? "Expense"
                  : e.kind === "income"
                    ? "Income"
                    : "Internal Transfer"}{" "}
                · Transaction {e.transactionId} · {e.transactionDate}{" "}
                {e.expense
                  ? `· Expense ${money(e.expense)} `
                  : e.kind === "income"
                    ? `· Income ${money(e.income)} `
                    : ""}
                · Category {e.categoryId ?? "Uncategorized"} · Note{" "}
                {e.note ?? "—"}
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
      {p.receivingAccountId && (
        <p>
          Excess disposition{" "}
          {p.excessDisposition === "none"
            ? "No uncommitted excess"
            : p.excessDisposition}
        </p>
      )}
    </div>
  );
}
