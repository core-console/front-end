import { expect, test, type Page } from "@playwright/test";

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

test("opens the home page", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Application foundation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  expectNoBrowserErrors(errors);
});

test("renders the frontend 404 page for an unknown route", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/missing-page");

  await expect(page).toHaveURL(/\/missing-page$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Return home" })).toBeVisible();
  expectNoBrowserErrors(errors);
});
