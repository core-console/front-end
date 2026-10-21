import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";

import { getGetCurrentUserMockHandler } from "@/api/generated/core-console.msw";
import { server } from "@/mocks/server";
import { createTestQueryClient } from "@/test/render";
import {
  advanceLedger,
  advanceParticipant,
  advanceFunding,
} from "@/test/advance-fixtures";
import { settlementReceipt, settlement } from "@/test/settlement-fixtures";
import { submissionTestUser } from "@/test/submission-fixtures";
import { FinanceSubmissionsProvider } from "./finance-submissions";
import {
  useFinanceSubmissions,
  type SubmitResult,
} from "./finance-submission-context";

it("does not look up a live confirmation while recovering stale rejection or its reconfirmation", async () => {
  let response = Promise.resolve();
  let release = () => {};
  const posts: { key: string; body: unknown }[] = [];
  const lookups: string[] = [];
  server.use(
    getGetCurrentUserMockHandler(submissionTestUser),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        const key = request.headers.get("Idempotency-Key")!;
        posts.push({ key, body: await request.json() });
        await response;
        if (posts.length === 1) {
          const problem = {
            type: "about:blank",
            title: "Conflict",
            status: 409,
            code: "finance_settlement_preview_stale",
            detail: "Preview changed.",
          };
          return HttpResponse.json(
            {
              ...problem,
              submissionReceipt: {
                ...settlementReceipt(key),
                outcome: { kind: "rejected", problem },
              },
            },
            { status: 409 },
          );
        }
        return HttpResponse.json(settlementReceipt(key), { status: 201 });
      },
    ),
    http.get("*/api/finance/submissions/:id", ({ params }) => {
      lookups.push(String(params.id));
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Not Found",
          status: 404,
          code: "finance_submission_not_found",
        },
        { status: 404 },
      );
    }),
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json(settlement),
    ),
  );
  const queryClient = createTestQueryClient();
  const { result } = renderHook(useFinanceSubmissions, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <FinanceSubmissionsProvider>{children}</FinanceSubmissionsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.recoveryLoaded).toBe(true));

  for (const token of ["a", "b"]) {
    response = new Promise<void>((resolve) => {
      release = resolve;
    });
    let submission!: Promise<SubmitResult>;
    let preparationRecovery: Promise<void> | undefined;
    act(() => {
      submission = result.current.submit(
        {
          operation: "createFinanceSettlement",
          workflow: "settlement",
          targetLedgerId: advanceLedger.id,
          body: {
            participantId: advanceParticipant.id,
            receivingAccountId: advanceFunding.id,
            transactionDate: "2027-01-02",
            amount: { amount: "50", currency: "CNY" },
            previewToken: token.repeat(64),
            note: "Cash repayment",
          },
        },
        () => {
          preparationRecovery = result.current.recover();
        },
      );
    });
    try {
      await waitFor(() => expect(posts).toHaveLength(token === "a" ? 1 : 2));
      // Complete the recovery pass while admission/confirmation is still held.
      await act(async () => {
        await preparationRecovery;
      });
      await act(() => result.current.recover());
      expect(lookups).toEqual([]);
    } finally {
      release();
      await act(async () => {
        await submission;
      });
    }
    await act(() => result.current.recover());
    expect(lookups).toEqual([]);
    expect((await submission).record).toMatchObject({
      state: "resolved",
      resolution: {
        kind: "receipt",
        receipt: { outcome: { kind: token === "a" ? "rejected" : "created" } },
      },
    });
  }
  expect(posts[0]!.key).not.toBe(posts[1]!.key);
});
