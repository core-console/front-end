import { Link } from "react-router";
import type {
  SettlementPreview,
  ForgivenessPreview,
  CombinedSettlementPreview,
  CreditApplicationPreview,
} from "@/api/generated/schemas";
import { formatFinanceMoney } from "./finance-money";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export function SettlementAllocations({
  allocations,
  ledgerId,
  participantId,
  confirmed = false,
}: {
  allocations:
    | SettlementPreview["allocations"]
    | ForgivenessPreview["allocations"]
    | CombinedSettlementPreview["allocations"]
    | CreditApplicationPreview["allocations"];
  ledgerId: string;
  participantId: string;
  confirmed?: boolean;
}) {
  const hasCredit = allocations.some((item) => "creditApplied" in item);
  const hasCash = allocations.some((item) => "cashPaid" in item);
  const hasForgiveness = allocations.some((item) => "forgiven" in item);
  return (
    <Table
      aria-label={confirmed ? "Confirmed Allocations" : "Proposed Allocations"}
    >
      <TableHeader>
        <TableRow>
          {[
            "Order",
            "Advance source",
            ...(hasCredit ? ["Credit applied", "Credit origin"] : []),
            ...(hasCash ? ["Cash paid"] : []),
            ...(hasForgiveness ? ["Forgiven"] : []),
            confirmed ? "Remaining at confirmation" : "Remaining after",
          ].map((label) => (
            <TableHead key={label}>{label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {allocations.map((item) => (
          <TableRow key={`${item.position}-${item.obligationId}`}>
            <TableCell>{item.position}</TableCell>
            <TableCell className="whitespace-normal">
              <Link
                className="underline underline-offset-4"
                to={`/finance/advances?ledger=${ledgerId}&participant_id=${participantId}&advance_id=${item.advanceId}`}
              >
                {item.sourceDate}
              </Link>
              <p className="max-w-48 text-xs break-all text-muted-foreground">
                Obligation {item.obligationId}
              </p>
            </TableCell>
            {hasCredit ? (
              <>
                <TableCell>
                  {"creditApplied" in item
                    ? formatFinanceMoney(item.creditApplied)
                    : "—"}
                </TableCell>
                <TableCell className="break-all whitespace-normal">
                  {"originSettlementId" in item ? (
                    <Link
                      className="underline underline-offset-4"
                      to={`/finance/repayments?ledger=${ledgerId}&participant_id=${participantId}&settlement_id=${item.originSettlementId}`}
                    >
                      {item.originSettlementId}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </>
            ) : null}
            {hasCash ? (
              <TableCell className="tabular-nums">
                {"cashPaid" in item ? formatFinanceMoney(item.cashPaid) : "—"}
              </TableCell>
            ) : null}
            {hasForgiveness ? (
              <TableCell className="tabular-nums">
                {"forgiven" in item ? formatFinanceMoney(item.forgiven) : "—"}
              </TableCell>
            ) : null}
            <TableCell className="tabular-nums">
              {formatFinanceMoney(item.remainingAfter)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
