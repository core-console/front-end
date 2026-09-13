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
  CurrencyResponse,
  LedgerResponse,
  MeResponse,
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
]);

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
