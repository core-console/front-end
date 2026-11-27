import type { CorrectionCreditReturn } from "@/api/generated/schemas";
import { Link } from "react-router";
import { formatFinanceMoney as money } from "./finance-money";

export function CorrectionCreditReturns({
  returns,
  ledgerId,
  participantId,
  accountLabel,
}: {
  returns: CorrectionCreditReturn[];
  ledgerId: string;
  participantId: string;
  accountLabel?: (id: string) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h5 className="font-semibold">Actual Credit returns</h5>
      <p>The original return outflows and their receipt links are preserved.</p>
      <ol className="flex flex-col gap-2">
        {returns.map((item) => (
          <li key={item.transactionId}>
            <Link
              className="underline underline-offset-4"
              to={`/finance/repayments?ledger=${ledgerId}&participant_id=${participantId}&settlement_id=${item.settlementId}`}
            >
              Return of {money(item.returnAmount)} on {item.transactionDate}
            </Link>
            <p>
              Paying Account{" "}
              {accountLabel?.(item.payingAccountId) ?? item.payingAccountId} ·
              From this receipt {money(item.originAmount)} · Confirmation order{" "}
              {item.confirmationOrder} · Fragment {item.position}
            </p>
            <p>Original outflow Transaction {item.transactionId}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
