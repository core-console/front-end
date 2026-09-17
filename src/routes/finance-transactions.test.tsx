import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import {
  getListFinanceAccountsMockHandler,
  getListFinanceCategoriesMockHandler,
  getListFinanceLedgersMockHandler,
  getListFinanceTransactionsMockHandler,
  getListFinanceTransactionsMockHandler503,
} from "@/api/generated/core-console.msw";
import type { TransactionHistoryPageResponse } from "@/api/generated/schemas";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

const ledger = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Personal",
} as const;

const teamLedger = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Team fund",
} as const;

const accountId = "22222222-2222-4222-8222-222222222222";
const categoryId = "77777777-7777-4777-8777-777777777777";

const accounts = [
  {
    currency: "USD",
    currentBalance: { amount: "20.00", currency: "USD" },
    id: accountId,
    name: "Cash",
    nature: "asset",
    openingBalance: { amount: "0.00", currency: "USD" },
    status: "active",
    trackingStartDate: "2026-01-01",
  },
  {
    currency: "CNY",
    currentBalance: { amount: "0.00", currency: "CNY" },
    id: "33333333-3333-4333-8333-333333333333",
    name: "Old wallet",
    nature: "asset",
    openingBalance: { amount: "0.00", currency: "CNY" },
    status: "archived",
    trackingStartDate: "2026-01-01",
  },
] as const;

const categories = [
  { id: categoryId, name: "Salary", status: "archived" },
] as const;

const history = {
  items: [
    {
      account: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Cash",
        status: "active",
      },
      categoryAllocations: [
        {
          amount: { amount: "9007199254740993.25", currency: "USD" },
          category: {
            id: "77777777-7777-4777-8777-777777777777",
            name: "Salary",
            status: "archived",
          },
        },
      ],
      economicAmount: {
        amount: "9007199254740993.25",
        currency: "USD",
      },
      id: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      kind: "income",
      ledgerId: ledger.id,
      note: "Annual award",
      transactionDate: "2026-08-16",
    },
    {
      account: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Old wallet",
        status: "archived",
      },
      categoryAllocations: [
        {
          amount: { amount: "35.00", currency: "CNY" },
          category: null,
        },
      ],
      economicAmount: { amount: "35.00", currency: "CNY" },
      id: "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      kind: "expense",
      ledgerId: ledger.id,
      note: null,
      transactionDate: "2026-08-16",
    },
    {
      destinationAccount: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Savings",
        status: "active",
      },
      destinationAmount: { amount: "1000.00", currency: "CNY" },
      id: "aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
      kind: "internalTransfer",
      ledgerId: ledger.id,
      note: "Move reserve",
      sourceAccount: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Old wallet",
        status: "archived",
      },
      sourceAmount: { amount: "1000.00", currency: "CNY" },
      transactionDate: "2026-08-15",
    },
    {
      account: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Cash",
        status: "active",
      },
      correctionDelta: { amount: "-27.00", currency: "CNY" },
      id: "aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
      kind: "balanceAdjustment",
      ledgerId: ledger.id,
      note: "Balance correction",
      transactionDate: "2026-08-14",
    },
  ],
  nextCursor: null,
} satisfies TransactionHistoryPageResponse;

describe("Finance Transactions destination", () => {
  it("renders all four backend projections without flattening their semantics", async () => {
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceTransactionsMockHandler(history),
    );

    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const income = await screen.findByRole(
      "article",
      { name: "Income on August 16, 2026" },
      { timeout: 5_000 },
    );
    expect(
      screen
        .getAllByRole("article")
        .map((article) => article.getAttribute("aria-label")),
    ).toEqual([
      "Income on August 16, 2026",
      "Expense on August 16, 2026",
      "Internal Transfer on August 15, 2026",
      "Balance Adjustment on August 14, 2026",
    ]);
    expect(income).toHaveTextContent("9,007,199,254,740,993.25 USD");
    expect(income).toHaveTextContent("Into Cash");
    expect(income).toHaveTextContent("Salary (archived)");
    expect(income).toHaveTextContent("Annual award");

    const expense = screen.getByRole("article", {
      name: "Expense on August 16, 2026",
    });
    expect(expense).toHaveTextContent("35.00 CNY");
    expect(expense).toHaveTextContent("From Old wallet (archived)");
    expect(expense).toHaveTextContent("Uncategorized");

    const transfer = screen.getByRole("article", {
      name: "Internal Transfer on August 15, 2026",
    });
    expect(transfer).toHaveTextContent(
      "1,000.00 CNY from Old wallet (archived)",
    );
    expect(transfer).toHaveTextContent("1,000.00 CNY to Savings");
    expect(transfer).toHaveTextContent("Move reserve");

    const adjustment = screen.getByRole("article", {
      name: "Balance Adjustment on August 14, 2026",
    });
    expect(adjustment).toHaveTextContent("Correction -27.00 CNY");
    expect(adjustment).toHaveTextContent("Adjusts Cash");
    expect(adjustment).not.toHaveTextContent(/target balance/i);

    for (const transaction of [income, expense, transfer, adjustment]) {
      expect(
        within(transaction).getByRole("button", { name: /view details/i }),
      ).toBeDisabled();
      expect(
        within(transaction).getByRole("button", { name: /^edit/i }),
      ).toBeDisabled();
      expect(
        within(transaction).getByRole("button", { name: /^delete/i }),
      ).toBeDisabled();
    }
  });

  it("keeps edits local until Apply and makes Category and Uncategorized exclusive", async () => {
    const user = userEvent.setup();
    const requestUrls: URL[] = [];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([...accounts]),
      getListFinanceCategoriesMockHandler([...categories]),
      getListFinanceTransactionsMockHandler(({ request }) => {
        requestUrls.push(new URL(request.url));
        return { items: [], nextCursor: null };
      }),
    );
    const { router } = renderRoute(
      `/finance/transactions?ledger=${ledger.id}&from=2026-08-01&to=2026-08-31&kind=expense&account_id=${accountId}&uncategorized=true`,
    );

    await screen.findByRole(
      "heading",
      { name: "No matching transactions" },
      { timeout: 5_000 },
    );
    expect(requestUrls).toHaveLength(1);
    expect(Object.fromEntries(requestUrls[0]!.searchParams)).toEqual({
      accountId,
      fromDate: "2026-08-01",
      kind: "expense",
      pageSize: "50",
      toDate: "2026-08-31",
      uncategorized: "true",
    });
    expect(screen.getByText(/Applied filters:/)).toHaveTextContent(
      "From 2026-08-01 · To 2026-08-31 · Account Cash · Expense · Uncategorized",
    );

    const category = screen.getByRole("combobox", { name: "Category" });
    expect(
      within(category).getByRole("option", {
        name: "Salary (archived)",
      }),
    ).toBeInTheDocument();
    await user.selectOptions(category, `category:${categoryId}`);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Transaction kind" }),
      "income",
    );

    expect(requestUrls).toHaveLength(1);
    expect(router.state.location.search).toContain("uncategorized=true");
    expect(router.state.location.search).not.toContain("category_id");

    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => expect(requestUrls).toHaveLength(2));
    expect(router.state.location.search).toContain(`category_id=${categoryId}`);
    expect(router.state.location.search).toContain("kind=income");
    expect(router.state.location.search).not.toContain("uncategorized");
    expect(Object.fromEntries(requestUrls[1]!.searchParams)).toEqual({
      accountId,
      categoryId,
      fromDate: "2026-08-01",
      kind: "income",
      pageSize: "50",
      toDate: "2026-08-31",
    });

    await user.click(
      within(
        screen.getByRole("form", { name: "Transaction filters" }),
      ).getByRole("button", { name: "Clear filters" }),
    );
    await waitFor(() => expect(requestUrls).toHaveLength(3));
    expect(router.state.location.search).toBe(`?ledger=${ledger.id}`);
    expect(Object.fromEntries(requestUrls[2]!.searchParams)).toEqual({
      pageSize: "50",
    });
  });

  it("blocks a reversed draft date range without changing results or URL", async () => {
    const user = userEvent.setup();
    let requests = 0;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceTransactionsMockHandler(() => {
        requests += 1;
        return history;
      }),
    );
    const { router } = renderRoute(`/finance/transactions?ledger=${ledger.id}`);
    await screen.findByRole(
      "article",
      { name: "Income on August 16, 2026" },
      { timeout: 5_000 },
    );

    await user.type(screen.getByLabelText("From date"), "2026-09-01");
    await user.type(screen.getByLabelText("To date"), "2026-08-01");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "From date must be on or before To date.",
    );
    expect(requests).toBe(1);
    expect(router.state.location.search).toBe(`?ledger=${ledger.id}`);
  });

  it("normalizes malformed addressed filters before making a request", async () => {
    const requestUrls: URL[] = [];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceTransactionsMockHandler(({ request }) => {
        requestUrls.push(new URL(request.url));
        return { items: [], nextCursor: null };
      }),
    );
    const { router } = renderRoute(
      `/finance/transactions?ledger=${ledger.id}&from=2026-09-01&to=2026-08-01&kind=not-a-kind&account_id=not-an-account&category_id=${categoryId}&uncategorized=true&cursor=client-cursor`,
    );

    await screen.findByRole(
      "heading",
      { name: "No matching transactions" },
      { timeout: 5_000 },
    );

    expect(requestUrls).toHaveLength(1);
    expect(Object.fromEntries(requestUrls[0]!.searchParams)).toEqual({
      pageSize: "50",
      uncategorized: "true",
    });
    expect(router.state.location.search).toBe(
      `?ledger=${ledger.id}&uncategorized=true`,
    );
    expect(screen.getByLabelText("From date")).toHaveValue("");
    expect(screen.getByLabelText("To date")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue(
      "uncategorized",
    );
  });

  it("starts a separate Ledger result set while preserving only portable filters", async () => {
    const user = userEvent.setup();
    const requests: Array<{ ledgerId: string; search: string }> = [];
    server.use(
      getListFinanceLedgersMockHandler([ledger, teamLedger]),
      getListFinanceAccountsMockHandler([]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceTransactionsMockHandler(({ request, params }) => {
        requests.push({
          ledgerId: String(params.ledgerId),
          search: new URL(request.url).search,
        });
        return { items: [], nextCursor: null };
      }),
    );
    const { router } = renderRoute(
      `/finance/transactions?ledger=${ledger.id}&month=2026-08&date=2026-08-16&from=2026-08-01&kind=expense&uncategorized=true&account_id=${accountId}`,
    );

    await screen.findByRole(
      "heading",
      { name: "No matching transactions" },
      { timeout: 5_000 },
    );
    await user.click(screen.getByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Team fund" }),
    );

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]!.ledgerId).toBe(ledger.id);
    expect(requests[0]!.search).toContain(`accountId=${accountId}`);
    expect(requests[1]).toEqual({
      ledgerId: teamLedger.id,
      search:
        "?fromDate=2026-08-01&kind=expense&uncategorized=true&pageSize=50",
    });
    expect(router.state.location.search).toBe(
      `?ledger=${teamLedger.id}&month=2026-08&date=2026-08-16&from=2026-08-01&kind=expense&uncategorized=true`,
    );
  });

  it("contains an initial failure and retries only the history region", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceTransactionsMockHandler503({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        code: "database_unavailable",
        detail: "postgres.internal.example refused the connection",
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const error = await screen.findByRole("alert", undefined, {
      timeout: 5_000,
    });
    expect(error).toHaveTextContent("Transactions could not be loaded");
    expect(error).not.toHaveTextContent(/postgres\.internal/i);
    expect(
      screen.getByRole("form", { name: "Transaction filters" }),
    ).toBeVisible();

    server.use(getListFinanceTransactionsMockHandler(history));
    await user.click(within(error).getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("article", {
        name: "Income on August 16, 2026",
      }),
    ).toBeVisible();
  });

  it("keeps filters visible during initial loading and distinguishes an empty Ledger", async () => {
    let releaseHistory!: () => void;
    const historyPending = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceTransactionsMockHandler(async () => {
        await historyPending;
        return { items: [], nextCursor: null };
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    expect(
      await screen.findByRole("form", { name: "Transaction filters" }),
    ).toBeVisible();
    expect(
      screen.getByRole("status", { name: "Loading Transactions" }),
    ).toBeVisible();

    releaseHistory();
    expect(
      await screen.findByRole("heading", { name: "No transactions yet" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Record transaction" }),
    ).toSatisfy((buttons: HTMLElement[]) =>
      buttons.every((button) => button.hasAttribute("disabled")),
    );
  });

  it("loads the opaque next cursor once, appends in order, and announces unique additions", async () => {
    const user = userEvent.setup();
    const requestedCursors: Array<string | null> = [];
    let releaseNextPage!: () => void;
    const nextPagePending = new Promise<void>((resolve) => {
      releaseNextPage = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceTransactionsMockHandler(async ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        requestedCursors.push(cursor);
        if (cursor === null) {
          return {
            items: [history.items[0]!],
            nextCursor: "opaque.cursor/value",
          };
        }
        await nextPagePending;
        return {
          items: [history.items[0]!, history.items[3]!],
          nextCursor: null,
        };
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const income = await screen.findByRole(
      "article",
      { name: "Income on August 16, 2026" },
      { timeout: 5_000 },
    );
    const loadMore = screen.getByRole("button", { name: "Load more" });
    await user.click(loadMore);

    expect(requestedCursors).toEqual([null, "opaque.cursor/value"]);
    expect(income).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Loading more…" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Loading more…" }));
    expect(requestedCursors).toHaveLength(2);

    releaseNextPage();
    expect(
      await screen.findByRole("article", {
        name: "Balance Adjustment on August 14, 2026",
      }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("article", {
        name: "Income on August 16, 2026",
      }),
    ).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 more transaction loaded.",
    );
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
    expect(requestedCursors).toEqual([null, "opaque.cursor/value"]);
  });

  it("contains a failed next page and retries the same opaque cursor", async () => {
    const user = userEvent.setup();
    const cursors: Array<string | null> = [];
    let failNextPage = true;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([]),
      getListFinanceCategoriesMockHandler([]),
      http.get(
        "*/api/finance/ledgers/:ledgerId/transactions",
        ({ request }) => {
          const cursor = new URL(request.url).searchParams.get("cursor");
          cursors.push(cursor);
          if (cursor === null) {
            return HttpResponse.json({
              items: [history.items[0]!],
              nextCursor: "still.opaque",
            });
          }
          if (failNextPage) {
            return HttpResponse.json(
              {
                type: "about:blank",
                title: "Service Unavailable",
                status: 503,
                code: "database_unavailable",
                detail: "private database detail",
              },
              { status: 503 },
            );
          }
          return HttpResponse.json({
            items: [history.items[3]!],
            nextCursor: null,
          });
        },
      ),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    await screen.findByRole(
      "article",
      { name: "Income on August 16, 2026" },
      { timeout: 5_000 },
    );
    await user.click(screen.getByRole("button", { name: "Load more" }));

    const paginationError = await screen.findByRole("alert");
    expect(paginationError).toHaveTextContent(
      "More transactions could not be loaded",
    );
    expect(paginationError).not.toHaveTextContent(/private database detail/i);
    expect(
      screen.getByRole("article", {
        name: "Income on August 16, 2026",
      }),
    ).toBeVisible();
    expect(cursors).toEqual([null, "still.opaque"]);

    failNextPage = false;
    await user.click(
      within(paginationError).getByRole("button", {
        name: "Retry loading more",
      }),
    );
    expect(
      await screen.findByRole("article", {
        name: "Balance Adjustment on August 14, 2026",
      }),
    ).toBeVisible();
    expect(cursors).toEqual([null, "still.opaque", "still.opaque"]);
  });
});
