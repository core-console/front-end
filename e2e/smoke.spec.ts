import { AxeBuilder } from "@axe-core/playwright";
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
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
