import { z } from "zod";
import {
  AdvanceResponse,
  SharedAdvanceResponse,
} from "@/api/generated/schemas";

export type AdvanceSource = AdvanceResponse | SharedAdvanceResponse;

export function advanceObligations(source: AdvanceSource) {
  return "obligations" in source ? source.obligations : [source.obligation];
}

export function parseAdvanceSource(
  data: unknown,
  ledgerId: string,
  advanceId: string,
) {
  return z
    .union([AdvanceResponse, SharedAdvanceResponse])
    .refine(
      (item) =>
        item.id === advanceId &&
        item.ledgerId === ledgerId &&
        advanceObligations(item).every(
          (obligation) =>
            obligation.ledgerId === ledgerId &&
            obligation.advanceId === advanceId,
        ),
    )
    .parse(data);
}
