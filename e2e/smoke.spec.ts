import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const accessibilityTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

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
  testInfo: TestInfo,
) => {
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

  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Home" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Core Console sidebar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page, testInfo);
  expectNoBrowserErrors(errors);
});

test("renders the frontend 404 page for an unknown route", async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/missing-page");

  await expect(page).toHaveURL(/\/missing-page$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Return home" })).toBeVisible();
  await expectNoAccessibilityViolations(page, testInfo);
  expectNoBrowserErrors(errors);
});
