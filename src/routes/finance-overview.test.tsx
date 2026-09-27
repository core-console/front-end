import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getGetFinanceOverviewMockHandler503,
  getGetFinanceOverviewMockHandler,
  getListFinanceLedgersMockHandler,
} from "@/api/generated/core-console.msw";
import { getGetFinanceOverviewQueryKey } from "@/api/generated/core-console";
import { type FinanceOverviewResponse } from "@/api/generated/schemas";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

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
    expect(router.state.location.search).toContain("date=2026-08-16");

    releaseRefresh();
    await refresh;
    expect(focusedDay).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(router.state.location.search).toContain("date=2026-08-17"),
    );
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

  it("preserves Ledger and month context on failure and retries without showing stale position", async () => {
    const user = userEvent.setup();
    server.use(getGetFinanceOverviewMockHandler(overview));
    const { queryClient, router } = renderRoute(
      `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
    );
    expect(
      await screen.findByRole("region", { name: "Current financial position" }),
    ).toBeVisible();
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
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Finance Overview could not load for");
    expect(screen.getByLabelText("Selected month 2026-08")).toBeVisible();
    expect(alert).not.toHaveTextContent("db.internal.example");
    expect(
      screen.queryByRole("region", { name: "Current financial position" }),
    ).not.toBeInTheDocument();
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Finance Overview could not load",
    );
    expect(
      screen.queryByText("123,456,789,012,345.67 CNY"),
    ).not.toBeInTheDocument();
  });
});
