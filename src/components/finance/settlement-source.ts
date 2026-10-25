import { z } from "zod";
import {
  SettlementResponse,
  SelectedSettlementResponse,
  SelectedCreditSettlementResponse,
  SelectedIncomeSettlementResponse,
  CreditSettlementResponse,
  IncomeSettlementResponse,
  ForgivenessResponse,
  CombinedSettlementResponse,
} from "@/api/generated/schemas";

import { validCombinedComposition } from "./combined-settlement";

export const settlementSourceSchema = z
  .union([
    CombinedSettlementResponse.refine(
      (item) =>
        validCombinedComposition(
          item,
          item.selectedObligationIds,
          item.transactionDate,
        ),
      "Combined Allocations do not match retained cash, forgiveness or selected scope.",
    ),
    ForgivenessResponse.refine(
      (item) =>
        new Set(item.selectedObligationIds).size ===
          item.selectedObligationIds.length &&
        item.allocations.length > 0 &&
        item.allocations.every(
          (row) =>
            item.selectedObligationIds.includes(row.obligationId) &&
            row.sourceDate <= item.transactionDate &&
            row.forgiven.currency === item.amount.currency &&
            row.remainingAfter.currency === item.amount.currency,
        ),
      "Forgiveness Allocations do not match the retained selected scope.",
    ),
    SelectedSettlementResponse,
    SelectedCreditSettlementResponse,
    SelectedIncomeSettlementResponse,
    SettlementResponse,
    CreditSettlementResponse,
    IncomeSettlementResponse,
  ])
  .refine(
    (item) =>
      !("incomeTransactionId" in item) ||
      (item.transactionIds.includes(item.incomeTransactionId) &&
        item.acceptedSurplus.currency === item.amount.currency),
    "Income link does not match its Settlement source.",
  )
  .refine(
    (item) =>
      !("creditOrigin" in item) ||
      (item.creditOrigin.ledgerId === item.ledgerId &&
        item.creditOrigin.participantId === item.participantId &&
        item.creditOrigin.settlementId === item.id &&
        item.creditOrigin.receivingAccountId === item.receivingAccountId &&
        item.creditOrigin.transactionDate === item.transactionDate &&
        item.creditOrigin.confirmedAt === item.confirmedAt &&
        item.creditOrigin.confirmationOrder === item.confirmationOrder &&
        item.creditOrigin.amount.currency === item.amount.currency &&
        item.creditOrigin.available.currency === item.amount.currency &&
        item.transactionIds.includes(item.creditOrigin.transactionId)),
    "Credit origin does not match its Settlement source.",
  );
export type SettlementSource = z.infer<typeof settlementSourceSchema>;

export function parseSettlementSource(
  data: unknown,
  ledgerId: string,
  id: string,
  participantId?: string,
) {
  return settlementSourceSchema
    .refine(
      (item) =>
        item.id === id &&
        item.ledgerId === ledgerId &&
        (!participantId || item.participantId === participantId),
      "Settlement source does not match its addressed scope.",
    )
    .parse(data);
}
