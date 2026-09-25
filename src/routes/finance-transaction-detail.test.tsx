import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { getGetFinanceTransactionQueryKey } from "@/api/generated/core-console";
import {
  getDeleteFinanceTransactionMockHandler404,
  getGetFinanceTransactionMockHandler,
  getGetFinanceTransactionMockHandler404,
  getListFinanceLedgersMockHandler,
  getListFinanceTransactionsMockHandler,
} from "@/api/generated/core-console.msw";
import type { FinanceTransactionResponse } from "@/api/generated/schemas";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

const ledgerId = "11111111-1111-4111-8111-111111111111";
const transactionId = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const duplicateTransactionId = "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const account = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Cash",
  status: "archived",
} as const;
const otherAccount = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Cash",
  status: "active",
} as const;
const base = {
  id: transactionId,
  ledgerId,
  note: "Exact note",
  transactionDate: "2026-08-16",
} as const;
const money = { amount: "9007199254740993.25", currency: "USD" } as const;
const transactions = [
  {
    ...base,
    account,
    categoryAllocations: [{ amount: money, category: null }],
    economicAmount: money,
    kind: "income",
  },
  {
    ...base,
    account,
    categoryAllocations: [
      {
        amount: money,
        category: {
          id: "44444444-4444-4444-8444-444444444444",
          name: "Food",
          status: "archived",
        },
      },
    ],
    economicAmount: money,
    kind: "expense",
  },
  {
    ...base,
    destinationAccount: otherAccount,
    destinationAmount: money,
    kind: "internalTransfer",
    sourceAccount: account,
    sourceAmount: money,
  },
  {
    ...base,
    account,
    correctionDelta: { amount: "-27.00", currency: "USD" },
    kind: "balanceAdjustment",
  },
] satisfies FinanceTransactionResponse[];

function mockLedger() {
  server.use(
    getListFinanceLedgersMockHandler([{ id: ledgerId, name: "Personal" }]),
  );
}

describe("Finance Transaction detail", () => {
  it.each(transactions)(
    "renders the complete $kind projection at a direct URL",
    async (transaction) => {
      mockLedger();
      server.use(getGetFinanceTransactionMockHandler(transaction));
      renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);

      expect(
        await screen.findByRole(
          "heading",
          { name: "Transaction detail" },
          { timeout: 5_000 },
        ),
      ).toBeVisible();
      expect(screen.getByText("16 August 2026")).toBeVisible();
      expect(screen.getByText("Exact note")).toBeVisible();
      expect(
        screen.getByRole("link", { name: "Back to Transactions" }),
      ).toHaveAttribute("href", `/finance/transactions?ledger=${ledgerId}`);
      if (transaction.kind === "internalTransfer") {
        expect(screen.getByText("Source Account")).toBeVisible();
        expect(screen.getByText("Destination Account")).toBeVisible();
        expect(screen.getByText(account.id)).toBeVisible();
        expect(screen.getByText(otherAccount.id)).toBeVisible();
      } else if (transaction.kind === "balanceAdjustment") {
        expect(screen.getByText("Correction delta")).toBeVisible();
        expect(screen.getByText("-27.00 USD")).toBeVisible();
      } else {
        expect(screen.getByText("Economic amount")).toBeVisible();
        expect(
          screen.getAllByText("9,007,199,254,740,993.25 USD")[0],
        ).toBeVisible();
        expect(
          screen.getByText(
            transaction.kind === "income" ? "Uncategorized" : "Food (archived)",
          ),
        ).toBeVisible();
      }
    },
  );

  it("shows a positive Adjustment as a signed correction", async () => {
    mockLedger();
    const adjustment = transactions[3]!;
    if (adjustment.kind !== "balanceAdjustment")
      throw new Error("Expected Adjustment fixture");
    server.use(
      getGetFinanceTransactionMockHandler({
        ...adjustment,
        correctionDelta: { amount: "27.00", currency: "USD" },
      }),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);

    expect(
      await screen.findByText("+27.00 USD", {}, { timeout: 5_000 }),
    ).toBeVisible();
    expect(screen.getByText(/does not store a target balance/)).toBeVisible();
  });

  it("resolves a direct URL to the remembered Ledger without losing the Transaction id", async () => {
    localStorage.setItem("core-console.finance.last-ledger-id", ledgerId);
    mockLedger();
    server.use(getGetFinanceTransactionMockHandler(transactions[0]!));
    const { router } = renderRoute(
      `/finance/transactions/${transactionId}?kind=income`,
    );

    expect(
      await screen.findByRole(
        "heading",
        { name: "Transaction detail" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(
      `/finance/transactions/${transactionId}`,
    );
    expect(router.state.location.search).toBe(
      `?ledger=${ledgerId}&kind=income`,
    );
  });

  it("retains a validated Overview month and date as the return path", async () => {
    mockLedger();
    server.use(getGetFinanceTransactionMockHandler(transactions[0]!));
    renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}&month=2026-08&date=2026-08-16&return=overview`,
    );

    expect(
      await screen.findByRole(
        "link",
        { name: "Back to Overview" },
        { timeout: 5_000 },
      ),
    ).toHaveAttribute(
      "href",
      `/finance/overview?ledger=${ledgerId}&month=2026-08&date=2026-08-16`,
    );
  });

  it("opens from filtered history and returns to those filters", async () => {
    const user = userEvent.setup();
    mockLedger();
    server.use(
      getListFinanceTransactionsMockHandler({
        items: [transactions[0]!],
        nextCursor: null,
      }),
      getGetFinanceTransactionMockHandler(transactions[0]!),
    );
    const { router } = renderRoute(
      `/finance/transactions?ledger=${ledgerId}&kind=income`,
    );

    await user.click(
      await screen.findByRole(
        "link",
        { name: /View details for Income/ },
        { timeout: 5_000 },
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Transaction detail" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(
      `/finance/transactions/${transactionId}`,
    );
    await user.click(
      screen.getByRole("link", { name: "Back to Transactions" }),
    );
    await waitFor(() =>
      expect(router.state.location.search).toBe(
        `?ledger=${ledgerId}&kind=income`,
      ),
    );
  });

  it("distinguishes identical history rows and confirms the selected Transaction ID", async () => {
    const user = userEvent.setup();
    const duplicate = { ...transactions[0]!, id: duplicateTransactionId };
    let deletedId = "";
    mockLedger();
    server.use(
      getListFinanceTransactionsMockHandler({
        items: [transactions[0]!, duplicate],
        nextCursor: null,
      }),
      http.delete(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        ({ params }) => {
          deletedId = String(params.transactionId);
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    renderRoute(`/finance/transactions?ledger=${ledgerId}`);

    const rows = await screen.findAllByRole(
      "article",
      {
        name: "Income on August 16, 2026",
      },
      { timeout: 5_000 },
    );
    expect(rows).toHaveLength(2);
    for (const [row, id] of [
      [rows[0]!, transactionId],
      [rows[1]!, duplicateTransactionId],
    ] as const) {
      expect(within(row).getByText(`Transaction ID ${id}`)).toBeVisible();
      expect(
        within(row).getByRole("link", {
          name: `View details for Income on August 16, 2026, Transaction ID ${id}`,
        }),
      ).toHaveAttribute(
        "href",
        `/finance/transactions/${id}?ledger=${ledgerId}`,
      );
      expect(
        within(row).getByRole("button", {
          name: `Delete Income on August 16, 2026, Transaction ID ${id}`,
        }),
      ).toBeVisible();
    }

    await user.click(
      within(rows[1]!).getByRole("button", {
        name: `Delete Income on August 16, 2026, Transaction ID ${duplicateTransactionId}`,
      }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete transaction?",
    });
    expect(
      within(dialog).getByText(`Transaction ID ${duplicateTransactionId}`),
    ).toBeVisible();
    expect(
      within(dialog).queryByText(`Transaction ID ${transactionId}`),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Delete transaction" }),
    );
    await waitFor(() => expect(deletedId).toBe(duplicateTransactionId));
  });

  it("requires a separate confirmation with Cancel focused and removes stale detail after deletion", async () => {
    const user = userEvent.setup();
    mockLedger();
    server.use(
      getGetFinanceTransactionMockHandler(transactions[0]!),
      http.delete(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const { router, queryClient } = renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
    );

    await screen.findByRole("button", { name: "Delete transaction" });
    expect(
      queryClient.getQueryData(
        getGetFinanceTransactionQueryKey(ledgerId, transactionId),
      ),
    ).toBeDefined();

    await user.click(
      screen.getByRole("button", { name: "Delete transaction" }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete transaction?",
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus(),
    );
    expect(within(dialog).getByText(/cannot be undone/)).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "Delete transaction" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/finance/transactions"),
    );
    expect(
      queryClient.getQueryData(
        getGetFinanceTransactionQueryKey(ledgerId, transactionId),
      ),
    ).toBeUndefined();
  });

  it("deletes directly from history and announces the reconciled result", async () => {
    const user = userEvent.setup();
    let deleted = false;
    mockLedger();
    server.use(
      getListFinanceTransactionsMockHandler(() => ({
        items: deleted ? [] : [transactions[0]!],
        nextCursor: null,
      })),
      http.delete(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => {
          deleted = true;
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    renderRoute(`/finance/transactions?ledger=${ledgerId}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: /Delete Income on/ },
        { timeout: 5_000 },
      ),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete transaction?",
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus(),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Delete transaction" }),
    );
    expect(await screen.findByText("Income deleted.")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("article", { name: /Income on/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows an unavailable detail for an absent Transaction without exposing another Ledger", async () => {
    mockLedger();
    server.use(getGetFinanceTransactionMockHandler404());
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);

    expect(
      await screen.findByRole(
        "heading",
        { name: "Transaction unavailable" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Transactions", current: false }),
    ).toHaveAttribute("href", `/finance/transactions?ledger=${ledgerId}`);
    expect(screen.queryByText("Exact note")).not.toBeInTheDocument();
  });

  it("stops stale deletion and removes the obsolete detail presentation", async () => {
    const user = userEvent.setup();
    mockLedger();
    server.use(
      getGetFinanceTransactionMockHandler(transactions[0]!),
      getDeleteFinanceTransactionMockHandler404(),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Delete transaction" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete transaction",
      }),
    );
    expect(
      await screen.findByRole(
        "heading",
        { name: "Transaction unavailable" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Transaction unavailable. It was already removed."),
    ).toBeVisible();
    expect(screen.queryByText("Exact note")).not.toBeInTheDocument();
  });

  it("clears Transaction identity when switching Ledgers", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([
        { id: ledgerId, name: "Personal" },
        { id: "55555555-5555-4555-8555-555555555555", name: "Team fund" },
      ]),
      getGetFinanceTransactionMockHandler(transactions[0]!),
      getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
    );
    const { router } = renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}&kind=income`,
    );

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Personal" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Team fund" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/finance/transactions"),
    );
    expect(router.state.location.search).toBe(
      "?ledger=55555555-5555-4555-8555-555555555555&kind=income",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Transaction detail" }),
      ).not.toBeInTheDocument(),
    );
  });
});
