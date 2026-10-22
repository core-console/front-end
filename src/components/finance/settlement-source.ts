import { z } from "zod";
import {
  SettlementResponse,
  CreditSettlementResponse,
} from "@/api/generated/schemas";

export const settlementSourceSchema = z
  .union([SettlementResponse, CreditSettlementResponse])
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
