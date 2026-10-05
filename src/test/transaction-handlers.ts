import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import {
  createdTransactionReceipt,
  rejectedTransactionReceipt,
} from "./submission-fixtures";

// Existing lifecycle scenarios keep their current-resource fixtures. Model the
// cumulative producer explicitly: POST evidence and a separate resource read.
export function transactionCreateHandler(
  resolver: (
    info: Parameters<Parameters<typeof http.post>[1]>[0],
  ) => Response | Promise<Response>,
) {
  return http.post(
    "*/api/finance/ledgers/:ledgerId/transactions",
    async (info) => {
      const response = await resolver(info);
      if (!response) return response;
      const body = await response.clone().json();
      const key = info.request.headers.get("Idempotency-Key")!;
      const ledgerId = String(info.params.ledgerId);
      if (response.status === 201 && body.id) {
        server.use(
          http.get(
            `*/api/finance/ledgers/${ledgerId}/transactions/${body.id}`,
            () => HttpResponse.json(body),
          ),
        );
        return HttpResponse.json(
          createdTransactionReceipt(key, ledgerId, body.id),
          { status: 201 },
        );
      }
      if (
        [
          "validation_error",
          "finance_account_archived",
          "finance_category_archived",
          "finance_account_not_found",
          "finance_category_not_found",
        ].includes(body.code)
      ) {
        const problem = {
          type: body.type,
          title: body.title,
          status: body.status,
          code: body.code,
          detail: body.detail ?? "The Transaction command was rejected.",
        };
        return HttpResponse.json(
          {
            ...body,
            submissionReceipt: rejectedTransactionReceipt(
              key,
              ledgerId,
              problem,
            ),
          },
          { status: response.status },
        );
      }
      return response;
    },
  );
}
