import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  getListFinanceAccountsMockHandler,
  getListFinanceAccountsMockHandler503,
  getListFinanceCurrenciesMockHandler,
  getListFinanceLedgersMockHandler,
  getArchiveFinanceAccountMockHandler,
  getArchiveFinanceAccountMockHandler404,
  getCreateFinanceAccountMockHandler,
  getCreateFinanceAccountMockHandler422,
  getUpdateFinanceAccountMockHandler,
  getUpdateFinanceAccountMockHandler404,
  getUpdateFinanceAccountMockHandler409,
  getUpdateFinanceAccountMockHandler422,
  getUnarchiveFinanceAccountMockHandler,
  getUnarchiveFinanceAccountMockHandler503,
} from "@/api/generated/core-console.msw";
import type { AccountResponse } from "@/api/generated/schemas";
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

const accounts = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Credit card",
    nature: "liability",
    currency: "CNY",
    openingBalance: { amount: "0.00", currency: "CNY" },
    currentBalance: { amount: "2460.80", currency: "CNY" },
    trackingStartDate: "2026-08-01",
    status: "active",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Cash reserve",
    nature: "asset",
    currency: "JPY",
    openingBalance: { amount: "12000", currency: "JPY" },
    currentBalance: { amount: "9007199254740993", currency: "JPY" },
    trackingStartDate: "2026-09-01",
    status: "archived",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Operating cash",
    nature: "asset",
    currency: "CNY",
    openingBalance: { amount: "10000.00", currency: "CNY" },
    currentBalance: { amount: "18420.35", currency: "CNY" },
    trackingStartDate: "2026-08-01",
    status: "active",
  },
] satisfies AccountResponse[];

describe("Finance Accounts destination", () => {
  it("organizes backend-ordered Accounts by lifecycle and Nature with exact Money", async () => {
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(accounts),
    );

    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    const active = await screen.findByRole(
      "region",
      { name: "Active Accounts" },
      { timeout: 5_000 },
    );
    const archived = screen.getByRole("region", {
      name: "Archived Accounts",
    });

    expect(
      within(active)
        .getAllByRole("article")
        .map((row) => row.getAttribute("aria-label")),
    ).toEqual(["Operating cash", "Credit card"]);
    expect(within(active).getByText("18,420.35 CNY")).toBeVisible();
    expect(within(active).getByText("2,460.80 CNY")).toBeVisible();
    expect(
      within(archived)
        .getAllByRole("article")
        .map((row) => row.getAttribute("aria-label")),
    ).toEqual(["Cash reserve"]);
    expect(
      within(archived).getByText("9,007,199,254,740,993 JPY"),
    ).toBeVisible();
    expect(within(archived).getByText("Archived")).toBeVisible();
  });

  it("gives duplicate Account names unique contextual action names", async () => {
    const duplicateAccounts = [
      { ...accounts[2]!, name: "Shared" },
      {
        ...accounts[2]!,
        id: "66666666-6666-4666-8666-666666666666",
        name: "Shared",
      },
    ] satisfies AccountResponse[];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(duplicateAccounts),
    );
    const user = userEvent.setup();
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    const firstActions = await screen.findByRole(
      "button",
      { name: "Actions for Shared, active asset in CNY, 1 of 2" },
      { timeout: 5_000 },
    );
    const secondActions = screen.getByRole("button", {
      name: "Actions for Shared, active asset in CNY, 2 of 2",
    });
    expect(firstActions).toBeVisible();
    expect(secondActions).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Edit Shared, active asset in CNY, 1 of 2",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Edit Shared, active asset in CNY, 2 of 2",
      }),
    ).toBeVisible();

    await user.click(secondActions);
    expect(
      await screen.findByRole("menuitem", {
        name: "Archive Shared, active asset in CNY, 2 of 2",
      }),
    ).toBeVisible();
  });

  it("keeps same-name Account identity inside archive and correction workflows", async () => {
    const duplicateAccounts = [
      { ...accounts[2]!, name: "Shared" },
      {
        ...accounts[2]!,
        id: "66666666-6666-4666-8666-666666666666",
        name: "Shared",
      },
    ] satisfies AccountResponse[];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(duplicateAccounts),
    );
    const user = userEvent.setup();
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Actions for Shared, active asset in CNY, 2 of 2" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Archive Shared, active asset in CNY, 2 of 2",
      }),
    );
    const confirmation = screen.getByRole("alertdialog", {
      name: "Archive Shared, active asset in CNY, 2 of 2?",
    });
    expect(confirmation).toHaveTextContent(
      "Shared, active asset in CNY, 2 of 2",
    );
    expect(confirmation).toHaveAccessibleDescription(
      /Shared, active asset in CNY, 2 of 2/,
    );
    await user.click(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Actions for Shared, active asset in CNY, 1 of 2",
      }),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Correct nature or currency for Shared, active asset in CNY, 1 of 2",
      }),
    );
    const correction = screen.getByRole("dialog", {
      name: "Correct nature or currency",
    });
    expect(correction).toHaveTextContent(
      "Target Account: Shared, active asset in CNY, 1 of 2",
    );
    expect(correction).toHaveAccessibleDescription(
      /Shared, active asset in CNY, 1 of 2/,
    );
  });

  it("invites creation without rendering lifecycle sections when no Accounts exist", async () => {
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler([]),
    );

    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    expect(
      await screen.findByRole(
        "heading",
        { name: "No Accounts yet" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Create an Account to start tracking a position in this Ledger.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Active Accounts" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Archived Accounts" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeEnabled();
  });

  it("keeps archived positions visible and explains when no active Accounts remain", async () => {
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler([accounts[1]!]),
    );

    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    expect(
      await screen.findByRole(
        "heading",
        { name: "No active Accounts" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Archived positions remain part of this Ledger."),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Archived Accounts" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Active Accounts" }),
    ).not.toBeInTheDocument();
  });

  it("confirms every archive consequence and reconciles the confirmed lifecycle", async () => {
    const user = userEvent.setup();
    let archiveRequests = 0;
    let releaseArchive!: () => void;
    const pendingArchive = new Promise<void>((resolve) => {
      releaseArchive = resolve;
    });
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let listedAccounts: AccountResponse[] = [accounts[2]!, accounts[1]!];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(async () => {
        listRequests += 1;
        if (listRequests > 1) await pendingRefresh;
        return listedAccounts;
      }),
      getArchiveFinanceAccountMockHandler(async () => {
        archiveRequests += 1;
        await pendingArchive;
        const archived = {
          ...accounts[2]!,
          status: "archived",
        } satisfies AccountResponse;
        listedAccounts = [archived, accounts[1]!];
        return archived;
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    const actions = await screen.findByRole(
      "button",
      { name: "Actions for Operating cash" },
      { timeout: 5_000 },
    );
    await user.click(actions);
    await user.click(
      await screen.findByRole("menuitem", { name: "Archive Operating cash" }),
    );

    const confirmation = screen.getByRole("alertdialog", {
      name: "Archive Operating cash?",
    });
    expect(confirmation).toHaveTextContent("does not delete this Account");
    expect(confirmation).toHaveTextContent("keeps its historical Transactions");
    expect(confirmation).toHaveTextContent(
      "keeps it in current financial-position calculations",
    );
    expect(confirmation).toHaveTextContent(
      "excludes it from ordinary new Transaction references",
    );
    expect(confirmation).not.toHaveTextContent(/must be zero|insufficient/i);
    const cancel = within(confirmation).getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();

    await user.click(cancel);
    expect(archiveRequests).toBe(0);
    expect(actions).toHaveFocus();

    await user.click(actions);
    await user.click(
      await screen.findByRole("menuitem", { name: "Archive Operating cash" }),
    );
    await user.click(
      within(
        screen.getByRole("alertdialog", {
          name: "Archive Operating cash?",
        }),
      ).getByRole("button", { name: "Archive Account" }),
    );

    const pendingDialog = screen.getByRole("alertdialog", {
      name: "Archive Operating cash?",
    });
    expect(pendingDialog).toHaveAttribute("aria-busy", "true");
    expect(
      within(pendingDialog).getByRole("button", { name: "Archiving…" }),
    ).toBeDisabled();
    releaseArchive();

    await waitFor(() => {
      expect(
        within(
          screen.getByRole("region", { name: "Archived Accounts" }),
        ).getByRole("article", { name: "Operating cash" }),
      ).toBeVisible();
    });
    expect(archiveRequests).toBe(1);
    expect(listRequests).toBe(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Operating cash archived.",
    );
    expect(
      screen.getByRole("button", { name: "Actions for Operating cash" }),
    ).toHaveFocus();
    releaseRefresh();
  });

  it("removes a stale Account and refreshes its Ledger after archive not-found", async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(async () => {
        listRequests += 1;
        if (listRequests === 1) return [accounts[2]!];
        await pendingRefresh;
        return [];
      }),
      getArchiveFinanceAccountMockHandler404({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        code: "finance_account_not_found",
        detail: "internal account identifier was not found",
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    const actions = await screen.findByRole(
      "button",
      { name: "Actions for Operating cash" },
      { timeout: 5_000 },
    );
    await user.click(actions);
    await user.click(
      await screen.findByRole("menuitem", { name: "Archive Operating cash" }),
    );
    const confirmation = screen.getByRole("alertdialog", {
      name: "Archive Operating cash?",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "Archive Account" }),
    );

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(
      "This Account is no longer available. Refresh the list and try again.",
    );
    expect(error).not.toHaveTextContent(/internal account identifier/i);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "Operating cash" }),
    ).not.toBeInTheDocument();
    expect(listRequests).toBe(2);
    expect(screen.getByRole("status")).not.toHaveTextContent(/archived/i);
    releaseRefresh();
  });

  it("unarchives directly with accessible error recovery and confirmed cache state", async () => {
    const user = userEvent.setup();
    let listedAccounts: AccountResponse[] = [accounts[2]!, accounts[1]!];
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(async () => {
        listRequests += 1;
        if (listRequests > 1) await pendingRefresh;
        return listedAccounts;
      }),
      getUnarchiveFinanceAccountMockHandler503({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        code: "database_unavailable",
        detail: "postgres.internal.example refused the connection",
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    const actions = await screen.findByRole(
      "button",
      { name: "Actions for Cash reserve" },
      { timeout: 5_000 },
    );
    await user.click(actions);
    await user.click(
      await screen.findByRole("menuitem", { name: "Unarchive Cash reserve" }),
    );

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(
      "Accounts are temporarily unavailable. Try again later.",
    );
    expect(error).not.toHaveTextContent(/postgres\.internal/i);
    expect(
      within(
        screen.getByRole("region", { name: "Archived Accounts" }),
      ).getByRole("article", { name: "Cash reserve" }),
    ).toBeVisible();

    server.use(
      getUnarchiveFinanceAccountMockHandler(() => {
        const active = {
          ...accounts[1]!,
          status: "active",
        } satisfies AccountResponse;
        listedAccounts = [accounts[2]!, active];
        return active;
      }),
    );
    await user.click(actions);
    await user.click(
      await screen.findByRole("menuitem", { name: "Unarchive Cash reserve" }),
    );

    await waitFor(() => {
      expect(
        within(
          screen.getByRole("region", { name: "Active Accounts" }),
        ).getByRole("article", { name: "Cash reserve" }),
      ).toBeVisible();
    });
    expect(listRequests).toBe(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Cash reserve unarchived.",
    );
    expect(
      screen.getByRole("button", { name: "Actions for Cash reserve" }),
    ).toHaveFocus();
    releaseRefresh();
  });

  it("excludes overlapping actions for every Account with a pending mutation", async () => {
    const user = userEvent.setup();
    const secondArchived = {
      ...accounts[1]!,
      id: "77777777-7777-4777-8777-777777777777",
      name: "Travel reserve",
    } satisfies AccountResponse;
    let listedAccounts: AccountResponse[] = [accounts[1]!, secondArchived];
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondPending = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(() => listedAccounts),
      getUnarchiveFinanceAccountMockHandler(async ({ params }) => {
        const accountId = String(params.accountId);
        await (accountId === accounts[1]!.id ? firstPending : secondPending);
        const account = listedAccounts.find((item) => item.id === accountId)!;
        const active = {
          ...account,
          status: "active",
        } satisfies AccountResponse;
        listedAccounts = listedAccounts.map((item) =>
          item.id === accountId ? active : item,
        );
        return active;
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    const firstActions = await screen.findByRole(
      "button",
      { name: "Actions for Cash reserve" },
      { timeout: 5_000 },
    );
    await user.click(firstActions);
    await user.click(
      await screen.findByRole("menuitem", { name: "Unarchive Cash reserve" }),
    );
    const secondActions = screen.getByRole("button", {
      name: "Actions for Travel reserve",
    });
    await user.click(secondActions);
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Unarchive Travel reserve",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Actions for Cash reserve" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Edit Cash reserve" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Actions for Travel reserve" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Edit Travel reserve" }),
    ).toBeDisabled();

    releaseSecond();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Actions for Travel reserve" }),
      ).toBeEnabled();
    });
    expect(
      screen.getByRole("button", { name: "Actions for Cash reserve" }),
    ).toBeDisabled();

    releaseFirst();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Actions for Cash reserve" }),
      ).toBeEnabled();
    });
  });

  it("keeps semantic correction separate and sends only the correction family", async () => {
    const user = userEvent.setup();
    const correctable = {
      ...accounts[2]!,
      name: "Travel fund",
      openingBalance: { amount: "0", currency: "CNY" },
      currentBalance: { amount: "0", currency: "CNY" },
    } satisfies AccountResponse;
    let requestBody: unknown;
    let listedAccounts: AccountResponse[] = [correctable];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(() => listedAccounts),
      getUpdateFinanceAccountMockHandler(async ({ request }) => {
        requestBody = await request.json();
        const corrected = {
          ...correctable,
          currency: "USD",
          currentBalance: { amount: "0", currency: "USD" },
          openingBalance: { amount: "0", currency: "USD" },
        } satisfies AccountResponse;
        listedAccounts = [corrected];
        return corrected;
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    const actions = await screen.findByRole(
      "button",
      { name: "Actions for Travel fund" },
      { timeout: 5_000 },
    );
    await user.click(actions);
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Correct nature or currency for Travel fund",
      }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Correct nature or currency",
    });
    expect(dialog).toHaveTextContent(
      "Opening Balance is zero and no Finance Transaction history exists",
    );
    expect(dialog).toHaveTextContent(
      "Currency correction changes denomination",
    );
    expect(within(dialog).getByLabelText("New nature")).toHaveValue("asset");
    expect(within(dialog).getByLabelText("New currency")).toHaveValue("CNY");
    expect(
      within(dialog).getByRole("button", { name: "Apply correction" }),
    ).toBeDisabled();

    await user.selectOptions(
      within(dialog).getByLabelText("New currency"),
      "USD",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Apply correction" }),
    );

    expect(requestBody).toEqual({ currency: "USD" });
    expect(
      await screen.findByRole("article", { name: "Travel fund" }),
    ).toHaveTextContent("0 USD");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Travel fund corrected.",
    );
    expect(actions).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps a pending semantic correction bound to its original workflow", async () => {
    const user = userEvent.setup();
    const firstAccount = {
      ...accounts[2]!,
      name: "Travel fund",
      openingBalance: { amount: "0", currency: "CNY" },
      currentBalance: { amount: "0", currency: "CNY" },
    } satisfies AccountResponse;
    let releaseCorrection!: () => void;
    const pendingCorrection = new Promise<void>((resolve) => {
      releaseCorrection = resolve;
    });
    let updateRequests = 0;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler([firstAccount, accounts[0]!]),
      getUpdateFinanceAccountMockHandler(async () => {
        updateRequests += 1;
        await pendingCorrection;
        return {
          ...firstAccount,
          currency: "USD",
          currentBalance: { amount: "0", currency: "USD" },
          openingBalance: { amount: "0", currency: "USD" },
        } satisfies AccountResponse;
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        {
          name: "Actions for Travel fund",
        },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Correct nature or currency for Travel fund",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Correct nature or currency",
    });
    await user.selectOptions(
      within(dialog).getByLabelText("New currency"),
      "USD",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Apply correction" }),
    );

    expect(
      within(dialog).getByRole("button", { name: "Applying…" }),
    ).toBeDisabled();
    expect(
      within(dialog).queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(dialog).toBeVisible();
    expect(dialog).toHaveTextContent("Travel fund");
    expect(updateRequests).toBe(1);

    releaseCorrection();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(updateRequests).toBe(1);
    expect(
      screen.getByRole("button", { name: "Edit Travel fund" }),
    ).toBeEnabled();
  });

  it("keeps a pending correction excluded after Accounts unmounts and remounts", async () => {
    const user = userEvent.setup();
    const account = {
      ...accounts[2]!,
      name: "Travel fund",
      openingBalance: { amount: "0", currency: "CNY" },
      currentBalance: { amount: "0", currency: "CNY" },
    } satisfies AccountResponse;
    let listedAccounts: AccountResponse[] = [account];
    let releaseCorrection!: () => void;
    const pendingCorrection = new Promise<void>((resolve) => {
      releaseCorrection = resolve;
    });
    let updateRequests = 0;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(() => listedAccounts),
      getUpdateFinanceAccountMockHandler(async () => {
        updateRequests += 1;
        await pendingCorrection;
        const corrected = {
          ...account,
          currency: "USD",
          currentBalance: { amount: "0", currency: "USD" },
          openingBalance: { amount: "0", currency: "USD" },
        } satisfies AccountResponse;
        listedAccounts = [corrected];
        return corrected;
      }),
    );
    const { router } = renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Actions for Travel fund" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Correct nature or currency for Travel fund",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Correct nature or currency",
    });
    await user.selectOptions(
      within(dialog).getByLabelText("New currency"),
      "USD",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Apply correction" }),
    );
    expect(updateRequests).toBe(1);

    await router.navigate(`/finance/overview?ledger=${ledger.id}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Overview" }),
    ).toBeVisible();
    await router.navigate(`/finance/accounts?ledger=${ledger.id}`);

    const remountedActions = await screen.findByRole(
      "button",
      { name: "Actions for Travel fund" },
      { timeout: 5_000 },
    );
    expect(remountedActions).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Edit Travel fund" }),
    ).toBeDisabled();
    await user.click(remountedActions);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(updateRequests).toBe(1);

    releaseCorrection();
    await waitFor(() => expect(remountedActions).toBeEnabled());
  });

  it("removes a stale Account and refreshes its Ledger after correction not-found", async () => {
    const user = userEvent.setup();
    const staleAccount = {
      ...accounts[2]!,
      name: "Travel fund",
      openingBalance: { amount: "0", currency: "CNY" },
      currentBalance: { amount: "0", currency: "CNY" },
    } satisfies AccountResponse;
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(async () => {
        listRequests += 1;
        if (listRequests === 1) return [staleAccount];
        await pendingRefresh;
        return [];
      }),
      getUpdateFinanceAccountMockHandler404({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        code: "finance_account_not_found",
        detail: "internal account identifier was not found",
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Actions for Travel fund" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Correct nature or currency for Travel fund",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Correct nature or currency",
    });
    await user.selectOptions(
      within(dialog).getByLabelText("New currency"),
      "USD",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Apply correction" }),
    );

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(
      "This Account is no longer available. Refresh the list and try again.",
    );
    expect(error).not.toHaveTextContent(/internal account identifier/i);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "Travel fund" }),
    ).not.toBeInTheDocument();
    expect(listRequests).toBe(2);
    releaseRefresh();
  });

  it("recovers a semantics-lock conflict without losing attempted values", async () => {
    const user = userEvent.setup();
    const account = {
      ...accounts[2]!,
      name: "Travel fund",
      openingBalance: { amount: "0", currency: "CNY" },
      currentBalance: { amount: "0", currency: "CNY" },
    } satisfies AccountResponse;
    let requestBody: unknown;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler([account]),
      getUpdateFinanceAccountMockHandler409(async ({ request }) => {
        requestBody = await request.json();
        return {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "finance_account_semantics_locked",
          detail: "internal movement row 42 established semantics",
        };
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    const actions = await screen.findByRole(
      "button",
      { name: "Actions for Travel fund" },
      { timeout: 5_000 },
    );
    await user.click(actions);
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Correct nature or currency for Travel fund",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Correct nature or currency",
    });
    const nature = within(dialog).getByLabelText("New nature");
    const currency = within(dialog).getByLabelText("New currency");
    await user.selectOptions(nature, "liability");
    await user.selectOptions(currency, "USD");
    await user.click(
      within(dialog).getByRole("button", { name: "Apply correction" }),
    );

    expect(requestBody).toEqual({ currency: "USD", nature: "liability" });
    const error = await within(dialog).findByRole("alert");
    expect(error).toHaveTextContent(
      "established financial position or Transaction history prevents reinterpretation",
    );
    expect(error).toHaveTextContent("attempted values have been kept");
    expect(error).not.toHaveTextContent(/movement row 42/i);
    expect(nature).toHaveValue("liability");
    expect(currency).toHaveValue("USD");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    await user.click(
      within(dialog).getByRole("button", { name: "Return to Accounts" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(actions).toHaveFocus();
  });

  it("navigates from an archived Account to its validated Transactions filter", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([]),
      getListFinanceAccountsMockHandler([accounts[1]!]),
    );
    const { router } = renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Actions for Cash reserve" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: "View transactions for Cash reserve",
      }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/finance/transactions");
    });
    expect(
      Object.fromEntries(new URLSearchParams(router.state.location.search)),
    ).toEqual({
      account_id: accounts[1]!.id,
      ledger: ledger.id,
    });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Transactions",
      }),
    ).toBeVisible();
  });

  it("reconciles a created Account in backend order before refresh completes", async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const existingLiability = {
      ...accounts[0]!,
      name: "Zebra card",
    } satisfies AccountResponse;
    let listedAccounts: AccountResponse[] = [existingLiability];
    let requestBody: unknown;
    const localToday = new Date();
    const expectedToday = [
      localToday.getFullYear(),
      String(localToday.getMonth() + 1).padStart(2, "0"),
      String(localToday.getDate()).padStart(2, "0"),
    ].join("-");
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(async () => {
        listRequests += 1;
        if (listRequests > 1) await pendingRefresh;
        return listedAccounts;
      }),
      getCreateFinanceAccountMockHandler(async ({ request }) => {
        requestBody = await request.json();
        const created = {
          ...accounts[1]!,
          name: "Travel cash",
          nature: "liability",
          status: "active",
          openingBalance: { amount: "2500", currency: "JPY" },
          currentBalance: { amount: "2500", currency: "JPY" },
          trackingStartDate: "2026-09-10",
        } satisfies AccountResponse;
        listedAccounts = [created];
        return created;
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    const createButton = await screen.findByRole(
      "button",
      { name: "Create account" },
      { timeout: 5_000 },
    );
    await user.click(createButton);
    const dialog = screen.getByRole("dialog", { name: "Create account" });
    expect(within(dialog).getByLabelText("Opening balance")).toHaveValue("0");
    expect(within(dialog).getByLabelText("Tracking start date")).toHaveValue(
      expectedToday,
    );

    await user.type(
      within(dialog).getByLabelText("Account name"),
      "Travel cash",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Nature"),
      "liability",
    );
    await user.selectOptions(within(dialog).getByLabelText("Currency"), "JPY");
    const openingBalance = within(dialog).getByLabelText("Opening balance");
    await user.clear(openingBalance);
    await user.type(openingBalance, "002500");
    const trackingStart = within(dialog).getByLabelText("Tracking start date");
    await user.clear(trackingStart);
    await user.type(trackingStart, "2026-09-10");
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    expect(requestBody).toEqual({
      currency: "JPY",
      name: "Travel cash",
      nature: "liability",
      openingBalance: { amount: "002500", currency: "JPY" },
      trackingStartDate: "2026-09-10",
    });
    expect(
      await screen.findByRole("article", { name: "Travel cash" }),
    ).toBeVisible();
    expect(listRequests).toBe(2);
    expect(
      within(screen.getByRole("region", { name: "Liabilities" }))
        .getAllByRole("article")
        .map((row) => row.getAttribute("aria-label")),
    ).toEqual(["Travel cash", "Zebra card"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Travel cash created.",
    );
    expect(createButton).toHaveFocus();
    expect(
      screen.queryByRole("dialog", { name: "Create account" }),
    ).not.toBeInTheDocument();
    releaseRefresh();
  });

  it("focuses the first invalid create field and preserves the draft", async () => {
    const user = userEvent.setup();
    let createRequests = 0;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler([]),
      getCreateFinanceAccountMockHandler(() => {
        createRequests += 1;
        return accounts[0]!;
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create account" },
        { timeout: 5_000 },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Create account" });
    const name = within(dialog).getByLabelText("Account name");
    const openingBalance = within(dialog).getByLabelText("Opening balance");
    await user.selectOptions(within(dialog).getByLabelText("Currency"), "JPY");
    await user.clear(openingBalance);
    await user.type(openingBalance, "1.25");
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByText("Enter an Account name.")).toBeVisible();
    expect(openingBalance).toHaveValue("1.25");
    expect(createRequests).toBe(0);

    await user.type(name, "Pocket cash");
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    expect(openingBalance).toHaveFocus();
    expect(openingBalance).toHaveAttribute("aria-invalid", "true");
    expect(
      within(dialog).getByText("JPY amounts cannot include fractional digits."),
    ).toBeVisible();
    expect(name).toHaveValue("Pocket cash");
    expect(createRequests).toBe(0);
  });

  it("keeps a create draft open when backend validation rejects it", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler([]),
      getCreateFinanceAccountMockHandler422({
        type: "about:blank",
        title: "Validation Error",
        status: 422,
        code: "validation_error",
        detail: "numeric precision exceeded in internal persistence",
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create account" },
        { timeout: 5_000 },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Create account" });
    const name = within(dialog).getByLabelText("Account name");
    await user.type(name, "Long-term reserve");
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Check the Account fields and try again.",
    );
    expect(dialog).not.toHaveTextContent(/internal persistence/i);
    expect(name).toHaveValue("Long-term reserve");
    expect(dialog).toBeVisible();
  });

  it("validates Account name length by Unicode code points without truncating", async () => {
    const user = userEvent.setup();
    const backendValidName = "😀".repeat(100);
    const overlongName = "😀".repeat(101);
    let createRequests = 0;
    let requestBody: unknown;
    let listedAccounts: AccountResponse[] = [];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(() => listedAccounts),
      getCreateFinanceAccountMockHandler(async ({ request }) => {
        createRequests += 1;
        requestBody = await request.json();
        const created = { ...accounts[2]!, name: backendValidName };
        listedAccounts = [created];
        return created;
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create account" },
        { timeout: 5_000 },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Create account" });
    const name = within(dialog).getByLabelText("Account name");
    await user.click(name);
    await user.paste(overlongName);

    expect(name).toHaveValue(overlongName);
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(
      within(dialog).getByText("Account name must be 100 characters or fewer."),
    ).toBeVisible();
    expect(name).toHaveValue(overlongName);
    expect(createRequests).toBe(0);

    await user.clear(name);
    await user.paste(` ${backendValidName} `);
    expect(name).toHaveValue(` ${backendValidName} `);
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    expect(createRequests).toBe(1);
    expect(requestBody).toMatchObject({ name: backendValidName });
    expect(
      await screen.findByRole("article", { name: backendValidName }),
    ).toBeVisible();
  });

  it("reconciles an ordinary edit in backend order before refresh completes", async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const reserveAccount = {
      ...accounts[0]!,
      name: "Reserve",
      nature: "asset",
    } satisfies AccountResponse;
    let listedAccounts: AccountResponse[] = [accounts[2]!, reserveAccount];
    let requestBody: unknown;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(async () => {
        listRequests += 1;
        if (listRequests > 1) await pendingRefresh;
        return listedAccounts;
      }),
      getUpdateFinanceAccountMockHandler(async ({ request }) => {
        requestBody = await request.json();
        const updated = {
          ...accounts[2]!,
          name: "Zebra cash",
          openingBalance: { amount: "12500.50", currency: "CNY" },
          currentBalance: { amount: "20920.85", currency: "CNY" },
          trackingStartDate: "2026-07-15",
        } satisfies AccountResponse;
        listedAccounts = [reserveAccount, updated];
        return updated;
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    const editButton = await screen.findByRole(
      "button",
      { name: "Edit Operating cash" },
      { timeout: 5_000 },
    );
    await user.click(editButton);
    const dialog = screen.getByRole("dialog", { name: "Edit Operating cash" });
    expect(within(dialog).getByText("Asset")).toBeVisible();
    expect(within(dialog).getByText("CNY")).toBeVisible();
    expect(within(dialog).getByText("18,420.35 CNY")).toBeVisible();
    expect(within(dialog).queryByLabelText("Nature")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Currency")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(/correct nature or currency/i),
    ).not.toBeInTheDocument();

    const name = within(dialog).getByLabelText("Account name");
    await user.clear(name);
    await user.type(name, "Zebra cash");
    const openingBalance = within(dialog).getByLabelText("Opening balance");
    await user.clear(openingBalance);
    await user.type(openingBalance, "12500.50");
    const trackingStart = within(dialog).getByLabelText("Tracking start date");
    await user.clear(trackingStart);
    await user.type(trackingStart, "2026-07-15");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    expect(requestBody).toEqual({
      name: "Zebra cash",
      openingBalance: { amount: "12500.50", currency: "CNY" },
      trackingStartDate: "2026-07-15",
    });
    expect(
      await screen.findByRole("article", { name: "Zebra cash" }),
    ).toBeVisible();
    expect(listRequests).toBe(2);
    expect(
      within(screen.getByRole("region", { name: "Assets" }))
        .getAllByRole("article")
        .map((row) => row.getAttribute("aria-label")),
    ).toEqual(["Reserve", "Zebra cash"]);
    expect(screen.getByRole("status")).toHaveTextContent("Zebra cash updated.");
    expect(editButton).toHaveFocus();
    expect(
      screen.queryByRole("dialog", { name: "Edit Operating cash" }),
    ).not.toBeInTheDocument();
    releaseRefresh();
  });

  it("recovers Tracking Start Date when associated history rejects an edit", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler([accounts[2]!]),
      getUpdateFinanceAccountMockHandler422({
        type: "about:blank",
        title: "Unprocessable Entity",
        status: 422,
        code: "validation_error",
        detail:
          "Tracking Start Date cannot be later than associated Transaction history.",
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Edit Operating cash" },
        { timeout: 5_000 },
      ),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Edit Operating cash",
    });
    const name = within(dialog).getByLabelText("Account name");
    const trackingStart = within(dialog).getByLabelText("Tracking start date");
    await user.clear(name);
    await user.type(name, "Draft operating cash");
    await user.clear(trackingStart);
    await user.type(trackingStart, "2026-09-01");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    expect(
      await within(dialog).findByText(
        "Choose a Tracking Start Date on or before the Account's earliest Transaction.",
      ),
    ).toBeVisible();
    expect(trackingStart).toHaveFocus();
    expect(trackingStart).toHaveAttribute("aria-invalid", "true");
    expect(trackingStart).toHaveAccessibleDescription(
      "Choose a Tracking Start Date on or before the Account's earliest Transaction.",
    );
    expect(trackingStart).toHaveValue("2026-09-01");
    expect(name).toHaveValue("Draft operating cash");
    expect(dialog).toBeVisible();
  });

  it("makes creation unavailable when the backend currency catalog is empty", async () => {
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([]),
      getListFinanceAccountsMockHandler([accounts[2]!]),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    expect(
      await screen.findByRole(
        "heading",
        { name: "Account changes unavailable" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "No supported currencies are available for creating or editing an Account.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Edit Operating cash" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("article", { name: "Operating cash" }),
    ).toBeVisible();
  });

  it("abandons Account drafts and loads the newly addressed Ledger", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger, teamLedger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(({ params }) =>
        params.ledgerId === teamLedger.id ? [accounts[0]!] : [accounts[2]!],
      ),
    );
    const { router } = renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create account" },
        { timeout: 5_000 },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Create account" });
    await user.type(
      within(dialog).getByLabelText("Account name"),
      "Draft cash",
    );

    await router.navigate(`/finance/accounts?ledger=${teamLedger.id}`);

    expect(
      await screen.findByRole("button", { name: "Team fund" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("article", { name: "Credit card" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "Operating cash" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Create account" }),
    ).not.toBeInTheDocument();
  });

  it("keeps Accounts loading inside the resolved Ledger destination", async () => {
    let releaseAccounts!: () => void;
    const pendingAccounts = new Promise<void>((resolve) => {
      releaseAccounts = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler(async () => {
        await pendingAccounts;
        return [];
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    expect(
      await screen.findByRole(
        "status",
        { name: "Loading Accounts" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "Accounts" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Personal" })).toBeVisible();

    releaseAccounts();
    expect(
      await screen.findByRole("heading", { name: "No Accounts yet" }),
    ).toBeVisible();
  });

  it("contains an Accounts failure and retries without exposing backend detail", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceCurrenciesMockHandler([
        { code: "CNY", minorUnit: 2 },
        { code: "JPY", minorUnit: 0 },
        { code: "USD", minorUnit: 2 },
      ]),
      getListFinanceAccountsMockHandler503({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        code: "database_unavailable",
        detail: "db.internal.example refused the connection",
      }),
    );
    renderRoute(`/finance/accounts?ledger=${ledger.id}`);

    const alert = await screen.findByRole("alert", undefined, {
      timeout: 5_000,
    });
    expect(alert).toHaveTextContent("Accounts could not be loaded. Try again.");
    expect(alert).not.toHaveTextContent(/db\.internal/i);
    expect(screen.getByRole("button", { name: "Personal" })).toBeVisible();

    server.use(getListFinanceAccountsMockHandler([accounts[2]!]));
    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("article", { name: "Operating cash" }),
    ).toBeVisible();
  });
});
