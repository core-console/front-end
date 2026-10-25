import { Link } from "react-router";
import type {
  SettlementPreview,
  ForgivenessPreview,
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
    SettlementPreview["allocations"] | ForgivenessPreview["allocations"];
  ledgerId: string;
  participantId: string;
  confirmed?: boolean;
}) {
  return (
    <Table
      aria-label={confirmed ? "Confirmed Allocations" : "Proposed Allocations"}
    >
      <TableHeader>
        <TableRow>
          {[
            "Order",
            "Advance source",
            allocations.some((item) => "forgiven" in item)
              ? "Forgiven"
              : "Cash paid",
            confirmed ? "Remaining at confirmation" : "Remaining after",
          ].map((label) => (
            <TableHead key={label}>{label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {allocations.map((item) => (
          <TableRow key={item.obligationId}>
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
            <TableCell className="tabular-nums">
              {formatFinanceMoney(
                "forgiven" in item ? item.forgiven : item.cashPaid,
              )}
            </TableCell>
            <TableCell className="tabular-nums">
              {formatFinanceMoney(item.remainingAfter)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
