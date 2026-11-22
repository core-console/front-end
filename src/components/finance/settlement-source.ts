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
  CreditApplicationResponse,
  CreditReturnResponse,
} from "@/api/generated/schemas";

import { validCreditApplicationComposition } from "./credit-application";
import { validCreditReturnComposition } from "./credit-return";
import { equalDecimal, validCombinedComposition } from "./combined-settlement";
import { subtractExactDecimals } from "./finance-decimal";

function validEffectiveAmount(
  original: { amount: string; currency: string },
  effective?: { amount: string; currency: string } | null,
  restated = false,
) {
  return (
    !effective ||
    (effective.currency === original.currency &&
      /^\d+(?:\.\d+)?$/.test(effective.amount) &&
      (restated ||
        !subtractExactDecimals(original.amount, effective.amount).startsWith(
          "-",
        )))
  );
}

export const settlementSourceSchema = z
  .union([
    CreditReturnResponse.refine(
      (item) =>
        validCreditReturnComposition(item) &&
        item.transactionIds.length === item.origins.length &&
        new Set(item.transactionIds).size === item.transactionIds.length,
      "Credit return does not match its ordered origins or linked transfers.",
    ),
    CreditApplicationResponse.refine(
      (item) =>
        validCreditApplicationComposition(
          item,
          item.selectedObligationIds,
          item.transactionDate,
        ),
      "Credit application does not match its origins or selected debt.",
    ),
    CombinedSettlementResponse.refine(
      (item) =>
        validCombinedComposition(
          {
            ...item,
            allocations: item.allocations.filter(
              (a) =>
                !equalDecimal(
                  ("forgiven" in a ? a.forgiven : a.cashPaid).amount,
                  "0",
                ),
            ),
          },
          item.selectedObligationIds,
          item.transactionDate,
        ) &&
        item.allocations.every(
          (row, index) =>
            row.position === index + 1 &&
            item.selectedObligationIds.includes(row.obligationId) &&
            row.sourceDate <= item.transactionDate &&
            ("forgiven" in row
              ? validEffectiveAmount(
                  row.forgiven,
                  row.effectiveForgiven,
                  !!item.effectiveForgivenessAmount,
                )
              : validEffectiveAmount(
                  row.cashPaid,
                  row.effectiveCashPaid,
                  !!item.effectiveCashAmount,
                )),
        ) &&
        equalDecimal(
          item.allocations.reduce(
            (cash, row) =>
              "cashPaid" in row
                ? subtractExactDecimals(
                    cash,
                    `-${(row.effectiveCashPaid ?? row.cashPaid).amount}`,
                  )
                : cash,
            "0",
          ),
          subtractExactDecimals(
            subtractExactDecimals(
              (item.effectiveCashAmount ?? item.amount).amount,
              item.creditOrigin?.amount.amount ?? "0",
            ),
            item.acceptedSurplus?.amount ?? "0",
          ),
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
            validEffectiveAmount(
              row.forgiven,
              row.effectiveForgiven,
              !!item.effectiveForgivenessAmount,
            ) &&
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
      !("incomeTransactionId" in item && item.incomeTransactionId) ||
      (item.transactionIds.includes(item.incomeTransactionId) &&
        item.acceptedSurplus?.currency === item.amount.currency),
    "Income link does not match its Settlement source.",
  )
  .refine(
    (item) =>
      !("creditOrigin" in item && item.creditOrigin) ||
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
