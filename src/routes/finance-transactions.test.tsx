import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import {
  getListFinanceAccountsMockHandler,
  getListFinanceCategoriesMockHandler,
  getListFinanceCurrenciesMockHandler,
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
const duplicateAccountId = "22222222-2222-4222-8222-222222222223";
const destinationAccountId = "22222222-2222-4222-8222-222222222224";
const cnyAccountId = "22222222-2222-4222-8222-222222222225";
const categoryId = "77777777-7777-4777-8777-777777777777";
const activeCategoryId = "88888888-8888-4888-8888-888888888888";
const duplicateCategoryId = "88888888-8888-4888-8888-888888888889";

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
  { id: activeCategoryId, name: "Groceries", status: "active" },
  { id: categoryId, name: "Salary", status: "archived" },
] as const;

const currencies = [
  { code: "CNY", minorUnit: 2 },
  { code: "JPY", minorUnit: 0 },
  { code: "USD", minorUnit: 2 },
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
  it("distinguishes duplicate references and associates each picker description", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([
        accounts[0],
        {
          ...accounts[0],
          id: duplicateAccountId,
        },
      ]),
      getListFinanceCategoriesMockHandler([
        categories[0],
        {
          ...categories[0],
          id: duplicateCategoryId,
        },
      ]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Expense" }));

    const dialog = screen.getByRole("dialog", { name: "Record expense" });
    const account = within(dialog).getByRole("combobox", { name: "Account" });
    const category = within(dialog).getByRole("combobox", {
      name: "Category",
    });
    expect(
      within(account).getByRole("option", {
        name: "Cash, active asset in USD, 1 of 2 · USD",
      }),
    ).toBeInTheDocument();
    expect(
      within(account).getByRole("option", {
        name: "Cash, active asset in USD, 2 of 2 · USD",
      }),
    ).toBeInTheDocument();
    expect(
      within(category).getByRole("option", {
        name: `Groceries, Category ID ${activeCategoryId}`,
      }),
    ).toBeInTheDocument();
    expect(
      within(category).getByRole("option", {
        name: `Groceries, Category ID ${duplicateCategoryId}`,
      }),
    ).toBeInTheDocument();
    expect(account).toHaveAccessibleDescription(
      "Only active Accounts can be selected. The selected Account supplies currency.",
    );
    expect(category).toHaveAccessibleDescription(
      "Categories are optional; Uncategorized is a complete allocation.",
    );
  });

  it("records a fixed Expense with exact Account currency and complete Category allocation", async () => {
    const user = userEvent.setup();
    let created = false;
    let submittedBody: unknown;
    const createdExpense = {
      account: {
        id: accountId,
        name: "Cash",
        status: "active",
      },
      categoryAllocations: [
        {
          amount: { amount: "9007199254740993.25", currency: "USD" },
          category: {
            id: activeCategoryId,
            name: "Groceries",
            status: "active",
          },
        },
      ],
      economicAmount: {
        amount: "9007199254740993.25",
        currency: "USD",
      },
      id: "99999999-9999-4999-8999-999999999999",
      kind: "expense",
      ledgerId: ledger.id,
      note: "Large exact purchase",
      transactionDate: "2027-01-02",
    } satisfies TransactionHistoryPageResponse["items"][number];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([...accounts]),
      getListFinanceCategoriesMockHandler([...categories]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(() => ({
        items: created ? [createdExpense, ...history.items] : history.items,
        nextCursor: null,
      })),
      http.post(
        "*/api/finance/ledgers/:ledgerId/transactions",
        async ({ request }) => {
          submittedBody = await request.json();
          created = true;
          return HttpResponse.json(createdExpense, { status: 201 });
        },
      ),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    await screen.findByRole(
      "article",
      { name: "Income on August 16, 2026" },
      { timeout: 5_000 },
    );
    const recordTransaction = screen.getByRole("button", {
      name: "Record transaction",
    });
    await waitFor(() => expect(recordTransaction).toBeEnabled());
    await user.click(recordTransaction);
    await user.click(await screen.findByRole("menuitem", { name: "Expense" }));

    const dialog = screen.getByRole("dialog", { name: "Record expense" });
    expect(
      within(dialog).queryByRole("combobox", { name: /kind/i }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("option", { name: /Old wallet/ }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("option", { name: /Salary/ }),
    ).not.toBeInTheDocument();

    await user.type(
      within(dialog).getByRole("textbox", { name: "Amount" }),
      "9007199254740993.25",
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Account" }),
      accountId,
    );
    expect(within(dialog).getByText("USD", { exact: true })).toBeVisible();
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Category" }),
      activeCategoryId,
    );
    await user.clear(within(dialog).getByLabelText("Transaction date"));
    await user.type(
      within(dialog).getByLabelText("Transaction date"),
      "2027-01-02",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Note" }),
      "  Large exact purchase  ",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record expense" }),
    );

    expect(submittedBody).toEqual({
      accountId,
      categoryAllocations: [
        {
          amount: { amount: "9007199254740993.25", currency: "USD" },
          categoryId: activeCategoryId,
        },
      ],
      economicAmount: {
        amount: "9007199254740993.25",
        currency: "USD",
      },
      kind: "expense",
      note: "Large exact purchase",
      transactionDate: "2027-01-02",
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Record expense" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Expense recorded.");
    expect(
      await screen.findByRole("article", {
        name: "Expense on January 2, 2027",
      }),
    ).toHaveTextContent("9,007,199,254,740,993.25 USD");
  });

  it("records Income as explicit Uncategorized and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    let submittedBody: unknown;
    const today = new Date();
    const localToday = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");
    const createdIncome = {
      account: { id: accountId, name: "Cash", status: "active" },
      categoryAllocations: [
        {
          amount: { amount: "12.5", currency: "USD" },
          category: null,
        },
      ],
      economicAmount: { amount: "12.5", currency: "USD" },
      id: "99999999-9999-4999-8999-999999999998",
      kind: "income",
      ledgerId: ledger.id,
      note: null,
      transactionDate: localToday,
    } satisfies TransactionHistoryPageResponse["items"][number];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([...accounts]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post(
        "*/api/finance/ledgers/:ledgerId/transactions",
        async ({ request }) => {
          submittedBody = await request.json();
          return HttpResponse.json(createdIncome, { status: 201 });
        },
      ),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole("button", {
      name: "Record transaction",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Income" }));

    const dialog = screen.getByRole("dialog", { name: "Record income" });
    const amount = within(dialog).getByRole("textbox", { name: "Amount" });
    expect(within(dialog).getByLabelText("Transaction date")).toHaveValue(
      localToday,
    );
    expect(
      within(dialog).getByRole("combobox", { name: "Category" }),
    ).toHaveValue("");
    await user.type(amount, "1.234");
    await user.click(
      within(dialog).getByRole("button", { name: "Record income" }),
    );
    expect(
      within(dialog).getByText(
        "USD amounts support at most 2 fractional digits.",
      ),
    ).toBeVisible();
    expect(amount).toHaveFocus();
    expect(submittedBody).toBeUndefined();

    await user.clear(amount);
    await user.type(amount, "12.5");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Note" }),
      "   ",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record income" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Record income" }),
      ).not.toBeInTheDocument(),
    );
    expect(submittedBody).toEqual({
      accountId,
      categoryAllocations: [
        {
          amount: { amount: "12.5", currency: "USD" },
          categoryId: null,
        },
      ],
      economicAmount: { amount: "12.5", currency: "USD" },
      kind: "income",
      note: null,
      transactionDate: localToday,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Income recorded.");
  });

  it("records one exact same-currency Internal Transfer and reconciles history", async () => {
    const user = userEvent.setup();
    let created = false;
    let submittedBody: unknown;
    const transferAccounts = [
      accounts[0],
      {
        ...accounts[0],
        currentBalance: { amount: "125.00", currency: "USD" },
        id: destinationAccountId,
        name: "Savings",
      },
      {
        ...accounts[0],
        currency: "CNY",
        currentBalance: { amount: "80.00", currency: "CNY" },
        id: cnyAccountId,
        name: "CNY wallet",
        openingBalance: { amount: "0.00", currency: "CNY" },
      },
      accounts[1],
    ] as const;
    const createdTransfer = {
      destinationAccount: {
        id: destinationAccountId,
        name: "Savings",
        status: "active",
      },
      destinationAmount: {
        amount: "9007199254740993.25",
        currency: "USD",
      },
      id: "99999999-9999-4999-8999-999999999993",
      kind: "internalTransfer",
      ledgerId: ledger.id,
      note: "Move exact reserve",
      sourceAccount: { id: accountId, name: "Cash", status: "active" },
      sourceAmount: {
        amount: "9007199254740993.25",
        currency: "USD",
      },
      transactionDate: "2027-04-07",
    } satisfies TransactionHistoryPageResponse["items"][number];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([...transferAccounts]),
      getListFinanceCategoriesMockHandler([...categories]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(() => ({
        items: created ? [createdTransfer, ...history.items] : history.items,
        nextCursor: null,
      })),
      http.post(
        "*/api/finance/ledgers/:ledgerId/transactions",
        async ({ request }) => {
          submittedBody = await request.json();
          created = true;
          return HttpResponse.json(createdTransfer, { status: 201 });
        },
      ),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(
      await screen.findByRole("menuitem", { name: "Internal Transfer" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Record internal transfer",
    });
    const source = within(dialog).getByRole("combobox", {
      name: "Source Account",
    });
    const destination = within(dialog).getByRole("combobox", {
      name: "Destination Account",
    });
    expect(source).toHaveValue(accountId);
    expect(
      within(destination).queryByRole("option", { name: /Cash/ }),
    ).not.toBeInTheDocument();
    expect(
      within(destination).queryByRole("option", { name: /CNY wallet/ }),
    ).not.toBeInTheDocument();
    expect(
      within(destination).getByRole("option", { name: "Savings · USD" }),
    ).toBeInTheDocument();
    await user.selectOptions(destination, destinationAccountId);
    await user.type(
      within(dialog).getByRole("textbox", { name: "Amount" }),
      "9007199254740993.25",
    );
    expect(within(dialog).getByText("USD", { exact: true })).toBeVisible();
    await user.clear(within(dialog).getByLabelText("Transaction date"));
    await user.type(
      within(dialog).getByLabelText("Transaction date"),
      "2027-04-07",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Note" }),
      "  Move exact reserve  ",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record transfer" }),
    );

    expect(submittedBody).toEqual({
      amount: { amount: "9007199254740993.25", currency: "USD" },
      destinationAccountId,
      kind: "internalTransfer",
      note: "Move exact reserve",
      sourceAccountId: accountId,
      transactionDate: "2027-04-07",
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Record internal transfer" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Internal Transfer recorded.",
    );
    expect(
      await screen.findByRole("article", {
        name: "Internal Transfer on April 7, 2027",
      }),
    ).toHaveTextContent("9,007,199,254,740,993.25 USD");
  });

  it("preserves duplicate transfer identities when refresh removes the destination", async () => {
    const user = userEvent.setup();
    let referencesPresent = true;
    let accountRequests = 0;
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const duplicateAccounts = [
      accounts[0],
      { ...accounts[0], id: duplicateAccountId },
      {
        ...accounts[0],
        id: destinationAccountId,
        name: "Savings",
      },
    ] as const;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      http.get("*/api/finance/ledgers/:ledgerId/accounts", () => {
        accountRequests += 1;
        return HttpResponse.json(
          referencesPresent
            ? duplicateAccounts
            : [duplicateAccounts[0], duplicateAccounts[2]],
        );
      }),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", async () => {
        await responseGate;
        return HttpResponse.json(
          {
            code: "finance_account_not_found",
            detail: "Account was not found.",
            status: 404,
            title: "Not found",
            type: "about:blank",
          },
          { status: 404 },
        );
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(
      await screen.findByRole("menuitem", { name: "Internal Transfer" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Record internal transfer",
    });
    const source = within(dialog).getByRole("combobox", {
      name: "Source Account",
    });
    const destination = within(dialog).getByRole("combobox", {
      name: "Destination Account",
    });
    const amount = within(dialog).getByRole("textbox", { name: "Amount" });
    const date = within(dialog).getByLabelText("Transaction date");
    const note = within(dialog).getByRole("textbox", { name: "Note" });
    await user.selectOptions(destination, duplicateAccountId);
    await user.type(amount, "27.50");
    await user.clear(date);
    await user.type(date, "2027-04-08");
    await user.type(note, "Keep transfer draft");
    await user.click(
      within(dialog).getByRole("button", { name: "Record transfer" }),
    );

    referencesPresent = false;
    act(() => window.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(accountRequests).toBeGreaterThan(1));
    expect(source).toHaveValue(accountId);
    expect(
      within(source).getByRole("option", {
        name: "Cash, active asset in USD, 1 of 2 · USD",
      }),
    ).not.toHaveAttribute("disabled");
    expect(destination).toHaveValue(duplicateAccountId);
    expect(
      within(destination).getByRole("option", {
        name: "Cash, active asset in USD, 2 of 2 (unavailable)",
      }),
    ).toBeDisabled();
    expect(amount).toHaveValue("27.50");
    expect(date).toHaveValue("2027-04-08");
    expect(note).toHaveValue("Keep transfer draft");

    releaseResponse();
    const message =
      "The selected Destination Account — Cash, active asset in USD, 2 of 2 — is no longer available. Choose another compatible active Account; your other values have been kept.";
    expect(await within(dialog).findByText(message)).toBeVisible();
    await waitFor(() => expect(destination).toHaveFocus());
    expect(destination).toHaveAccessibleErrorMessage(message);
    expect(amount).toHaveValue("27.50");
    expect(date).toHaveValue("2027-04-08");
    expect(note).toHaveValue("Keep transfer draft");
  });

  it("refreshes Accounts and requires source re-selection after its currency changes", async () => {
    const user = userEvent.setup();
    let sourceCurrencyChanged = false;
    let accountRequests = 0;
    let transactionRequests = 0;
    const duplicateAccounts = [
      accounts[0],
      { ...accounts[0], id: duplicateAccountId },
      {
        ...accounts[0],
        currency: "CNY",
        currentBalance: { amount: "18.00", currency: "CNY" },
        id: cnyAccountId,
        name: "Yuan reserve",
        openingBalance: { amount: "0.00", currency: "CNY" },
      },
    ] as const;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      http.get("*/api/finance/ledgers/:ledgerId/accounts", () => {
        accountRequests += 1;
        return HttpResponse.json(
          sourceCurrencyChanged
            ? [
                {
                  ...duplicateAccounts[0],
                  currency: "CNY",
                  currentBalance: { amount: "20.00", currency: "CNY" },
                  openingBalance: { amount: "0.00", currency: "CNY" },
                },
                duplicateAccounts[1],
                duplicateAccounts[2],
              ]
            : duplicateAccounts,
        );
      }),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", () => {
        transactionRequests += 1;
        sourceCurrencyChanged = true;
        return HttpResponse.json(
          {
            code: "validation_error",
            detail: "Transfer Accounts and amount must use the same currency.",
            status: 422,
            title: "Validation error",
            type: "about:blank",
          },
          { status: 422 },
        );
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(
      await screen.findByRole("menuitem", { name: "Internal Transfer" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Record internal transfer",
    });
    const source = within(dialog).getByRole("combobox", {
      name: "Source Account",
    });
    const destination = within(dialog).getByRole("combobox", {
      name: "Destination Account",
    });
    const amount = within(dialog).getByRole("textbox", { name: "Amount" });
    const date = within(dialog).getByLabelText("Transaction date");
    const note = within(dialog).getByRole("textbox", { name: "Note" });
    await user.selectOptions(destination, duplicateAccountId);
    await user.type(amount, "27.50");
    await user.clear(date);
    await user.type(date, "2027-04-10");
    await user.type(note, "Keep source currency draft");
    await user.click(
      within(dialog).getByRole("button", { name: "Record transfer" }),
    );

    const message =
      "The selected Source Account — Cash, active asset in USD, 1 of 2 — changed currency. Choose a valid Source Account again; your other values have been kept.";
    expect(await within(dialog).findByText(message)).toBeVisible();
    await waitFor(() => expect(accountRequests).toBeGreaterThan(1));
    await waitFor(() => expect(source).toHaveFocus());
    expect(source).toHaveAccessibleErrorMessage(message);
    expect(source).toHaveValue(accountId);
    expect(
      within(source).getByRole("option", {
        name: "Cash, active asset in USD, 1 of 2 · CNY",
      }),
    ).not.toBeDisabled();
    expect(destination).toHaveValue(duplicateAccountId);
    expect(
      within(destination).getByRole("option", {
        name: "Cash, active asset in USD, 2 of 2 (unavailable)",
      }),
    ).toBeDisabled();
    expect(amount).toHaveValue("27.50");
    expect(date).toHaveValue("2027-04-10");
    expect(note).toHaveValue("Keep source currency draft");
    expect(within(dialog).getByText("CNY", { exact: true })).toBeVisible();

    await user.click(
      within(dialog).getByRole("button", { name: "Record transfer" }),
    );
    expect(transactionRequests).toBe(1);
    expect(source).toHaveValue(accountId);
    expect(destination).toHaveValue(duplicateAccountId);
    await user.selectOptions(source, cnyAccountId);
    expect(source).toHaveValue(cnyAccountId);
    expect(destination).toHaveValue("");
    expect(within(dialog).queryByText(message)).not.toBeInTheDocument();
    expect(amount).toHaveValue("27.50");
    expect(date).toHaveValue("2027-04-10");
    expect(note).toHaveValue("Keep source currency draft");
  });

  it("refreshes Accounts and requires destination re-selection after its currency changes", async () => {
    const user = userEvent.setup();
    let destinationCurrencyChanged = false;
    let accountRequests = 0;
    let transactionRequests = 0;
    const duplicateAccounts = [
      accounts[0],
      { ...accounts[0], id: duplicateAccountId },
      {
        ...accounts[0],
        id: destinationAccountId,
        name: "Savings",
      },
    ] as const;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      http.get("*/api/finance/ledgers/:ledgerId/accounts", () => {
        accountRequests += 1;
        return HttpResponse.json(
          destinationCurrencyChanged
            ? [
                duplicateAccounts[0],
                {
                  ...duplicateAccounts[1],
                  currency: "CNY",
                  currentBalance: { amount: "20.00", currency: "CNY" },
                  openingBalance: { amount: "0.00", currency: "CNY" },
                },
                duplicateAccounts[2],
              ]
            : duplicateAccounts,
        );
      }),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", () => {
        transactionRequests += 1;
        destinationCurrencyChanged = true;
        return HttpResponse.json(
          {
            code: "validation_error",
            detail: "Transfer Accounts and amount must use the same currency.",
            status: 422,
            title: "Validation error",
            type: "about:blank",
          },
          { status: 422 },
        );
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(
      await screen.findByRole("menuitem", { name: "Internal Transfer" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Record internal transfer",
    });
    const source = within(dialog).getByRole("combobox", {
      name: "Source Account",
    });
    const destination = within(dialog).getByRole("combobox", {
      name: "Destination Account",
    });
    const amount = within(dialog).getByRole("textbox", { name: "Amount" });
    const date = within(dialog).getByLabelText("Transaction date");
    const note = within(dialog).getByRole("textbox", { name: "Note" });
    await user.selectOptions(destination, duplicateAccountId);
    await user.type(amount, "63.25");
    await user.clear(date);
    await user.type(date, "2027-04-11");
    await user.type(note, "Keep destination currency draft");
    await user.click(
      within(dialog).getByRole("button", { name: "Record transfer" }),
    );

    const message =
      "The selected Destination Account — Cash, active asset in USD, 2 of 2 — changed currency. Choose a compatible Destination Account again; your other values have been kept.";
    expect(await within(dialog).findByText(message)).toBeVisible();
    await waitFor(() => expect(accountRequests).toBeGreaterThan(1));
    await waitFor(() => expect(destination).toHaveFocus());
    expect(destination).toHaveAccessibleErrorMessage(message);
    expect(source).toHaveValue(accountId);
    expect(destination).toHaveValue(duplicateAccountId);
    expect(
      within(destination).getByRole("option", {
        name: "Cash, active asset in USD, 2 of 2 (unavailable)",
      }),
    ).toBeDisabled();
    expect(amount).toHaveValue("63.25");
    expect(date).toHaveValue("2027-04-11");
    expect(note).toHaveValue("Keep destination currency draft");
    expect(within(dialog).getByText("USD", { exact: true })).toBeVisible();

    await user.click(
      within(dialog).getByRole("button", { name: "Record transfer" }),
    );
    expect(transactionRequests).toBe(1);
    await user.selectOptions(destination, destinationAccountId);
    expect(destination).toHaveValue(destinationAccountId);
    expect(within(dialog).queryByText(message)).not.toBeInTheDocument();
    expect(amount).toHaveValue("63.25");
    expect(date).toHaveValue("2027-04-11");
    expect(note).toHaveValue("Keep destination currency draft");
  });

  it("fails closed when currency recovery cannot refresh Accounts", async () => {
    const user = userEvent.setup();
    let accountRequests = 0;
    let transactionRequests = 0;
    const duplicateAccounts = [
      accounts[0],
      { ...accounts[0], id: duplicateAccountId },
    ] as const;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      http.get("*/api/finance/ledgers/:ledgerId/accounts", () => {
        accountRequests += 1;
        if (accountRequests > 1) {
          return HttpResponse.json(
            {
              code: "database_unavailable",
              detail: "Database unavailable.",
              status: 503,
              title: "Service unavailable",
              type: "about:blank",
            },
            { status: 503 },
          );
        }
        return HttpResponse.json(duplicateAccounts);
      }),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", () => {
        transactionRequests += 1;
        return HttpResponse.json(
          {
            code: "validation_error",
            detail: "Transfer Accounts and amount must use the same currency.",
            status: 422,
            title: "Validation error",
            type: "about:blank",
          },
          { status: 422 },
        );
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(
      await screen.findByRole("menuitem", { name: "Internal Transfer" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Record internal transfer",
    });
    const source = within(dialog).getByRole("combobox", {
      name: "Source Account",
    });
    const destination = within(dialog).getByRole("combobox", {
      name: "Destination Account",
    });
    const amount = within(dialog).getByRole("textbox", { name: "Amount" });
    const date = within(dialog).getByLabelText("Transaction date");
    const note = within(dialog).getByRole("textbox", { name: "Note" });
    await user.selectOptions(destination, duplicateAccountId);
    await user.type(amount, "71.25");
    await user.clear(date);
    await user.type(date, "2027-04-12");
    await user.type(note, "Keep failed refresh draft");
    await user.click(
      within(dialog).getByRole("button", { name: "Record transfer" }),
    );

    const recoveryAlert = await within(dialog).findByRole("alert");
    expect(recoveryAlert).toHaveTextContent(
      "Accounts could not be refreshed. Retry Account refresh before submitting this transfer.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Retry Account refresh" }),
    ).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "Record transfer" }),
    ).toBeDisabled();
    expect(accountRequests).toBe(2);
    expect(transactionRequests).toBe(1);
    expect(source).toHaveValue(accountId);
    expect(destination).toHaveValue(duplicateAccountId);
    expect(
      within(source).getByRole("option", {
        name: "Cash, active asset in USD, 1 of 2 · USD",
      }),
    ).not.toBeDisabled();
    expect(
      within(destination).getByRole("option", {
        name: "Cash, active asset in USD, 2 of 2 · USD",
      }),
    ).not.toBeDisabled();
    expect(amount).toHaveValue("71.25");
    expect(date).toHaveValue("2027-04-12");
    expect(note).toHaveValue("Keep failed refresh draft");
    await user.type(note, " revised");
    expect(note).toHaveValue("Keep failed refresh draft revised");
    expect(recoveryAlert).toHaveTextContent(
      "Accounts could not be refreshed. Retry Account refresh before submitting this transfer.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Retry Account refresh" }),
    ).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "Record transfer" }),
    ).toBeDisabled();
    expect(source).toHaveValue(accountId);
    expect(destination).toHaveValue(duplicateAccountId);
  });

  it("re-evaluates the preserved draft after Account recovery retry succeeds", async () => {
    const user = userEvent.setup();
    let accountRequests = 0;
    let transactionRequests = 0;
    const duplicateAccounts = [
      accounts[0],
      { ...accounts[0], id: duplicateAccountId },
      {
        ...accounts[0],
        id: destinationAccountId,
        name: "Savings",
      },
    ] as const;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      http.get("*/api/finance/ledgers/:ledgerId/accounts", () => {
        accountRequests += 1;
        if (accountRequests === 2) {
          return HttpResponse.json(
            {
              code: "database_unavailable",
              detail: "Database unavailable.",
              status: 503,
              title: "Service unavailable",
              type: "about:blank",
            },
            { status: 503 },
          );
        }
        if (accountRequests > 2) {
          return HttpResponse.json([
            duplicateAccounts[0],
            {
              ...duplicateAccounts[1],
              currency: "CNY",
              currentBalance: { amount: "20.00", currency: "CNY" },
              openingBalance: { amount: "0.00", currency: "CNY" },
            },
            duplicateAccounts[2],
          ]);
        }
        return HttpResponse.json(duplicateAccounts);
      }),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", () => {
        transactionRequests += 1;
        return HttpResponse.json(
          {
            code: "validation_error",
            detail: "Transfer Accounts and amount must use the same currency.",
            status: 422,
            title: "Validation error",
            type: "about:blank",
          },
          { status: 422 },
        );
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(
      await screen.findByRole("menuitem", { name: "Internal Transfer" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Record internal transfer",
    });
    const source = within(dialog).getByRole("combobox", {
      name: "Source Account",
    });
    const destination = within(dialog).getByRole("combobox", {
      name: "Destination Account",
    });
    const amount = within(dialog).getByRole("textbox", { name: "Amount" });
    const date = within(dialog).getByLabelText("Transaction date");
    const note = within(dialog).getByRole("textbox", { name: "Note" });
    await user.selectOptions(destination, duplicateAccountId);
    await user.type(amount, "82.75");
    await user.clear(date);
    await user.type(date, "2027-04-13");
    await user.type(note, "Keep retry recovery draft");
    await user.click(
      within(dialog).getByRole("button", { name: "Record transfer" }),
    );

    const retry = await within(dialog).findByRole("button", {
      name: "Retry Account refresh",
    });
    expect(
      within(dialog).getByRole("button", { name: "Record transfer" }),
    ).toBeDisabled();
    await user.click(retry);

    const message =
      "The selected Destination Account — Cash, active asset in USD, 2 of 2 — changed currency. Choose a compatible Destination Account again; your other values have been kept.";
    expect(await within(dialog).findByText(message)).toBeVisible();
    await waitFor(() => expect(destination).toHaveFocus());
    expect(accountRequests).toBe(3);
    expect(transactionRequests).toBe(1);
    expect(
      within(dialog).queryByRole("button", { name: "Retry Account refresh" }),
    ).not.toBeInTheDocument();
    const recordTransfer = within(dialog).getByRole("button", {
      name: "Record transfer",
    });
    expect(recordTransfer).toBeEnabled();
    expect(source).toHaveValue(accountId);
    expect(destination).toHaveValue(duplicateAccountId);
    expect(
      within(destination).getByRole("option", {
        name: "Cash, active asset in USD, 2 of 2 (unavailable)",
      }),
    ).toBeDisabled();
    expect(amount).toHaveValue("82.75");
    expect(date).toHaveValue("2027-04-13");
    expect(note).toHaveValue("Keep retry recovery draft");

    await user.click(recordTransfer);
    expect(transactionRequests).toBe(1);
    expect(destination).toHaveAccessibleErrorMessage(message);
    await user.selectOptions(destination, destinationAccountId);
    expect(destination).toHaveValue(destinationAccountId);
    expect(within(dialog).queryByText(message)).not.toBeInTheDocument();
    expect(amount).toHaveValue("82.75");
    expect(date).toHaveValue("2027-04-13");
    expect(note).toHaveValue("Keep retry recovery draft");
  });

  it("explains when no compatible transfer pair is available", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([...accounts]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(
      screen.getByText(
        "Internal Transfer is unavailable until this Ledger has two active Accounts in the same currency.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Manage Accounts" }),
    ).toHaveAttribute("href", `/finance/accounts?ledger=${ledger.id}`);
    await user.click(trigger);
    expect(
      await screen.findByRole("menuitem", { name: "Internal Transfer" }),
    ).toHaveAttribute("data-disabled");
  });

  it("keeps a transfer pending across route remount without allowing another submit", async () => {
    const user = userEvent.setup();
    let releaseRequest!: () => void;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    let requests = 0;
    let created = false;
    const transferAccounts = [
      accounts[0],
      {
        ...accounts[0],
        id: destinationAccountId,
        name: "Savings",
      },
    ] as const;
    const createdTransfer = {
      destinationAccount: {
        id: destinationAccountId,
        name: "Savings",
        status: "active",
      },
      destinationAmount: { amount: "31.00", currency: "USD" },
      id: "99999999-9999-4999-8999-999999999992",
      kind: "internalTransfer",
      ledgerId: ledger.id,
      note: null,
      sourceAccount: { id: accountId, name: "Cash", status: "active" },
      sourceAmount: { amount: "31.00", currency: "USD" },
      transactionDate: "2027-04-09",
    } satisfies TransactionHistoryPageResponse["items"][number];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([...transferAccounts]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(() => ({
        items: created ? [createdTransfer, ...history.items] : history.items,
        nextCursor: null,
      })),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", async () => {
        requests += 1;
        await requestGate;
        created = true;
        return HttpResponse.json(createdTransfer, { status: 201 });
      }),
    );
    const { router } = renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(
      await screen.findByRole("menuitem", { name: "Internal Transfer" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Record internal transfer",
    });
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Destination Account" }),
      destinationAccountId,
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Amount" }),
      "31.00",
    );
    const date = within(dialog).getByLabelText("Transaction date");
    await user.clear(date);
    await user.type(date, "2027-04-09");
    await user.click(
      within(dialog).getByRole("button", { name: "Record transfer" }),
    );

    expect(
      await within(dialog).findByRole("button", {
        name: "Recording transfer…",
      }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(dialog).toBeVisible();
    expect(requests).toBe(1);

    await act(async () => {
      await router.navigate(`/finance/accounts?ledger=${ledger.id}`);
    });
    await screen.findByRole("heading", { level: 1, name: "Accounts" });
    await act(async () => {
      await router.navigate(`/finance/transactions?ledger=${ledger.id}`);
    });
    await screen.findByRole("heading", { level: 1, name: "Transactions" });
    const remountedTrigger = await screen.findByRole("button", {
      name: "Record transaction",
    });
    expect(remountedTrigger).toBeDisabled();
    expect(requests).toBe(1);

    releaseRequest();
    await waitFor(() => expect(remountedTrigger).toBeEnabled());
    expect(requests).toBe(1);
    expect(
      await screen.findByRole("article", {
        name: "Internal Transfer on April 9, 2027",
      }),
    ).toBeVisible();
  });

  it("preserves the draft and requires explicit correction after a Category is archived", async () => {
    const user = userEvent.setup();
    let categoryArchived = false;
    let requests = 0;
    const recoveredExpense = {
      account: { id: accountId, name: "Cash", status: "active" },
      categoryAllocations: [
        {
          amount: { amount: "42.00", currency: "USD" },
          category: null,
        },
      ],
      economicAmount: { amount: "42.00", currency: "USD" },
      id: "99999999-9999-4999-8999-999999999997",
      kind: "expense",
      ledgerId: ledger.id,
      note: "Preserve this draft",
      transactionDate: "2027-03-04",
    } satisfies TransactionHistoryPageResponse["items"][number];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([...accounts]),
      getListFinanceCategoriesMockHandler(() =>
        categoryArchived
          ? [
              { id: activeCategoryId, name: "Groceries", status: "archived" },
              {
                id: duplicateCategoryId,
                name: "Groceries",
                status: "active",
              },
              categories[1],
            ]
          : [
              categories[0],
              {
                id: duplicateCategoryId,
                name: "Groceries",
                status: "active",
              },
              categories[1],
            ],
      ),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", async () => {
        requests += 1;
        if (requests === 1) {
          categoryArchived = true;
          return HttpResponse.json(
            {
              code: "finance_category_archived",
              detail: "Category is archived.",
              status: 409,
              title: "Conflict",
              type: "about:blank",
            },
            { status: 409 },
          );
        }
        return HttpResponse.json(recoveredExpense, { status: 201 });
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole("button", {
      name: "Record transaction",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Record expense" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Amount" }),
      "42.00",
    );
    const category = within(dialog).getByRole("combobox", {
      name: "Category",
    });
    await user.selectOptions(category, activeCategoryId);
    const date = within(dialog).getByLabelText("Transaction date");
    await user.clear(date);
    await user.type(date, "2027-03-04");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Note" }),
      "Preserve this draft",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record expense" }),
    );

    expect(
      await within(dialog).findByText(
        `The selected Category — Groceries, Category ID ${activeCategoryId} — was archived. Choose another active Category or Uncategorized; your other values have been kept.`,
      ),
    ).toBeVisible();
    await waitFor(() => expect(category).toHaveFocus());
    expect(category).toHaveAccessibleErrorMessage(
      `The selected Category — Groceries, Category ID ${activeCategoryId} — was archived. Choose another active Category or Uncategorized; your other values have been kept.`,
    );
    expect(category).toHaveValue(activeCategoryId);
    expect(
      within(category).getByRole("option", {
        name: `Groceries, Category ID ${activeCategoryId} (unavailable)`,
      }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("textbox", { name: "Amount" })).toHaveValue(
      "42.00",
    );
    expect(date).toHaveValue("2027-03-04");
    expect(within(dialog).getByRole("textbox", { name: "Note" })).toHaveValue(
      "Preserve this draft",
    );

    await user.selectOptions(category, "");
    await user.click(
      within(dialog).getByRole("button", { name: "Record expense" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Record expense" }),
      ).not.toBeInTheDocument(),
    );
    expect(requests).toBe(2);
  });

  it("keeps duplicate Account identity in stale-reference recovery", async () => {
    const user = userEvent.setup();
    let accountArchived = false;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler(() => [
        {
          ...accounts[0],
          status: accountArchived ? "archived" : "active",
        },
        {
          ...accounts[0],
          id: duplicateAccountId,
        },
      ]),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", () => {
        accountArchived = true;
        return HttpResponse.json(
          {
            code: "finance_account_archived",
            detail: "Account is archived.",
            status: 409,
            title: "Conflict",
            type: "about:blank",
          },
          { status: 409 },
        );
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole("button", {
      name: "Record transaction",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Income" }));
    const dialog = screen.getByRole("dialog", { name: "Record income" });
    const account = within(dialog).getByRole("combobox", { name: "Account" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Amount" }),
      "19.00",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record income" }),
    );

    const message =
      "The selected Account — Cash, active asset in USD, 1 of 2 — was archived. Choose another active Account; your other values have been kept.";
    expect(await within(dialog).findByText(message)).toBeVisible();
    await waitFor(() => expect(account).toHaveFocus());
    expect(account).toHaveAccessibleErrorMessage(message);
    expect(account).toHaveValue(accountId);
    expect(
      within(account).getByRole("option", {
        name: "Cash, active asset in USD, 1 of 2 (unavailable)",
      }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("textbox", { name: "Amount" })).toHaveValue(
      "19.00",
    );
  });

  it("keeps the selected duplicate Account identity when a background refresh removes it", async () => {
    const user = userEvent.setup();
    let referencesPresent = true;
    let accountRequests = 0;
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler(() => {
        accountRequests += 1;
        return referencesPresent
          ? [
              accounts[0],
              {
                ...accounts[0],
                id: duplicateAccountId,
              },
            ]
          : [accounts[0]];
      }),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", async () => {
        await responseGate;
        return HttpResponse.json(
          {
            code: "finance_account_not_found",
            detail: "Account was not found.",
            status: 404,
            title: "Not found",
            type: "about:blank",
          },
          { status: 404 },
        );
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Income" }));
    const dialog = screen.getByRole("dialog", { name: "Record income" });
    const account = within(dialog).getByRole("combobox", { name: "Account" });
    await user.selectOptions(account, duplicateAccountId);
    await user.type(
      within(dialog).getByRole("textbox", { name: "Amount" }),
      "21.00",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record income" }),
    );

    referencesPresent = false;
    act(() => window.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(accountRequests).toBeGreaterThan(1));
    expect(account).toHaveValue(duplicateAccountId);
    expect(
      within(account).getByRole("option", {
        name: "Cash, active asset in USD, 2 of 2 (unavailable)",
      }),
    ).toBeDisabled();

    releaseResponse();
    const message =
      "The selected Account — Cash, active asset in USD, 2 of 2 — is no longer available. Choose another active Account; your other values have been kept.";
    expect(await within(dialog).findByText(message)).toBeVisible();
    await waitFor(() => expect(account).toHaveFocus());
    expect(account).toHaveAccessibleErrorMessage(message);
  });

  it("keeps the selected duplicate Category identity when a background refresh removes it", async () => {
    const user = userEvent.setup();
    let referencesPresent = true;
    let categoryRequests = 0;
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([...accounts]),
      getListFinanceCategoriesMockHandler(() => {
        categoryRequests += 1;
        return referencesPresent
          ? [
              categories[0],
              {
                ...categories[0],
                id: duplicateCategoryId,
              },
            ]
          : [categories[0]];
      }),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", async () => {
        await responseGate;
        return HttpResponse.json(
          {
            code: "finance_category_not_found",
            detail: "Category was not found.",
            status: 404,
            title: "Not found",
            type: "about:blank",
          },
          { status: 404 },
        );
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Record expense" });
    const category = within(dialog).getByRole("combobox", {
      name: "Category",
    });
    await user.selectOptions(category, duplicateCategoryId);
    await user.type(
      within(dialog).getByRole("textbox", { name: "Amount" }),
      "22.00",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record expense" }),
    );

    referencesPresent = false;
    act(() => window.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(categoryRequests).toBeGreaterThan(1));
    expect(category).toHaveValue(duplicateCategoryId);
    expect(
      within(category).getByRole("option", {
        name: `Groceries, Category ID ${duplicateCategoryId} (unavailable)`,
      }),
    ).toBeDisabled();

    releaseResponse();
    const message = `The selected Category — Groceries, Category ID ${duplicateCategoryId} — is no longer available. Choose another active Category or Uncategorized; your other values have been kept.`;
    expect(await within(dialog).findByText(message)).toBeVisible();
    await waitFor(() => expect(category).toHaveFocus());
    expect(category).toHaveAccessibleErrorMessage(message);
  });

  it("excludes duplicate submission and cancellation while recording is pending", async () => {
    const user = userEvent.setup();
    let releaseRequest!: () => void;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    let requests = 0;
    const createdExpense = {
      account: { id: accountId, name: "Cash", status: "active" },
      categoryAllocations: [
        {
          amount: { amount: "8.00", currency: "USD" },
          category: null,
        },
      ],
      economicAmount: { amount: "8.00", currency: "USD" },
      id: "99999999-9999-4999-8999-999999999996",
      kind: "expense",
      ledgerId: ledger.id,
      note: null,
      transactionDate: "2027-03-05",
    } satisfies TransactionHistoryPageResponse["items"][number];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([...accounts]),
      getListFinanceCategoriesMockHandler([...categories]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", async () => {
        requests += 1;
        await requestGate;
        return HttpResponse.json(createdExpense, { status: 201 });
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole("button", {
      name: "Record transaction",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Record expense" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Amount" }),
      "8.00",
    );
    const date = within(dialog).getByLabelText("Transaction date");
    await user.clear(date);
    await user.type(date, "2027-03-05");
    await user.click(
      within(dialog).getByRole("button", { name: "Record expense" }),
    );

    const pendingButton = await within(dialog).findByRole("button", {
      name: "Recording expense…",
    });
    expect(pendingButton).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("textbox", { name: "Amount" }),
    ).toBeDisabled();
    expect(
      within(dialog).queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("dialog", { name: "Record expense" }),
    ).toBeVisible();
    expect(requests).toBe(1);

    releaseRequest();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Record expense" }),
      ).not.toBeInTheDocument(),
    );
    expect(requests).toBe(1);
  });

  it("restores successful empty-state focus only after recording is usable again", async () => {
    const user = userEvent.setup();
    let created = false;
    let accountRequests = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const createdExpense = {
      account: { id: accountId, name: "Cash", status: "active" },
      categoryAllocations: [
        {
          amount: { amount: "6.00", currency: "USD" },
          category: null,
        },
      ],
      economicAmount: { amount: "6.00", currency: "USD" },
      id: "99999999-9999-4999-8999-999999999995",
      kind: "expense",
      ledgerId: ledger.id,
      note: null,
      transactionDate: "2027-03-06",
    } satisfies TransactionHistoryPageResponse["items"][number];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      http.get("*/api/finance/ledgers/:ledgerId/accounts", async () => {
        accountRequests += 1;
        if (accountRequests > 1) await refreshGate;
        return HttpResponse.json(accounts);
      }),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(() => ({
        items: created ? [createdExpense] : [],
        nextCursor: null,
      })),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", () => {
        created = true;
        return HttpResponse.json(createdExpense, { status: 201 });
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Record transaction" }),
      ).toHaveLength(2),
    );
    const triggers = screen.getAllByRole("button", {
      name: "Record transaction",
    });
    expect(triggers[1]).toBeEnabled();
    const emptyStateTrigger = triggers[1]!;
    await user.click(emptyStateTrigger);
    await user.click(await screen.findByRole("menuitem", { name: "Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Record expense" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Amount" }),
      "6.00",
    );
    const date = within(dialog).getByLabelText("Transaction date");
    await user.clear(date);
    await user.type(date, "2027-03-06");
    await user.click(
      within(dialog).getByRole("button", { name: "Record expense" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Record expense" }),
      ).not.toBeInTheDocument(),
    );
    expect(emptyStateTrigger.isConnected).toBe(false);
    const fallback = screen.getByRole("button", { name: "Record transaction" });
    expect(fallback).toBeDisabled();
    expect(fallback).not.toHaveFocus();

    releaseRefresh();
    await waitFor(() => expect(fallback).toBeEnabled());
    expect(fallback).toHaveFocus();
  });

  it("falls back to the Finance heading when the connected invoker stays disabled", async () => {
    const user = userEvent.setup();
    let accountsEligible = true;
    let accountRequests = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const createdExpense = {
      account: { id: accountId, name: "Cash", status: "active" },
      categoryAllocations: [
        {
          amount: { amount: "7.00", currency: "USD" },
          category: null,
        },
      ],
      economicAmount: { amount: "7.00", currency: "USD" },
      id: "99999999-9999-4999-8999-999999999994",
      kind: "expense",
      ledgerId: ledger.id,
      note: null,
      transactionDate: "2027-03-07",
    } satisfies TransactionHistoryPageResponse["items"][number];
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      http.get("*/api/finance/ledgers/:ledgerId/accounts", async () => {
        accountRequests += 1;
        if (accountRequests > 1) await refreshGate;
        return HttpResponse.json(accountsEligible ? accounts : []);
      }),
      getListFinanceCategoriesMockHandler([]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", () => {
        accountsEligible = false;
        return HttpResponse.json(createdExpense, { status: 201 });
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole(
      "button",
      { name: "Record transaction" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Record expense" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Amount" }),
      "7.00",
    );
    const date = within(dialog).getByLabelText("Transaction date");
    await user.clear(date);
    await user.type(date, "2027-03-07");
    await user.click(
      within(dialog).getByRole("button", { name: "Record expense" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Record expense" }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger.isConnected).toBe(true);
    expect(trigger).toBeDisabled();
    expect(trigger).not.toHaveFocus();

    releaseRefresh();
    await screen.findByText(
      "Record transaction is unavailable until this Ledger has an active Account.",
    );
    expect(trigger).toBeDisabled();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Transactions" }),
      ).toHaveFocus(),
    );
  });

  it("keeps every value through backend validation and a later server error", async () => {
    const user = userEvent.setup();
    let requests = 0;
    server.use(
      getListFinanceLedgersMockHandler([ledger]),
      getListFinanceAccountsMockHandler([...accounts]),
      getListFinanceCategoriesMockHandler([...categories]),
      getListFinanceCurrenciesMockHandler([...currencies]),
      getListFinanceTransactionsMockHandler(history),
      http.post("*/api/finance/ledgers/:ledgerId/transactions", () => {
        requests += 1;
        if (requests === 1) {
          return HttpResponse.json(
            {
              code: "validation_error",
              detail:
                "Transaction Date cannot be before the Account Tracking Start Date.",
              status: 422,
              title: "Validation error",
              type: "about:blank",
            },
            { status: 422 },
          );
        }
        return HttpResponse.json(
          {
            code: "database_unavailable",
            detail: "internal database host unavailable",
            status: 503,
            title: "Service unavailable",
            type: "about:blank",
          },
          { status: 503 },
        );
      }),
    );
    renderRoute(`/finance/transactions?ledger=${ledger.id}`);

    const trigger = await screen.findByRole("button", {
      name: "Record transaction",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Income" }));
    const dialog = screen.getByRole("dialog", { name: "Record income" });
    const amount = within(dialog).getByRole("textbox", { name: "Amount" });
    const category = within(dialog).getByRole("combobox", {
      name: "Category",
    });
    const date = within(dialog).getByLabelText("Transaction date");
    const note = within(dialog).getByRole("textbox", { name: "Note" });
    await user.type(amount, "25.00");
    await user.selectOptions(category, activeCategoryId);
    await user.clear(date);
    await user.type(date, "2027-04-05");
    await user.type(note, "Keep after every failure");
    await user.click(
      within(dialog).getByRole("button", { name: "Record income" }),
    );

    expect(
      await within(dialog).findByText(
        "Choose a Transaction Date on or after the Account's Tracking Start Date.",
      ),
    ).toBeVisible();
    await waitFor(() => expect(date).toHaveFocus());
    expect(amount).toHaveValue("25.00");
    expect(category).toHaveValue(activeCategoryId);
    expect(note).toHaveValue("Keep after every failure");

    await user.clear(date);
    await user.type(date, "2027-04-06");
    await user.click(
      within(dialog).getByRole("button", { name: "Record income" }),
    );
    expect(
      await within(dialog).findByRole("alert", {
        name: "",
      }),
    ).toHaveTextContent(
      "Transactions are temporarily unavailable. Try again later.",
    );
    expect(amount).toHaveValue("25.00");
    expect(category).toHaveValue(activeCategoryId);
    expect(date).toHaveValue("2027-04-06");
    expect(note).toHaveValue("Keep after every failure");
    expect(
      within(dialog).queryByText("internal database host unavailable"),
    ).not.toBeInTheDocument();
    expect(requests).toBe(2);
  });

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
