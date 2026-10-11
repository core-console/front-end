/// <reference lib="dom" />
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  adjustmentTestContext,
  adjustmentTestResource,
} from "../src/test/adjustment-submission-fixtures.ts";
import { submissionTestUser } from "../src/test/submission-fixtures.ts";
import {
  transactionTestAccounts as accounts,
  transactionTestCategories as categories,
  transactionTestDate as date,
  transactionTestLedger as ledger,
  transactionTestResource,
} from "../src/test/transaction-submission-fixtures.ts";
import { barrier, stored } from "./support/submission-journal.ts";

async function installApi(
  context: BrowserContext,
  page: Page,
  editKind:
    "income" | "expense" | "internalTransfer" | "balanceAdjustment" = "expense",
) {
  const editResource =
    editKind === "balanceAdjustment"
      ? adjustmentTestResource
      : transactionTestResource(editKind);
  const requests: string[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failures: string[] = [];
  const failed = new Set<string>();
  let hold: ReturnType<typeof barrier> | undefined;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname}${url.search}`);
    const dependency = url.pathname.split("/").at(-1)!;
    if (failed.has(dependency)) {
      failures.push(url.pathname);
      return route.fulfill({
        status: 503,
        json: { detail: "private database address" },
      });
    }
    if (hold && ["currencies", "accounts", "categories"].includes(dependency))
      await hold.promise;
    if (url.pathname === "/api/me")
      return route.fulfill({ json: submissionTestUser });
    if (url.pathname === "/api/finance/ledgers")
      return route.fulfill({ json: [ledger] });
    if (dependency === "currencies")
      return route.fulfill({
        json: [
          { code: "USD", minorUnit: 2 },
          { code: "JPY", minorUnit: 0 },
        ],
      });
    if (dependency === "accounts") return route.fulfill({ json: accounts });
    if (dependency === "categories") return route.fulfill({ json: categories });
    if (dependency === "balance-adjustment-context")
      return route.fulfill({
        json: {
          ...adjustmentTestContext,
          transactionDate: url.searchParams.get("transactionDate"),
        },
      });
    if (dependency === "transactions") {
      if (request.method() === "POST")
        return route.fulfill({ status: 201, json: {} });
      return route.fulfill({
        json: url.searchParams.has("cursor")
          ? {
              items: [
                {
                  ...transactionTestResource("income"),
                  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
                },
              ],
              nextCursor: null,
            }
          : {
              items: [transactionTestResource("expense")],
              nextCursor: "retained.cursor",
            },
      });
    }
    if (url.pathname.includes("/submissions/"))
      return route.fulfill({
        json: {
          state: "unfinished",
          submissionId: dependency,
          commandVersion: "1",
          operation: "createFinanceTransaction",
          targetLedgerId: ledger.id,
          admittedAt: "2026-10-05T00:00:00Z",
        },
      });
    if (url.pathname.endsWith(`/transactions/${editResource.id}`))
      return route.fulfill({ json: editResource });
    throw new Error(
      `Unexpected API request: ${request.method()} ${url.pathname}`,
    );
  });
  return {
    requests,
    failed,
    hold() {
      hold = barrier();
    },
    release() {
      hold?.release();
      hold = undefined;
    },
    assertErrors() {
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual(
        failures.map(() =>
          expect.stringMatching(/^Failed to load resource:.*503/),
        ),
      );
    },
  };
}

for (const [kind, title, dependency, label] of [
  ["income", "Income", "categories", "Category"],
  ["expense", "Expense", "currencies", "币种"],
  ["internalTransfer", "Internal Transfer", "accounts", "Account"],
  ["balanceAdjustment", "Balance Adjustment", "currencies", "币种"],
  ["balanceAdjustment", "Balance Adjustment", "accounts", "Account"],
] as const) {
  test(`${kind} edit: recovers only failed ${dependency} and preserves the draft`, async ({
    page,
    context,
  }) => {
    const api = await installApi(context, page, kind);
    await page.goto(
      `/finance/transactions/${transactionTestResource("expense").id}?ledger=${ledger.id}`,
    );
    await page
      .getByRole("button", { name: `Edit ${title}`, exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: `Edit ${title}` });
    const amount = dialog.getByLabel(
      kind === "balanceAdjustment" ? "Target balance" : "Amount",
      { exact: true },
    );
    await amount.fill("42.25");
    await dialog.getByLabel("Note", { exact: true }).fill("Keep edited draft");
    api.failed.add(dependency);
    await page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange")),
    );
    const retry = dialog.getByRole("button", { name: `重试加载${label}` });
    await expect(retry).toBeEnabled({ timeout: 15_000 });
    const save = dialog.getByRole("button", {
      name: kind === "balanceAdjustment" ? "Save adjustment" : "Save changes",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await expect(dialog.getByLabel("Note", { exact: true })).toBeFocused();
    await accessible(page);
    const before = [...api.requests];
    api.failed.clear();
    api.hold();
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByText(`正在重试加载${label}…`)).toBeVisible();
    await page.keyboard.press("Enter");
    api.release();
    await expect(dialog.getByText(`${label}数据已恢复。`)).toBeVisible();
    await expect(retry).toBeFocused();
    await expect(amount).toHaveValue("42.25");
    await expect(dialog.getByLabel("Note", { exact: true })).toHaveValue(
      "Keep edited draft",
    );
    await expect(save).toBeEnabled();
    expect(api.requests.slice(before.length)).toEqual([
      expect.stringMatching(new RegExp(`^GET .*/${dependency}$`)),
    ]);
    expect(
      api.requests.filter((request) => /^(POST|PUT|DELETE) /.test(request)),
    ).toEqual([]);
    await accessible(page);
    api.assertErrors();
  });
}

async function accessible(page: Page) {
  await page.locator("body").evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

for (const [dependency, label] of [
  ["currencies", "币种"],
  ["accounts", "Account"],
  ["categories", "Category"],
] as const) {
  test(`${dependency}: keyboard retry preserves work and distinguishes later background loading`, async ({
    page,
    context,
  }) => {
    const api = await installApi(context, page);
    api.failed.add(dependency);
    const entry = `/finance/transactions?ledger=${ledger.id}&from=2026-10-01&to=2026-10-31&account_id=${accounts[0].id}&category_id=${categories[0].id}`;
    await page.goto(entry);
    await expect(page.getByText(`正在加载${label}…`)).toBeVisible();
    const retry = page.getByRole("button", { name: `重试加载${label}` });
    await expect(retry).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByRole("alert")).not.toContainText(
      "private database address",
    );
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByRole("article")).toHaveCount(2);
    await page.getByLabel("From date").fill("2026-10-03");
    await accessible(page);
    const before = [...api.requests];
    api.failed.clear();
    api.hold();
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(`正在重试加载${label}…`)).toBeVisible();
    await expect(retry).toBeDisabled();
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    await accessible(page);
    api.release();
    await expect(page.getByText(`${label}数据已恢复。`)).toBeVisible();
    await expect(retry).toBeFocused();
    await expect(page.getByLabel("From date")).toHaveValue("2026-10-03");
    await expect(
      page
        .getByRole("form", { name: "Transaction filters" })
        .getByLabel("Account", { exact: true }),
    ).toHaveValue(accounts[0].id);
    await expect(
      page
        .getByRole("form", { name: "Transaction filters" })
        .getByLabel("Category", { exact: true }),
    ).toHaveValue(`category:${categories[0].id}`);
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(page).toHaveURL(entry);
    await expect(
      page.getByRole("button", { name: "Personal", exact: true }),
    ).toBeVisible();
    expect(api.requests.slice(before.length)).toEqual([
      expect.stringMatching(new RegExp(`^GET .*/${dependency}$`)),
    ]);
    await accessible(page);
    if (dependency === "accounts")
      await page.screenshot({
        path: "test-results/transactions-dependency-recovered.png",
        fullPage: true,
      });
    api.hold();
    await page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(
      page.getByRole("status").filter({ hasText: `正在加载${label}…` }),
    ).toBeVisible();
    await expect(page.getByText(`正在重试加载${label}…`)).toHaveCount(0);
    await expect(retry).toBeFocused();
    await expect(retry).toBeDisabled();
    await accessible(page);
    api.release();
    await expect(page.getByText(`${label}数据已恢复。`)).toBeVisible();
    await expect(retry).toBeFocused();
    await expect(page.getByLabel("From date")).toHaveValue("2026-10-03");
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(page).toHaveURL(entry);
    expect(
      api.requests.filter((request) => /^(POST|PUT|DELETE) /.test(request)),
    ).toEqual([]);
    await accessible(page);
    api.assertErrors();
  });
}

for (const [kind, title, amountLabel] of [
  ["Expense", "Record expense", "Amount"],
  ["Income", "Record income", "Amount"],
  ["Internal Transfer", "Record internal transfer", "Amount"],
  ["Balance Adjustment", "Record balance adjustment", "Target balance"],
] as const) {
  test(`${kind}: dependency recovery retains the open form and its work`, async ({
    page,
    context,
  }) => {
    const api = await installApi(context, page);
    await page.goto(`/finance/transactions?ledger=${ledger.id}`);
    await page.getByRole("button", { name: "Record transaction" }).click();
    await page.getByRole("menuitem", { name: kind, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: title });
    await dialog.getByLabel(amountLabel, { exact: true }).fill("42.25");
    await dialog.getByLabel("Transaction date").fill(date);
    await dialog.getByLabel("Note", { exact: true }).fill("Keep this draft");
    if (kind === "Expense") {
      await dialog
        .getByRole("button", { name: "Record expense", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText(
        "outcome is unknown",
      );
    }
    const retained = await stored(page);
    await dialog.getByLabel("Note", { exact: true }).fill("Keep edited draft");
    api.failed.add("accounts");
    await page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange")),
    );
    const retry = dialog.getByRole("button", { name: "重试加载Account" });
    await expect(retry).toBeEnabled({ timeout: 15_000 });
    await expect(dialog.getByLabel("Note", { exact: true })).toBeFocused();
    await accessible(page);
    const before = [...api.requests];
    api.failed.clear();
    api.hold();
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByText("正在重试加载Account…")).toBeVisible();
    await dialog.getByLabel("Note", { exact: true }).focus();
    api.release();
    await expect(dialog.getByText("Account数据已恢复。")).toBeVisible();
    await expect(dialog.getByLabel("Note", { exact: true })).toBeFocused();
    await expect(dialog.getByLabel("Note", { exact: true })).toHaveValue(
      "Keep edited draft",
    );
    await expect(dialog.getByLabel(amountLabel, { exact: true })).toHaveValue(
      "42.25",
    );
    await expect(dialog.getByLabel("Transaction date")).toHaveValue(date);
    expect(api.requests.slice(before.length)).toEqual([
      `GET /api/finance/ledgers/${ledger.id}/accounts`,
    ]);
    expect(await stored(page)).toEqual(retained);
    if (kind === "Expense") {
      expect(retained).toHaveLength(1);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Retry original submission" }),
      ).toBeEnabled();
      expect(
        api.requests.filter((request) => request.startsWith("POST ")),
      ).toHaveLength(1);
    } else
      expect(
        api.requests.filter((request) => request.startsWith("POST ")),
      ).toEqual([]);
    await accessible(page);
    api.assertErrors();
  });
}
