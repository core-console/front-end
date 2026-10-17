import type { QueryClient } from "@tanstack/react-query";

import {
  getGetFinanceParticipantQueryKey,
  getListFinanceParticipantsQueryKey,
  type listFinanceParticipants,
} from "@/api/generated/core-console";
import { ParticipantResponse, ProblemDetails } from "@/api/generated/schemas";
import { compareLedgerNamesByBackendOrder } from "@/components/finance/ledger-name-order";

export function parseParticipant(
  data: unknown,
  ledgerId: string,
  participantId?: string,
) {
  return ParticipantResponse.refine(
    (item) =>
      item.ledgerId === ledgerId &&
      (!participantId || item.id === participantId),
  ).parse(data);
}

export async function reconcileParticipant(
  queryClient: QueryClient,
  item: ParticipantResponse,
  response: { data: unknown; headers: Headers; status: number },
) {
  const listKey = getListFinanceParticipantsQueryKey(item.ledgerId);
  const detailKey = getGetFinanceParticipantQueryKey(item.ledgerId, item.id);
  await Promise.all([
    queryClient.cancelQueries({ queryKey: listKey }),
    queryClient.cancelQueries({ queryKey: detailKey }),
  ]);
  queryClient.setQueryData(detailKey, { ...response, data: item });
  queryClient.setQueryData<Awaited<ReturnType<typeof listFinanceParticipants>>>(
    listKey,
    (current) => {
      if (!current) return current;
      const items = ParticipantResponse.array()
        .parse(current.data)
        .filter((other) => other.id !== item.id);
      items.push(item);
      items.sort(
        (a, b) =>
          Number(a.status === "archived") - Number(b.status === "archived") ||
          compareLedgerNamesByBackendOrder(a, b),
      );
      return { ...current, data: items };
    },
  );
  void queryClient.invalidateQueries({ queryKey: listKey });
}

export function participantProblem(error: unknown) {
  const result = ProblemDetails.safeParse(
    typeof error === "object" && error !== null && "info" in error
      ? error.info
      : undefined,
  );
  return result.success ? result.data : undefined;
}

export function participantError(error: unknown) {
  switch (participantProblem(error)?.code) {
    case "validation_error":
      return "Enter a Participant name of 1–100 characters.";
    case "finance_participant_not_found":
      return "This Participant is no longer available in this Ledger. Close and refresh the list.";
    case "finance_ledger_not_found":
      return "This Ledger is no longer available. Choose an available Ledger.";
    default:
      return "The change could not be confirmed. Refresh Participants to check the current record before trying again.";
  }
}
