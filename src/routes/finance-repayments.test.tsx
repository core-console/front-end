import { screen, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import {
  getGetCurrentUserMockHandler,
  getListFinanceLedgersMockHandler,
  getListFinanceAccountsMockHandler,
  getListFinanceParticipantsMockHandler,
  getListFinanceCurrenciesMockHandler,
} from "@/api/generated/core-console.msw";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import { submissionTestUser } from "@/test/submission-fixtures";
import { getListFinanceAccountsQueryKey } from "@/api/generated/core-console";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as account,
} from "@/test/advance-fixtures";
import {
  repaymentPreview as preview,
  settlement,
  settlementReceipt,
  outstandingObligations,
  repaidObligations,
  money,
} from "@/test/settlement-fixtures";

beforeEach(() =>
  server.use(
    getGetCurrentUserMockHandler(submissionTestUser),
    getListFinanceLedgersMockHandler([ledger]),
    getListFinanceAccountsMockHandler([account]),
    getListFinanceParticipantsMockHandler([{ ...person, status: "archived" }]),
    getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () => HttpResponse.json(outstandingObligations),
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/settlements",
      () => HttpResponse.json([]),
    ),
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json(settlement),
    ),
  ),
);
async function draft(amount = "50") {
  const user = userEvent.setup();
  const record = await screen.findByRole(
    "button",
    { name: "Record repayment" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(record).toBeEnabled());
  await user.click(record);
  const dialog = screen.getByRole("dialog", { name: "Record repayment" });
  await user.selectOptions(
    within(dialog).getByLabelText("Participant"),
    person.id,
  );
  await user.selectOptions(
    within(dialog).getByLabelText("Receiving Account"),
    account.id,
  );
  await user.type(within(dialog).getByLabelText("Amount"), amount);
  await user.clear(within(dialog).getByLabelText("Date"));
  await user.type(within(dialog).getByLabelText("Date"), "2027-01-02");
  await user.type(within(dialog).getByLabelText("Note"), "Cash repayment");
  return { user, dialog };
}
it("previews and confirms 40 plus 10 with retained Allocations and separate current debt for an archived Participant", async () => {
  let confirmed = false;
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        expect(await request.json()).toEqual({
          participantId: person.id,
          receivingAccountId: account.id,
          transactionDate: "2027-01-02",
          amount: { amount: "50", currency: "CNY" },
          note: "Cash repayment",
        });
        return HttpResponse.json(preview);
      },
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        confirmed = true;
        expect(request.headers.get("Finance-Command-Version")).toBe("1");
        expect(request.headers.get("Finance-Submission-Owner")).toBe(
          submissionTestUser.id,
        );
        expect(await request.json()).toMatchObject({
          previewToken: preview.previewToken,
        });
        return HttpResponse.json(
          settlementReceipt(request.headers.get("Idempotency-Key")!),
          { status: 201 },
        );
      },
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () =>
        HttpResponse.json(
          confirmed ? repaidObligations : outstandingObligations,
        ),
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/settlements",
      () => HttpResponse.json(confirmed ? [settlement] : []),
    ),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Repayment preview",
  });
  const rows = within(review).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("40.00 CNY");
  expect(rows[2]).toHaveTextContent("10.00 CNY");
  expect(rows[2]).toHaveTextContent("50.00 CNY");
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm repayment" }),
  );
  const source = await screen.findByRole("region", {
    name: "Confirmed Settlement",
  });
  expect(await within(source).findByText(/Cash repayment/)).toBeVisible();
  expect(
    within(source).getByRole("table", { name: "Confirmed Allocations" }),
  ).toHaveTextContent("10.00 CNY");
  expect(
    await screen.findByRole("table", {
      name: "Participant receivable composition",
    }),
  ).toHaveTextContent("50.00 CNY");
});

it("requires a refreshed preview and a deliberate new action after correlated stale rejection", async () => {
  let previews = 0;
  const posts: { key: string; body: unknown }[] = [];
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json({
        ...preview,
        previewToken: (++previews === 1 ? "a" : "b").repeat(64),
        outstandingBefore: money(previews === 1 ? "100.00" : "80.00"),
        outstandingAfter: money(previews === 1 ? "50.00" : "30.00"),
      }),
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        const key = request.headers.get("Idempotency-Key")!;
        posts.push({ key, body: await request.json() });
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
      },
    ),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Confirm repayment" }),
  );
  await within(dialog).findByRole("button", { name: "Refresh preview" });
  expect(
    within(dialog).queryByRole("button", { name: "Confirm repayment" }),
  ).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText("Amount")).toHaveValue("50");
  expect(within(dialog).getByLabelText("Participant")).toHaveFocus();
  expect(previews).toBe(1);
  expect(posts).toHaveLength(1);
  await user.click(
    within(dialog).getByRole("button", { name: "Refresh preview" }),
  );
  expect(await within(dialog).findByText("30.00 CNY")).toBeVisible();
  expect(posts).toHaveLength(1);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm repayment" }),
  );
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[0]!.key).not.toBe(posts[1]!.key);
  expect(
    posts.map((item) => (item.body as { previewToken: string }).previewToken),
  ).toEqual(["a".repeat(64), "b".repeat(64)]);
});

it.each(["missing", "busy", "wrong receipt"])(
  "keeps an uncertain command immutable across navigation and %s lookup, then retries the original key",
  async (mode) => {
    const posts: { key: string; body: unknown }[] = [];
    server.use(
      http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
        HttpResponse.json(preview),
      ),
      http.post(
        "*/api/finance/ledgers/:ledger/settlements",
        async ({ request }) => {
          const key = request.headers.get("Idempotency-Key")!;
          posts.push({ key, body: await request.json() });
          return posts.length === 1
            ? HttpResponse.error()
            : HttpResponse.json(settlementReceipt(key), { status: 201 });
        },
      ),
      http.get("*/api/finance/submissions/:id", ({ params }) =>
        mode === "wrong receipt"
          ? HttpResponse.json({
              state: "terminal",
              receipt: {
                ...settlementReceipt(String(params.id)),
                targetLedgerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              },
            })
          : HttpResponse.json(
              {
                type: "about:blank",
                title: "Unavailable",
                status: mode === "missing" ? 404 : 409,
                code:
                  mode === "missing" ? "not_found" : "finance_submission_busy",
              },
              { status: mode === "missing" ? 404 : 409 },
            ),
      ),
      http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
        HttpResponse.json(
          { type: "about:blank", title: "Unavailable", status: 503 },
          { status: 503 },
        ),
      ),
    );
    const { router } = renderRoute(`/finance/repayments?ledger=${ledger.id}`);
    const { user, dialog } = await draft();
    await user.click(
      within(dialog).getByRole("button", { name: "Preview repayment" }),
    );
    await user.click(
      await within(dialog).findByRole("button", { name: "Confirm repayment" }),
    );
    expect(await within(dialog).findByText(/outcome is unknown/)).toBeVisible();
    expect(within(dialog).getByLabelText("Amount")).toBeDisabled();
    await user.click(
      within(dialog).getByRole("button", { name: "Close to recovery" }),
    );
    await act(() => router.navigate("/"));
    await act(() => router.navigate(`/finance/repayments?ledger=${ledger.id}`));
    expect(
      await screen.findByRole("button", { name: "Record repayment" }),
    ).toBeDisabled();
    expect(posts).toHaveLength(1);
    await user.click(
      await screen.findByRole("button", { name: "Retry original submission" }),
    );
    await screen.findByRole("status", { name: /Settlement created:/ });
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(
      screen.queryByRole("button", { name: "Retry original submission" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Settlement" }),
    ).toHaveAttribute(
      "href",
      `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}&settlement_id=${settlement.id}`,
    );
  },
);

it("blocks dispatch if durable browser preparation fails", async () => {
  let posts = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(preview),
    ),
    http.post("*/api/finance/ledgers/:ledger/settlements", () => {
      posts++;
      return HttpResponse.error();
    }),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  const confirm = await within(dialog).findByRole("button", {
    name: "Confirm repayment",
  });
  const storage = vi.spyOn(indexedDB, "open").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  try {
    await user.click(confirm);
    expect(
      await within(dialog).findByText(/Browser preparation failed/),
    ).toBeVisible();
    expect(posts).toBe(0);
  } finally {
    storage.mockRestore();
  }
});

it.each(["0", "-1", "98.000", "1e2", "0.001"])(
  "rejects invalid Money %s without rounding or previewing",
  async (amount) => {
    let previews = 0;
    server.use(
      http.post("*/api/finance/ledgers/:ledger/settlements/preview", () => {
        previews++;
        return HttpResponse.json(preview);
      }),
    );
    renderRoute(`/finance/repayments?ledger=${ledger.id}`);
    const { user, dialog } = await draft(amount);
    await user.click(
      within(dialog).getByRole("button", { name: "Preview repayment" }),
    );
    expect(within(dialog).getByLabelText("Amount")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(within(dialog).getByLabelText("Amount")).toHaveFocus();
    expect(within(dialog).getByLabelText("Amount")).toHaveValue(amount);
    expect(previews).toBe(0);
  },
);

it("shows 98 paid and 2 still owed, preserving the historical result after later backdated debt", async () => {
  const original = {
    ...settlement,
    amount: money("98.00"),
    allocations: [
      {
        ...preview.allocations[0]!,
        cashPaid: money("98.00"),
        remainingAfter: money("2.00"),
      },
    ],
  };
  server.use(
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json(original),
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/settlements",
      () => HttpResponse.json([original]),
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () =>
        HttpResponse.json([
          {
            ...outstandingObligations[0]!,
            principal: money("100.00"),
            cashPaid: money("98.00"),
            remaining: money("2.00"),
          },
          { ...outstandingObligations[1]!, sourceDate: "2025-01-01" },
        ]),
    ),
  );
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}&settlement_id=${settlement.id}`,
  );
  const source = await screen.findByRole("region", {
    name: "Confirmed Settlement",
  });
  expect((await within(source).findAllByText("98.00 CNY"))[0]).toBeVisible();
  expect(within(source).getByRole("table")).toHaveTextContent("2.00 CNY");
  expect(within(source).queryByText("2025-01-01")).not.toBeInTheDocument();
  expect(
    await screen.findByRole("table", {
      name: "Participant receivable composition",
    }),
  ).toHaveTextContent("2025-01-01");
});

it("invalidates confirmation on edit and refuses unavailable or excessive preview debt without dispatch", async () => {
  let previews = 0;
  let posts = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      ++previews === 1
        ? HttpResponse.json(preview)
        : HttpResponse.json(
            {
              type: "about:blank",
              title: "Conflict",
              status: 409,
              code: "finance_settlement_exceeds_debt",
            },
            { status: 409 },
          ),
    ),
    http.post("*/api/finance/ledgers/:ledger/settlements", () => {
      posts++;
      return HttpResponse.error();
    }),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  await within(dialog).findByRole("button", { name: "Confirm repayment" });
  await user.type(within(dialog).getByLabelText("Amount"), "0");
  expect(
    within(dialog).queryByRole("button", { name: "Confirm repayment" }),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  expect(
    await within(dialog).findByText(/Preview could not be loaded/),
  ).toBeVisible();
  expect(posts).toBe(0);
});

it("keeps server same-date tie order across refreshed previews and sends the receiving currency", async () => {
  const usd = {
    ...account,
    currency: "USD" as const,
    openingBalance: { amount: "100.00", currency: "USD" as const },
    currentBalance: { amount: "100.00", currency: "USD" as const },
  };
  const allocations = [...preview.allocations].reverse().map((item, index) => ({
    ...item,
    position: index + 1,
    sourceDate: "2026-02-01",
    cashPaid: { amount: index === 0 ? "40.00" : "10.00", currency: "USD" },
    remainingAfter: { amount: index === 0 ? "0.00" : "50.00", currency: "USD" },
  }));
  let requests = 0;
  server.use(
    getListFinanceAccountsMockHandler([usd]),
    getListFinanceCurrenciesMockHandler([{ code: "USD", minorUnit: 2 }]),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        requests++;
        expect(await request.json()).toMatchObject({
          amount: { amount: "50", currency: "USD" },
          transactionDate: "2027-01-02",
        });
        return HttpResponse.json({
          ...preview,
          allocations,
          amount: { amount: "50.00", currency: "USD" },
          receivingBalance: { amount: "100.00", currency: "USD" },
          receivingBalanceAfter: { amount: "150.00", currency: "USD" },
          outstandingBefore: { amount: "100.00", currency: "USD" },
          outstandingAfter: { amount: "50.00", currency: "USD" },
        });
      },
    ),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  for (let index = 0; index < 2; index++) {
    await user.click(
      within(dialog).getByRole("button", { name: "Preview repayment" }),
    );
    const table = await within(dialog).findByRole("table", {
      name: "Proposed Allocations",
    });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent(allocations[0]!.obligationId);
    expect(rows[2]).toHaveTextContent(allocations[1]!.obligationId);
  }
  expect(requests).toBe(2);
});

it("rejects a receipt date before tracking and discards reviewed drafts without dispatch", async () => {
  let posts = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(preview),
    ),
    http.post("*/api/finance/ledgers/:ledger/settlements", () => {
      posts++;
      return HttpResponse.error();
    }),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  const date = within(dialog).getByLabelText("Date");
  await user.clear(date);
  await user.type(date, "2025-12-31");
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  expect(date).toHaveFocus();
  expect(date).toHaveAttribute("aria-invalid", "true");
  await user.clear(date);
  await user.type(date, "2027-01-02");
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  await within(dialog).findByRole("button", { name: "Confirm repayment" });
  await user.click(
    within(dialog).getByRole("button", { name: "Discard draft" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(posts).toBe(0);
});

it("does not request malformed addressed identities or accept a foreign Settlement source", async () => {
  let reads = 0;
  server.use(
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () => {
      reads++;
      return HttpResponse.json({
        ...settlement,
        ledgerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      });
    }),
  );
  const { router } = renderRoute(
    `/finance/repayments?ledger=${ledger.id}&settlement_id=invalid`,
  );
  expect(
    await screen.findByText(
      /The addressed Participant or Settlement is unavailable/,
    ),
  ).toBeVisible();
  expect(reads).toBe(0);
  await act(() =>
    router.navigate(
      `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}&settlement_id=${settlement.id}`,
    ),
  );
  expect(
    await screen.findByText(/Settlement source is unavailable/),
  ).toBeVisible();
  expect(
    screen.queryByRole("table", { name: "Confirmed Allocations" }),
  ).not.toBeInTheDocument();
});

it("never restores a rejected preview when refreshed receiving eligibility fails local validation", async () => {
  let previews = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () => {
      previews++;
      return HttpResponse.json(preview);
    }),
    http.post("*/api/finance/ledgers/:ledger/settlements", ({ request }) => {
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
            ...settlementReceipt(request.headers.get("Idempotency-Key")!),
            outcome: { kind: "rejected", problem },
          },
        },
        { status: 409 },
      );
    }),
  );
  const { queryClient } = renderRoute(
    `/finance/repayments?ledger=${ledger.id}`,
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Confirm repayment" }),
  );
  await within(dialog).findByRole("button", { name: "Refresh preview" });
  server.use(
    getListFinanceAccountsMockHandler([{ ...account, status: "archived" }]),
  );
  // Model a server-state refetch while the owner leaves their rejected draft untouched.
  await act(() =>
    queryClient.refetchQueries({
      queryKey: getListFinanceAccountsQueryKey(ledger.id),
    }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByRole("option", { name: /Checking/ }),
    ).not.toBeInTheDocument(),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Refresh preview" }),
  );
  expect(within(dialog).getByLabelText("Receiving Account")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(
    within(dialog).queryByRole("button", { name: "Confirm repayment" }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("region", { name: "Repayment preview" }),
  ).not.toBeInTheDocument();
  expect(previews).toBe(1);
});
