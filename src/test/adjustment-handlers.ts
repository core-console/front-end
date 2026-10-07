import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import {
  AdjustmentSubmissionReceipt,
  type FinanceTransactionResponseOutput,
} from "@/api/generated/schemas";

// Lifecycle fixtures describe current resources; the POST returns evidence only.
export type AdjustmentFixtureResult =
  | { outcome: "created"; transaction: FinanceTransactionResponseOutput }
  | { outcome: "noChange"; transaction: null };

export function adjustmentCreateHandler(
  resolver: (
    info: Parameters<Parameters<typeof http.post>[1]>[0],
  ) => Response | Promise<Response>,
) {
  return http.post(
    "*/api/finance/ledgers/:ledgerId/balance-adjustments",
    async (info) => {
      const response = await resolver(info);
      const body = await response.clone().json();
      const identity = {
        submissionId: info.request.headers.get("Idempotency-Key")!,
        commandVersion: "1",
        operation: "createBalanceAdjustment",
        targetLedgerId: String(info.params.ledgerId),
        admittedAt: "2026-10-06T00:00:00Z",
        resolvedAt: "2026-10-06T00:00:01Z",
      };
      if (
        response.ok &&
        (body.outcome === "created" || body.outcome === "noChange")
      ) {
        if (body.outcome === "created") {
          server.use(
            http.get(
              `*/api/finance/ledgers/${identity.targetLedgerId}/transactions/${body.transaction.id}`,
              () => HttpResponse.json(body.transaction),
            ),
          );
        }
        return HttpResponse.json(
          AdjustmentSubmissionReceipt.parse({
            ...identity,
            outcome:
              body.outcome === "noChange"
                ? { kind: "noChange" }
                : {
                    kind: "created",
                    resource: { type: "transaction", id: body.transaction.id },
                  },
          }),
        );
      }
      if (
        [
          "validation_error",
          "account_balance_changed",
          "finance_account_semantics_changed",
          "finance_account_archived",
          "finance_account_not_found",
        ].includes(body.code)
      ) {
        const problem = {
          type: body.type,
          title: body.title,
          status: body.status,
          code: body.code,
          detail: body.detail ?? "The adjustment was rejected.",
        };
        return HttpResponse.json(
          {
            ...body,
            submissionReceipt: AdjustmentSubmissionReceipt.parse({
              ...identity,
              outcome: { kind: "rejected", problem },
            }),
          },
          { status: response.status },
        );
      }
      return response;
    },
  );
}
