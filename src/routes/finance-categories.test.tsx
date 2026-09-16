import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  getListFinanceCategoriesMockHandler,
  getListFinanceCategoriesMockHandler503,
  getListFinanceLedgersMockHandler,
  getCreateFinanceCategoryMockHandler,
  getCreateFinanceCategoryMockHandler409,
  getCreateFinanceCategoryMockHandler500,
  getArchiveFinanceCategoryMockHandler,
  getUpdateFinanceCategoryMockHandler,
  getUpdateFinanceCategoryMockHandler409,
  getUpdateFinanceCategoryMockHandler404,
  getUnarchiveFinanceCategoryMockHandler409,
  getUnarchiveFinanceCategoryMockHandler,
} from "@/api/generated/core-console.msw";
import type { CategoryResponse } from "@/api/generated/schemas";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

const ledger = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Personal",
} as const;

const teamLedger = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "Team fund",
} as const;

const categories = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Transport",
    status: "active",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Food",
    status: "active",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Subscriptions",
    status: "archived",
  },
] satisfies CategoryResponse[];

describe("Finance Categories destination", () => {
  it("separates Categories by lifecycle while retaining backend order", async () => {
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(categories),
    );

    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    const active = await screen.findByRole(
      "region",
      { name: "Active Categories" },
      { timeout: 5_000 },
    );
    const archived = screen.getByRole("region", {
      name: "Archived Categories",
    });

    expect(
      within(active)
        .getAllByRole("article")
        .map((row) => row.getAttribute("aria-label")),
    ).toEqual(["Transport", "Food"]);
    expect(
      within(archived)
        .getAllByRole("article")
        .map((row) => row.getAttribute("aria-label")),
    ).toEqual(["Subscriptions"]);
  });

  it("disambiguates duplicate names throughout Category workflows", async () => {
    const user = userEvent.setup();
    const duplicateFood = {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Food",
      status: "active",
    } as const;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler([categories[1]!, duplicateFood]),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    const firstIdentity = `Food, Category ID ${categories[1]!.id}`;
    const secondIdentity = `Food, Category ID ${duplicateFood.id}`;
    const firstRow = await screen.findByRole(
      "article",
      { name: firstIdentity },
      { timeout: 5_000 },
    );
    const secondRow = screen.getByRole("article", { name: secondIdentity });
    expect(
      within(firstRow).getByText(`Category ID ${categories[1]!.id}`),
    ).toBeVisible();
    expect(
      within(secondRow).getByText(`Category ID ${duplicateFood.id}`),
    ).toBeVisible();

    await user.click(
      within(firstRow).getByRole("button", {
        name: `Actions for ${firstIdentity}`,
      }),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: `Rename ${firstIdentity}`,
      }),
    );
    const rename = screen.getByRole("dialog", {
      name: `Rename ${firstIdentity}`,
    });
    await user.keyboard("{Escape}");
    expect(rename).not.toBeVisible();

    await user.click(
      within(secondRow).getByRole("button", {
        name: `Actions for ${secondIdentity}`,
      }),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: `Archive ${secondIdentity}`,
      }),
    );
    expect(
      screen.getByRole("alertdialog", {
        name: `Archive ${secondIdentity}?`,
      }),
    ).toBeVisible();
  });

  it("announces the exact duplicate Category after lifecycle changes", async () => {
    const user = userEvent.setup();
    const duplicateFood = {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Food",
      status: "archived",
    } as const;
    const archivedFood = { ...categories[1]!, status: "archived" } as const;
    const activeDuplicateFood = { ...duplicateFood, status: "active" } as const;
    let listedCategories: CategoryResponse[] = [categories[1]!, duplicateFood];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(() => listedCategories),
      getArchiveFinanceCategoryMockHandler(() => {
        listedCategories = [archivedFood, duplicateFood];
        return archivedFood;
      }),
      getUnarchiveFinanceCategoryMockHandler(() => {
        listedCategories = [archivedFood, activeDuplicateFood];
        return activeDuplicateFood;
      }),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    const archivedIdentity = `Food, Category ID ${categories[1]!.id}`;
    const unarchivedIdentity = `Food, Category ID ${duplicateFood.id}`;
    await user.click(
      await screen.findByRole(
        "button",
        { name: `Actions for ${archivedIdentity}` },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: `Archive ${archivedIdentity}`,
      }),
    );
    await user.click(
      within(
        screen.getByRole("alertdialog", {
          name: `Archive ${archivedIdentity}?`,
        }),
      ).getByRole("button", { name: "Archive Category" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        `${archivedIdentity} archived.`,
      ),
    );

    await user.click(
      screen.getByRole("button", {
        name: `Actions for ${unarchivedIdentity}`,
      }),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: `Unarchive ${unarchivedIdentity}`,
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        `${unarchivedIdentity} unarchived.`,
      ),
    );
  });

  it("keeps a conflicting create open with its entered name", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(categories),
      getCreateFinanceCategoryMockHandler409({
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "finance_category_name_conflict",
      }),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create category" },
        { timeout: 5_000 },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Create category" });
    const name = within(dialog).getByLabelText("Category name");
    await user.type(name, "Food");
    await user.click(
      within(dialog).getByRole("button", { name: "Create category" }),
    );

    const error = await within(dialog).findByRole("alert");
    expect(error).toHaveTextContent(
      "A Category with this name already exists.",
    );
    expect(name).toHaveValue("Food");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-describedby", error.id);
  });

  it("does not dismiss a pending Create workflow", async () => {
    const user = userEvent.setup();
    let releaseCreate!: () => void;
    const pendingCreate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const createdCategory = {
      ...categories[0]!,
      name: "Travel",
    } as const;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler([]),
      getCreateFinanceCategoryMockHandler(async () => {
        await pendingCreate;
        return createdCategory;
      }),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create category" },
        { timeout: 5_000 },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Create category" });
    await user.type(within(dialog).getByLabelText("Category name"), "Travel");
    await user.click(
      within(dialog).getByRole("button", { name: "Create category" }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Creating…" }),
      ).toBeDisabled(),
    );

    await user.keyboard("{Escape}");
    const pendingDialog = screen.queryByRole("dialog", {
      name: "Create category",
    });
    releaseCreate();

    expect(pendingDialog).toBe(dialog);
    expect(within(dialog).getByLabelText("Category name")).toHaveValue(
      "Travel",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Create category" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("reconciles a confirmed create in backend name order before refresh", async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const strasz = { ...categories[0]!, name: "Strasz" };
    const strasse = {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Straße",
      status: "active",
    } as const;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(async () => {
        listRequests += 1;
        if (listRequests > 1) await pendingRefresh;
        return listRequests === 1 ? [strasz] : [strasse, strasz];
      }),
      getCreateFinanceCategoryMockHandler(strasse),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create category" },
        { timeout: 5_000 },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Create category" });
    await user.type(within(dialog).getByLabelText("Category name"), "Straße");
    await user.click(
      within(dialog).getByRole("button", { name: "Create category" }),
    );

    await waitFor(() => expect(listRequests).toBe(2));
    const active = screen.getByRole("region", { name: "Active Categories" });
    expect(
      within(active)
        .getAllByRole("article")
        .map((row) => row.getAttribute("aria-label")),
    ).toEqual(["Straße", "Strasz"]);
    releaseRefresh();
  });

  it("keeps a conflicting rename open with its entered name", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(categories),
      getUpdateFinanceCategoryMockHandler409({
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "finance_category_name_conflict",
      }),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Actions for Food" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Rename Food" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Rename Food" });
    const name = within(dialog).getByLabelText("Category name");
    await user.clear(name);
    await user.type(name, "Transport");
    await user.click(
      within(dialog).getByRole("button", { name: "Rename category" }),
    );

    expect(
      await within(dialog).findByText(
        "A Category with this name already exists.",
      ),
    ).toBeVisible();
    expect(name).toHaveValue("Transport");
  });

  it("does not dismiss a pending Rename workflow", async () => {
    const user = userEvent.setup();
    let releaseRename!: () => void;
    const pendingRename = new Promise<void>((resolve) => {
      releaseRename = resolve;
    });
    const renamedCategory = {
      ...categories[0]!,
      name: "Dining",
    } as const;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(categories),
      getUpdateFinanceCategoryMockHandler(async () => {
        await pendingRename;
        return renamedCategory;
      }),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Actions for Transport" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Rename Transport" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Rename Transport" });
    const name = within(dialog).getByLabelText("Category name");
    await user.clear(name);
    await user.type(name, "Dining");
    await user.click(
      within(dialog).getByRole("button", { name: "Rename category" }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Renaming…" }),
      ).toBeDisabled(),
    );

    await user.keyboard("{Escape}");
    const pendingDialog = screen.queryByRole("dialog", {
      name: "Rename Transport",
    });
    releaseRename();

    expect(pendingDialog).toBe(dialog);
    expect(name).toHaveValue("Dining");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Rename Transport" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("reconciles a confirmed rename in backend name order before refresh", async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const renamedTransport = {
      ...categories[0]!,
      name: "Dining",
    } as const;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(async () => {
        listRequests += 1;
        if (listRequests > 1) await pendingRefresh;
        return listRequests === 1
          ? categories
          : [renamedTransport, categories[1]!, categories[2]!];
      }),
      getUpdateFinanceCategoryMockHandler(renamedTransport),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Actions for Transport" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Rename Transport" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Rename Transport" });
    const name = within(dialog).getByLabelText("Category name");
    await user.clear(name);
    await user.type(name, "Dining");
    await user.click(
      within(dialog).getByRole("button", { name: "Rename category" }),
    );

    await waitFor(() => expect(listRequests).toBe(2));
    expect(
      within(screen.getByRole("region", { name: "Active Categories" }))
        .getAllByRole("article")
        .map((row) => row.getAttribute("aria-label")),
    ).toEqual(["Dining", "Food"]);
    releaseRefresh();
  });

  it("confirms archive and reconciles the confirmed lifecycle immediately", async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const archivedTransport = {
      ...categories[0]!,
      status: "archived",
    } as const;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(async () => {
        listRequests += 1;
        if (listRequests > 1) await pendingRefresh;
        return listRequests === 1
          ? categories
          : [categories[1]!, archivedTransport, categories[2]!];
      }),
      getArchiveFinanceCategoryMockHandler(archivedTransport),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    const actions = await screen.findByRole(
      "button",
      { name: "Actions for Transport" },
      { timeout: 5_000 },
    );
    await user.click(actions);
    await user.click(
      await screen.findByRole("menuitem", { name: "Archive Transport" }),
    );
    const confirmation = screen.getByRole("alertdialog", {
      name: "Archive Transport?",
    });
    expect(confirmation).toHaveTextContent("historical Category allocations");
    expect(confirmation).toHaveTextContent("new Transaction suggestions");
    await waitFor(() =>
      expect(
        within(confirmation).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus(),
    );
    await user.click(
      within(confirmation).getByRole("button", { name: "Archive Category" }),
    );

    await waitFor(() => expect(listRequests).toBe(2));
    expect(
      within(screen.getByRole("region", { name: "Archived Categories" }))
        .getAllByRole("article")
        .map((row) => row.getAttribute("aria-label")),
    ).toContain("Transport");
    expect(
      within(screen.getByRole("region", { name: "Active Categories" }))
        .getAllByRole("article")
        .map((row) => row.getAttribute("aria-label")),
    ).not.toContain("Transport");
    const movedActions = screen.getByRole("button", {
      name: "Actions for Transport",
    });
    expect(movedActions).not.toBe(actions);
    await waitFor(() => expect(movedActions).toHaveFocus());
    releaseRefresh();
  });

  it("offers a separate Rename path after an unarchive name conflict", async () => {
    const user = userEvent.setup();
    let unarchiveRequests = 0;
    const duplicateSubscriptions = {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Subscriptions",
      status: "active",
    } as const;
    const archivedIdentity = `Subscriptions, Category ID ${categories[2]!.id}`;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler([
        duplicateSubscriptions,
        categories[2]!,
      ]),
      getUnarchiveFinanceCategoryMockHandler409(() => {
        unarchiveRequests += 1;
        return {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "finance_category_name_conflict",
        };
      }),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: `Actions for ${archivedIdentity}` },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: `Unarchive ${archivedIdentity}`,
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(archivedIdentity);
    expect(alert).toHaveTextContent(
      "A Category with this name already exists.",
    );
    expect(alert).toHaveTextContent("rename it, then retry Unarchive");
    await user.click(
      within(alert).getByRole("button", {
        name: `Rename ${archivedIdentity}`,
      }),
    );

    expect(
      screen.getByRole("dialog", { name: `Rename ${archivedIdentity}` }),
    ).toBeVisible();
    expect(unarchiveRequests).toBe(1);
  });

  it("navigates to Transactions with a validated Category filter", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(categories),
    );
    const { router } = renderRoute(
      `/finance/categories?ledger=${ledger.id}&category_id=not-a-category`,
    );

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Actions for Food" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: "View transactions for Food",
      }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/finance/transactions");
    });
    expect(
      Object.fromEntries(new URLSearchParams(router.state.location.search)),
    ).toEqual({
      ledger: ledger.id,
      category_id: categories[1]!.id,
    });
  });

  it("explains optional categorization when the Ledger has no Categories", async () => {
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler([]),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    expect(
      await screen.findByRole(
        "heading",
        { name: "No Categories yet" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/Categories are optional.*Uncategorized/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create category" }),
    ).toBeEnabled();
  });

  it("keeps archived Categories manageable when none are active", async () => {
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler([categories[2]!]),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    expect(
      await screen.findByRole(
        "heading",
        { name: "No active Categories" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/new Transactions can remain Uncategorized/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Actions for Subscriptions" }),
    ).toBeEnabled();
  });

  it("keeps Categories loading inside the resolved Ledger destination", async () => {
    let releaseCategories!: () => void;
    const pendingCategories = new Promise<void>((resolve) => {
      releaseCategories = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(async () => {
        await pendingCategories;
        return [];
      }),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    expect(
      await screen.findByRole(
        "status",
        { name: "Loading Categories" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "Categories" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Personal" })).toBeVisible();

    releaseCategories();
    expect(
      await screen.findByRole("heading", { name: "No Categories yet" }),
    ).toBeVisible();
  });

  it("contains a Categories failure and retries without backend detail", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler503({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        code: "database_unavailable",
        detail: "db.internal.example refused the connection",
      }),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    const alert = await screen.findByRole("alert", undefined, {
      timeout: 5_000,
    });
    expect(alert).toHaveTextContent(
      "Categories could not be loaded. Try again.",
    );
    expect(alert).not.toHaveTextContent(/db\.internal/i);
    expect(screen.getByRole("button", { name: "Personal" })).toBeVisible();

    server.use(getListFinanceCategoriesMockHandler([categories[0]!]));
    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("article", { name: "Transport" }),
    ).toBeVisible();
  });

  it("abandons Category drafts and loads the newly addressed Ledger", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger, teamLedger]),
      getListFinanceCategoriesMockHandler(({ params }) =>
        params.ledgerId === teamLedger.id
          ? [{ ...categories[0]!, name: "Team travel" }]
          : categories,
      ),
    );
    const { router } = renderRoute(`/finance/categories?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create category" },
        { timeout: 5_000 },
      ),
    );
    await user.type(
      within(
        screen.getByRole("dialog", { name: "Create category" }),
      ).getByLabelText("Category name"),
      "Draft category",
    );

    await router.navigate(`/finance/categories?ledger=${teamLedger.id}`);

    expect(
      await screen.findByRole("button", { name: "Team fund" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("article", { name: "Team travel" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Create category" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "Food" }),
    ).not.toBeInTheDocument();
  });

  it("removes stale Category state when Rename reports not found", async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(async () => {
        listRequests += 1;
        if (listRequests > 1) await pendingRefresh;
        return listRequests === 1 ? categories : categories.slice(1);
      }),
      getUpdateFinanceCategoryMockHandler404({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        code: "finance_category_not_found",
      }),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);
    const createCategory = await screen.findByRole(
      "button",
      { name: "Create category" },
      { timeout: 5_000 },
    );

    await user.click(
      screen.getByRole("button", { name: "Actions for Transport" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Rename Transport" }),
    );
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Rename Transport" }),
      ).getByRole("button", { name: "Rename category" }),
    );

    expect(
      await screen.findByText(/This Category is no longer available/i),
    ).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "Transport" }),
    ).not.toBeInTheDocument();
    expect(listRequests).toBe(2);
    await waitFor(() => expect(createCategory).toHaveFocus());
    releaseRefresh();
  });

  it("exposes pending lifecycle state and prevents duplicate actions", async () => {
    const user = userEvent.setup();
    let releaseUnarchive!: () => void;
    const pendingUnarchive = new Promise<void>((resolve) => {
      releaseUnarchive = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(categories),
      getUnarchiveFinanceCategoryMockHandler(async () => {
        await pendingUnarchive;
        return { ...categories[2]!, status: "active" };
      }),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Actions for Subscriptions" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Unarchive Subscriptions" }),
    );

    const row = screen.getByRole("article", { name: "Subscriptions" });
    await waitFor(() => expect(row).toHaveAttribute("aria-busy", "true"));
    expect(
      screen.getByRole("button", { name: "Actions for Subscriptions" }),
    ).toBeDisabled();

    releaseUnarchive();
    await waitFor(() => expect(row).not.toHaveAttribute("aria-busy", "true"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Actions for Subscriptions" }),
      ).toHaveFocus(),
    );
  });

  it("validates Category name length by Unicode code points", async () => {
    const user = userEvent.setup();
    const backendValidName = "😀".repeat(100);
    const overlongName = "😀".repeat(101);
    let createRequests = 0;
    let requestBody: unknown;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler([]),
      getCreateFinanceCategoryMockHandler(async ({ request }) => {
        createRequests += 1;
        requestBody = await request.json();
        return {
          id: categories[0]!.id,
          name: backendValidName,
          status: "active",
        };
      }),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create category" },
        { timeout: 5_000 },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Create category" });
    const name = within(dialog).getByLabelText("Category name");
    await user.click(name);
    await user.paste(overlongName);
    await user.click(
      within(dialog).getByRole("button", { name: "Create category" }),
    );

    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(createRequests).toBe(0);

    await user.clear(name);
    await user.paste(` ${backendValidName} `);
    await user.click(
      within(dialog).getByRole("button", { name: "Create category" }),
    );

    expect(createRequests).toBe(1);
    expect(requestBody).toEqual({ name: backendValidName });
  });

  it("uses a safe fallback for an unknown create failure", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler([]),
      getCreateFinanceCategoryMockHandler500({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        code: "unexpected_internal_failure",
        detail: "finance_categories constraint internals",
      }),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create category" },
        { timeout: 5_000 },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Create category" });
    await user.type(within(dialog).getByLabelText("Category name"), "Travel");
    await user.click(
      within(dialog).getByRole("button", { name: "Create category" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The Category could not be created. Try again.",
    );
    expect(dialog).not.toHaveTextContent(/constraint internals/i);
  });

  it("reconciles a confirmed unarchive before refresh completes", async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const activeSubscriptions = {
      ...categories[2]!,
      status: "active",
    } as const;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCategoriesMockHandler(async () => {
        listRequests += 1;
        if (listRequests > 1) await pendingRefresh;
        return listRequests === 1
          ? categories
          : [categories[0]!, categories[1]!, activeSubscriptions];
      }),
      getUnarchiveFinanceCategoryMockHandler(activeSubscriptions),
    );
    renderRoute(`/finance/categories?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Actions for Subscriptions" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Unarchive Subscriptions" }),
    );

    await waitFor(() => expect(listRequests).toBe(2));
    expect(
      within(screen.getByRole("region", { name: "Active Categories" }))
        .getAllByRole("article")
        .map((row) => row.getAttribute("aria-label")),
    ).toContain("Subscriptions");
    expect(
      screen.queryByRole("region", { name: "Archived Categories" }),
    ).not.toBeInTheDocument();
    releaseRefresh();
  });
});
