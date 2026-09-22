import { AxeBuilder } from "@axe-core/playwright";
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  AccountResponse,
  CategoryResponse,
  CurrencyResponse,
  LedgerResponse,
  MeResponse,
  TransactionHistoryPageResponse,
  UserResponse,
} from "../src/api/generated/schemas/index.ts";

const accessibilityTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

const currentUser = MeResponse.parse({
  displayName: "Core Console Operator",
  email: "operator@example.com",
  id: "edb4ee80-17c6-46b5-863e-2afa18e84043",
  username: "operator",
});

const managedUsers = UserResponse.array().parse([
  {
    displayName: "Core Console Operator",
    email: "operator@example.com",
    id: currentUser.id,
    identityIssuer: "local-development",
    identitySubject: "operator",
    status: "active",
    username: "operator",
  },
  {
    displayName: "Alice Smith",
    email: "alice@example.com",
    id: "a40a626a-99f1-4e81-940b-66f9e0d45c90",
    identityIssuer: "local-development",
    identitySubject: "alice",
    status: "active",
    username: "asmith",
  },
  {
    displayName: "Bob Jones",
    email: "bob@example.com",
    id: "b9aa59ad-aa6b-49f5-9f4c-8ed071ea3f74",
    identityIssuer: "local-development",
    identitySubject: "bob",
    status: "inactive",
    username: "bjones",
  },
]);

const financeLedgers = LedgerResponse.array().parse([
  {
    id: "a40a626a-99f1-4e81-940b-66f9e0d45c90",
    name: "Personal",
  },
]);

const financeCurrencies = CurrencyResponse.array().parse([
  { code: "CNY", minorUnit: 2 },
  { code: "JPY", minorUnit: 0 },
  { code: "USD", minorUnit: 2 },
]);

const financeAccounts = AccountResponse.array().parse([
  {
    currency: "CNY",
    currentBalance: { amount: "18420.35", currency: "CNY" },
    id: "11111111-1111-4111-8111-111111111111",
    name: "Operating cash",
    nature: "asset",
    openingBalance: { amount: "10000.00", currency: "CNY" },
    status: "active",
    trackingStartDate: "2026-01-01",
  },
  {
    currency: "USD",
    currentBalance: { amount: "-842.10", currency: "USD" },
    id: "22222222-2222-4222-8222-222222222222",
    name: "Travel card",
    nature: "liability",
    openingBalance: { amount: "0.00", currency: "USD" },
    status: "archived",
    trackingStartDate: "2025-11-15",
  },
  {
    currency: "CNY",
    currentBalance: { amount: "3200.00", currency: "CNY" },
    id: "55555555-5555-4555-8555-555555555555",
    name: "Reserve cash",
    nature: "asset",
    openingBalance: { amount: "0.00", currency: "CNY" },
    status: "active",
    trackingStartDate: "2026-01-01",
  },
]);

const financeCategories = CategoryResponse.array().parse([
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
]);

const financeTransactionPages = [
  TransactionHistoryPageResponse.parse({
    items: [
      {
        account: {
          id: financeAccounts[0]!.id,
          name: financeAccounts[0]!.name,
          status: financeAccounts[0]!.status,
        },
        categoryAllocations: [
          {
            amount: { amount: "8500.00", currency: "CNY" },
            category: null,
          },
        ],
        economicAmount: { amount: "8500.00", currency: "CNY" },
        id: "55555555-5555-4555-8555-555555555555",
        kind: "income",
        ledgerId: financeLedgers[0]!.id,
        note: "August salary",
        transactionDate: "2026-08-16",
      },
      {
        account: {
          id: financeAccounts[1]!.id,
          name: financeAccounts[1]!.name,
          status: financeAccounts[1]!.status,
        },
        categoryAllocations: [
          {
            amount: { amount: "12.99", currency: "USD" },
            category: {
              id: financeCategories[1]!.id,
              name: financeCategories[1]!.name,
              status: financeCategories[1]!.status,
            },
          },
        ],
        economicAmount: { amount: "12.99", currency: "USD" },
        id: "66666666-6666-4666-8666-666666666666",
        kind: "expense",
        ledgerId: financeLedgers[0]!.id,
        note: "Developer tool",
        transactionDate: "2026-08-15",
      },
    ],
    nextCursor: "opaque-browser-cursor",
  }),
  TransactionHistoryPageResponse.parse({
    items: [
      {
        destinationAccount: {
          id: financeAccounts[0]!.id,
          name: financeAccounts[0]!.name,
          status: financeAccounts[0]!.status,
        },
        destinationAmount: { amount: "500.00", currency: "CNY" },
        id: "77777777-7777-4777-8777-777777777777",
        kind: "internalTransfer",
        ledgerId: financeLedgers[0]!.id,
        note: null,
        sourceAccount: {
          id: "99999999-9999-4999-8999-999999999999",
          name: "Old wallet",
          status: "archived",
        },
        sourceAmount: { amount: "500.00", currency: "CNY" },
        transactionDate: "2026-08-14",
      },
      {
        account: {
          id: financeAccounts[0]!.id,
          name: financeAccounts[0]!.name,
          status: financeAccounts[0]!.status,
        },
        correctionDelta: { amount: "-27.00", currency: "CNY" },
        id: "88888888-8888-4888-8888-888888888888",
        kind: "balanceAdjustment",
        ledgerId: financeLedgers[0]!.id,
        note: "Balance correction",
        transactionDate: "2026-08-13",
      },
    ],
    nextCursor: null,
  }),
] as const;

const longTransactionAccountName = "A".repeat(100);
const longTransactionCategoryName = "C".repeat(100);
const longTransactionAccount = AccountResponse.parse({
  ...financeAccounts[0]!,
  name: longTransactionAccountName,
});
const longTransactionCategory = CategoryResponse.parse({
  ...financeCategories[0]!,
  name: longTransactionCategoryName,
});
const longReferenceTransactionPage = TransactionHistoryPageResponse.parse({
  items: [
    {
      account: {
        id: longTransactionAccount.id,
        name: longTransactionAccount.name,
        status: longTransactionAccount.status,
      },
      categoryAllocations: [
        {
          amount: { amount: "8500.00", currency: "CNY" },
          category: {
            id: longTransactionCategory.id,
            name: longTransactionCategory.name,
            status: longTransactionCategory.status,
          },
        },
      ],
      economicAmount: { amount: "8500.00", currency: "CNY" },
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "income",
      ledgerId: financeLedgers[0]!.id,
      note: "Long reference regression",
      transactionDate: "2026-08-16",
    },
  ],
  nextCursor: null,
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", async (route) => {
    await route.fulfill({ json: currentUser });
  });
});

const collectBrowserErrors = (page: Page) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.stack ?? error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  return { pageErrors, consoleErrors };
};

const expectNoBrowserErrors = (
  errors: ReturnType<typeof collectBrowserErrors>,
) => {
  expect(errors.pageErrors, "unexpected page errors").toEqual([]);
  expect(errors.consoleErrors, "unexpected console errors").toEqual([]);
};

const formatAxeViolations = (violations: AxeResults["violations"]) =>
  violations
    .map(({ help, id, impact, nodes }) => {
      const targets = nodes
        .map(({ target }) => `  target: ${target.join(" > ")}`)
        .join("\n");

      return `- ${id} [${impact ?? "unknown"}]: ${help}\n${targets}`;
    })
    .join("\n");

const expectNoAccessibilityViolations = async (
  page: Page,
  surface: Locator,
  testInfo: TestInfo,
) => {
  await surface.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation: { finished: Promise<unknown> }) =>
          animation.finished.catch(() => undefined),
        ),
    );
  });

  const results = await new AxeBuilder({ page })
    .withTags([...accessibilityTags])
    .analyze();

  if (results.violations.length === 0) {
    return;
  }

  await testInfo.attach("axe-results", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
  expect(
    results.violations.length,
    `axe accessibility violations:\n${formatAxeViolations(results.violations)}`,
  ).toBe(0);
};

test("opens the home page", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  const sidebar = page.getByRole("complementary", {
    name: "Core Console sidebar",
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Home" }),
  ).toBeVisible();
  await expect(sidebar).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page, sidebar, testInfo);
  expectNoBrowserErrors(errors);
});

test("opens Users management in the production shell", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.route("**/api/users", async (route) => {
    await route.fulfill({ json: managedUsers });
  });
  const sidebar = page.getByRole("complementary", {
    name: "Core Console sidebar",
  });

  await page.goto("/users");

  await expect(
    page.getByRole("heading", { level: 1, name: "Users" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { exact: true, name: "Alice Smith" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "Inactive" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Users" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expectNoAccessibilityViolations(page, sidebar, testInfo);

  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog", { name: "Add user" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Identity issuer *")).toBeEditable();
  await expectNoAccessibilityViolations(page, dialog, testInfo);
  await dialog.press("Escape");
  await expect(dialog).not.toBeVisible();

  expectNoBrowserErrors(errors);
});

test("opens Finance with shared Ledger context", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  const finance = page.getByRole("region", { name: "Overview" });

  await page.goto("/finance/overview");

  await expect(page).toHaveURL(
    new RegExp(`/finance/overview\\?ledger=${financeLedgers[0]!.id}$`),
  );
  await expect(page.getByRole("button", { name: "Personal" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Finance", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    finance.getByRole("navigation", { name: "Finance navigation" }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page, finance, testInfo);
  expectNoBrowserErrors(errors);
});

test("renders accessible responsive Finance Accounts", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ height: 900, width: 1024 });
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route("**/api/finance/currencies", async (route) => {
    await route.fulfill({ json: financeCurrencies });
  });
  await page.route("**/api/finance/ledgers/*/accounts", async (route) => {
    await route.fulfill({ json: financeAccounts });
  });
  const accounts = page.getByRole("region", { exact: true, name: "Accounts" });

  await page.goto(`/finance/accounts?ledger=${financeLedgers[0]!.id}`);

  await expect(
    accounts.getByRole("heading", { name: "Active Accounts" }),
  ).toBeVisible();
  await expect(
    accounts.getByRole("heading", { name: "Archived Accounts" }),
  ).toBeVisible();
  await expect(accounts.getByText("18,420.35 CNY")).toBeVisible();
  expect(
    await page.evaluate<boolean>(
      "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
    ),
  ).toBe(true);
  await expectNoAccessibilityViolations(page, accounts, testInfo);

  const accountActions = accounts.getByRole("button", {
    name: "Actions for Operating cash",
  });
  await accountActions.click();
  await page
    .getByRole("menuitem", {
      name: "Correct nature or currency for Operating cash",
    })
    .click();
  const correction = page.getByRole("dialog", {
    name: "Correct nature or currency",
  });
  await expect(correction.getByLabel("New nature")).toBeVisible();
  await expect(correction.getByLabel("New currency")).toBeVisible();
  await expectNoAccessibilityViolations(page, correction, testInfo);
  await correction.press("Escape");
  await expect(correction).not.toBeVisible();
  await expect(accountActions).toBeFocused();

  await accountActions.click();
  await page.getByRole("menuitem", { name: "Archive Operating cash" }).click();
  const archiveConfirmation = page.getByRole("alertdialog", {
    name: "Archive Operating cash?",
  });
  await expect(
    archiveConfirmation.getByRole("button", { name: "Cancel" }),
  ).toBeFocused();
  await expectNoAccessibilityViolations(page, archiveConfirmation, testInfo);
  await archiveConfirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(archiveConfirmation).not.toBeVisible();
  await expect(accountActions).toBeFocused();

  await accounts.getByRole("button", { name: "Create account" }).click();
  const dialog = page.getByRole("dialog", { name: "Create account" });
  await expect(dialog.getByLabel("Account name")).toBeEditable();
  await expectNoAccessibilityViolations(page, dialog, testInfo);
  await dialog.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    accounts.getByRole("button", { name: "Create account" }),
  ).toBeFocused();
  expectNoBrowserErrors(errors);
});

test("renders accessible responsive Finance Categories", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ height: 900, width: 1024 });
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route("**/api/finance/ledgers/*/categories", async (route) => {
    await route.fulfill({ json: financeCategories });
  });
  const categories = page.getByRole("region", {
    exact: true,
    name: "Categories",
  });

  await page.goto(`/finance/categories?ledger=${financeLedgers[0]!.id}`);

  await expect(
    categories.getByRole("heading", { name: "Active Categories" }),
  ).toBeVisible();
  await expect(
    categories.getByRole("heading", { name: "Archived Categories" }),
  ).toBeVisible();
  expect(
    await page.evaluate<boolean>(
      "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
    ),
  ).toBe(true);
  await expectNoAccessibilityViolations(page, categories, testInfo);

  const foodActions = categories.getByRole("button", {
    name: "Actions for Food",
  });
  await foodActions.click();
  await page.getByRole("menuitem", { name: "Rename Food" }).click();
  const rename = page.getByRole("dialog", { name: "Rename Food" });
  await expect(rename.getByLabel("Category name")).toHaveValue("Food");
  await expectNoAccessibilityViolations(page, rename, testInfo);
  await rename.press("Escape");
  await expect(rename).not.toBeVisible();
  await expect(foodActions).toBeFocused();

  await foodActions.click();
  await page.getByRole("menuitem", { name: "Archive Food" }).click();
  const archiveConfirmation = page.getByRole("alertdialog", {
    name: "Archive Food?",
  });
  await expect(
    archiveConfirmation.getByRole("button", { name: "Cancel" }),
  ).toBeFocused();
  await expectNoAccessibilityViolations(page, archiveConfirmation, testInfo);
  await archiveConfirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(archiveConfirmation).not.toBeVisible();
  await expect(foodActions).toBeFocused();

  await categories.getByRole("button", { name: "Create category" }).click();
  const create = page.getByRole("dialog", { name: "Create category" });
  await expect(create.getByLabel("Category name")).toBeEditable();
  await expectNoAccessibilityViolations(page, create, testInfo);
  await create.press("Escape");
  await expect(create).not.toBeVisible();
  await expect(
    categories.getByRole("button", { name: "Create category" }),
  ).toBeFocused();
  expectNoBrowserErrors(errors);
});

test("renders accessible responsive Finance Transactions with opaque pagination", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ height: 900, width: 1024 });
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route("**/api/finance/ledgers/*/accounts", async (route) => {
    await route.fulfill({ json: financeAccounts });
  });
  await page.route("**/api/finance/ledgers/*/categories", async (route) => {
    await route.fulfill({ json: financeCategories });
  });
  await page.route("**/api/finance/currencies", async (route) => {
    await route.fulfill({ json: financeCurrencies });
  });
  await page.route("**/api/finance/ledgers/*/transactions**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    await route.fulfill({
      json:
        cursor === "opaque-browser-cursor"
          ? financeTransactionPages[1]
          : financeTransactionPages[0],
    });
  });
  const transactions = page.getByRole("region", {
    exact: true,
    name: "Transactions",
  });

  await page.goto(
    `/finance/transactions?ledger=${financeLedgers[0]!.id}&uncategorized=true`,
  );

  await expect(
    transactions.getByRole("article", {
      name: "Income on August 16, 2026",
    }),
  ).toBeVisible();
  await expect(
    transactions
      .getByRole("article", { name: "Expense on August 15, 2026" })
      .getByText("From Travel card (archived)"),
  ).toBeVisible();
  expect(
    await page.evaluate<boolean>(
      "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
    ),
  ).toBe(true);
  await expectNoAccessibilityViolations(page, transactions, testInfo);

  const recordTransaction = transactions.getByRole("button", {
    name: "Record transaction",
  });
  await expect(recordTransaction).toBeEnabled();
  await recordTransaction.click();
  await page.getByRole("menuitem", { name: "Expense" }).click();
  const expenseDialog = page.getByRole("dialog", { name: "Record expense" });
  await expect(expenseDialog.getByLabel("Amount")).toBeEditable();
  await expect(expenseDialog.getByLabel("Transaction date")).toBeEditable();
  await expect(
    expenseDialog.getByRole("option", { name: /Travel card/ }),
  ).toHaveCount(0);
  await expect(
    expenseDialog.getByRole("option", { name: /Subscriptions/ }),
  ).toHaveCount(0);
  expect(
    await expenseDialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expectNoAccessibilityViolations(page, expenseDialog, testInfo);
  await expenseDialog.press("Escape");
  await expect(expenseDialog).not.toBeVisible();
  await expect(recordTransaction).toBeFocused();

  await recordTransaction.click();
  await page.getByRole("menuitem", { name: "Internal Transfer" }).click();
  const transferDialog = page.getByRole("dialog", {
    name: "Record internal transfer",
  });
  await expect(transferDialog.getByLabel("Source Account")).toHaveValue(
    financeAccounts[0]!.id,
  );
  const transferDestination = transferDialog.getByLabel("Destination Account");
  await expect(transferDestination).toBeEditable();
  await expect(
    transferDestination.getByRole("option", { name: "Reserve cash · CNY" }),
  ).toHaveCount(1);
  await expect(
    transferDestination.getByRole("option", { name: /Operating cash/ }),
  ).toHaveCount(0);
  await expect(
    transferDestination.getByRole("option", { name: /Travel card/ }),
  ).toHaveCount(0);
  await expect(transferDialog.getByText("CNY", { exact: true })).toBeVisible();
  expect(
    await transferDialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expectNoAccessibilityViolations(page, transferDialog, testInfo);
  await transferDialog.press("Escape");
  await expect(transferDialog).not.toBeVisible();
  await expect(recordTransaction).toBeFocused();

  await transactions.getByRole("button", { name: "Load more" }).click();
  await expect(
    transactions.getByRole("article", {
      name: "Balance Adjustment on August 13, 2026",
    }),
  ).toBeVisible();
  await expect(transactions.getByRole("status")).toContainText(
    "2 more transactions loaded.",
  );

  await transactions
    .getByRole("combobox", { name: "Transaction kind" })
    .selectOption("expense");
  await expect(page).not.toHaveURL(/kind=expense/);
  await transactions.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/kind=expense/);
  expectNoBrowserErrors(errors);
});

for (const viewportWidth of [1024, 1280]) {
  test(`wraps long Transaction references at ${viewportWidth}px without horizontal document scroll`, async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await page.setViewportSize({ height: 900, width: viewportWidth });
    await page.route("**/api/finance/ledgers", async (route) => {
      await route.fulfill({ json: financeLedgers });
    });
    await page.route("**/api/finance/ledgers/*/accounts", async (route) => {
      await route.fulfill({ json: [longTransactionAccount] });
    });
    await page.route("**/api/finance/ledgers/*/categories", async (route) => {
      await route.fulfill({ json: [longTransactionCategory] });
    });
    await page.route("**/api/finance/currencies", async (route) => {
      await route.fulfill({ json: financeCurrencies });
    });
    await page.route(
      "**/api/finance/ledgers/*/transactions**",
      async (route) => {
        await route.fulfill({ json: longReferenceTransactionPage });
      },
    );
    const transactions = page.getByRole("region", {
      exact: true,
      name: "Transactions",
    });

    await page.goto(
      `/finance/transactions?ledger=${financeLedgers[0]!.id}&account_id=${longTransactionAccount.id}&category_id=${longTransactionCategory.id}`,
    );

    const appliedFilters = transactions.getByText(
      `Applied filters: Account ${longTransactionAccountName} · Category ${longTransactionCategoryName}`,
      { exact: true },
    );
    const transaction = transactions.getByRole("article", {
      name: "Income on August 16, 2026",
    });
    const accountReference = transaction.getByText(
      `Into ${longTransactionAccountName}`,
      { exact: true },
    );
    const categoryReference = transaction.getByText(
      longTransactionCategoryName,
      { exact: true },
    );

    await expect(appliedFilters).toBeVisible();
    await expect(accountReference).toBeVisible();
    await expect(categoryReference).toBeVisible();
    for (const reference of [
      appliedFilters,
      accountReference,
      categoryReference,
    ]) {
      expect(
        await reference.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }
    expect(
      await page.evaluate<boolean>(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
      ),
    ).toBe(true);
    expectNoBrowserErrors(errors);
  });
}

test("renders the frontend 404 page for an unknown route", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  const sidebar = page.getByRole("complementary", {
    name: "Core Console sidebar",
  });

  await page.goto("/missing-page");

  await expect(page).toHaveURL(/\/missing-page$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Return home" })).toBeVisible();
  await expectNoAccessibilityViolations(page, sidebar, testInfo);
  expectNoBrowserErrors(errors);
});
