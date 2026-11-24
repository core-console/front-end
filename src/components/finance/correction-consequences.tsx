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
      {(plan.forgivenessRestatements ?? []).length > 0 ? (
        <section
          aria-label="Forgiveness Expense restatements"
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          <h4 className="font-semibold">Forgiveness Expense restatements</h4>
          {plan.forgivenessRestatements?.map((item) => (
            <div
              key={item.expenseTransactionId}
              className="flex flex-col gap-1"
            >
              <p>
                Forgiveness Expense on {item.transactionDate} ·{" "}
                {money(item.forgivenBefore)} → {money(item.forgivenAfter)}
              </p>
              <p>
                Originally forgiven {money(item.originalForgiven)} ·
                Confirmation {item.confirmationOrder} · Allocation{" "}
                {item.position}
              </p>
              <Link
                className="underline underline-offset-4"
                to={`/finance/repayments?ledger=${plan.after.ledgerId}&settlement_id=${item.settlementId}`}
              >
                Open originating Settlement
              </Link>
            </div>
          ))}
        </section>
      ) : null}
      {(plan.cashReleases ?? []).length > 0 ? (
        <section
          aria-label="Released cash and credit origins"
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          <h4 className="font-semibold">Released cash and credit origins</h4>
          {(plan.cashReleases ?? []).map((release) => (
            <div
              key={`${release.settlementId}:${release.position}`}
              className="flex flex-col gap-1"
            >
              <p>
                Receipt {money(release.receiptAmount)} on{" "}
                {release.transactionDate} · confirmed {release.confirmedAt} ·
                order {release.confirmationOrder}
              </p>
              <p>
                Obligation {release.obligationId} · Allocation{" "}
                {release.position} · Cash applied {money(release.cashBefore)} →{" "}
                {money(release.cashAfter)}
              </p>
              <p>
                Released {money(release.released)} as credit from this receipt ·
                Credit {money(release.creditBefore)} →{" "}
                {money(release.creditAfter)}
              </p>
              <p>
                Credit Account {account(release.creditAccountId)} · Transfer{" "}
                {release.financialEffect.transactionId}
              </p>
              <Link
                className="underline underline-offset-4"
                to={`/finance/repayments?ledger=${plan.after.ledgerId}&settlement_id=${release.settlementId}`}
              >
                Open originating receipt
              </Link>
            </div>
          ))}
        </section>
      ) : null}
      {plan.creditApplications?.length ? (
        <section
          aria-label="Applied Credit and original receipts"
          className="flex flex-col gap-3 rounded-md border p-3"
        >
          <h4 className="font-semibold">
            Applied Credit and original receipts
          </h4>
          {plan.creditApplications.map((item) => (
            <div
              key={`${item.settlementId}:${item.position}`}
              className="flex flex-col gap-1"
            >
              <p>
                Originally applied {money(item.originalApplied)} · Effective{" "}
                {money(item.appliedBefore)} → {money(item.appliedAfter)} ·
                Restored {money(item.restored)}
              </p>
              <p>
                Credit application on {item.transactionDate} · Confirmation{" "}
                {item.confirmationOrder} · Allocation {item.position}
              </p>
              <p>
                Original receipt on {item.origin.transactionDate} · Confirmation{" "}
                {item.origin.confirmationOrder} · Available before{" "}
                {money(item.origin.available)}
              </p>
              {item.financialEffect ? (
                <p>
                  Internal Transfer on {item.financialEffect.transactionDate} ·{" "}
                  {item.financialEffect.transactionId}
                </p>
              ) : null}
              <Link
                className="underline underline-offset-4"
                to={`/finance/repayments?ledger=${plan.after.ledgerId}&participant_id=${item.origin.participantId}&settlement_id=${item.settlementId}`}
              >
                Open Credit application
              </Link>
              <Link
                className="underline underline-offset-4"
                to={`/finance/repayments?ledger=${plan.after.ledgerId}&participant_id=${item.origin.participantId}&settlement_id=${item.origin.settlementId}`}
              >
                Open original Credit receipt
              </Link>
            </div>
          ))}
        </section>
      ) : null}
      {plan.participantPositions?.length ? (
        <section
          aria-label="Gross Participant positions"
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          <h4 className="font-semibold">Gross Participant positions</h4>
          {plan.participantPositions.map((position) => (
            <div key={position.participantId}>
              <p>{person(position.participantId)}</p>
              <p>
                Outstanding receivables{" "}
                {money(position.outstandingReceivablesBefore)} →{" "}
                {money(position.outstandingReceivablesAfter)}
              </p>
              <p>
                Available Credit {money(position.availableCreditBefore)} →{" "}
                {money(position.availableCreditAfter)}
              </p>
            </div>
          ))}
        </section>
      ) : null}
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
      {(plan.cashReleases ?? []).length > 0 ? (
        <p>
          Released cash remains available as credit from its original receipt.
        </p>
      ) : !plan.creditApplications?.length ? (
        <p>No Credit released.</p>
      ) : null}
      <Link
        className="underline underline-offset-4"
        to={`/finance/advances?ledger=${plan.after.ledgerId}&advance_id=${plan.advanceId}`}
      >
        Open effective Advance
      </Link>
    </div>
  );
}
