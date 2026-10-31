import { Link } from "react-router";
import type { CreditApplicationPreview } from "@/api/generated/schemas";
import { formatFinanceMoney } from "./finance-money";
export function CreditApplicationOrigins({
  origins,
  ledgerId,
  participantId,
  action = "application",
}: {
  origins: CreditApplicationPreview["origins"];
  ledgerId: string;
  participantId: string;
  action?: "application" | "return";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="font-semibold">Consumed credit origins</h3>
      <p>
        Retained oldest receipt confirmation order, independently of financial
        dates. Balances below are frozen at this {action}.
      </p>
      <ol
        aria-label="Consumed credit origins"
        className="flex min-w-0 flex-col gap-3"
      >
        {origins.map((origin) => (
          <li
            key={origin.originSettlementId}
            className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]"
          >
            <p>
              Confirmation {origin.originConfirmationOrder} · Origin date{" "}
              {origin.originDate}
            </p>
            <p>
              Consumed {formatFinanceMoney(origin.amount)} · Available before{" "}
              {formatFinanceMoney(origin.availableBefore)} · Available after{" "}
              {formatFinanceMoney(origin.availableAfter)}
            </p>
            <p>Credit Liability Account · {origin.liabilityAccountId}</p>
            <Link
              className="underline underline-offset-4"
              to={`/finance/repayments?ledger=${ledgerId}&participant_id=${participantId}&settlement_id=${origin.originSettlementId}`}
            >
              Source receipt Settlement · {origin.originSettlementId}
            </Link>
            <Link
              className="underline underline-offset-4"
              to={`/finance/transactions/${origin.originTransactionId}?ledger=${ledgerId}`}
            >
              Origin Internal Transfer · {origin.originTransactionId}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
