import { transactionCreateHandler } from "@/test/transaction-handlers";
import { submissionTestUser } from "@/test/submission-fixtures";
import { getGetCurrentUserMockHandler } from "@/api/generated/core-console.msw";
import { screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getGetFinanceOverviewMockHandler503,
  getGetFinanceOverviewMockHandler,
  getGetFinanceTransactionMockHandler,
  getListFinanceLedgersMockHandler,
  getListFinanceTransactionsMockHandler,
  getListFinanceTransactionsMockHandler503,
  getListFinanceAccountsMockHandler,
  getListFinanceAccountsMockHandler503,
  getListFinanceCategoriesMockHandler,
  getListFinanceCurrenciesMockHandler,
} from "@/api/generated/core-console.msw";
import {
  getGetFinanceOverviewQueryKey,
  getListFinanceAccountsQueryKey,
  getListFinanceCategoriesQueryKey,
  getListFinanceTransactionsQueryKey,
} from "@/api/generated/core-console";
import {
  type FinanceOverviewResponse,
  type BalanceAdjustmentResultResponse,
  type BalanceAdjustmentContextResponse,
  type TransactionHistoryPageResponse,
} from "@/api/generated/schemas";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

beforeEach(() => server.use(getGetCurrentUserMockHandler(submissionTestUser)));

const ledger = {
  id: "a40a626a-99f1-4e81-940b-66f9e0d45c90",
  name: "Personal",
};

const overview: FinanceOverviewResponse = {
  accounts: [
    {
      currency: "CNY",
      currentBalance: { amount: "123456789012345.67", currency: "CNY" },
      id: "11111111-1111-4111-8111-111111111111",
      name: "Savings",
      nature: "asset",
      openingBalance: { amount: "0.00", currency: "CNY" },
      status: "archived",
      trackingStartDate: "2025-01-01",
    },
  ],
  days: [
    {
      activityByCurrency: [
        {
          currency: "CNY",
          expense: { amount: "0.00", currency: "CNY" },
          income: { amount: "0.00", currency: "CNY" },
          net: { amount: "0.00", currency: "CNY" },
          transactionCount: 1,
        },
      ],
      date: "2026-08-16",
      transactionCount: 1,
      transactionCountByKind: {
        balanceAdjustment: 0,
        expense: 0,
        income: 0,
        internalTransfer: 1,
      },
    },
  ],
  financialPositionByCurrency: [
    {
      assetTotal: { amount: "123456789012345.67", currency: "CNY" },
      currency: "CNY",
      liabilityTotal: { amount: "245.00", currency: "CNY" },
      netPosition: { amount: "123456789012100.67", currency: "CNY" },
    },
    {
      assetTotal: { amount: "1.00", currency: "USD" },
      currency: "USD",
      liabilityTotal: { amount: "0.00", currency: "USD" },
      netPosition: { amount: "1.00", currency: "USD" },
    },
  ],
  ledger,
  month: "2026-08",
  monthSummaryByCurrency: [
    {
      currency: "CNY",
      expense: { amount: "40.00", currency: "CNY" },
      income: { amount: "100.00", currency: "CNY" },
      net: { amount: "60.00", currency: "CNY" },
    },
    {
      currency: "USD",
      expense: { amount: "0.00", currency: "USD" },
      income: { amount: "0.00", currency: "USD" },
      net: { amount: "0.00", currency: "USD" },
    },
  ],
};

const dayTransactions = [
  {
    account: {
      id: overview.accounts[0]!.id,
      name: "Savings",
      status: "archived",
    },
    categoryAllocations: [
      {
        amount: { amount: "9007199254740993.25", currency: "CNY" },
        category: {
          id: "77777777-7777-4777-8777-777777777777",
          name: "Food",
          status: "archived",
        },
      },
    ],
    economicAmount: { amount: "9007199254740993.25", currency: "CNY" },
    id: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    kind: "income",
    ledgerId: ledger.id,
    note: "Award",
    transactionDate: "2026-08-16",
  },
  {
    account: {
      id: overview.accounts[0]!.id,
      name: "Savings",
      status: "archived",
    },
    categoryAllocations: [
      { amount: { amount: "35.00", currency: "CNY" }, category: null },
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
      name: "Cash",
      status: "active",
    },
    destinationAmount: { amount: "1000.00", currency: "CNY" },
    id: "aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    kind: "internalTransfer",
    ledgerId: ledger.id,
    note: "Reserve",
    sourceAccount: {
      id: overview.accounts[0]!.id,
      name: "Savings",
      status: "archived",
    },
    sourceAmount: { amount: "1000.00", currency: "CNY" },
    transactionDate: "2026-08-16",
  },
  {
    account: {
      id: overview.accounts[0]!.id,
      name: "Savings",
      status: "archived",
    },
    correctionDelta: { amount: "-27.00", currency: "CNY" },
    id: "aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
    kind: "balanceAdjustment",
    ledgerId: ledger.id,
    note: "Correction",
    transactionDate: "2026-08-16",
  },
] as const satisfies TransactionHistoryPageResponse["items"];

describe("Finance Overview", () => {
  beforeEach(() => {
    localStorage.clear();
    server.use(getListFinanceLedgersMockHandler([ledger]));
  });

  it("shows exact present position separately from selected-month activity and every Account", async () => {
    server.use(getGetFinanceOverviewMockHandler(overview));
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Overview" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("button", { name: ledger.name }),
    ).toBeVisible();
    const position = await screen.findByRole("region", {
      name: "Current financial position",
    });
    expect(
      within(position).getByText("123,456,789,012,345.67 CNY"),
    ).toBeVisible();
    expect(within(position).getByText("245.00 CNY")).toBeVisible();
    expect(within(position).getAllByText("1.00 USD")).toHaveLength(2);

    const month = screen.getByRole("region", {
      name: "Selected-month activity",
    });
    expect(within(month).getByText("100.00 CNY")).toBeVisible();
    expect(within(month).getAllByText("0.00 USD")).toHaveLength(3);

    const accounts = screen.getByRole("region", { name: "Account summary" });
    expect(within(accounts).getByText("Savings")).toBeVisible();
    expect(within(accounts).getByText("Archived")).toBeVisible();
  });

  it("shows selected-day activity and moves an empty day's action to Quick Entry", async () => {
    const user = userEvent.setup();
    server.use(
      getGetFinanceOverviewMockHandler({
        ...overview,
        accounts: [{ ...overview.accounts[0]!, status: "active" }],
      }),
    );
    server.use(
      getListFinanceAccountsMockHandler([
        { ...overview.accounts[0]!, status: "active" },
      ]),
    );
    server.use(getListFinanceCategoriesMockHandler([]));
    server.use(
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
    );
    server.use(
      getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );

    const day = await screen.findByRole("region", {
      name: "Selected-day activity",
    });
    expect(day.querySelector("time")).toHaveAttribute("datetime", "2026-08-17");
    await user.click(
      await within(day).findByRole("button", { name: "Record for this date" }),
    );
    expect(
      await screen.findByRole("textbox", { name: "Amount" }),
    ).toHaveFocus();
    expect(
      screen.getByText(/Effective Transaction Date:/).querySelector("time"),
    ).toHaveAttribute("datetime", "2026-08-17");
  });

  it("keeps backend order and kind-specific meaning across selected-day pages", async () => {
    const user = userEvent.setup();
    let overviewRequests = 0;
    let releaseOverview!: () => void;
    const deferredOverview = new Promise<void>((resolve) => {
      releaseOverview = resolve;
    });
    server.use(
      getGetFinanceOverviewMockHandler(async () => {
        overviewRequests += 1;
        if (overviewRequests > 1) await deferredOverview;
        return {
          ...overview,
          days: [{ ...overview.days[0]!, transactionCount: 4 }],
        };
      }),
    );
    server.use(
      getListFinanceTransactionsMockHandler(({ request }) =>
        request.url.includes("cursor=next")
          ? { items: dayTransactions.slice(2), nextCursor: null }
          : { items: dayTransactions.slice(0, 2), nextCursor: "next" },
      ),
    );
    const { queryClient } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    const day = await screen.findByRole("region", {
      name: "Selected-day activity",
    });
    expect(
      await within(day).findByText(
        /9,007,199,254,740,993\.25 CNY into Savings/,
      ),
    ).toBeVisible();
    expect(
      within(day).getByText(/Food \(archived\).*Category ID/),
    ).toBeVisible();
    expect(within(day).getByText(/Uncategorized: 35.00 CNY/)).toBeVisible();
    await user.click(within(day).getByRole("button", { name: "Load more" }));
    expect(
      await within(day).findByText(/1,000.00 CNY from Savings \(archived\)/),
    ).toBeVisible();
    expect(within(day).getByText(/Signed correction -27.00 CNY/)).toBeVisible();
    expect(
      within(day)
        .getAllByRole("listitem")
        .map(
          (item) => item.textContent?.match(/Transaction ID ([-a-f0-9]+)/)?.[1],
        ),
    ).toEqual(dayTransactions.map((item) => item.id));
    expect(
      within(day).getAllByRole("button", { name: /View details/ }),
    ).toHaveLength(4);
    expect(within(day).getAllByRole("button", { name: /Edit/ })).toHaveLength(
      4,
    );
    expect(within(day).getAllByRole("button", { name: /Delete/ })).toHaveLength(
      4,
    );
    expect(within(day).getByText(/4 transactions/)).toBeVisible();
    const refresh = queryClient.invalidateQueries({
      queryKey: getGetFinanceOverviewQueryKey(ledger.id, { month: "2026-08" }),
    });
    await waitFor(() => expect(overviewRequests).toBe(2));
    expect(within(day).getAllByRole("listitem")).toHaveLength(4);
    expect(within(day).getByText(/Updating activity count/)).toBeVisible();
    expect(within(day).queryByText(/4 transactions/)).not.toBeInTheDocument();
    releaseOverview();
    await refresh;
    await waitFor(() =>
      expect(within(day).getByText(/4 transactions/)).toBeVisible(),
    );
  });

  it("returns from selected-day detail and its deletion to the same Overview date", async () => {
    const user = userEvent.setup();
    let deleted = false;
    server.use(
      getGetFinanceOverviewMockHandler(overview),
      getListFinanceTransactionsMockHandler(() => ({
        items: deleted ? [] : [dayTransactions[0]],
        nextCursor: null,
      })),
      getGetFinanceTransactionMockHandler(dayTransactions[0]),
      http.delete(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => {
          deleted = true;
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    const { router } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    const view = await screen.findByRole("button", {
      name: /View details for Income.*aaaaaaa1/,
    });
    await user.click(view);
    const back = await screen.findByRole("link", { name: "Back to Overview" });
    expect(back).toHaveAttribute(
      "href",
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    await user.click(back);
    expect(router.state.location.pathname).toBe("/finance/overview");
    await user.click(
      await screen.findByRole("button", {
        name: /View details for Income.*aaaaaaa1/,
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Delete transaction" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete transaction?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Delete transaction" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/finance/overview"),
    );
    expect(router.state.location.search).toBe(
      `?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
  });

  it.each(["mouse", "keyboard"] as const)(
    "deletes selected-day activity with %s activation and restores stable destination focus",
    async (activation) => {
      const user = userEvent.setup();
      let deleted = false;
      let deletes = 0;
      let releaseDelete!: () => void;
      const deleteResponse = new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });
      server.use(
        getGetFinanceOverviewMockHandler(() => ({
          ...overview,
          days: deleted ? [] : overview.days,
        })),
        getListFinanceTransactionsMockHandler(() => ({
          items: deleted ? [] : [dayTransactions[0]],
          nextCursor: null,
        })),
        http.delete(
          "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
          async () => {
            deletes += 1;
            await deleteResponse;
            deleted = true;
            return new HttpResponse(null, { status: 204 });
          },
        ),
      );
      const { router } = renderRoute(
        `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
      );
      const action = await screen.findByRole(
        "button",
        { name: /Delete Income.*aaaaaaa1/ },
        { timeout: 5_000 },
      );
      const heading = screen.getByRole("heading", {
        level: 1,
        name: "Overview",
      });
      if (activation === "keyboard") {
        action.focus();
        await user.keyboard("{Enter}");
      } else await user.click(action);
      const dialog = screen.getByRole("alertdialog", {
        name: "Delete transaction?",
      });
      await waitFor(() =>
        expect(
          within(dialog).getByRole("button", { name: "Cancel" }),
        ).toHaveFocus(),
      );
      const confirm = within(dialog).getByRole("button", {
        name: "Delete transaction",
      });
      if (activation === "keyboard") {
        await user.tab();
        expect(confirm).toHaveFocus();
        await user.keyboard("{Enter}");
      } else await user.click(confirm);
      await waitFor(() => expect(deletes).toBe(1));
      expect(action).toBeInTheDocument();
      expect(heading).not.toHaveFocus();
      releaseDelete();
      const announcement = await screen.findByText("Transaction deleted.");
      expect(announcement).toHaveAttribute("aria-live", "polite");
      expect(
        await screen.findByText("No transactions for this date"),
      ).toBeVisible();
      expect(action).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Delete Income.*aaaaaaa1/ }),
      ).not.toBeInTheDocument();
      await waitFor(() => expect(heading).toHaveFocus());
      expect(heading.isConnected).toBe(true);
      expect(heading).not.toHaveAttribute("aria-disabled", "true");
      expect(document.body).not.toHaveFocus();
      expect(router.state.location.pathname).toBe("/finance/overview");
      expect(router.state.location.search).toBe(
        `?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
      );
    },
  );

  it("suppresses cached Calendar counts after direct Delete until Overview confirms the removal", async () => {
    const user = userEvent.setup();
    let deleted = false;
    let requests = 0;
    let releaseRefresh!: () => void;
    const deferred = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    server.use(
      getListFinanceTransactionsMockHandler(() => ({
        items: deleted ? [] : [dayTransactions[0]],
        nextCursor: null,
      })),
      http.get("*/api/finance/ledgers/:ledgerId/overview", async () => {
        requests += 1;
        if (requests > 1) await deferred;
        return HttpResponse.json({
          ...overview,
          days: deleted ? [] : overview.days,
        });
      }),
      http.delete(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => {
          deleted = true;
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    await screen.findByRole("button", { name: /2026-08-16.*1 transaction/ });
    await user.click(
      await screen.findByRole("button", { name: /Delete Income.*aaaaaaa1/ }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete transaction?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Delete transaction" }),
    );
    await waitFor(() => expect(requests).toBe(2));
    expect(
      screen.getByRole("button", { name: /2026-08-16.*Updating activity/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Selected-day activity" }),
    ).toHaveTextContent("Updating activity count");
    releaseRefresh();
    expect(
      await screen.findByRole("button", {
        name: /2026-08-16.*No transactions/,
      }),
    ).toBeVisible();
  });

  it("submits Quick Entry from the keyboard with the selected date and retains its reusable choices", async () => {
    const user = userEvent.setup();
    let created = false;
    let submitted: unknown;
    const account = { ...overview.accounts[0]!, status: "active" as const };
    const category = {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Food",
      status: "active" as const,
    };
    const createdIncome = {
      account: { id: account.id, name: account.name, status: "active" },
      categoryAllocations: [
        {
          amount: { amount: "9007199254740993.25", currency: "CNY" },
          category,
        },
      ],
      economicAmount: { amount: "9007199254740993.25", currency: "CNY" },
      id: "99999999-9999-4999-8999-999999999999",
      kind: "income",
      ledgerId: ledger.id,
      note: "Award",
      transactionDate: "2026-08-17",
    } satisfies TransactionHistoryPageResponse["items"][number];
    server.use(
      getGetFinanceOverviewMockHandler(() => ({
        ...overview,
        days: created
          ? [
              {
                ...overview.days[0]!,
                date: "2026-08-17",
                transactionCount: 1,
                transactionCountByKind: {
                  balanceAdjustment: 0,
                  expense: 0,
                  income: 1,
                  internalTransfer: 0,
                },
              },
            ]
          : [],
      })),
      getListFinanceAccountsMockHandler([account]),
      getListFinanceCategoriesMockHandler([category]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler(() => ({
        items: created ? [createdIncome] : [],
        nextCursor: null,
      })),
      transactionCreateHandler(async ({ request }) => {
        submitted = await request.json();
        created = true;
        return HttpResponse.json(createdIncome, { status: 201 });
      }),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );
    const form = await screen.findByRole("form", { name: "Quick Entry" });
    await user.click(within(form).getByRole("button", { name: "Income" }));
    const amount = within(form).getByRole("textbox", { name: "Amount" });
    await user.type(amount, "9007199254740993.25");
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Category" }),
      category.id,
    );
    await user.type(
      within(form).getByRole("textbox", { name: "Note" }),
      "Award{Enter}",
    );
    await waitFor(() =>
      expect(submitted).toEqual({
        accountId: account.id,
        categoryAllocations: [
          {
            amount: { amount: "9007199254740993.25", currency: "CNY" },
            categoryId: category.id,
          },
        ],
        economicAmount: { amount: "9007199254740993.25", currency: "CNY" },
        kind: "income",
        note: "Award",
        transactionDate: "2026-08-17",
      }),
    );
    await waitFor(() => expect(amount).toHaveValue(""));
    await waitFor(() => expect(amount).toHaveFocus());
    expect(within(form).getByRole("textbox", { name: "Note" })).toHaveValue("");
    expect(
      within(form).getByRole("button", { name: "Income" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(form).getByRole("combobox", { name: "Category" }),
    ).toHaveValue(category.id);
    expect(await screen.findByText("Income recorded.")).toBeInTheDocument();
    expect(
      await within(
        screen.getByRole("region", { name: "Selected-day activity" }),
      ).findByText(/9,007,199,254,740,993.25 CNY into Savings/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /2026-08-17.*1 transaction.*Income/ }),
    ).toBeVisible();
  });

  it("announces a confirmed Quick Entry write and hides stale activity counts until a failed Overview refresh is retried", async () => {
    const user = userEvent.setup();
    let created = false;
    let requests = 0;
    let releaseRefresh!: () => void;
    const deferred = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const account = { ...overview.accounts[0]!, status: "active" as const };
    const createdExpense = {
      account: { id: account.id, name: account.name, status: "active" },
      categoryAllocations: [
        { amount: { amount: "12.34", currency: "CNY" }, category: null },
      ],
      economicAmount: { amount: "12.34", currency: "CNY" },
      id: "99999999-9999-4999-8999-999999999999",
      kind: "expense",
      ledgerId: ledger.id,
      note: null,
      transactionDate: "2026-08-17",
    } satisfies TransactionHistoryPageResponse["items"][number];
    server.use(
      getListFinanceAccountsMockHandler([account]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler(() => ({
        items: created ? [createdExpense] : [],
        nextCursor: null,
      })),
      http.get("*/api/finance/ledgers/:ledgerId/overview", async () => {
        requests += 1;
        if (requests === 2) {
          await deferred;
          return HttpResponse.json(
            { type: "about:blank", title: "Unavailable", status: 503 },
            { status: 503 },
          );
        }
        return HttpResponse.json({
          ...overview,
          accounts: [account],
          days: created
            ? [
                {
                  ...overview.days[0]!,
                  date: "2026-08-17",
                  transactionCount: 1,
                  transactionCountByKind: {
                    balanceAdjustment: 0,
                    expense: 1,
                    income: 0,
                    internalTransfer: 0,
                  },
                },
              ]
            : [],
        });
      }),
      transactionCreateHandler(() => {
        created = true;
        return HttpResponse.json(createdExpense, { status: 201 });
      }),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );
    const form = await screen.findByRole("form", { name: "Quick Entry" });
    const amount = within(form).getByRole("textbox", { name: "Amount" });
    await screen.findByText("No transactions for this date");
    await user.type(amount, "12.34{Enter}");
    expect(await screen.findByText("Expense recorded.")).toBeInTheDocument();
    await waitFor(() => expect(amount).toHaveValue(""));
    await waitFor(() => expect(amount).toHaveFocus());
    expect(requests).toBe(2);
    const day = screen.getByRole("region", { name: "Selected-day activity" });
    expect(
      await within(day).findByText(/12.34 CNY from Savings/),
    ).toBeVisible();
    expect(within(day).queryByText("0 transactions")).not.toBeInTheDocument();
    expect(within(day).getByText(/Updating activity count/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /2026-08-17.*Updating activity/ }),
    ).toBeVisible();
    releaseRefresh();
    await screen.findByRole("alert", { name: "Finance Overview error" });
    expect(within(day).getByText(/Activity count unavailable/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry Overview" }));
    await waitFor(() => expect(requests).toBe(3));
    expect(within(day).getByText(/1 transaction/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /2026-08-17.*1 transaction/ }),
    ).toBeVisible();
  });

  it("keeps counts unavailable across consecutive writes and ignores the older delayed Overview response", async () => {
    const user = userEvent.setup();
    const account = { ...overview.accounts[0]!, status: "active" as const };
    const recorded: TransactionHistoryPageResponse["items"] = [];
    let requests = 0;
    let olderReturned = false;
    let releaseOlder!: () => void;
    let releaseLatest!: () => void;
    const older = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    const latest = new Promise<void>((resolve) => {
      releaseLatest = resolve;
    });
    server.use(
      getListFinanceAccountsMockHandler([account]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler(() => ({
        items: [...recorded].reverse(),
        nextCursor: null,
      })),
      http.get("*/api/finance/ledgers/:ledgerId/overview", async () => {
        requests += 1;
        const count = recorded.length;
        if (requests === 2) {
          await older;
          olderReturned = true;
        }
        if (requests === 3) await latest;
        return HttpResponse.json({
          ...overview,
          accounts: [account],
          days: count
            ? [
                {
                  ...overview.days[0]!,
                  date: "2026-08-17",
                  transactionCount: count,
                  transactionCountByKind: {
                    balanceAdjustment: 0,
                    expense: count,
                    income: 0,
                    internalTransfer: 0,
                  },
                },
              ]
            : [],
        });
      }),
      transactionCreateHandler(async ({ request }) => {
        const body = (await request.json()) as {
          economicAmount: { amount: string };
        };
        const transaction = {
          ...dayTransactions[1],
          id: `99999999-9999-4999-8999-99999999999${recorded.length + 1}`,
          account: {
            id: account.id,
            name: account.name,
            status: "active" as const,
          },
          categoryAllocations: [
            {
              amount: { amount: body.economicAmount.amount, currency: "CNY" },
              category: null,
            },
          ],
          economicAmount: {
            amount: body.economicAmount.amount,
            currency: "CNY",
          },
          transactionDate: "2026-08-17",
        } satisfies TransactionHistoryPageResponse["items"][number];
        recorded.push(transaction);
        return HttpResponse.json(transaction, { status: 201 });
      }),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );
    const form = await screen.findByRole("form", { name: "Quick Entry" });
    const amount = within(form).getByRole("textbox", { name: "Amount" });
    await screen.findByText("No transactions for this date");
    await user.type(amount, "10.00{Enter}");
    await waitFor(() => expect(requests).toBe(2));
    await waitFor(() => expect(amount).toHaveValue(""));
    await waitFor(() =>
      expect(
        within(form).getByRole("button", { name: "Record expense" }),
      ).toBeEnabled(),
    );
    await user.type(amount, "20.00{Enter}");
    await waitFor(() => expect(requests).toBe(3));
    const calendarDay = screen.getByRole("button", {
      name: /2026-08-17.*Updating activity/,
    });
    expect(calendarDay).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Selected-day activity" }),
    ).toHaveTextContent("Updating activity count");
    releaseOlder();
    await waitFor(() => expect(olderReturned).toBe(true));
    expect(calendarDay).toHaveAccessibleName(/Updating activity/);
    releaseLatest();
    await waitFor(() =>
      expect(calendarDay).toHaveAccessibleName(/2 transactions.*Expense/),
    );
  });

  it("retargets one draft across date history and abandons it at a Ledger boundary", async () => {
    const user = userEvent.setup();
    const otherLedger = {
      id: "b9aa59ad-aa6b-49f5-9f4c-8ed071ea3f74",
      name: "Team fund",
    };
    server.use(
      getListFinanceLedgersMockHandler([ledger, otherLedger]),
      getGetFinanceOverviewMockHandler(({ request }) => ({
        ...overview,
        ledger: request.url.includes(otherLedger.id) ? otherLedger : ledger,
        month: new URL(request.url).searchParams.get("month") ?? "2026-08",
        days: [],
      })),
      getListFinanceAccountsMockHandler([
        { ...overview.accounts[0]!, status: "active" },
      ]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
    );
    const { router } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    const form = await screen.findByRole("form", { name: "Quick Entry" });
    const amount = within(form).getByRole("textbox", { name: "Amount" });
    await user.type(amount, "12.34");
    await user.type(
      within(form).getByRole("textbox", { name: "Note" }),
      "Lunch",
    );
    await user.click(
      await screen.findByRole("button", {
        name: /2026-08-17.*No transactions/,
      }),
    );
    expect(router.state.location.search).toContain("date=2026-08-17");
    expect(amount).toHaveValue("12.34");
    expect(within(form).getByRole("textbox", { name: "Note" })).toHaveValue(
      "Lunch",
    );
    expect(form.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-08-17",
    );
    await router.navigate(-1);
    await waitFor(() =>
      expect(form.querySelector("time")).toHaveAttribute(
        "datetime",
        "2026-08-16",
      ),
    );
    expect(amount).toHaveValue("12.34");
    await router.navigate(1);
    await waitFor(() =>
      expect(form.querySelector("time")).toHaveAttribute(
        "datetime",
        "2026-08-17",
      ),
    );
    expect(amount).toHaveValue("12.34");
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() =>
      expect(form.querySelector("time")).toHaveAttribute(
        "datetime",
        "2026-09-17",
      ),
    );
    expect(amount).toHaveValue("12.34");
    await router.navigate(-1);
    await waitFor(() =>
      expect(form.querySelector("time")).toHaveAttribute(
        "datetime",
        "2026-08-17",
      ),
    );
    expect(amount).toHaveValue("12.34");
    await user.click(screen.getByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Team fund" }),
    );
    expect(router.state.location.search).toContain(`ledger=${otherLedger.id}`);
    const nextForm = await screen.findByRole("form", { name: "Quick Entry" });
    expect(
      within(nextForm).getByRole("textbox", { name: "Amount" }),
    ).toHaveValue("");
    expect(nextForm.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-08-17",
    );
  });

  it("preserves focused draft fields and requires explicit replacement of archived references", async () => {
    const user = userEvent.setup();
    let archived = false;
    let submissions = 0;
    const first = { ...overview.accounts[0]!, status: "active" as const };
    const second = { ...first, id: "22222222-2222-4222-8222-222222222222" };
    const category = {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Food",
      status: "active" as const,
    };
    server.use(
      getGetFinanceOverviewMockHandler(overview),
      getListFinanceAccountsMockHandler(() => [
        archived ? { ...first, status: "archived" } : first,
        second,
      ]),
      getListFinanceCategoriesMockHandler(() => [
        archived ? { ...category, status: "archived" } : category,
      ]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
      transactionCreateHandler(() => {
        submissions += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    const { queryClient } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );
    const form = await screen.findByRole("form", { name: "Quick Entry" });
    const amount = within(form).getByRole("textbox", { name: "Amount" });
    const accountSelect = within(form).getByRole("combobox", {
      name: "Account",
    });
    const categorySelect = within(form).getByRole("combobox", {
      name: "Category",
    });
    await user.type(amount, "12.34");
    await user.selectOptions(categorySelect, category.id);
    amount.focus();
    archived = true;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getListFinanceAccountsQueryKey(ledger.id),
      }),
      queryClient.invalidateQueries({
        queryKey: getListFinanceCategoriesQueryKey(ledger.id),
      }),
    ]);
    expect(amount).toHaveFocus();
    expect(amount).toHaveValue("12.34");
    expect(accountSelect).toHaveValue(first.id);
    expect(categorySelect).toHaveValue(category.id);
    await waitFor(() =>
      expect(
        within(accountSelect).getByRole("option", { name: /unavailable/ }),
      ).toBeDisabled(),
    );
    expect(
      within(categorySelect).getByRole("option", { name: /unavailable/ }),
    ).toBeDisabled();
    await user.click(
      within(form).getByRole("button", { name: "Record expense" }),
    );
    expect(submissions).toBe(0);
    expect(accountSelect).toHaveFocus();
    await user.selectOptions(accountSelect, second.id);
    await user.click(
      within(form).getByRole("button", { name: "Record expense" }),
    );
    expect(submissions).toBe(0);
    expect(categorySelect).toHaveFocus();
  });

  it("isolates a selected-day request failure and retries only that region", async () => {
    const user = userEvent.setup();
    server.use(getGetFinanceOverviewMockHandler(overview));
    server.use(getListFinanceTransactionsMockHandler503());
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );
    const calendar = await screen.findByRole("grid", {
      name: "2026-08 Finance calendar",
    });
    const quickEntry = screen.getByRole("region", { name: "Quick Entry" });
    const dayError = await screen.findByRole("alert", {
      name: "Selected-day error",
    });
    expect(calendar).toBeVisible();
    expect(quickEntry).toBeVisible();
    server.use(
      getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
    );
    await user.click(
      within(dayError).getByRole("button", { name: "Retry selected day" }),
    );
    expect(
      await screen.findByText("No transactions for this date"),
    ).toBeVisible();
    expect(calendar).toBeVisible();
    expect(quickEntry).toBeVisible();
  });

  it("keeps loaded selected-day rows with a retry when their background refresh fails", async () => {
    const user = userEvent.setup();
    server.use(
      getGetFinanceOverviewMockHandler(overview),
      getListFinanceTransactionsMockHandler({
        items: [dayTransactions[0]],
        nextCursor: null,
      }),
    );
    const { queryClient } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    const activity = await screen.findByRole("region", {
      name: "Selected-day activity",
    });
    expect(await within(activity).findByText("Award")).toBeVisible();
    server.use(getListFinanceTransactionsMockHandler503());
    await queryClient.invalidateQueries({
      queryKey: getListFinanceTransactionsQueryKey(ledger.id),
    });
    expect(within(activity).getByText("Award")).toBeVisible();
    const alert = await within(activity).findByRole("alert");
    expect(alert).toHaveTextContent("Showing the last loaded results");
    server.use(
      getListFinanceTransactionsMockHandler({
        items: [dayTransactions[0]],
        nextCursor: null,
      }),
    );
    await user.click(
      within(alert).getByRole("button", { name: "Retry selected day" }),
    );
    await waitFor(() =>
      expect(within(activity).queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("blocks every Overview creation entry when the Ledger has no active Account", async () => {
    server.use(
      getGetFinanceOverviewMockHandler(overview),
      getListFinanceAccountsMockHandler(overview.accounts),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );
    const quickEntry = await screen.findByRole("region", {
      name: "Quick Entry",
    });
    expect(
      await within(quickEntry).findByText(/need an active Account/),
    ).toBeVisible();
    expect(
      within(quickEntry).getByRole("link", {
        name: "Create or unarchive an Account",
      }),
    ).toHaveAttribute("href", expect.stringContaining("/finance/accounts"));
    expect(
      within(quickEntry).getByRole("button", {
        name: "Other transaction actions",
      }),
    ).toBeDisabled();
    expect(
      await screen.findByRole("button", { name: "Record for this date" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("form", { name: "Quick Entry" }),
    ).not.toBeInTheDocument();
  });

  it("preserves the Quick Entry draft when its last active Account becomes archived", async () => {
    const user = userEvent.setup();
    let archived = false;
    const account = { ...overview.accounts[0]!, status: "active" as const };
    server.use(
      getGetFinanceOverviewMockHandler(overview),
      getListFinanceAccountsMockHandler(() => [
        archived ? { ...account, status: "archived" } : account,
      ]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
    );
    const { queryClient } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );
    const form = await screen.findByRole("form", { name: "Quick Entry" });
    const amount = within(form).getByRole("textbox", { name: "Amount" });
    await user.type(amount, "12.34");
    amount.focus();
    archived = true;
    await queryClient.invalidateQueries({
      queryKey: getListFinanceAccountsQueryKey(ledger.id),
    });
    expect(form).toBeInTheDocument();
    expect(amount).toHaveFocus();
    expect(amount).toHaveValue("12.34");
    await waitFor(() =>
      expect(
        within(form).getByRole("button", { name: "Record expense" }),
      ).toBeDisabled(),
    );
    expect(
      screen.getByRole("link", { name: "Create or unarchive an Account" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Record for this date" }),
    ).toBeDisabled();
  });

  it("keeps cached Quick Entry references and keyboard focus after an Accounts refetch failure", async () => {
    const user = userEvent.setup();
    const account = { ...overview.accounts[0]!, status: "active" as const };
    server.use(
      getGetFinanceOverviewMockHandler({ ...overview, accounts: [account] }),
      getListFinanceAccountsMockHandler([account]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
    );
    const { queryClient } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );
    const form = await screen.findByRole("form", { name: "Quick Entry" });
    const amount = within(form).getByRole("textbox", { name: "Amount" });
    await user.type(amount, "12.34");
    amount.focus();
    server.use(getListFinanceAccountsMockHandler503());
    await queryClient.invalidateQueries({
      queryKey: getListFinanceAccountsQueryKey(ledger.id),
    });
    expect(form).toBeInTheDocument();
    expect(amount).toHaveValue("12.34");
    expect(amount).toHaveFocus();
    expect(
      await screen.findByText(/Quick Entry references could not refresh/),
    ).toBeVisible();
    expect(
      within(form).getByRole("button", { name: "Record expense" }),
    ).toBeDisabled();
    server.use(getListFinanceAccountsMockHandler([account]));
    await user.click(
      screen.getByRole("button", { name: "Retry Quick Entry references" }),
    );
    await waitFor(() =>
      expect(
        within(form).getByRole("button", { name: "Record expense" }),
      ).toBeEnabled(),
    );
    expect(amount).toHaveValue("12.34");
  });

  it("starts secondary dialogs on the selected date and restores their menu invoker on cancellation", async () => {
    const user = userEvent.setup();
    const first = { ...overview.accounts[0]!, status: "active" as const };
    const second = {
      ...first,
      id: "22222222-2222-4222-8222-222222222222",
      name: "Cash",
    };
    server.use(
      getGetFinanceOverviewMockHandler(overview),
      getListFinanceAccountsMockHandler([first, second]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );
    const menu = await screen.findByRole("button", {
      name: "Other transaction actions",
    });
    await waitFor(() => expect(menu).toBeEnabled());
    await user.click(menu);
    await user.click(
      await screen.findByRole("menuitem", { name: "Internal Transfer" }),
    );
    const transfer = screen.getByRole("dialog", { name: /Internal Transfer/i });
    expect(within(transfer).getByLabelText("Transaction date")).toHaveValue(
      "2026-08-17",
    );
    await user.click(within(transfer).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(menu).toHaveFocus());
    await user.click(
      await screen.findByRole("button", { name: "Other transaction actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Balance Adjustment" }),
    );
    const adjustment = screen.getByRole("dialog", {
      name: /Balance Adjustment/i,
    });
    expect(within(adjustment).getByLabelText("Transaction date")).toHaveValue(
      "2026-08-17",
    );
    await user.click(
      within(adjustment).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(menu).toHaveFocus());
  });

  it("keeps counts authoritative for no-change Adjustment and suppresses them for a created Adjustment", async () => {
    const user = userEvent.setup();
    const account = { ...overview.accounts[0]!, status: "active" as const };
    const adjustment = {
      ...dayTransactions[3],
      account: {
        id: account.id,
        name: account.name,
        status: "active" as const,
      },
      correctionDelta: { amount: "5.00", currency: "CNY" },
      transactionDate: "2026-08-17",
    } satisfies TransactionHistoryPageResponse["items"][number];
    let created = false;
    let requests = 0;
    let releaseRefresh!: () => void;
    const deferred = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    server.use(
      getListFinanceAccountsMockHandler([account]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler(() => ({
        items: created ? [adjustment] : [],
        nextCursor: null,
      })),
      http.get("*/api/finance/ledgers/:ledgerId/overview", async () => {
        requests += 1;
        if (requests > 1) await deferred;
        return HttpResponse.json({
          ...overview,
          accounts: [account],
          days: created
            ? [
                {
                  ...overview.days[0]!,
                  date: "2026-08-17",
                  transactionCountByKind: {
                    balanceAdjustment: 1,
                    expense: 0,
                    income: 0,
                    internalTransfer: 0,
                  },
                },
              ]
            : [],
        });
      }),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        ({ request }) =>
          HttpResponse.json({
            account: { id: account.id, name: account.name, status: "active" },
            accountNature: "asset",
            derivedComparisonBalance: { amount: "20.00", currency: "CNY" },
            transactionDate:
              new URL(request.url).searchParams.get("transactionDate") ?? "",
          } satisfies BalanceAdjustmentContextResponse),
      ),
      http.post(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments",
        async ({ request }) => {
          const body = (await request.json()) as {
            targetBalance: { amount: string };
          };
          if (body.targetBalance.amount === "20.00")
            return HttpResponse.json({
              outcome: "noChange",
              transaction: null,
            } satisfies BalanceAdjustmentResultResponse);
          created = true;
          return HttpResponse.json({
            outcome: "created",
            transaction: adjustment,
          } satisfies BalanceAdjustmentResultResponse);
        },
      ),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );
    const openAdjustment = async () => {
      const menu = await screen.findByRole("button", {
        name: "Other transaction actions",
      });
      await waitFor(() => expect(menu).toBeEnabled());
      await user.click(menu);
      await user.click(
        await screen.findByRole("menuitem", { name: "Balance Adjustment" }),
      );
      const dialog = screen.getByRole("dialog", {
        name: "Record balance adjustment",
      });
      await within(dialog).findByText("20.00 CNY");
      return dialog;
    };
    let dialog = await openAdjustment();
    await user.type(
      within(dialog).getByRole("textbox", { name: "Target balance" }),
      "20.00",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record adjustment" }),
    );
    expect(
      await screen.findByText(
        "Balance already matched the target. No Balance Adjustment was created.",
      ),
    ).toBeInTheDocument();
    expect(requests).toBe(1);
    expect(
      screen.getByRole("button", { name: /2026-08-17.*No transactions/ }),
    ).toBeVisible();

    dialog = await openAdjustment();
    await user.type(
      within(dialog).getByRole("textbox", { name: "Target balance" }),
      "25.00",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record adjustment" }),
    );
    await waitFor(() => expect(requests).toBe(2));
    expect(
      screen.getByRole("button", { name: /2026-08-17.*Updating activity/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Selected-day activity" }),
    ).toHaveTextContent("Updating activity count");
    releaseRefresh();
    expect(
      await screen.findByRole("button", {
        name: /2026-08-17.*1 transaction.*Balance Adjustment/,
      }),
    ).toBeVisible();
  });

  it("explains why Internal Transfer is unavailable without a same-currency Account pair", async () => {
    const user = userEvent.setup();
    const first = { ...overview.accounts[0]!, status: "active" as const };
    const second = {
      ...first,
      id: "22222222-2222-4222-8222-222222222222",
      name: "USD Cash",
      currency: "USD" as const,
      currentBalance: { amount: "0.00", currency: "USD" as const },
      openingBalance: { amount: "0.00", currency: "USD" as const },
    };
    server.use(
      getGetFinanceOverviewMockHandler({
        ...overview,
        accounts: [first, second],
      }),
      getListFinanceAccountsMockHandler([first, second]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );
    const menu = await screen.findByRole("button", {
      name: "Other transaction actions",
    });
    await waitFor(() => expect(menu).toBeEnabled());
    await user.click(menu);
    expect(
      await screen.findByRole("menuitem", { name: "Internal Transfer" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(/distinct active Accounts using the same currency/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "Manage Accounts for Internal Transfer",
      }),
    ).toHaveAttribute(
      "href",
      `/finance/accounts?ledger=${ledger.id}&month=2026-08&date=2026-08-17`,
    );
  });

  it("clamps month navigation, updates URL history, and hides the old month while the next request is pending", async () => {
    const user = userEvent.setup();
    let releaseFebruary!: () => void;
    const February = new Promise<void>((resolve) => {
      releaseFebruary = resolve;
    });
    server.use(
      getGetFinanceOverviewMockHandler(async ({ request }) => {
        const month = new URL(request.url).searchParams.get("month");
        if (month === "2026-02") {
          await February;
          return { ...overview, days: [], month: "2026-02" };
        }
        return { ...overview, days: [], month: month ?? "2026-08" };
      }),
    );
    const { router } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-01&date=2026-01-31`,
    );
    expect(
      await screen.findByRole("region", { name: "Current financial position" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(router.state.location.search).toBe(
      `?ledger=${ledger.id}&month=2026-02&date=2026-02-28`,
    );
    expect(screen.getByLabelText("Selected month 2026-02")).toBeVisible();
    expect(
      screen.getByRole("status", { name: "Loading Finance Overview" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Current financial position" }),
    ).not.toBeInTheDocument();

    releaseFebruary();
    expect(
      await screen.findByRole("grid", { name: "2026-02 Finance calendar" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /2026-02-28.*Selected/ }),
    ).toHaveFocus();

    await router.navigate(-1);
    expect(
      await screen.findByRole("grid", { name: "2026-01 Finance calendar" }),
    ).toBeVisible();
    expect(router.state.location.search).toBe(
      `?ledger=${ledger.id}&month=2026-01&date=2026-01-31`,
    );
    await router.navigate(1);
    expect(
      await screen.findByRole("grid", { name: "2026-02 Finance calendar" }),
    ).toBeVisible();
    expect(router.state.location.search).toBe(
      `?ledger=${ledger.id}&month=2026-02&date=2026-02-28`,
    );
  });

  it("keeps an invalidated month's cached Calendar counts suppressed across month remount", async () => {
    const user = userEvent.setup();
    let augustRequests = 0;
    let releaseAugust!: () => void;
    const deferred = new Promise<void>((resolve) => {
      releaseAugust = resolve;
    });
    server.use(
      getGetFinanceOverviewMockHandler(async ({ request }) => {
        const month = new URL(request.url).searchParams.get("month");
        if (month === "2026-09")
          return { ...overview, month: "2026-09", days: [] };
        augustRequests += 1;
        if (augustRequests > 1) await deferred;
        return {
          ...overview,
          days:
            augustRequests > 1
              ? [
                  {
                    ...overview.days[0]!,
                    transactionCount: 2,
                    transactionCountByKind: {
                      balanceAdjustment: 0,
                      expense: 0,
                      income: 0,
                      internalTransfer: 2,
                    },
                  },
                ]
              : overview.days,
        };
      }),
    );
    const { queryClient } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    await screen.findByRole("button", { name: /2026-08-16.*1 transaction/ });
    await queryClient.invalidateQueries({
      queryKey: getGetFinanceOverviewQueryKey(ledger.id, { month: "2026-08" }),
      refetchType: "none",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /2026-08-16.*Updating activity/ }),
      ).toBeVisible(),
    );
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByRole("grid", { name: "2026-09 Finance calendar" });
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(augustRequests).toBe(2));
    const day = screen.getByRole("button", {
      name: /2026-08-16.*Updating activity/,
    });
    expect(day).toBeVisible();
    expect(day).not.toHaveAccessibleName(/1 transaction/);
    releaseAugust();
    await waitFor(() => expect(day).toHaveAccessibleName(/2 transactions/));
  });

  it("preserves month and date while switching to the new Ledger's Overview data", async () => {
    const user = userEvent.setup();
    const otherLedger = {
      id: "b9aa59ad-aa6b-49f5-9f4c-8ed071ea3f74",
      name: "Team fund",
    };
    server.use(getListFinanceLedgersMockHandler([ledger, otherLedger]));
    server.use(
      getGetFinanceOverviewMockHandler(({ request }) => {
        if (request.url.includes(otherLedger.id)) {
          return {
            ...overview,
            accounts: [],
            days: [],
            financialPositionByCurrency: [],
            ledger: otherLedger,
            monthSummaryByCurrency: [],
          };
        }
        return overview;
      }),
    );
    const { router } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    expect(
      await screen.findByRole("region", { name: "Current financial position" }),
    ).toHaveTextContent("123,456,789,012,345.67 CNY");
    await user.click(screen.getByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Team fund" }),
    );
    expect(router.state.location.search).toBe(
      `?ledger=${otherLedger.id}&month=2026-08&date=2026-08-16`,
    );
    expect(
      await screen.findByRole("region", { name: "Current financial position" }),
    ).toHaveTextContent("No Account balances yet");
    expect(
      screen.queryByText("123,456,789,012,345.67 CNY"),
    ).not.toBeInTheDocument();
  });

  it("keeps Calendar focus separate from selection and exposes transfer-only activity", async () => {
    const user = userEvent.setup();
    server.use(getGetFinanceOverviewMockHandler(overview));
    const { router } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    const calendar = await screen.findByRole("grid", {
      name: "2026-08 Finance calendar",
    });
    expect(within(calendar).getAllByRole("button")).toHaveLength(31);
    expect(
      within(calendar).getAllByRole("button", { pressed: true }),
    ).toHaveLength(1);
    const selected = within(calendar).getByRole("button", {
      name: /2026-08-16.*Selected.*1 transaction.*Internal Transfer.*CNY/,
    });
    expect(selected).toHaveAttribute("tabindex", "0");
    selected.focus();
    await user.keyboard("{ArrowRight}");
    expect(
      within(calendar).getByRole("button", { name: /2026-08-17/ }),
    ).toHaveFocus();
    expect(router.state.location.search).toContain("date=2026-08-16");
    await user.keyboard("{End}");
    expect(
      within(calendar).getByRole("button", { name: /2026-08-22/ }),
    ).toHaveFocus();
    await user.keyboard(" ");
    await waitFor(() =>
      expect(router.state.location.search).toContain("date=2026-08-22"),
    );
    expect(
      within(calendar).getByRole("button", { name: /2026-08-22.*Selected/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{ArrowLeft}{Home}");
    expect(
      within(calendar).getByRole("button", { name: /2026-08-16/ }),
    ).toHaveFocus();
    expect(router.state.location.search).toContain("date=2026-08-22");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(router.state.location.search).toContain("date=2026-08-16"),
    );
  });

  it("keeps a focused Calendar day mounted and operable during a same-month background refresh", async () => {
    const user = userEvent.setup();
    let requestCount = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    server.use(
      getGetFinanceOverviewMockHandler(async () => {
        requestCount += 1;
        if (requestCount > 1) await pendingRefresh;
        return overview;
      }),
    );
    const { queryClient, router } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    const calendar = await screen.findByRole("grid", {
      name: "2026-08 Finance calendar",
    });
    within(calendar)
      .getByRole("button", { name: /2026-08-16.*Selected/ })
      .focus();
    await user.keyboard("{ArrowRight}");
    const focusedDay = within(calendar).getByRole("button", {
      name: /2026-08-17/,
    });
    expect(focusedDay).toHaveFocus();

    const refresh = queryClient.invalidateQueries({
      queryKey: getGetFinanceOverviewQueryKey(ledger.id, { month: "2026-08" }),
    });
    await waitFor(() => expect(requestCount).toBe(2));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Refreshing Finance Overview",
    );
    expect(calendar).toBeInTheDocument();
    expect(focusedDay).toHaveFocus();
    expect(focusedDay).toHaveAccessibleName(/Updating activity/);
    expect(focusedDay).not.toHaveAccessibleName(/1 transaction/);
    expect(
      screen.getByRole("region", { name: "Selected-day activity" }),
    ).toHaveTextContent("Updating activity count");
    expect(router.state.location.search).toContain("date=2026-08-16");

    releaseRefresh();
    await refresh;
    expect(focusedDay).toHaveFocus();
    await waitFor(() =>
      expect(focusedDay).toHaveAccessibleName(/No transactions/),
    );
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(router.state.location.search).toContain("date=2026-08-17"),
    );
  });

  it("suppresses cached counts while the exact Overview refresh is paused", async () => {
    server.use(getGetFinanceOverviewMockHandler(overview));
    const { queryClient } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    const day = await screen.findByRole("button", {
      name: /2026-08-16.*1 transaction/,
    });
    day.focus();
    try {
      onlineManager.setOnline(false);
      const refresh = queryClient.invalidateQueries({
        queryKey: getGetFinanceOverviewQueryKey(ledger.id, {
          month: "2026-08",
        }),
      });
      await waitFor(() =>
        expect(day).toHaveAccessibleName(/Updating activity/),
      );
      expect(day).toHaveFocus();
      expect(
        screen.getByRole("region", { name: "Selected-day activity" }),
      ).toHaveTextContent("Updating activity count");
      onlineManager.setOnline(true);
      await refresh;
      await waitFor(() => expect(day).toHaveAccessibleName(/1 transaction/));
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("keeps cached Overview, a Quick Entry draft, and selected-day actions through deferred and failed refresh", async () => {
    const user = userEvent.setup();
    let requests = 0;
    let releaseRefresh!: () => void;
    const deferred = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const account = { ...overview.accounts[0]!, status: "active" as const };
    server.use(
      getListFinanceAccountsMockHandler([account]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler({
        items: [dayTransactions[0]],
        nextCursor: null,
      }),
      http.get("*/api/finance/ledgers/:ledgerId/overview", async () => {
        requests += 1;
        if (requests === 1)
          return HttpResponse.json({
            ...overview,
            accounts: [account],
          });
        await deferred;
        return HttpResponse.json(
          { type: "about:blank", title: "Unavailable", status: 503 },
          { status: 503 },
        );
      }),
    );
    const { queryClient } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    const form = await screen.findByRole("form", { name: "Quick Entry" });
    const amount = within(form).getByRole("textbox", { name: "Amount" });
    await user.type(amount, "12.34");
    amount.focus();
    const day = await screen.findByRole("region", {
      name: "Selected-day activity",
    });
    const edit = await within(day).findByRole("button", {
      name: /Edit Income.*aaaaaaa1/,
    });
    const refresh = queryClient.invalidateQueries({
      queryKey: getGetFinanceOverviewQueryKey(ledger.id, { month: "2026-08" }),
    });
    await waitFor(() => expect(requests).toBe(2));
    expect(form).toBeInTheDocument();
    expect(amount).toHaveValue("12.34");
    expect(amount).toHaveFocus();
    expect(day).toBeInTheDocument();
    expect(edit).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Current financial position" }),
    ).toBeVisible();
    edit.focus();
    releaseRefresh();
    await refresh;
    await screen.findByRole("alert", { name: "Finance Overview error" });
    expect(edit).toHaveFocus();
    expect(day).toBeInTheDocument();
    expect(form).toBeInTheDocument();
    expect(amount).toHaveValue("12.34");
    expect(
      screen.getByRole("region", { name: "Current financial position" }),
    ).toBeVisible();
    await user.click(
      within(day).getByRole("button", { name: /Delete Income.*aaaaaaa1/ }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete transaction?",
    });
    expect(dialog).toBeVisible();
    await queryClient.invalidateQueries({
      queryKey: getGetFinanceOverviewQueryKey(ledger.id, { month: "2026-08" }),
    });
    expect(dialog).toBeVisible();
  });

  it("keeps cached Overview and a Quick Entry draft when a missing Adjustment is reconciled", async () => {
    const user = userEvent.setup();
    let missing = false;
    let overviewRequests = 0;
    let releaseRefresh!: () => void;
    const deferred = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const account = { ...overview.accounts[0]!, status: "active" as const };
    const adjustment = {
      ...dayTransactions[3],
      account: {
        id: account.id,
        name: account.name,
        status: "active" as const,
      },
    } satisfies TransactionHistoryPageResponse["items"][number];
    server.use(
      getListFinanceAccountsMockHandler([account]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler(() => ({
        items: missing ? [] : [adjustment],
        nextCursor: null,
      })),
      http.get("*/api/finance/ledgers/:ledgerId/overview", async () => {
        overviewRequests += 1;
        if (overviewRequests === 2) {
          await deferred;
          return HttpResponse.json(
            { type: "about:blank", title: "Unavailable", status: 503 },
            { status: 503 },
          );
        }
        return HttpResponse.json({
          ...overview,
          accounts: [account],
          days: missing
            ? []
            : [
                {
                  ...overview.days[0]!,
                  transactionCountByKind: {
                    balanceAdjustment: 1,
                    expense: 0,
                    income: 0,
                    internalTransfer: 0,
                  },
                },
              ],
        });
      }),
      http.get(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => {
          missing = true;
          return HttpResponse.json(
            {
              type: "about:blank",
              title: "Not Found",
              status: 404,
              code: "finance_transaction_not_found",
            },
            { status: 404 },
          );
        },
      ),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    const form = await screen.findByRole("form", { name: "Quick Entry" });
    const amount = within(form).getByRole("textbox", { name: "Amount" });
    await user.type(amount, "9.99");
    await user.click(
      await screen.findByRole("button", {
        name: /Edit Balance Adjustment.*aaaaaaa4/,
      }),
    );
    expect(
      await screen.findByText(
        "Transaction unavailable. It was already removed.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(overviewRequests).toBe(2));
    expect(
      screen.getByRole("grid", { name: "2026-08 Finance calendar" }),
    ).toBeInTheDocument();
    expect(form).toBeInTheDocument();
    expect(amount).toHaveValue("9.99");
    expect(
      screen.getByRole("button", { name: /2026-08-16.*Updating activity/ }),
    ).toBeVisible();
    releaseRefresh();
    await screen.findByRole("alert", { name: "Finance Overview error" });
    expect(
      screen.getByRole("button", {
        name: /2026-08-16.*Activity count unavailable/,
      }),
    ).toBeVisible();
    expect(amount).toHaveValue("9.99");
    await user.click(screen.getByRole("button", { name: "Retry Overview" }));
    expect(
      await screen.findByRole("button", {
        name: /2026-08-16.*No transactions/,
      }),
    ).toBeVisible();
  });

  it.each(["updated", "removed"] as const)(
    "suppresses Calendar counts through a %s Balance Adjustment replacement",
    async (outcome) => {
      const user = userEvent.setup();
      const account = { ...overview.accounts[0]!, status: "active" as const };
      const original = {
        ...dayTransactions[3],
        account: {
          id: account.id,
          name: account.name,
          status: "active" as const,
        },
      } satisfies TransactionHistoryPageResponse["items"][number];
      const updated = {
        ...original,
        correctionDelta: { amount: "2.00", currency: "CNY" as const },
      };
      let replaced = false;
      let requests = 0;
      let releaseRefresh!: () => void;
      const deferred = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      server.use(
        getListFinanceAccountsMockHandler([account]),
        getListFinanceCategoriesMockHandler([]),
        getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
        getListFinanceTransactionsMockHandler(() => ({
          items: replaced
            ? outcome === "updated"
              ? [updated]
              : []
            : [original],
          nextCursor: null,
        })),
        getGetFinanceTransactionMockHandler(() =>
          replaced && outcome === "updated" ? updated : original,
        ),
        http.get("*/api/finance/ledgers/:ledgerId/overview", async () => {
          requests += 1;
          if (requests > 1) await deferred;
          return HttpResponse.json({
            ...overview,
            accounts: [account],
            days:
              replaced && outcome === "removed"
                ? []
                : [
                    {
                      ...overview.days[0]!,
                      transactionCountByKind: {
                        balanceAdjustment: 1,
                        expense: 0,
                        income: 0,
                        internalTransfer: 0,
                      },
                    },
                  ],
          });
        }),
        http.get(
          "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
          ({ request }) =>
            HttpResponse.json({
              account: { id: account.id, name: account.name, status: "active" },
              accountNature: "asset",
              derivedComparisonBalance: { amount: "25.00", currency: "CNY" },
              transactionDate:
                new URL(request.url).searchParams.get("transactionDate") ?? "",
            } satisfies BalanceAdjustmentContextResponse),
        ),
        http.put(
          "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
          () => {
            replaced = true;
            return HttpResponse.json(
              outcome === "updated"
                ? { outcome, transaction: updated }
                : { outcome, transaction: null },
            );
          },
        ),
      );
      renderRoute(
        `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
      );
      await user.click(
        await screen.findByRole("button", {
          name: /Edit Balance Adjustment.*aaaaaaa4/,
        }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Edit Balance Adjustment",
      });
      const target = within(dialog).getByRole("textbox", {
        name: "Target balance",
      });
      await waitFor(() => expect(target).toBeEnabled());
      await user.type(target, outcome === "updated" ? "27.00" : "25.00");
      await user.click(
        within(dialog).getByRole("button", { name: "Save adjustment" }),
      );
      await waitFor(() => expect(requests).toBe(2));
      expect(
        screen.getByText("Updating Calendar activity."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", {
          name: "Selected-day activity",
          hidden: true,
        }),
      ).toHaveTextContent("Updating activity count");
      releaseRefresh();
      const expected =
        outcome === "updated"
          ? /2026-08-16.*1 transaction.*Balance Adjustment/
          : /2026-08-16.*No transactions/;
      expect(
        await screen.findByRole("button", { name: expected }),
      ).toBeVisible();
    },
  );

  it("keeps date-changing Edit feedback and suppresses old counts through failed Overview refresh", async () => {
    const user = userEvent.setup();
    let holdRefresh = false;
    let saved = false;
    let overviewRequests = 0;
    let releaseRefresh!: () => void;
    const deferred = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const account = { ...overview.accounts[0]!, status: "active" as const };
    const original = {
      ...dayTransactions[0],
      account: {
        id: account.id,
        name: account.name,
        status: "active" as const,
      },
      categoryAllocations: [
        { amount: dayTransactions[0].economicAmount, category: null },
      ],
    };
    const updated = {
      ...original,
      note: "Changed",
      transactionDate: "2026-08-17",
    };
    server.use(
      getListFinanceAccountsMockHandler(async () => {
        if (holdRefresh) await deferred;
        return [account];
      }),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
      getListFinanceTransactionsMockHandler(({ request }) => ({
        items: saved
          ? request.url.includes("fromDate=2026-08-17")
            ? [updated]
            : []
          : [original],
        nextCursor: null,
      })),
      getGetFinanceTransactionMockHandler(() => (saved ? updated : original)),
      http.get("*/api/finance/ledgers/:ledgerId/overview", async () => {
        overviewRequests += 1;
        if (holdRefresh) {
          await deferred;
          if (overviewRequests === 2)
            return HttpResponse.json(
              { type: "about:blank", title: "Unavailable", status: 503 },
              { status: 503 },
            );
        }
        return HttpResponse.json({
          ...overview,
          accounts: [account],
          days: saved
            ? [{ ...overview.days[0]!, date: "2026-08-17" }]
            : overview.days,
        });
      }),
      http.put(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => {
          saved = true;
          holdRefresh = true;
          return HttpResponse.json(updated);
        },
      ),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    const form = await screen.findByRole("form", { name: "Quick Entry" });
    const amount = within(form).getByRole("textbox", { name: "Amount" });
    await user.type(amount, "5.00");
    await user.click(
      await screen.findByRole("button", { name: /Edit Income.*aaaaaaa1/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Income" });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Save changes" }),
      ).toBeEnabled(),
    );
    const note = within(dialog).getByRole("textbox", { name: "Note" });
    const date = within(dialog).getByLabelText("Transaction date");
    await user.clear(date);
    await user.type(date, "2026-08-17");
    await user.clear(note);
    await user.type(note, "Changed");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    await waitFor(() => expect(saved).toBe(true));
    expect(dialog).toBeInTheDocument();
    expect(form).toBeInTheDocument();
    expect(amount).toHaveValue("5.00");
    expect(screen.getByText("Updating Calendar activity.")).toBeInTheDocument();
    releaseRefresh();
    expect(await screen.findByText("Transaction updated.")).toBeInTheDocument();
    expect(
      await screen.findByRole("alert", { name: "Finance Overview error" }),
    ).toBeVisible();
    expect(form).toBeInTheDocument();
    expect(amount).toHaveValue("5.00");
    expect(
      screen.getByText("Calendar activity counts unavailable. Retry Overview."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Selected-day activity" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry Overview" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /2026-08-17.*1 transaction/ }),
      ).toBeVisible(),
    );
    expect(
      screen.getByRole("button", { name: /2026-08-16.*No transactions/ }),
    ).toBeVisible();
  });

  it("keeps empty Ledger activity distinct from zero-valued represented currencies", async () => {
    server.use(
      getGetFinanceOverviewMockHandler({
        ...overview,
        accounts: [],
        days: [],
        financialPositionByCurrency: [],
        monthSummaryByCurrency: [],
      }),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-01`,
    );
    const position = await screen.findByRole("region", {
      name: "Current financial position",
    });
    expect(within(position).getByText("No Account balances yet")).toBeVisible();
    expect(
      within(position).getByRole("link", { name: "Go to Accounts" }),
    ).toHaveAttribute("href", `/finance/accounts?ledger=${ledger.id}`);
    expect(
      within(
        screen.getByRole("region", { name: "Selected-month activity" }),
      ).getByText("No Account currencies are represented in this Ledger yet."),
    ).toBeVisible();
    const calendar = screen.getByRole("grid", {
      name: "2026-08 Finance calendar",
    });
    expect(within(calendar).getAllByRole("button")).toHaveLength(31);
    expect(
      within(calendar).getByRole("button", {
        name: /2026-08-01.*No transactions/,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Account summary" }),
    ).toHaveTextContent("No Accounts in this Ledger yet.");
  });

  it("shows all involved currencies and every kind on a multi-currency active date", async () => {
    const activity = overview.days[0]!;
    server.use(
      getGetFinanceOverviewMockHandler({
        ...overview,
        days: [
          {
            ...activity,
            activityByCurrency: [
              ...activity.activityByCurrency,
              {
                currency: "JPY",
                expense: { amount: "0", currency: "JPY" },
                income: { amount: "0", currency: "JPY" },
                net: { amount: "0", currency: "JPY" },
                transactionCount: 1,
              },
              {
                currency: "USD",
                expense: { amount: "0.00", currency: "USD" },
                income: { amount: "0.00", currency: "USD" },
                net: { amount: "0.00", currency: "USD" },
                transactionCount: 1,
              },
            ],
            transactionCount: 3,
            transactionCountByKind: {
              balanceAdjustment: 1,
              expense: 0,
              income: 0,
              internalTransfer: 2,
            },
          },
        ],
      }),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    const calendar = await screen.findByRole("grid", {
      name: "2026-08 Finance calendar",
    });
    const day = within(calendar).getByRole("button", {
      name: /2026-08-16.*3 transactions.*Internal Transfer.*Balance Adjustment.*CNY and JPY and USD/,
    });
    expect(day).toHaveTextContent("3 currencies");
    expect(day).not.toHaveTextContent(/0\.00|0 CNY/);
  });

  it("preserves Ledger, month, and cached position on failed background refresh", async () => {
    const user = userEvent.setup();
    server.use(getGetFinanceOverviewMockHandler(overview));
    const { queryClient, router } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    expect(
      await screen.findByRole("region", { name: "Current financial position" }),
    ).toBeVisible();
    const focusedDay = screen.getByRole("button", {
      name: /2026-08-16.*Selected/,
    });
    focusedDay.focus();
    server.use(
      getGetFinanceOverviewMockHandler503({
        code: "database_unavailable",
        detail: "db.internal.example refused the connection",
        status: 503,
        title: "Service Unavailable",
        type: "about:blank",
      }),
    );
    await queryClient.invalidateQueries({
      queryKey: getGetFinanceOverviewQueryKey(ledger.id, { month: "2026-08" }),
    });
    const alert = await screen.findByRole("alert", {
      name: "Finance Overview error",
    });
    expect(alert).toHaveTextContent("Finance Overview could not load for");
    expect(screen.getByLabelText("Selected month 2026-08")).toBeVisible();
    expect(alert).not.toHaveTextContent("db.internal.example");
    expect(focusedDay).toHaveFocus();
    expect(focusedDay).toHaveAccessibleName(/Activity count unavailable/);
    expect(
      screen.getByRole("region", { name: "Current financial position" }),
    ).toBeVisible();
    expect(router.state.location.search).toBe(
      `?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    server.use(getGetFinanceOverviewMockHandler(overview));
    await user.click(screen.getByRole("button", { name: "Retry Overview" }));
    expect(
      await screen.findByRole("region", { name: "Current financial position" }),
    ).toBeVisible();
  });

  it("does not display an Overview response for a different Ledger or month", async () => {
    server.use(
      getGetFinanceOverviewMockHandler({
        ...overview,
        ledger: {
          id: "b9aa59ad-aa6b-49f5-9f4c-8ed071ea3f74",
          name: "Another Ledger",
        },
      }),
    );
    renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    expect(
      await screen.findByRole("alert", { name: "Finance Overview error" }),
    ).toHaveTextContent("Finance Overview could not load");
    expect(
      screen.queryByText("123,456,789,012,345.67 CNY"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /2026-08-16.*Activity count unavailable/,
      }),
    ).toBeVisible();
  });

  it("keeps cached Calendar controls but suppresses counts after a context-invalid Overview refresh", async () => {
    const user = userEvent.setup();
    let requests = 0;
    server.use(
      getGetFinanceOverviewMockHandler(() => {
        requests += 1;
        return {
          ...overview,
          ledger:
            requests === 2
              ? {
                  id: "b9aa59ad-aa6b-49f5-9f4c-8ed071ea3f74",
                  name: "Another Ledger",
                }
              : overview.ledger,
        };
      }),
    );
    const { queryClient } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    const calendar = await screen.findByRole("grid", {
      name: "2026-08 Finance calendar",
    });
    const day = within(calendar).getByRole("button", {
      name: /2026-08-16.*1 transaction/,
    });
    day.focus();
    await queryClient.invalidateQueries({
      queryKey: getGetFinanceOverviewQueryKey(ledger.id, { month: "2026-08" }),
    });
    expect(requests).toBe(2);
    expect(calendar).toBeInTheDocument();
    expect(day).toHaveFocus();
    await waitFor(() =>
      expect(day).toHaveAccessibleName(/Activity count unavailable/),
    );
    await user.click(screen.getByRole("button", { name: "Retry Overview" }));
    await waitFor(() => expect(requests).toBe(3));
    await waitFor(() => expect(day).toHaveAccessibleName(/1 transaction/));
  });
});
