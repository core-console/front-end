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
  BalanceAdjustmentContextResponse,
  CategoryResponse,
  CurrencyResponse,
  FinanceTransactionResponse,
  FinanceOverviewResponse,
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

const financeOverviewForMonth = (month: string) =>
  FinanceOverviewResponse.parse({
    accounts: financeAccounts,
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
          {
            currency: "USD",
            expense: { amount: "0.00", currency: "USD" },
            income: { amount: "0.00", currency: "USD" },
            net: { amount: "0.00", currency: "USD" },
            transactionCount: 1,
          },
        ],
        date: `${month}-16`,
        transactionCount: 2,
        transactionCountByKind: {
          balanceAdjustment: 1,
          expense: 0,
          income: 0,
          internalTransfer: 1,
        },
      },
    ],
    financialPositionByCurrency: [
      {
        assetTotal: { amount: "21620.35", currency: "CNY" },
        currency: "CNY",
        liabilityTotal: { amount: "0.00", currency: "CNY" },
        netPosition: { amount: "21620.35", currency: "CNY" },
      },
      {
        assetTotal: { amount: "0.00", currency: "USD" },
        currency: "USD",
        liabilityTotal: { amount: "842.10", currency: "USD" },
        netPosition: { amount: "-842.10", currency: "USD" },
      },
    ],
    ledger: financeLedgers[0],
    month,
    monthSummaryByCurrency: [
      {
        currency: "CNY",
        expense: { amount: "0.00", currency: "CNY" },
        income: { amount: "0.00", currency: "CNY" },
        net: { amount: "0.00", currency: "CNY" },
      },
      {
        currency: "USD",
        expense: { amount: "0.00", currency: "USD" },
        income: { amount: "0.00", currency: "USD" },
        net: { amount: "0.00", currency: "USD" },
      },
    ],
  });

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

const mockOverviewDetails = async (page: Page) => {
  await page.route("**/api/finance/currencies", async (route) => {
    await route.fulfill({ json: financeCurrencies });
  });
  await page.route("**/api/finance/ledgers/*/accounts", async (route) => {
    await route.fulfill({ json: financeAccounts });
  });
  await page.route("**/api/finance/ledgers/*/categories", async (route) => {
    await route.fulfill({ json: financeCategories });
  });
  await page.route("**/api/finance/ledgers/*/transactions?*", async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get("fromDate");
    const items = date?.endsWith("-16")
      ? financeTransactionPages[1]!.items.map((item) => ({
          ...item,
          transactionDate: date,
        }))
      : [];
    await route.fulfill({ json: { items, nextCursor: null } });
  });
};

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
  await surface.waitFor({ state: "visible" });
  await page.locator("body").evaluate(async (element) => {
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
  await mockOverviewDetails(page);
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route(
    "**/api/finance/ledgers/*/overview?month=*",
    async (route) => {
      const month = new URL(route.request().url()).searchParams.get("month")!;
      await route.fulfill({ json: financeOverviewForMonth(month) });
    },
  );
  const finance = page.getByRole("region", { name: "Overview" });

  await page.goto("/finance/overview");

  await expect(page).toHaveURL(
    new RegExp(
      `/finance/overview\\?ledger=${financeLedgers[0]!.id}&month=\\d{4}-\\d{2}&date=\\d{4}-\\d{2}-\\d{2}$`,
    ),
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

test("enables Other transaction actions at full contrast and preserves keyboard dismissal", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  await mockOverviewDetails(page);
  let releaseAccounts!: () => void;
  const accountsReady = new Promise<void>((resolve) => {
    releaseAccounts = resolve;
  });
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route("**/api/finance/ledgers/*/accounts", async (route) => {
    await accountsReady;
    await route.fulfill({ json: financeAccounts });
  });
  await page.route(
    "**/api/finance/ledgers/*/overview?month=*",
    async (route) => {
      const month = new URL(route.request().url()).searchParams.get("month")!;
      await route.fulfill({ json: financeOverviewForMonth(month) });
    },
  );
  await page.goto("/finance/overview");
  const trigger = page.getByRole("button", {
    name: "Other transaction actions",
    exact: true,
  });
  await expect(trigger).toBeDisabled();
  await expect(trigger).toHaveCSS("opacity", "0.5");
  // Observe the actual enabled frame; eventual opacity assertions miss the fade.
  const triggerId = await trigger.getAttribute("id");
  await page.evaluate(`(() => {
    const element = document.getElementById(${JSON.stringify(triggerId)});
    window.firstEnabledOpacity = new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!element.disabled) {
          observer.disconnect();
          resolve(getComputedStyle(element).opacity);
        }
      });
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["disabled"],
      });
    });
  })()`);
  releaseAccounts();
  const firstEnabledOpacity = await page.evaluate<string>(
    "window.firstEnabledOpacity",
  );
  expect(firstEnabledOpacity).toBe("1");
  await expect(trigger).toBeEnabled();
  await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  await expectNoAccessibilityViolations(page, trigger, testInfo);
  await trigger.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Balance Adjustment", exact: true }),
  ).toBeEnabled();
  await menu.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expectNoBrowserErrors(errors);
});

test("keeps the seven-day Finance Calendar usable in the expanded 1024px shell", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  await mockOverviewDetails(page);
  await page.setViewportSize({ height: 900, width: 1024 });
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route(
    "**/api/finance/ledgers/*/overview?month=*",
    async (route) => {
      const month = new URL(route.request().url()).searchParams.get("month")!;
      await route.fulfill({ json: financeOverviewForMonth(month) });
    },
  );
  const overview = page.getByRole("region", { exact: true, name: "Overview" });
  await page.goto(
    `/finance/overview?ledger=${financeLedgers[0]!.id}&month=2026-08&date=2026-08-16`,
  );
  const calendar = overview.getByRole("grid", {
    name: "2026-08 Finance calendar",
  });
  await expect(calendar).toBeVisible();
  await expect(
    overview.getByRole("form", { name: "Quick Entry" }),
  ).toBeVisible();
  await expect(
    overview
      .getByRole("region", { name: "Selected-day activity" })
      .getByRole("listitem"),
  ).toHaveCount(2);
  await expect(calendar.getByRole("button")).toHaveCount(31);
  await expect(
    calendar.getByRole("button", {
      name: /2026-08-16.*Selected.*2 transactions.*Internal Transfer.*Balance Adjustment.*CNY and USD/,
    }),
  ).toBeVisible();
  await expect(
    overview
      .getByRole("region", { name: "Current financial position" })
      .getByText("21,620.35 CNY")
      .first(),
  ).toBeVisible();
  await expect(
    overview
      .getByRole("region", { name: "Current financial position" })
      .getByText("-842.10 USD"),
  ).toBeVisible();
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ height: 900, width });
    await expect(calendar).toBeVisible();
    expect(
      await page.evaluate<boolean>(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ height: 900, width: 1024 });
  await expectNoAccessibilityViolations(page, overview, testInfo);
  expectNoBrowserErrors(errors);
});

test("records Quick Entry with keyboard order and refreshes the selected day", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ height: 900, width: 1024 });
  await mockOverviewDetails(page);
  let created = false;
  let submissions = 0;
  let submittedBody: unknown;
  const transaction = FinanceTransactionResponse.parse({
    account: {
      id: financeAccounts[0]!.id,
      name: financeAccounts[0]!.name,
      status: "active",
    },
    categoryAllocations: [
      {
        amount: { amount: "12.34", currency: "CNY" },
        category: {
          id: financeCategories[0]!.id,
          name: financeCategories[0]!.name,
          status: "active",
        },
      },
    ],
    economicAmount: { amount: "12.34", currency: "CNY" },
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "expense",
    ledgerId: financeLedgers[0]!.id,
    note: "Cafe",
    transactionDate: "2026-08-17",
  });
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route(
    "**/api/finance/ledgers/*/overview?month=*",
    async (route) => {
      const summary = financeOverviewForMonth("2026-08");
      await route.fulfill({
        json: created
          ? {
              ...summary,
              days: [
                ...summary.days,
                {
                  ...summary.days[0],
                  date: "2026-08-17",
                  transactionCount: 1,
                  transactionCountByKind: {
                    balanceAdjustment: 0,
                    expense: 1,
                    income: 0,
                    internalTransfer: 0,
                  },
                },
              ],
            }
          : summary,
      });
    },
  );
  await page.route("**/api/finance/ledgers/*/transactions?*", async (route) => {
    const date = new URL(route.request().url()).searchParams.get("fromDate");
    if (date !== "2026-08-17") return route.fallback();
    await route.fulfill({
      json: { items: created ? [transaction] : [], nextCursor: null },
    });
  });
  await page.route("**/api/finance/ledgers/*/transactions", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    submissions += 1;
    submittedBody = route.request().postDataJSON();
    created = true;
    await route.fulfill({ json: transaction, status: 201 });
  });
  await page.goto(
    `/finance/overview?ledger=${financeLedgers[0]!.id}&month=2026-08&date=2026-08-17`,
  );
  const form = page.getByRole("form", { name: "Quick Entry" });
  const amount = form.getByRole("textbox", { name: "Amount" });
  const account = form.getByRole("combobox", { name: "Account" });
  const category = form.getByRole("combobox", { name: "Category" });
  const note = form.getByRole("textbox", { name: "Note" });
  await expect(form).toBeVisible();
  await expect(amount).not.toBeFocused();
  await amount.focus();
  await page.keyboard.type("12.34");
  await page.keyboard.press("Tab");
  await expect(account).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(category).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(category).toHaveValue(financeCategories[0]!.id);
  await page.keyboard.press("Tab");
  await expect(note).toBeFocused();
  await page.keyboard.type("Cafe");
  await page.keyboard.press("Enter");
  await expect.poll(() => submissions).toBe(1);
  expect(submittedBody).toEqual({
    accountId: financeAccounts[0]!.id,
    categoryAllocations: [
      {
        amount: { amount: "12.34", currency: "CNY" },
        categoryId: financeCategories[0]!.id,
      },
    ],
    economicAmount: { amount: "12.34", currency: "CNY" },
    kind: "expense",
    note: "Cafe",
    transactionDate: "2026-08-17",
  });
  await expect(amount).toHaveValue("");
  await expect(amount).toBeFocused();
  await expect(note).toHaveValue("");
  await expect(category).toHaveValue(financeCategories[0]!.id);
  await expect(
    page.getByRole("button", { name: /2026-08-17.*1 transaction.*Expense/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Selected-day activity" })
      .getByText(/12.34 CNY from Operating cash/),
  ).toBeVisible();
  expectNoBrowserErrors(errors);
});

test.describe("Finance Overview civil dates in Pacific/Apia", () => {
  test.use({ timezoneId: "Pacific/Apia" });

  test("speaks the skipped 2011-12-30 date and weekday without shifting it", async ({
    page,
  }) => {
    const errors = collectBrowserErrors(page);
    await mockOverviewDetails(page);
    await page.route("**/api/finance/ledgers", async (route) => {
      await route.fulfill({ json: financeLedgers });
    });
    await page.route(
      "**/api/finance/ledgers/*/overview?month=*",
      async (route) => {
        await route.fulfill({ json: financeOverviewForMonth("2011-12") });
      },
    );

    await page.goto(
      `/finance/overview?ledger=${financeLedgers[0]!.id}&month=2011-12&date=2011-12-30`,
    );
    const calendar = page.getByRole("grid", {
      name: "2011-12 Finance calendar",
    });
    await expect(
      calendar.getByRole("button", {
        name: /2011-12-30, Friday, December 30, 2011.*Selected/,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Calendar" })
        .getByText("December 2011 · Selected Friday, December 30, 2011"),
    ).toBeVisible();
    expectNoBrowserErrors(errors);
  });
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
  await page.route(
    "**/api/finance/ledgers/*/accounts/*/balance-adjustment-context**",
    async (route) => {
      const transactionDate = new URL(route.request().url()).searchParams.get(
        "transactionDate",
      );
      await route.fulfill({
        json: BalanceAdjustmentContextResponse.parse({
          account: {
            id: financeAccounts[0]!.id,
            name: financeAccounts[0]!.name,
            status: financeAccounts[0]!.status,
          },
          accountNature: financeAccounts[0]!.nature,
          derivedComparisonBalance: financeAccounts[0]!.currentBalance,
          transactionDate,
        }),
      });
    },
  );
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
  await page.route("**/api/finance/ledgers/*/transactions/*", async (route) => {
    const id = route.request().url().split("/").at(-1);
    const transaction = financeTransactionPages[0]!.items.find(
      (item) => item.id === id,
    );
    await route.fulfill({ json: transaction, status: transaction ? 200 : 404 });
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

  const editExpense = transactions.getByRole("button", {
    name: /Edit Expense.*Transaction ID/,
  });
  await editExpense.click();
  const editDialog = page.getByRole("dialog", { name: "Edit Expense" });
  await expect(editDialog.getByLabel("Account")).toHaveValue(
    financeAccounts[1]!.id,
  );
  await expect(
    editDialog.getByRole("option", { name: /Travel card.*archived/ }),
  ).toHaveCount(1);
  await expect(editDialog.getByLabel("Amount")).toBeEditable();
  for (const width of [1024, 1280]) {
    await page.setViewportSize({ height: 900, width });
    expect(
      await editDialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  }
  await expectNoAccessibilityViolations(page, editDialog, testInfo);
  await editDialog.press("Escape");
  await expect(editDialog).not.toBeVisible();
  await expect(editExpense).toBeFocused();
  await page.setViewportSize({ height: 900, width: 1024 });

  const recordTransaction = transactions
    .getByRole("group", { name: "Transaction history actions" })
    .getByRole("button", { name: "Record transaction", exact: true });
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

  await recordTransaction.click();
  await page.getByRole("menuitem", { name: "Balance Adjustment" }).click();
  const adjustmentDialog = page.getByRole("dialog", {
    name: "Record balance adjustment",
  });
  await expect(adjustmentDialog.getByLabel("Account")).toHaveValue(
    financeAccounts[0]!.id,
  );
  await expect(adjustmentDialog.getByText("18,420.35 CNY")).toBeVisible();
  await expect(adjustmentDialog.getByText("Asset")).toBeVisible();
  await expect(
    adjustmentDialog.getByText(/known end-of-day Account Balance/),
  ).toBeVisible();
  await adjustmentDialog.getByLabel("Target balance").fill("18421.35");
  await expect(adjustmentDialog.getByText("+1.00 CNY")).toBeVisible();
  expect(
    await adjustmentDialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expectNoAccessibilityViolations(page, adjustmentDialog, testInfo);
  await adjustmentDialog.press("Escape");
  await expect(adjustmentDialog).not.toBeVisible();
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

for (const viewportWidth of [1024, 1280]) {
  test(`shows accessible Transaction detail and confirmation at ${viewportWidth}px`, async ({
    page,
  }, testInfo) => {
    const errors = collectBrowserErrors(page);
    const expense = financeTransactionPages[0]!.items[1]!;
    await page.setViewportSize({ height: 900, width: viewportWidth });
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
    await page.route(
      "**/api/finance/ledgers/*/transactions**",
      async (route) => {
        await route.fulfill({ json: financeTransactionPages[0] });
      },
    );
    await page.route(
      "**/api/finance/ledgers/*/transactions/*",
      async (route) => {
        await route.fulfill({ json: expense });
      },
    );

    await page.goto(
      `/finance/transactions/${expense.id}?ledger=${financeLedgers[0]!.id}`,
    );
    await expect(
      page.getByRole("heading", { name: "Transaction detail" }),
    ).toBeVisible();
    await expect(page.getByText("Travel card (archived)")).toBeVisible();
    await expect(page.getByText("Subscriptions (archived)")).toBeVisible();
    expect(
      await page.evaluate<boolean>(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
      ),
    ).toBe(true);
    await expectNoAccessibilityViolations(
      page,
      page.getByRole("region", { name: "Transactions" }),
      testInfo,
    );

    await page.getByRole("button", { name: "Delete transaction" }).click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Delete transaction?",
    });
    await expect(
      confirmation.getByRole("button", { name: "Cancel" }),
    ).toBeFocused();
    await expect(confirmation).toContainText("cannot be undone or restored");
    await expectNoAccessibilityViolations(page, confirmation, testInfo);
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).not.toBeVisible();
    await page.getByRole("link", { name: "Back to Transactions" }).click();
    await expect(page).toHaveURL(
      `/finance/transactions?ledger=${financeLedgers[0]!.id}`,
    );
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Transaction detail" }),
    ).toBeVisible();
    expectNoBrowserErrors(errors);
  });
}

test("replaces an archived Account Adjustment in an accessible narrow dialog", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  const original = financeTransactionPages[1]!.items[1]!;
  if (original.kind !== "balanceAdjustment")
    throw new Error("Expected an Adjustment fixture");
  const archivedAccount = AccountResponse.parse({
    ...financeAccounts[1]!,
    name: longTransactionAccountName,
  });
  const adjustment = FinanceTransactionResponse.parse({
    ...original,
    account: {
      id: archivedAccount.id,
      name: archivedAccount.name,
      status: "archived",
    },
    correctionDelta: { amount: "-27.00", currency: "USD" },
  });
  if (adjustment.kind !== "balanceAdjustment")
    throw new Error("Expected an Adjustment");
  const updated = FinanceTransactionResponse.parse({
    ...adjustment,
    correctionDelta: { amount: "1.00", currency: "USD" },
  });
  if (updated.kind !== "balanceAdjustment")
    throw new Error("Expected an updated Adjustment");
  let current = adjustment;
  await page.setViewportSize({ height: 812, width: 375 });
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route("**/api/finance/ledgers/*/accounts", async (route) => {
    await route.fulfill({ json: [archivedAccount, financeAccounts[0]!] });
  });
  await page.route("**/api/finance/currencies", async (route) => {
    await route.fulfill({ json: financeCurrencies });
  });
  await page.route("**/api/finance/ledgers/*/transactions/*", async (route) => {
    await route.fulfill({ json: current });
  });
  await page.route(
    "**/api/finance/ledgers/*/accounts/*/balance-adjustment-context**",
    async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("replacingTransactionId")).toBe(
        adjustment.id,
      );
      expect(url.searchParams.get("transactionDate")).toBe(
        adjustment.transactionDate,
      );
      await route.fulfill({
        json: BalanceAdjustmentContextResponse.parse({
          account: adjustment.account,
          accountNature: "liability",
          derivedComparisonBalance: {
            amount: "9007199254740993.25",
            currency: "USD",
          },
          transactionDate: adjustment.transactionDate,
        }),
      });
    },
  );
  await page.route(
    "**/api/finance/ledgers/*/balance-adjustments/*",
    async (route) => {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({
        accountId: archivedAccount.id,
        expectedAccountNature: "liability",
        expectedDerivedBalance: {
          amount: "9007199254740993.25",
          currency: "USD",
        },
        targetBalance: { amount: "9007199254740994.25", currency: "USD" },
      });
      current = updated;
      await route.fulfill({
        json: { outcome: "updated", transaction: updated },
      });
    },
  );

  await page.goto(
    `/finance/transactions/${adjustment.id}?ledger=${financeLedgers[0]!.id}`,
  );
  await page.getByRole("button", { name: "Edit Balance Adjustment" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Balance Adjustment" });
  await expect(dialog.getByRole("combobox", { name: "Account" })).toHaveValue(
    archivedAccount.id,
  );
  await expect(dialog.getByRole("option", { name: /archived/ })).toBeAttached();
  await expect(dialog.getByText("9,007,199,254,740,993.25 USD")).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "Target balance" })
    .fill("9007199254740994.25");
  await expect(dialog.getByText("+1.00 USD")).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.right <= element.ownerDocument.documentElement.clientWidth
      );
    }),
  ).toBe(true);
  await expectNoAccessibilityViolations(page, dialog, testInfo);
  await dialog.getByRole("button", { name: "Save adjustment" }).click();
  await expect(
    page.getByRole("region", { name: "Transactions" }).getByRole("status"),
  ).toContainText("Balance Adjustment updated.");
  expectNoBrowserErrors(errors);
});

test("keeps long Account names and Transaction identity inside a narrow delete confirmation", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  const transaction = longReferenceTransactionPage.items[0]!;
  await page.setViewportSize({ height: 812, width: 375 });
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route("**/api/finance/ledgers/*/transactions/*", async (route) => {
    await route.fulfill({ json: transaction });
  });

  await page.goto(
    `/finance/transactions/${transaction.id}?ledger=${financeLedgers[0]!.id}`,
  );
  await page.getByRole("button", { name: "Delete transaction" }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Delete transaction?",
  });
  await expect(confirmation).toContainText(longTransactionAccountName);
  await expect(confirmation).toContainText(`Transaction ID ${transaction.id}`);
  await expect(
    confirmation.getByRole("button", { name: "Cancel" }),
  ).toBeFocused();
  for (const locator of [
    confirmation,
    confirmation.locator('[data-slot="alert-dialog-description"]'),
  ]) {
    expect(
      await locator.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  }
  expect(
    await confirmation.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.right <= element.ownerDocument.documentElement.clientWidth
      );
    }),
  ).toBe(true);
  await expectNoAccessibilityViolations(page, confirmation, testInfo);
  expectNoBrowserErrors(errors);
});

test("carries a new Ledger through setup, four entries, history, detail, and navigation", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors = collectBrowserErrors(page);
  const missingResources: string[] = [];
  page.on("response", (response) => {
    if (response.status() === 404) missingResources.push(response.url());
  });
  await page.setViewportSize({ height: 900, width: 1024 });
  const secondLedger = LedgerResponse.parse({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Projects",
  });
  const ledgers: Array<(typeof financeLedgers)[number]> = [];
  const accounts: Array<(typeof financeAccounts)[number]> = [];
  const categories: Array<(typeof financeCategories)[number]> = [];
  const entries: Array<ReturnType<typeof FinanceTransactionResponse.parse>> =
    [];
  const submitted: unknown[] = [];
  const accountRef = (account: (typeof financeAccounts)[number]) => ({
    id: account.id,
    name: account.name,
    status: account.status,
  });
  const expense = FinanceTransactionResponse.parse({
    account: accountRef(financeAccounts[0]!),
    categoryAllocations: [
      {
        amount: { amount: "12.99", currency: "CNY" },
        category: {
          id: financeCategories[0]!.id,
          name: financeCategories[0]!.name,
          status: "active",
        },
      },
    ],
    economicAmount: { amount: "12.99", currency: "CNY" },
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "expense",
    ledgerId: financeLedgers[0]!.id,
    note: "Cafe",
    transactionDate: "2026-08-16",
  });
  const income = FinanceTransactionResponse.parse({
    account: accountRef(financeAccounts[0]!),
    categoryAllocations: [
      { amount: { amount: "40.00", currency: "CNY" }, category: null },
    ],
    economicAmount: { amount: "40.00", currency: "CNY" },
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc",
    kind: "income",
    ledgerId: financeLedgers[0]!.id,
    note: "Pay",
    transactionDate: "2026-08-15",
  });
  const transfer = FinanceTransactionResponse.parse({
    destinationAccount: accountRef(financeAccounts[2]!),
    destinationAmount: { amount: "5.00", currency: "CNY" },
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    kind: "internalTransfer",
    ledgerId: financeLedgers[0]!.id,
    note: null,
    sourceAccount: accountRef(financeAccounts[0]!),
    sourceAmount: { amount: "5.00", currency: "CNY" },
    transactionDate: "2026-08-14",
  });
  const adjustment = FinanceTransactionResponse.parse({
    account: accountRef(financeAccounts[0]!),
    correctionDelta: { amount: "1.00", currency: "CNY" },
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    kind: "balanceAdjustment",
    ledgerId: financeLedgers[0]!.id,
    note: "Counted",
    transactionDate: "2026-08-13",
  });
  await page.route("**/api/finance/ledgers", async (route) => {
    if (route.request().method() === "POST") {
      const next = ledgers.length === 0 ? financeLedgers[0]! : secondLedger;
      ledgers.push(next);
      await route.fulfill({ json: next, status: 201 });
    } else await route.fulfill({ json: ledgers });
  });
  await page.route("**/api/finance/currencies", async (route) => {
    await route.fulfill({ json: financeCurrencies });
  });
  await page.route("**/api/finance/ledgers/*/accounts", async (route) => {
    if (route.request().method() === "POST") {
      const next =
        accounts.length === 0 ? financeAccounts[0]! : financeAccounts[2]!;
      accounts.push(next);
      await route.fulfill({ json: next, status: 201 });
    } else {
      const isPersonal = route.request().url().includes(financeLedgers[0]!.id);
      await route.fulfill({ json: isPersonal ? accounts : [] });
    }
  });
  await page.route("**/api/finance/ledgers/*/categories", async (route) => {
    if (route.request().method() === "POST") {
      categories.push(financeCategories[0]!);
      await route.fulfill({ json: financeCategories[0], status: 201 });
    } else await route.fulfill({ json: categories });
  });
  await page.route(
    "**/api/finance/ledgers/*/overview?month=*",
    async (route) => {
      const url = new URL(route.request().url());
      const month = url.searchParams.get("month")!;
      const ledger = url.pathname.includes(financeLedgers[0]!.id)
        ? financeLedgers[0]!
        : secondLedger;
      const visible = ledger.id === financeLedgers[0]!.id ? entries : [];
      const template = financeOverviewForMonth(month);
      await route.fulfill({
        json: {
          ...template,
          accounts: ledger.id === financeLedgers[0]!.id ? accounts : [],
          days: visible
            .filter((entry) => entry.transactionDate.startsWith(month))
            .map((entry) => ({
              activityByCurrency: [],
              date: entry.transactionDate,
              transactionCount: 1,
              transactionCountByKind: {
                balanceAdjustment: Number(entry.kind === "balanceAdjustment"),
                expense: Number(entry.kind === "expense"),
                income: Number(entry.kind === "income"),
                internalTransfer: Number(entry.kind === "internalTransfer"),
              },
            })),
          financialPositionByCurrency:
            ledger.id === financeLedgers[0]!.id && accounts.length > 0
              ? template.financialPositionByCurrency.slice(0, 1)
              : [],
          ledger,
          monthSummaryByCurrency:
            ledger.id === financeLedgers[0]!.id && accounts.length > 0
              ? template.monthSummaryByCurrency.slice(0, 1)
              : [],
        },
      });
    },
  );
  await page.route(
    "**/api/finance/ledgers/*/accounts/*/balance-adjustment-context**",
    async (route) => {
      await route.fulfill({
        json: BalanceAdjustmentContextResponse.parse({
          account: accountRef(financeAccounts[0]!),
          accountNature: "asset",
          derivedComparisonBalance: {
            amount: "18420.35",
            currency: "CNY",
          },
          transactionDate: new URL(route.request().url()).searchParams.get(
            "transactionDate",
          ),
        }),
      });
    },
  );
  await page.route(
    "**/api/finance/ledgers/*/balance-adjustments",
    async (route) => {
      submitted.push(route.request().postDataJSON());
      entries.unshift(adjustment);
      await route.fulfill({
        json: { outcome: "created", transaction: adjustment },
        status: 201,
      });
    },
  );
  await page.route("**/api/finance/ledgers/*/transactions", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { kind: string };
      submitted.push(body);
      const created =
        body.kind === "expense"
          ? expense
          : body.kind === "income"
            ? income
            : transfer;
      entries.unshift(created);
      await route.fulfill({ json: created, status: 201 });
    } else await route.fulfill({ json: { items: entries, nextCursor: null } });
  });
  await page.route("**/api/finance/ledgers/*/transactions?*", async (route) => {
    const url = new URL(route.request().url());
    const isPersonal = url.pathname.includes(financeLedgers[0]!.id);
    const kind = url.searchParams.get("kind");
    const from = url.searchParams.get("fromDate");
    const to = url.searchParams.get("toDate");
    const cursor = url.searchParams.get("cursor");
    const filtered = (isPersonal ? entries : []).filter(
      (entry) =>
        (!kind || entry.kind === kind) &&
        (!from || entry.transactionDate >= from) &&
        (!to || entry.transactionDate <= to),
    );
    const offset = cursor === "opaque-journey-cursor" ? 2 : 0;
    await route.fulfill({
      json: {
        items: filtered.slice(offset, offset + 2),
        nextCursor:
          filtered.length > offset + 2 ? "opaque-journey-cursor" : null,
      },
    });
  });
  await page.route("**/api/finance/ledgers/*/transactions/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) {
      await route.fulfill({ json: { detail: "Not found" }, status: 404 });
    } else if (route.request().method() === "DELETE") {
      entries.splice(index, 1);
      await route.fulfill({ status: 204 });
    } else if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { note: string };
      entries[index] = FinanceTransactionResponse.parse({
        ...entries[index],
        note: body.note,
      });
      await route.fulfill({ json: entries[index] });
    } else await route.fulfill({ json: entries[index] });
  });

  await page.goto("/finance/overview");
  await expect(
    page.getByRole("heading", { name: "Create your first Ledger" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Ledger name" }).fill("Personal");
  await page.getByRole("button", { name: "Create Ledger" }).click();
  await expect(page).toHaveURL(new RegExp(`ledger=${financeLedgers[0]!.id}`));
  await page.getByRole("link", { name: "Accounts", exact: true }).click();
  for (const account of [financeAccounts[0]!, financeAccounts[2]!]) {
    await page.getByRole("button", { name: "Create account" }).click();
    const dialog = page.getByRole("dialog", { name: "Create account" });
    await dialog
      .getByRole("textbox", { name: "Account name" })
      .fill(account.name);
    await dialog
      .getByRole("textbox", { name: "Opening balance" })
      .fill(account.openingBalance.amount);
    await dialog
      .getByLabel("Tracking start date")
      .fill(account.trackingStartDate);
    await dialog.getByRole("button", { name: "Create account" }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page.getByRole("link", { name: "Categories", exact: true }).click();
  await page.getByRole("button", { name: "Create category" }).click();
  const categoryDialog = page.getByRole("dialog", { name: "Create category" });
  await categoryDialog
    .getByRole("textbox", { name: "Category name" })
    .fill("Food");
  await categoryDialog.getByRole("button", { name: "Create category" }).click();
  await expect(categoryDialog).not.toBeVisible();

  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  const transactions = page.getByRole("region", {
    exact: true,
    name: "Transactions",
  });
  await expect(
    page.getByRole("heading", { name: "No transactions yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record transaction", exact: true }),
  ).toHaveCount(2);
  const record = transactions
    .getByRole("group", { name: "Transaction history actions" })
    .getByRole("button", { name: "Record transaction", exact: true });
  for (const [kind, amount, date, note] of [
    ["Expense", "12.99", "2026-08-16", "Cafe"],
    ["Income", "40.00", "2026-08-15", "Pay"],
  ] as const) {
    await record.click();
    await page.getByRole("menuitem", { name: kind }).click();
    const dialog = page.getByRole("dialog", {
      name: `Record ${kind.toLowerCase()}`,
    });
    if (kind === "Income")
      await expectNoAccessibilityViolations(page, dialog, testInfo);
    await dialog.getByRole("textbox", { name: "Amount" }).fill(amount);
    await dialog.getByLabel("Transaction date").fill(date);
    await dialog.getByRole("textbox", { name: "Note" }).fill(note);
    if (kind === "Expense")
      await dialog
        .getByRole("combobox", { name: "Category" })
        .selectOption(financeCategories[0]!.id);
    await dialog
      .getByRole("button", { name: `Record ${kind.toLowerCase()}` })
      .click();
    await expect(dialog).not.toBeVisible();
  }
  await record.click();
  await page.getByRole("menuitem", { name: "Internal Transfer" }).click();
  const transferDialog = page.getByRole("dialog", {
    name: "Record internal transfer",
  });
  await expectNoAccessibilityViolations(page, transferDialog, testInfo);
  await transferDialog
    .getByRole("combobox", { name: "Destination Account" })
    .selectOption(financeAccounts[2]!.id);
  await transferDialog.getByRole("textbox", { name: "Amount" }).fill("5.00");
  await transferDialog.getByLabel("Transaction date").fill("2026-08-14");
  await transferDialog.getByRole("button", { name: "Record transfer" }).click();
  await expect(transferDialog).not.toBeVisible();
  await record.click();
  await page.getByRole("menuitem", { name: "Balance Adjustment" }).click();
  const adjustmentDialog = page.getByRole("dialog", {
    name: "Record balance adjustment",
  });
  await adjustmentDialog.getByLabel("Transaction date").fill("2026-08-13");
  await adjustmentDialog
    .getByRole("textbox", { name: "Target balance" })
    .fill("18421.35");
  await adjustmentDialog.getByRole("textbox", { name: "Note" }).fill("Counted");
  await adjustmentDialog
    .getByRole("button", { name: "Record adjustment" })
    .click();
  await expect(adjustmentDialog).not.toBeVisible();
  expect(submitted).toHaveLength(4);
  await expect(transactions.getByRole("article")).toHaveCount(2);
  await transactions.getByRole("button", { name: "Load more" }).click();
  await expect(transactions.getByRole("article")).toHaveCount(4);
  for (const kind of [
    "Expense",
    "Income",
    "Internal Transfer",
    "Balance Adjustment",
  ]) {
    await expect(
      transactions.getByRole("article", { name: new RegExp(`^${kind} on`) }),
    ).toBeVisible();
  }
  await expectNoAccessibilityViolations(page, transactions, testInfo);

  await transactions
    .getByRole("link", { name: /View details for Expense/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/transactions/${expense.id}`));
  await page.getByRole("button", { name: "Edit Expense" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit Expense" });
  await editDialog.getByRole("textbox", { name: "Note" }).fill("Cafe revised");
  await editDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(editDialog).not.toBeVisible();
  await expect(page.getByRole("article")).toContainText("Cafe revised");
  await page.reload();
  await expect(page.getByRole("article")).toContainText("Cafe revised");
  await page.getByRole("button", { name: "Delete transaction" }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Delete transaction?",
  });
  await expect(
    confirmation.getByRole("button", { name: "Cancel" }),
  ).toBeFocused();
  await confirmation
    .getByRole("button", { name: "Delete transaction" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/finance/transactions\\?ledger=${financeLedgers[0]!.id}`),
  );
  await expect(
    transactions.getByRole("article", { name: /Expense/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "Transaction completion" }),
  ).toHaveText("Transaction deleted.");
  await expect(
    page.getByRole("heading", { name: "Transactions", level: 1 }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Transactions", level: 1 }),
  ).toHaveAccessibleDescription("Transaction deleted.");

  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.goto(
    `/finance/overview?ledger=${financeLedgers[0]!.id}&month=2026-08&date=2026-08-15`,
  );
  await expect(
    page.getByRole("region", { name: "Selected-day activity" }),
  ).toContainText("40.00 CNY");
  await page.getByRole("button", { name: "Personal" }).click();
  await page.getByRole("menuitem", { name: "Create Ledger" }).click();
  const ledgerDialog = page.getByRole("dialog", { name: "Create Ledger" });
  await expectNoAccessibilityViolations(page, ledgerDialog, testInfo);
  await ledgerDialog
    .getByRole("textbox", { name: "Ledger name" })
    .fill("Projects");
  await ledgerDialog
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`ledger=${secondLedger.id}`));
  await expect(
    page.getByRole("region", { name: "Account summary" }),
  ).toContainText("No Accounts in this Ledger yet");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`ledger=${financeLedgers[0]!.id}`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`ledger=${secondLedger.id}`));
  await page.reload();
  await expect(page.getByRole("button", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("menuitem", { name: "Personal" }).click();
  await expect(page).toHaveURL(new RegExp(`ledger=${financeLedgers[0]!.id}`));
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ height: 900, width });
    for (const destination of [
      "Overview",
      "Transactions",
      "Accounts",
      "Categories",
    ]) {
      await page.getByRole("link", { name: destination, exact: true }).click();
      await expect(
        page.getByRole("region", { name: destination, exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate<boolean>(
          "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
        ),
      ).toBe(true);
    }
  }
  expect(
    await page.evaluate<boolean>(
      "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
    ),
  ).toBe(true);
  expect(missingResources).toEqual([]);
  expectNoBrowserErrors(errors);
});

test("keeps an Adjustment draft and exact context through a browser conflict", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ height: 900, width: 1024 });
  const submitted: unknown[] = [];
  let contextReads = 0;
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route("**/api/finance/currencies", async (route) => {
    await route.fulfill({ json: financeCurrencies });
  });
  await page.route("**/api/finance/ledgers/*/accounts", async (route) => {
    await route.fulfill({ json: [financeAccounts[0]] });
  });
  await page.route("**/api/finance/ledgers/*/categories", async (route) => {
    await route.fulfill({ json: financeCategories });
  });
  await page.route("**/api/finance/ledgers/*/transactions?*", async (route) => {
    await route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.route(
    "**/api/finance/ledgers/*/accounts/*/balance-adjustment-context**",
    async (route) => {
      contextReads += 1;
      await route.fulfill({
        json: BalanceAdjustmentContextResponse.parse({
          account: {
            id: financeAccounts[0]!.id,
            name: financeAccounts[0]!.name,
            status: "active",
          },
          accountNature: "asset",
          derivedComparisonBalance: {
            amount: contextReads === 1 ? "20.00" : "27.50",
            currency: "CNY",
          },
          transactionDate: new URL(route.request().url()).searchParams.get(
            "transactionDate",
          ),
        }),
      });
    },
  );
  await page.route(
    "**/api/finance/ledgers/*/balance-adjustments",
    async (route) => {
      submitted.push(route.request().postDataJSON());
      if (submitted.length === 1) {
        await route.fulfill({
          json: {
            code: "account_balance_changed",
            detail: "Authoritative context changed.",
            status: 409,
            title: "Conflict",
            type: "about:blank",
          },
          status: 409,
        });
      } else {
        await route.fulfill({
          json: { outcome: "noChange", transaction: null },
        });
      }
    },
  );
  await page.goto(`/finance/transactions?ledger=${financeLedgers[0]!.id}`);
  await page
    .getByRole("group", { name: "Transaction history actions" })
    .getByRole("button", { name: "Record transaction", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Balance Adjustment" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Record balance adjustment",
  });
  const target = dialog.getByRole("textbox", { name: "Target balance" });
  const note = dialog.getByRole("textbox", { name: "Note" });
  await target.fill("25.00");
  await note.fill("Counted independently");
  await expect(dialog.getByText("+5.00 CNY")).toBeVisible();
  await dialog.getByRole("button", { name: "Record adjustment" }).click();
  const conflict = dialog.getByRole("alert");
  await expect(conflict).toContainText("Account balance changed");
  await expect(conflict).toContainText(
    "Derived balance changed from 20.00 CNY to 27.50 CNY.",
  );
  await expect(dialog.getByText("-2.50 CNY")).toBeVisible();
  await expect(target).toHaveValue("25.00");
  await expect(note).toHaveValue("Counted independently");
  expect(submitted).toHaveLength(1);
  await expectNoAccessibilityViolations(page, dialog, testInfo);
  await dialog.getByRole("button", { name: "Record adjustment" }).click();
  await expect(dialog).not.toBeVisible();
  expect(submitted).toEqual([
    expect.objectContaining({
      expectedDerivedBalance: { amount: "20.00", currency: "CNY" },
      targetBalance: { amount: "25.00", currency: "CNY" },
    }),
    expect.objectContaining({
      expectedDerivedBalance: { amount: "27.50", currency: "CNY" },
      targetBalance: { amount: "25.00", currency: "CNY" },
    }),
  ]);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([
    expect.stringMatching(/Failed to load resource:.*409/),
  ]);
});

test("keeps history usable after a database error and handles a removed detail", async ({
  page,
}, testInfo) => {
  test.setTimeout(75_000);
  const errors = collectBrowserErrors(page);
  let allowNextPage = false;
  let failedPageRequests = 0;
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
  await page.route("**/api/finance/ledgers/*/categories", async (route) => {
    await route.fulfill({ json: financeCategories });
  });
  await page.route("**/api/finance/ledgers/*/transactions?*", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor && !allowNextPage) {
      failedPageRequests += 1;
      await route.fulfill({
        json: {
          code: "database_unavailable",
          detail: "constraint internal secret 7fca",
          status: 503,
          title: "Service unavailable",
          type: "about:blank",
        },
        status: 503,
      });
    } else {
      await route.fulfill({
        json: cursor ? financeTransactionPages[1] : financeTransactionPages[0],
      });
    }
  });
  await page.route("**/api/finance/ledgers/*/transactions/*", async (route) => {
    await route.fulfill({
      json: {
        code: "finance_transaction_not_found",
        detail: "constraint internal secret 7fca",
        status: 404,
        title: "Not found",
        type: "about:blank",
      },
      status: 404,
    });
  });
  await page.goto(`/finance/transactions?ledger=${financeLedgers[0]!.id}`);
  const transactions = page.getByRole("region", {
    exact: true,
    name: "Transactions",
  });
  await expect(transactions.getByRole("article")).toHaveCount(2);
  await transactions.getByRole("button", { name: "Load more" }).click();
  const failure = transactions.getByRole("alert").filter({
    hasText: "More transactions could not be loaded.",
  });
  await expect(failure).toContainText(
    "More transactions could not be loaded. Existing results are still available.",
    { timeout: 20_000 },
  );
  await expect(transactions.getByRole("article")).toHaveCount(2);
  await expect(page.getByText("constraint internal secret 7fca")).toHaveCount(
    0,
  );
  await expectNoAccessibilityViolations(page, transactions, testInfo);
  allowNextPage = true;
  await transactions
    .getByRole("button", { name: "Retry loading more" })
    .click();
  await expect(transactions.getByRole("article")).toHaveCount(4);
  await transactions
    .getByRole("link", { name: /View details for Balance Adjustment/ })
    .click();
  const unavailable = page.getByRole("heading", {
    name: "Transaction unavailable",
  });
  await expect(unavailable).toBeVisible();
  await expect(unavailable).toBeFocused();
  await expect(page.getByText("constraint internal secret 7fca")).toHaveCount(
    0,
  );
  await expectNoAccessibilityViolations(
    page,
    page.getByRole("region", { name: "Transactions" }),
    testInfo,
  );
  expect(failedPageRequests).toBeGreaterThan(0);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors.length).toBeGreaterThanOrEqual(2);
  expect(
    errors.consoleErrors.filter(
      (message) => !/Failed to load resource:.*(503|404)/.test(message),
    ),
  ).toEqual([]);
});

test("recovers Category lifecycle conflicts and preserves locked Account semantics", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ height: 900, width: 1024 });
  const duplicate = CategoryResponse.parse({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    name: "Subscriptions",
    status: "active",
  });
  const categories = [financeCategories[0]!, duplicate, financeCategories[1]!];
  let unarchiveAttempts = 0;
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route("**/api/finance/currencies", async (route) => {
    await route.fulfill({ json: financeCurrencies });
  });
  await page.route("**/api/finance/ledgers/*/accounts", async (route) => {
    await route.fulfill({ json: financeAccounts });
  });
  await page.route("**/api/finance/ledgers/*/accounts/*", async (route) => {
    await route.fulfill({
      json: {
        code: "finance_account_semantics_locked",
        detail: "database constraint internal secret 7fca",
        status: 409,
        title: "Conflict",
        type: "about:blank",
      },
      status: 409,
    });
  });
  await page.route("**/api/finance/ledgers/*/categories", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        json: {
          code: "finance_category_name_conflict",
          detail: "database constraint internal secret 7fca",
          status: 409,
          title: "Conflict",
          type: "about:blank",
        },
        status: 409,
      });
    } else await route.fulfill({ json: categories });
  });
  await page.route("**/api/finance/ledgers/*/categories/*", async (route) => {
    const body = route.request().postDataJSON() as { name: string };
    const updated = CategoryResponse.parse({
      ...categories[2],
      name: body.name,
    });
    categories[2] = updated;
    await route.fulfill({ json: updated });
  });
  await page.route(
    "**/api/finance/ledgers/*/categories/*/unarchive",
    async (route) => {
      unarchiveAttempts += 1;
      if (unarchiveAttempts === 1) {
        await route.fulfill({
          json: {
            code: "finance_category_name_conflict",
            detail: "database constraint internal secret 7fca",
            status: 409,
            title: "Conflict",
            type: "about:blank",
          },
          status: 409,
        });
      } else {
        const active = CategoryResponse.parse({
          ...categories[2],
          status: "active",
        });
        categories[2] = active;
        await route.fulfill({ json: active });
      }
    },
  );

  await page.goto(`/finance/categories?ledger=${financeLedgers[0]!.id}`);
  const categoryRegion = page.getByRole("region", {
    exact: true,
    name: "Categories",
  });
  await categoryRegion.getByRole("button", { name: "Create category" }).click();
  const create = page.getByRole("dialog", { name: "Create category" });
  const name = create.getByRole("textbox", { name: "Category name" });
  await name.fill("Food");
  await create.getByRole("button", { name: "Create category" }).click();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAttribute(
    "aria-errormessage",
    "create-category-name-error",
  );
  await expect(
    create.getByText("A Category with this name already exists."),
  ).toBeVisible();
  await expect(name).toHaveValue("Food");
  await expect(create).not.toContainText("constraint internal secret");
  await expectNoAccessibilityViolations(page, create, testInfo);
  await create.getByRole("button", { name: "Cancel" }).click();
  await expect(
    categoryRegion.getByRole("button", { name: "Create category" }),
  ).toBeFocused();

  const archivedActions = categoryRegion.getByRole("button", {
    name: `Actions for Subscriptions, Category ID ${financeCategories[1]!.id}`,
  });
  await archivedActions.click();
  await page
    .getByRole("menuitem", { name: /Unarchive Subscriptions.*Category ID/ })
    .click();
  const lifecycleError = categoryRegion.getByRole("alert");
  await expect(lifecycleError).toContainText("rename it, then retry Unarchive");
  await expect(lifecycleError).not.toContainText("constraint internal secret");
  await lifecycleError
    .getByRole("button", { name: /Rename Subscriptions/ })
    .click();
  const rename = page.getByRole("dialog", { name: /Rename Subscriptions/ });
  await expectNoAccessibilityViolations(page, rename, testInfo);
  await rename
    .getByRole("textbox", { name: "Category name" })
    .fill("Subscriptions restored");
  await rename.getByRole("button", { name: "Rename category" }).click();
  await expect(rename).not.toBeVisible();
  const restoredActions = categoryRegion.getByRole("button", {
    name: "Actions for Subscriptions restored",
  });
  await restoredActions.click();
  await page
    .getByRole("menuitem", { name: "Unarchive Subscriptions restored" })
    .click();
  await expect(categoryRegion.getByRole("status")).toContainText(
    "Subscriptions restored unarchived.",
  );
  await expect(restoredActions).toBeFocused();
  expect(unarchiveAttempts).toBe(2);

  await page.getByRole("link", { name: "Accounts", exact: true }).click();
  const accounts = page.getByRole("region", { exact: true, name: "Accounts" });
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
  await correction
    .getByRole("combobox", { name: "New nature" })
    .selectOption("liability");
  await correction.getByRole("button", { name: "Apply correction" }).click();
  await expect(correction.getByRole("alert")).toContainText(
    "An established financial position or Transaction history prevents reinterpretation.",
  );
  await expect(
    correction.getByRole("combobox", { name: "New nature" }),
  ).toHaveValue("liability");
  await expect(correction).not.toContainText("constraint internal secret");
  await expectNoAccessibilityViolations(page, correction, testInfo);
  await correction.getByRole("button", { name: "Return to Accounts" }).click();
  await expect(accountActions).toBeFocused();
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([
    expect.stringMatching(/Failed to load resource:.*409/),
    expect.stringMatching(/Failed to load resource:.*409/),
    expect.stringMatching(/Failed to load resource:.*409/),
  ]);
});

test("does not resurrect detail after pending deletion across Back, Forward, and reload", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  const transaction = financeTransactionPages[0]!.items[0]!;
  let deleted = false;
  let detailReads = 0;
  let deletes = 0;
  let releaseDelete!: () => void;
  const deleteResponse = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  await mockOverviewDetails(page);
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route("**/api/finance/ledgers/*/transactions?*", async (route) => {
    await route.fulfill({
      json: { items: deleted ? [] : [transaction], nextCursor: null },
    });
  });
  await page.route(
    `**/api/finance/ledgers/*/transactions/${transaction.id}`,
    async (route) => {
      if (route.request().method() === "DELETE") {
        deletes += 1;
        await deleteResponse;
        deleted = true;
        await route.fulfill({ status: 204 });
        return;
      }
      detailReads += 1;
      if (!deleted) await route.fulfill({ json: transaction });
      else {
        await route.fulfill({ json: { detail: "Not found" }, status: 404 });
      }
    },
  );
  await page.goto(`/finance/transactions?ledger=${financeLedgers[0]!.id}`);
  await page.getByRole("link", { name: /View details for Income/ }).click();
  await page
    .getByRole("button", { name: "Delete transaction", exact: true })
    .click();
  const deleteStarted = page.waitForRequest(
    (request) =>
      request.method() === "DELETE" && request.url().endsWith(transaction.id),
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete transaction", exact: true })
    .click();
  await deleteStarted;
  await page.goBack();
  await expect(
    page.getByRole("article", { name: "Income on August 16, 2026" }),
  ).toBeVisible();
  const deletionConfirmed = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" && response.status() === 204,
  );
  releaseDelete();
  await deletionConfirmed;
  await expect(
    page.getByRole("heading", { name: "No transactions yet" }),
  ).toBeVisible();
  expect(detailReads).toBe(1);

  await page.goForward();
  await expect(
    page.getByRole("button", { name: "Delete transaction", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit Income", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Transaction detail", exact: true }),
  ).toHaveCount(0);
  const unavailable = page.getByRole("heading", {
    name: "Transaction unavailable",
  });
  await expect(unavailable).toBeVisible();
  await expect(unavailable).toBeFocused();
  await expect(unavailable).toHaveAccessibleDescription("Transaction deleted.");
  await expect(page.getByRole("status")).toHaveText("Transaction deleted.");
  await expect(page).toHaveURL(
    `/finance/transactions/${transaction.id}?ledger=${financeLedgers[0]!.id}`,
  );
  for (let navigation = 0; navigation < 2; navigation += 1) {
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "No transactions yet" }),
    ).toBeVisible();
    await page.goForward();
    await expect(unavailable).toBeFocused();
  }
  expect(detailReads).toBe(1);
  expect(deletes).toBe(1);
  await page.reload();
  await expect(unavailable).toBeVisible();
  await expect(unavailable).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Delete transaction", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit Income", exact: true }),
  ).toHaveCount(0);
  expect(detailReads).toBe(2);
  await expectNoAccessibilityViolations(page, unavailable, testInfo);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([
    expect.stringMatching(/Failed to load resource:.*404/),
  ]);
});

for (const scenario of [
  { detail: "success", status: 204 },
  { detail: "pending", status: 204 },
  { detail: "success", status: 404 },
] as const) {
  test(`keeps remounted detail terminal after ${scenario.status} with a ${scenario.detail} GET`, async ({
    page,
  }, testInfo) => {
    const errors = collectBrowserErrors(page);
    const transaction = financeTransactionPages[0]!.items[0]!;
    let deleted = false;
    let detailReads = 0;
    let deletes = 0;
    let releaseDelete!: () => void;
    let releaseDetail!: () => void;
    const deleteResponse = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const detailResponse = new Promise<void>((resolve) => {
      releaseDetail = resolve;
    });
    await mockOverviewDetails(page);
    await page.route("**/api/finance/ledgers", async (route) => {
      await route.fulfill({ json: financeLedgers });
    });
    await page.route(
      "**/api/finance/ledgers/*/transactions?*",
      async (route) => {
        await route.fulfill({
          json: { items: deleted ? [] : [transaction], nextCursor: null },
        });
      },
    );
    await page.route(
      `**/api/finance/ledgers/*/transactions/${transaction.id}`,
      async (route) => {
        if (route.request().method() === "DELETE") {
          deletes += 1;
          await deleteResponse;
          deleted = true;
          if (scenario.status === 204) await route.fulfill({ status: 204 });
          else
            await route.fulfill({
              status: 404,
              json: {
                type: "about:blank",
                title: "Not Found",
                status: 404,
                code: "finance_transaction_not_found",
                detail: "Transaction was already removed.",
              },
            });
          return;
        }
        detailReads += 1;
        if (detailReads === 2 && scenario.detail === "pending") {
          await detailResponse;
          if (route.request().failure()) return;
        }
        await route.fulfill({
          json: {
            ...transaction,
            note:
              detailReads === 1
                ? "Original projection"
                : "Remounted projection",
          },
        });
      },
    );
    const detailUrl = `/finance/transactions/${transaction.id}?ledger=${financeLedgers[0]!.id}`;
    await page.goto(`/finance/transactions?ledger=${financeLedgers[0]!.id}`);
    await page.getByRole("link", { name: /View details for Income/ }).click();
    await page
      .getByRole("button", { name: "Delete transaction", exact: true })
      .click();
    const deleteStarted = page.waitForRequest(
      (request) =>
        request.method() === "DELETE" && request.url().endsWith(transaction.id),
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete transaction", exact: true })
      .click();
    await deleteStarted;
    await page.goBack();
    await expect(
      page.getByRole("article", { name: "Income on August 16, 2026" }),
    ).toBeVisible();
    const remountedRead = page.waitForRequest(
      (request) =>
        request.method() === "GET" && request.url().endsWith(transaction.id),
    );
    await page.goForward();
    await remountedRead;
    await expect(
      page.getByText(
        scenario.detail === "pending"
          ? "Original projection"
          : "Remounted projection",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit Income", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Delete transaction", exact: true }),
    ).toBeEnabled();
    expect(detailReads).toBe(2);
    const abortedRead =
      scenario.detail === "pending"
        ? page.waitForEvent("requestfailed", {
            predicate: (request) =>
              request.method() === "GET" &&
              request.url().endsWith(transaction.id),
          })
        : undefined;
    const deletionConfirmed = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.status() === scenario.status,
    );
    releaseDelete();
    await deletionConfirmed;
    const unavailable = page.getByRole("heading", {
      name: "Transaction unavailable",
    });
    const completion =
      scenario.status === 204
        ? "Transaction deleted."
        : "Transaction unavailable. It was already removed.";
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toBeFocused();
    await expect(unavailable).toHaveAccessibleDescription(completion);
    await expect(page.getByRole("status")).toHaveText(completion);
    if (abortedRead) {
      expect((await abortedRead).failure()?.errorText).toContain("ERR_ABORTED");
      releaseDetail();
    }
    await expect(
      page.getByRole("button", { name: "Edit Income", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Delete transaction", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(
      page.getByText(/Original projection|Remounted projection/),
    ).toHaveCount(0);
    await expect(page).toHaveURL(detailUrl);
    for (let navigation = 0; navigation < 2; navigation += 1) {
      await page.goBack();
      await expect(
        page.getByRole("heading", { name: "No transactions yet" }),
      ).toBeVisible();
      await page.goForward();
      await expect(unavailable).toBeFocused();
      await expect(page).toHaveURL(detailUrl);
      await expect(
        page.getByRole("button", { name: "Delete transaction", exact: true }),
      ).toHaveCount(0);
    }
    expect(detailReads).toBe(2);
    expect(deletes).toBe(1);
    await expectNoAccessibilityViolations(page, unavailable, testInfo);
    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual(
      scenario.status === 404
        ? [expect.stringMatching(/Failed to load resource:.*404/)]
        : [],
    );
  });
}

test("restores Overview dialog invokers and announces detail deletion on return", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  const transaction = financeTransactionPages[0]!.items[0]!;
  let deleted = false;
  let detailReads = 0;
  await page.setViewportSize({ height: 900, width: 1024 });
  await mockOverviewDetails(page);
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route("**/api/finance/ledgers/*/transactions?*", async (route) => {
    await route.fulfill({
      json: { items: deleted ? [] : [transaction], nextCursor: null },
    });
  });
  await page.route(
    "**/api/finance/ledgers/*/overview?month=*",
    async (route) => {
      const month = new URL(route.request().url()).searchParams.get("month")!;
      const total = { amount: deleted ? "0.00" : "8500.00", currency: "CNY" };
      const summary = {
        currency: "CNY",
        expense: { amount: "0.00", currency: "CNY" },
        income: total,
        net: total,
      };
      await route.fulfill({
        json: FinanceOverviewResponse.parse({
          ...financeOverviewForMonth(month),
          days: deleted
            ? []
            : [
                {
                  activityByCurrency: [{ ...summary, transactionCount: 1 }],
                  date: transaction.transactionDate,
                  transactionCount: 1,
                  transactionCountByKind: {
                    balanceAdjustment: 0,
                    expense: 0,
                    income: 1,
                    internalTransfer: 0,
                  },
                },
              ],
          monthSummaryByCurrency: [summary],
        }),
      });
    },
  );
  await page.route(
    "**/api/finance/ledgers/*/accounts/*/balance-adjustment-context**",
    async (route) => {
      await route.fulfill({
        json: BalanceAdjustmentContextResponse.parse({
          account: {
            id: financeAccounts[0]!.id,
            name: financeAccounts[0]!.name,
            status: "active",
          },
          accountNature: "asset",
          derivedComparisonBalance: financeAccounts[0]!.currentBalance,
          transactionDate: new URL(route.request().url()).searchParams.get(
            "transactionDate",
          ),
        }),
      });
    },
  );
  await page.route(
    `**/api/finance/ledgers/*/transactions/${transaction.id}`,
    async (route) => {
      if (route.request().method() === "DELETE") {
        deleted = true;
        await route.fulfill({ status: 204 });
      } else {
        detailReads += 1;
        await route.fulfill({ json: transaction });
      }
    },
  );
  await page.goto(
    `/finance/overview?ledger=${financeLedgers[0]!.id}&month=2026-08&date=2026-08-16`,
  );
  const invoker = page.getByRole("button", {
    name: "Other transaction actions",
    exact: true,
  });
  await expect(invoker).toBeEnabled();
  for (const [kind, dialogName] of [
    ["Internal Transfer", "Record internal transfer"],
    ["Balance Adjustment", "Record balance adjustment"],
  ] as const) {
    await invoker.press("Enter");
    await page.getByRole("menuitem", { name: kind, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: dialogName, exact: true });
    await expect(dialog.getByLabel("Transaction date")).toHaveValue(
      "2026-08-16",
    );
    if (kind === "Internal Transfer")
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    else await dialog.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(invoker).toBeFocused();
  }
  await page
    .getByRole("region", { name: "Selected-day activity" })
    .getByRole("button", {
      name: `View details for Income, Transaction ID ${transaction.id}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Delete transaction", exact: true })
    .click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Delete transaction?",
  });
  await confirmation
    .getByRole("button", { name: "Delete transaction", exact: true })
    .click();
  await expect(page).toHaveURL(
    `/finance/overview?ledger=${financeLedgers[0]!.id}&month=2026-08&date=2026-08-16`,
  );
  await expect(
    page.getByRole("status", { name: "Transaction completion" }),
  ).toHaveText("Transaction deleted.");
  const heading = page.getByRole("heading", { name: "Overview", level: 1 });
  await expect(heading).toBeFocused();
  await expect(heading).toHaveAccessibleDescription("Transaction deleted.");
  await expect(
    page.getByRole("region", { name: "Selected-day activity" }),
  ).toContainText("No transactions for this date");
  expect(detailReads).toBe(1);
  await expectNoAccessibilityViolations(page, heading, testInfo);
  expectNoBrowserErrors(errors);
});

test("contains a maximum-length Ledger name across Finance destinations and supported widths", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  const ledger = LedgerResponse.parse({
    ...financeLedgers[0]!,
    name: "W".repeat(100),
  });
  await mockOverviewDetails(page);
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: [ledger] });
  });
  await page.route(
    "**/api/finance/ledgers/*/overview?month=*",
    async (route) => {
      const month = new URL(route.request().url()).searchParams.get("month")!;
      await route.fulfill({
        json: { ...financeOverviewForMonth(month), ledger },
      });
    },
  );
  await page.setViewportSize({ height: 900, width: 1024 });
  await page.goto(
    `/finance/overview?ledger=${ledger.id}&month=2026-08&date=2026-08-16`,
  );
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ height: 900, width });
    for (const destination of [
      "Overview",
      "Transactions",
      "Accounts",
      "Categories",
    ]) {
      await page
        .getByRole("navigation", { name: "Finance navigation" })
        .getByRole("link", { name: destination, exact: true })
        .click();
      const surface = page.getByRole("region", {
        name: destination,
        exact: true,
      });
      if (destination === "Overview")
        await expect(
          page.getByRole("region", { name: "Account summary" }),
        ).toBeVisible();
      else if (destination === "Transactions")
        await expect(
          page.getByRole("heading", { name: "No transactions yet" }),
        ).toBeVisible();
      else
        await expect(
          surface.getByText(`${destination} in ${ledger.name}`, {
            exact: true,
          }),
        ).toBeVisible();
      expect(
        await page.evaluate<boolean>(
          "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
        ),
      ).toBe(true);
      const invoker = surface.getByRole("button", {
        name: ledger.name,
        exact: true,
      });
      expect(
        await invoker.evaluate((element, viewportWidth) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.left >= 0 &&
            bounds.right <= viewportWidth &&
            element.scrollWidth <= element.clientWidth
          );
        }, width),
      ).toBe(true);
      await invoker.click();
      const menu = page.getByRole("menu");
      const ledgerChoice = menu.getByRole("menuitem", {
        name: ledger.name,
        exact: true,
      });
      await expect(ledgerChoice).toBeVisible();
      expect(
        await ledgerChoice.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await menu
        .getByRole("menuitem", {
          name: `Rename ${ledger.name} Ledger`,
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog", { name: "Rename Ledger" });
      await expect(
        dialog.getByRole("textbox", { name: "Ledger name" }),
      ).toHaveValue(ledger.name);
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).not.toBeVisible();
      if (width === 1024)
        await expectNoAccessibilityViolations(page, surface, testInfo);
    }
  }
  expectNoBrowserErrors(errors);
});

test("preserves Calendar focus and Quick Entry draft during an Overview refresh", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ height: 900, width: 1024 });
  await mockOverviewDetails(page);
  let overviewReads = 0;
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route("**/api/finance/ledgers", async (route) => {
    await route.fulfill({ json: financeLedgers });
  });
  await page.route(
    "**/api/finance/ledgers/*/overview?month=*",
    async (route) => {
      overviewReads += 1;
      if (overviewReads > 1) await refreshGate;
      await route.fulfill({ json: financeOverviewForMonth("2026-08") });
    },
  );
  const initialUrl = `/finance/overview?ledger=${financeLedgers[0]!.id}&month=2026-08&date=2026-08-16`;
  await page.goto(initialUrl);
  const overview = page.getByRole("region", { exact: true, name: "Overview" });
  const calendar = overview.getByRole("grid", {
    name: "2026-08 Finance calendar",
  });
  const amount = overview
    .getByRole("form", { name: "Quick Entry" })
    .getByRole("textbox", { name: "Amount" });
  await amount.fill("99.25");
  const selected = calendar.getByRole("button", {
    name: /2026-08-16.*Selected/,
  });
  await selected.focus();
  await selected.press("ArrowRight");
  const nextDay = calendar.getByRole("button", { name: /2026-08-17/ });
  await expect(nextDay).toBeFocused();
  await expect(page).toHaveURL(initialUrl);
  await page.evaluate("window.dispatchEvent(new Event('visibilitychange'))");
  await expect.poll(() => overviewReads).toBe(2);
  await expect(
    overview.getByRole("status", { name: "" }).filter({
      hasText: "Refreshing Finance Overview",
    }),
  ).toBeVisible();
  await expect(calendar).toBeVisible();
  await expect(nextDay).toBeFocused();
  await expect(amount).toHaveValue("99.25");
  await expect(page).toHaveURL(initialUrl);
  await expectNoAccessibilityViolations(page, overview, testInfo);
  releaseRefresh();
  await expect(
    overview.getByText("Refreshing Finance Overview…"),
  ).not.toBeVisible();
  await expect(nextDay).toBeFocused();
  await nextDay.press("Enter");
  await expect(page).toHaveURL(/date=2026-08-17$/);
  await page.goBack();
  await expect(page).toHaveURL(initialUrl);
  await page.reload();
  await expect(
    calendar.getByRole("button", { name: /2026-08-16.*Selected/ }),
  ).toBeVisible();
  expectNoBrowserErrors(errors);
});

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
