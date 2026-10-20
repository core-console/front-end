import { SettlementResponse } from "@/api/generated/schemas";

export function parseSettlementSource(
  data: unknown,
  ledgerId: string,
  id: string,
  participantId?: string,
) {
  return SettlementResponse.refine(
    (item) =>
      item.id === id &&
      item.ledgerId === ledgerId &&
      (!participantId || item.participantId === participantId),
    "Settlement source does not match its addressed scope.",
  ).parse(data);
}
