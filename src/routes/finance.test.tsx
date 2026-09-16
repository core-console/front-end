import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { getListFinanceLedgersQueryKey } from "@/api/generated/core-console";
import {
  getListFinanceLedgersMockHandler,
  getListFinanceLedgersMockHandler503,
  getCreateFinanceLedgerMockHandler,
  getCreateFinanceLedgerMockHandler409,
  getUpdateFinanceLedgerMockHandler,
  getUpdateFinanceLedgerMockHandler404,
  getUpdateFinanceLedgerMockHandler409,
} from "@/api/generated/core-console.msw";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

const personalLedger = {
  id: "a40a626a-99f1-4e81-940b-66f9e0d45c90",
  name: "Personal",
};
const teamLedger = {
  id: "b9aa59ad-aa6b-49f5-9f4c-8ed071ea3f74",
  name: "Team fund",
};
const straszLedger = { ...teamLedger, name: "Strasz" };
const strasseLedger = {
  id: "cb052250-9ee8-4b70-bef6-e7fa8f1bce5b",
  name: "Straße",
};

describe("Finance foundation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("exposes one global Finance destination and four local destinations", async () => {
    server.use(getListFinanceLedgersMockHandler([personalLedger]));

    renderRoute(`/finance/transactions?ledger=${personalLedger.id}`);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Transactions" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("banner")).getByText("Finance"),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Finance", current: "page" }),
    ).toHaveAttribute("href", "/finance/overview");

    const localNavigation = screen.getByRole("navigation", {
      name: "Finance navigation",
    });
    expect(
      within(localNavigation).getByRole("link", {
        name: "Transactions",
        current: "page",
      }),
    ).toBeVisible();
    expect(within(localNavigation).getAllByRole("link")).toHaveLength(4);
    expect(
      await screen.findByRole("button", { name: "Personal" }),
    ).toBeVisible();
  });

  it("rejects detail-like path segments outside Transactions", async () => {
    server.use(getListFinanceLedgersMockHandler([personalLedger]));

    renderRoute(
      `/finance/accounts/${personalLedger.id}?ledger=${personalLedger.id}`,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { level: 1, name: "Accounts" }),
    ).not.toBeInTheDocument();
  });

  it("removes an invalid Transaction id and retains only valid portable state", async () => {
    server.use(getListFinanceLedgersMockHandler([personalLedger]));
    const { router } = renderRoute(
      `/finance/transactions/not-a-transaction?ledger=${personalLedger.id}&from=2026-08-01&to=invalid&kind=unknown&uncategorized=true&account_id=edb4ee80-17c6-46b5-863e-2afa18e84043`,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Transactions" }),
    ).toBeVisible();
    await waitFor(() => {
      expect(
        `${router.state.location.pathname}${router.state.location.search}`,
      ).toBe(
        `/finance/transactions?ledger=${personalLedger.id}&from=2026-08-01&uncategorized=true&account_id=edb4ee80-17c6-46b5-863e-2afa18e84043`,
      );
    });
  });

  it("preserves validated portable state when resolving a remembered Ledger", async () => {
    localStorage.setItem("core-console.finance.last-ledger-id", teamLedger.id);
    server.use(getListFinanceLedgersMockHandler([personalLedger, teamLedger]));

    const { router } = renderRoute(
      "/finance/transactions?from=2026-08-01&kind=expense&to=invalid",
    );

    expect(
      await screen.findByRole("button", { name: "Team fund" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/finance/transactions");
    expect(router.state.location.search).toBe(
      `?ledger=${teamLedger.id}&from=2026-08-01&kind=expense`,
    );
  });

  it("preserves validated portable state when resolving the default Ledger", async () => {
    server.use(getListFinanceLedgersMockHandler([personalLedger, teamLedger]));

    const { router } = renderRoute(
      "/finance/transactions?month=2026-08&date=invalid&kind=expense",
    );

    expect(
      await screen.findByRole("button", { name: "Personal" }),
    ).toBeVisible();
    expect(router.state.location.search).toBe(
      `?ledger=${personalLedger.id}&month=2026-08&kind=expense`,
    );
  });

  it("does not substitute another Ledger for an unavailable addressed Ledger", async () => {
    server.use(getListFinanceLedgersMockHandler([personalLedger]));

    const { router } = renderRoute(
      `/finance/transactions?ledger=${teamLedger.id}`,
    );

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Ledger unavailable",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "The requested Ledger is not available. Select another Ledger to continue.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Choose a Ledger" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute(
      "href",
      `/finance/accounts?ledger=${teamLedger.id}`,
    );
    expect(
      screen.queryByText("Transactions for Personal"),
    ).not.toBeInTheDocument();
    expect(router.state.location.search).toBe(`?ledger=${teamLedger.id}`);
  });

  it("treats malformed Ledger context as addressed and unavailable", async () => {
    localStorage.setItem(
      "core-console.finance.last-ledger-id",
      personalLedger.id,
    );
    server.use(getListFinanceLedgersMockHandler([personalLedger]));
    const { router } = renderRoute("/finance/accounts?ledger=");

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Ledger unavailable",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Choose a Ledger" }),
    ).toBeVisible();
    expect(router.state.location.search).toBe("?ledger=");
    expect(screen.getByRole("link", { name: "Categories" })).toHaveAttribute(
      "href",
      "/finance/categories?ledger=",
    );
    expect(screen.queryByText("Accounts for Personal")).not.toBeInTheDocument();
  });

  it("keeps Ledger resolution pending until the list succeeds", async () => {
    let releaseList!: () => void;
    const pendingList = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler(async () => {
        await pendingList;
        return [personalLedger];
      }),
    );

    renderRoute("/finance/overview");

    expect(
      await screen.findByRole("status", { name: "Loading Finance Ledgers" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Create your first Ledger" }),
    ).not.toBeInTheDocument();

    releaseList();
    expect(
      await screen.findByRole("button", { name: "Personal" }),
    ).toBeVisible();
  });

  it("contains a Ledger-list failure and retries only that request", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler503({
        code: "database_unavailable",
        detail: "Database host db.internal.example refused the connection.",
        status: 503,
        title: "Service Unavailable",
        type: "about:blank",
      }),
    );

    renderRoute("/finance/categories");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Finance could not load your Ledgers. Try again.",
    );
    expect(alert).not.toHaveTextContent(/db\.internal/i);
    expect(
      screen.queryByRole("heading", { name: "Create your first Ledger" }),
    ).not.toBeInTheDocument();

    server.use(getListFinanceLedgersMockHandler([personalLedger]));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("button", { name: "Personal" }),
    ).toBeVisible();
  });

  it("creates an explicitly named first Ledger and enters dated Overview", async () => {
    const user = userEvent.setup();
    let ledgers: Array<typeof personalLedger> = [];
    let createRequests = 0;
    let createBody: unknown;
    server.use(
      getListFinanceLedgersMockHandler(() => ledgers),
      getCreateFinanceLedgerMockHandler(async ({ request }) => {
        createRequests += 1;
        createBody = await request.json();
        ledgers = [{ ...personalLedger, name: "Household" }];
        return ledgers[0]!;
      }),
    );

    const { router } = renderRoute("/finance/categories");

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Create your first Ledger",
      }),
    ).toBeVisible();
    const name = screen.getByLabelText("Ledger name");
    expect(name).toHaveValue("Personal");
    await user.clear(name);
    await user.type(name, "Household");
    await user.click(screen.getByRole("button", { name: "Create Ledger" }));

    await waitFor(() => expect(createRequests).toBe(1));
    expect(createBody).toEqual({ name: "Household" });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/finance/overview");
    });
    expect(
      screen.getByRole("heading", { level: 1, name: "Overview" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("button", { name: "Household" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/finance/overview");
    const params = new URLSearchParams(router.state.location.search);
    const now = new Date();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    expect(params.get("ledger")).toBe(personalLedger.id);
    expect(params.get("month")).toBe(today.slice(0, 7));
    expect(params.get("date")).toBe(today);
  });

  it("switches Ledger while preserving only portable addressed state", async () => {
    const user = userEvent.setup();
    server.use(getListFinanceLedgersMockHandler([personalLedger, teamLedger]));
    const { router } = renderRoute(
      `/finance/transactions/77ef6ca4-f45a-4e77-9a29-07c56191fbca?ledger=${personalLedger.id}&month=2026-13&date=not-a-date&from=2026-08-01&to=2026-02-30&kind=expense&uncategorized=false&account_id=account-1&category_id=edb4ee80-17c6-46b5-863e-2afa18e84043&cursor=next`,
    );

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Team fund" }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/finance/transactions");
    });
    expect(
      Object.fromEntries(new URLSearchParams(router.state.location.search)),
    ).toEqual({
      ledger: teamLedger.id,
      from: "2026-08-01",
      kind: "expense",
    });
  });

  it("does nothing when the active Ledger is selected again", async () => {
    const user = userEvent.setup();
    server.use(getListFinanceLedgersMockHandler([personalLedger, teamLedger]));
    const initialUrl = `/finance/transactions/77ef6ca4-f45a-4e77-9a29-07c56191fbca?ledger=${personalLedger.id}&from=2026-08-01&account_id=edb4ee80-17c6-46b5-863e-2afa18e84043`;
    const { router } = renderRoute(initialUrl);

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await user.click(await screen.findByRole("menuitem", { name: "Personal" }));

    expect(
      `${router.state.location.pathname}${router.state.location.search}`,
    ).toBe(initialUrl);
  });

  it("names each Rename action for its target Ledger", async () => {
    const user = userEvent.setup();
    server.use(getListFinanceLedgersMockHandler([personalLedger, teamLedger]));
    renderRoute(`/finance/accounts?ledger=${personalLedger.id}`);

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    expect(
      await screen.findByRole("menuitem", {
        name: "Rename Personal Ledger",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "Team fund" }));

    await user.click(await screen.findByRole("button", { name: "Team fund" }));
    expect(
      await screen.findByRole("menuitem", {
        name: "Rename Team fund Ledger",
      }),
    ).toBeVisible();
  });

  it("keeps a conflicting rename open with its entered name", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([personalLedger, teamLedger]),
      getUpdateFinanceLedgerMockHandler409({
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "finance_ledger_name_conflict",
      }),
    );
    renderRoute(`/finance/accounts?ledger=${personalLedger.id}`);

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Rename Personal Ledger",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Rename Ledger" });
    const name = within(dialog).getByLabelText("Ledger name");
    await user.clear(name);
    await user.type(name, "Team fund");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));

    expect(
      await within(dialog).findByText(
        "A Ledger with this name already exists.",
      ),
    ).toBeVisible();
    expect(name).toHaveValue("Team fund");
    const error = within(dialog).getByRole("alert");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-describedby", error.id);
  });

  it("abandons Rename when browser history changes the active Ledger", async () => {
    const user = userEvent.setup();
    server.use(getListFinanceLedgersMockHandler([personalLedger, teamLedger]));
    const { router } = renderRoute(
      `/finance/accounts?ledger=${personalLedger.id}`,
    );

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Team fund" }),
    );
    await user.click(await screen.findByRole("button", { name: "Team fund" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Rename Team fund Ledger",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Rename Ledger" });
    await user.type(within(dialog).getByLabelText("Ledger name"), " draft");

    await router.navigate(-1);

    expect(
      await screen.findByRole("button", { name: "Personal" }),
    ).toBeVisible();
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Rename Ledger" }),
      ).not.toBeInTheDocument();
    });
  });

  it("abandons Rename when its Ledger disappears during a list refresh", async () => {
    const user = userEvent.setup();
    let ledgers = [personalLedger, teamLedger];
    server.use(getListFinanceLedgersMockHandler(() => ledgers));
    const { queryClient } = renderRoute(
      `/finance/accounts?ledger=${personalLedger.id}`,
    );

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Rename Personal Ledger",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Rename Ledger" }),
    ).toBeVisible();

    ledgers = [teamLedger];
    await queryClient.invalidateQueries({
      queryKey: getListFinanceLedgersQueryKey(),
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Rename Ledger" }),
      ).not.toBeInTheDocument();
    });
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Ledger unavailable",
      }),
    ).toBeVisible();
  });

  it("creates an additional Ledger and selects it in the current destination", async () => {
    const user = userEvent.setup();
    let ledgers = [personalLedger];
    server.use(
      getListFinanceLedgersMockHandler(() => ledgers),
      getCreateFinanceLedgerMockHandler(async ({ request }) => {
        const body = (await request.json()) as { name: string };
        const created = { ...teamLedger, name: body.name };
        ledgers = [...ledgers, created];
        return created;
      }),
    );
    const { router } = renderRoute(
      `/finance/categories?ledger=${personalLedger.id}`,
    );

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Create Ledger" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Create Ledger" });
    await user.type(within(dialog).getByLabelText("Ledger name"), "Household");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(
        new URLSearchParams(router.state.location.search).get("ledger"),
      ).toBe(teamLedger.id);
    });
    expect(router.state.location.pathname).toBe("/finance/categories");
    expect(
      await screen.findByRole("button", { name: "Household" }),
    ).toBeVisible();
  });

  it("reconciles a created Ledger in backend name order before refresh completes", async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const createdLedger = { ...teamLedger, name: "accounts" };
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler(async () => {
        listRequests += 1;
        if (listRequests > 1) await pendingRefresh;
        return listRequests === 1
          ? [personalLedger]
          : [createdLedger, personalLedger];
      }),
      getCreateFinanceLedgerMockHandler(createdLedger),
    );
    renderRoute(`/finance/accounts?ledger=${personalLedger.id}`);

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Create Ledger" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Create Ledger" });
    await user.type(within(dialog).getByLabelText("Ledger name"), "Team fund");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(
      await screen.findByRole("button", { name: "accounts" }),
    ).toBeVisible();
    expect(listRequests).toBe(2);
    await user.click(screen.getByRole("button", { name: "accounts" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .slice(0, 2)
        .map((item) => item.textContent),
    ).toEqual(["accounts", "Personal"]);
    releaseRefresh();
  });

  it("uses backend Unicode case-fold ordering before a create refresh completes", async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler(async () => {
        listRequests += 1;
        if (listRequests > 1) await pendingRefresh;
        return listRequests === 1
          ? [straszLedger]
          : [strasseLedger, straszLedger];
      }),
      getCreateFinanceLedgerMockHandler(strasseLedger),
    );
    renderRoute(`/finance/accounts?ledger=${straszLedger.id}`);

    await user.click(await screen.findByRole("button", { name: "Strasz" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Create Ledger" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Create Ledger" });
    await user.type(within(dialog).getByLabelText("Ledger name"), "Straße");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("button", { name: "Straße" })).toBeVisible();
    expect(listRequests).toBe(2);
    await user.click(screen.getByRole("button", { name: "Straße" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .slice(0, 2)
        .map((item) => item.textContent),
    ).toEqual(["Straße", "Strasz"]);
    releaseRefresh();
  });

  it("keeps a conflicting create open with its entered name", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([personalLedger]),
      getCreateFinanceLedgerMockHandler409({
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "finance_ledger_name_conflict",
      }),
    );
    renderRoute(`/finance/overview?ledger=${personalLedger.id}`);

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Create Ledger" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Create Ledger" });
    const name = within(dialog).getByLabelText("Ledger name");
    await user.type(name, "Personal");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(
      await within(dialog).findByText(
        "A Ledger with this name already exists.",
      ),
    ).toBeVisible();
    expect(name).toHaveValue("Personal");
    const error = within(dialog).getByRole("alert");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-describedby", error.id);
  });

  it("associates first-Ledger field validation with its input", async () => {
    const user = userEvent.setup();
    server.use(getListFinanceLedgersMockHandler([]));
    renderRoute("/finance/overview");

    const name = await screen.findByLabelText("Ledger name");
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Create Ledger" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Enter a Ledger name.");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining(error.id),
    );
  });

  it("associates first-Ledger server conflicts with its input", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([]),
      getCreateFinanceLedgerMockHandler409({
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "finance_ledger_name_conflict",
      }),
    );
    renderRoute("/finance/overview");

    const name = await screen.findByLabelText("Ledger name");
    await user.click(screen.getByRole("button", { name: "Create Ledger" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("A Ledger with this name already exists.");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining(error.id),
    );
  });

  it("renames the current Ledger without changing addressed context", async () => {
    const user = userEvent.setup();
    let ledgers = [personalLedger];
    server.use(
      getListFinanceLedgersMockHandler(() => ledgers),
      getUpdateFinanceLedgerMockHandler(async ({ request }) => {
        const body = (await request.json()) as { name: string };
        const renamed = { ...personalLedger, name: body.name };
        ledgers = [renamed];
        return renamed;
      }),
    );
    const { router } = renderRoute(
      `/finance/accounts?ledger=${personalLedger.id}`,
    );

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Rename Personal Ledger",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Rename Ledger" });
    const name = within(dialog).getByLabelText("Ledger name");
    await user.clear(name);
    await user.type(name, "Household");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));

    expect(
      await screen.findByRole("button", { name: "Household" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/finance/accounts");
    expect(
      new URLSearchParams(router.state.location.search).get("ledger"),
    ).toBe(personalLedger.id);
  });

  it("reconciles a renamed Ledger in backend name order before refresh completes", async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const renamedLedger = { ...personalLedger, name: "zebra" };
    server.use(
      getListFinanceLedgersMockHandler(async () => {
        listRequests += 1;
        if (listRequests > 1) await pendingRefresh;
        return listRequests === 1
          ? [personalLedger, teamLedger]
          : [teamLedger, renamedLedger];
      }),
      getUpdateFinanceLedgerMockHandler(renamedLedger),
    );
    renderRoute(`/finance/accounts?ledger=${personalLedger.id}`);

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Rename Personal Ledger",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Rename Ledger" });
    const name = within(dialog).getByLabelText("Ledger name");
    await user.clear(name);
    await user.type(name, "zebra");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));

    expect(await screen.findByRole("button", { name: "zebra" })).toBeVisible();
    expect(listRequests).toBe(2);
    await user.click(screen.getByRole("button", { name: "zebra" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .slice(0, 2)
        .map((item) => item.textContent),
    ).toEqual(["Team fund", "zebra"]);
    releaseRefresh();
  });

  it("removes a stale Ledger selection when Rename returns not found", async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    server.use(
      getListFinanceLedgersMockHandler(() => {
        listRequests += 1;
        return listRequests === 1 ? [personalLedger, teamLedger] : [teamLedger];
      }),
      getUpdateFinanceLedgerMockHandler404({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        code: "finance_ledger_not_found",
      }),
    );
    renderRoute(`/finance/accounts?ledger=${personalLedger.id}`);

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Rename Personal Ledger",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Rename Ledger" });
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Ledger unavailable",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Rename Ledger" }),
    ).not.toBeInTheDocument();
    expect(listRequests).toBe(2);
  });

  it("restores the prior Ledger through browser history", async () => {
    const user = userEvent.setup();
    server.use(getListFinanceLedgersMockHandler([personalLedger, teamLedger]));
    const { router } = renderRoute(
      `/finance/overview?ledger=${personalLedger.id}&month=2026-09&date=2026-09-12`,
    );

    await user.click(await screen.findByRole("button", { name: "Personal" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Team fund" }),
    );
    expect(
      await screen.findByRole("button", { name: "Team fund" }),
    ).toBeVisible();

    await router.navigate(-1);

    expect(
      await screen.findByRole("button", { name: "Personal" }),
    ).toBeVisible();
    expect(new URLSearchParams(router.state.location.search).get("month")).toBe(
      "2026-09",
    );
    expect(new URLSearchParams(router.state.location.search).get("date")).toBe(
      "2026-09-12",
    );
  });
});
