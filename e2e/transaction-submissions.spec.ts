/// <reference lib="dom" />
import { AxeBuilder } from "@axe-core/playwright";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  createdTransactionReceipt,
  submissionTestUser,
} from "../src/test/submission-fixtures.ts";
import {
  transactionTestLedger as ledger,
  transactionTestOtherLedger as otherLedger,
  transactionTestAccounts as accounts,
  transactionTestCategories as categories,
  transactionTestDate as date,
  transactionTestMoney as money,
  transactionTestId as id,
  transactionTestBody,
  transactionTestResource,
  transactionTestOverview,
} from "../src/test/transaction-submission-fixtures.ts";

const entries = [
  { kind: "expense", origin: "quick" },
  { kind: "income", origin: "quick" },
  { kind: "expense", origin: "transactions" },
  { kind: "income", origin: "transactions" },
  { kind: "internalTransfer", origin: "transactions" },
  { kind: "internalTransfer", origin: "overview" },
] as const;
type Entry = (typeof entries)[number];
function errorsFor(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}
async function installApi(context: BrowserContext, entry: Entry) {
  const posts: {
    key: string;
    owner: string;
    version: string;
    path: string;
    body: unknown;
  }[] = [];
  let replay = false;
  let terminalLookup = false;
  let unavailable = false;
  let lookups = 0;
  let hold: Promise<void> | null = null;
  let release: (() => void) | undefined;
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/me")
      return route.fulfill({ json: submissionTestUser });
    if (url.pathname === "/api/finance/ledgers")
      return route.fulfill({ json: [ledger, otherLedger] });
    if (url.pathname.endsWith("/currencies"))
      return route.fulfill({
        json: [
          { code: "USD", minorUnit: 2 },
          { code: "JPY", minorUnit: 0 },
        ],
      });
    if (url.pathname.endsWith("/accounts"))
      return route.fulfill({ json: accounts });
    if (url.pathname.endsWith("/categories"))
      return route.fulfill({ json: categories });
    if (url.pathname.endsWith("/overview"))
      return route.fulfill({
        json: {
          ...transactionTestOverview,
          month: url.searchParams.get("month"),
        },
      });
    if (url.pathname.includes("/submissions/")) {
      lookups += 1;
      expect(request.headers()["finance-submission-owner"]).toBe(
        submissionTestUser.id,
      );
      const key = url.pathname.split("/").at(-1)!;
      return route.fulfill({
        headers: { "Cache-Control": "no-store" },
        json: terminalLookup
          ? {
              state: "terminal",
              receipt: createdTransactionReceipt(key, ledger.id, id),
            }
          : {
              state: "unfinished",
              submissionId: key,
              commandVersion: "1",
              operation: "createFinanceTransaction",
              targetLedgerId: ledger.id,
              admittedAt: "2026-10-05T00:00:00Z",
            },
      });
    }
    if (url.pathname.endsWith("/transactions")) {
      if (request.method() === "POST") {
        posts.push({
          key: request.headers()["idempotency-key"]!,
          owner: request.headers()["finance-submission-owner"]!,
          version: request.headers()["finance-command-version"]!,
          path: url.pathname,
          body: request.postDataJSON(),
        });
        if (!replay) return route.fulfill({ json: {}, status: 201 });
        if (hold) await hold;
        terminalLookup = true;
        return route.fulfill({
          json: createdTransactionReceipt(posts.at(-1)!.key, ledger.id, id),
          status: 201,
        });
      }
      return route.fulfill({ json: { items: [], nextCursor: null } });
    }
    if (url.pathname.endsWith(`/transactions/${id}`))
      return route.fulfill({
        json: unavailable ? {} : transactionTestResource(entry.kind),
      });
    throw new Error(
      `Unexpected API request: ${request.method()} ${url.pathname}`,
    );
  });
  return {
    posts,
    get lookups() {
      return lookups;
    },
    allowRetry() {
      replay = true;
    },
    failResource() {
      unavailable = true;
    },
    completeLookup() {
      terminalLookup = true;
    },
    holdReplay() {
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseReplay() {
      release?.();
      hold = null;
    },
  };
}
async function create(page: Page, entry: Entry, expectUnknown = true) {
  await page.goto(
    entry.origin === "transactions"
      ? `/finance/transactions?ledger=${ledger.id}`
      : `/finance/overview?ledger=${ledger.id}&month=2026-10&date=${date}`,
  );
  if (entry.origin !== "quick") {
    await page
      .getByRole("button", {
        name:
          entry.origin === "transactions"
            ? "Record transaction"
            : "Other transaction actions",
      })
      .first()
      .click();
    await page
      .getByRole("menuitem", {
        name:
          entry.kind === "internalTransfer"
            ? "Internal Transfer"
            : entry.kind === "income"
              ? "Income"
              : "Expense",
      })
      .click();
  }
  const form =
    entry.origin === "quick"
      ? page.getByRole("form", { name: "Quick Entry" })
      : page.getByRole("dialog");
  if (entry.origin === "quick" && entry.kind === "income")
    await form.getByRole("button", { name: /^Income$/ }).click();
  await form.getByLabel("Amount", { exact: true }).fill(money.amount);
  if (entry.kind === "internalTransfer")
    await form.getByLabel("Destination Account").selectOption(accounts[1].id);
  else
    await form
      .getByLabel("Category", { exact: true })
      .selectOption(categories[1].id);
  if (entry.origin !== "quick")
    await form.getByLabel("Transaction date").fill(date);
  await form.getByLabel("Note", { exact: true }).fill("Immutable note");
  await form
    .getByRole("button", {
      name:
        entry.kind === "internalTransfer"
          ? "Record transfer"
          : `Record ${entry.kind}`,
    })
    .click();
  if (expectUnknown)
    await expect(form.getByRole("alert")).toContainText("outcome is unknown");
  return form;
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("core-console.finance.submissions", 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const records = await new Promise<
      { state: string; body: unknown; submissionId: string }[]
    >((resolve, reject) => {
      const tx = db.transaction("submissions", "readonly");
      const get = tx.objectStore("submissions").getAll();
      tx.oncomplete = () => resolve(get.result);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return records;
  });
}
for (const entry of entries) {
  test(`${entry.origin} ${entry.kind}: reload retains identity and only explicit retry creates a request`, async ({
    page,
    context,
  }) => {
    const errors = errorsFor(page);
    const api = await installApi(context, entry);
    const form = await create(page, entry);
    expect(api.posts[0]).toMatchObject({
      body: transactionTestBody(entry.kind),
      owner: submissionTestUser.id,
      version: "1",
    });
    await form.getByLabel("Note", { exact: true }).fill("New transient note");
    if (entry.origin !== "quick")
      await form.getByRole("button", { name: "Cancel" }).click();
    const violations = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(violations.violations).toEqual([]);
    if (entry.origin === "quick" && entry.kind === "expense")
      await page.screenshot({
        path: "test-results/t07-recovery.png",
        fullPage: true,
      });
    await page.reload();
    await expect.poll(() => api.lookups).toBeGreaterThan(0);
    expect(api.posts).toHaveLength(1);
    expect((await stored(page))[0]!.body).toEqual(
      transactionTestBody(entry.kind),
    );
    api.allowRetry();
    await page
      .getByRole("button", { name: "Retry original submission" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("status", { name: /^Transaction created:/ }),
    ).toBeVisible();
    expect(api.posts).toHaveLength(2);
    expect(api.posts[1]).toEqual(api.posts[0]);
    await page.getByRole("button", { name: "Acknowledge outcome" }).click();
    await expect.poll(() => stored(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("a receipt stays resolved through resource refresh failure and simultaneous tab acknowledgement", async ({
  page,
  context,
}) => {
  const entry = entries[0]!;
  const errors = errorsFor(page);
  const api = await installApi(context, entry);
  await create(page, entry);
  api.allowRetry();
  api.failResource();
  await page.getByRole("button", { name: "Retry original submission" }).click();
  await expect(
    page.getByRole("status", { name: /^Transaction created:/ }),
  ).toContainText("could not refresh");
  expect((await stored(page))[0]?.state).toBe("resolved");
  const sibling = await context.newPage();
  const siblingErrors = errorsFor(sibling);
  await sibling.goto(`/finance/accounts?ledger=${otherLedger.id}`);
  await expect(
    sibling.getByRole("button", { name: "Acknowledge outcome" }),
  ).toBeVisible();
  await Promise.all([
    sibling.getByRole("button", { name: "Acknowledge outcome" }).click(),
    page.getByRole("button", { name: "Acknowledge outcome" }).click(),
  ]);
  await expect.poll(() => stored(page)).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry original submission" }),
  ).toHaveCount(0);
  expect(api.posts).toHaveLength(2);
  expect(errors).toEqual([]);
  expect(siblingErrors).toEqual([]);
});

for (const entry of [entries[0]!, entries[3]!, entries[5]!]) {
  test(`${entry.kind}: persistent Chromium profile restart retains the immutable command`, async () => {
    const profile = await mkdtemp(
      join(tmpdir(), "core-console-transactions-t07-"),
    );
    if (
      resolve(dirname(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("core-console-transactions-t07-")
    )
      throw new Error("Unexpected test profile cleanup path.");
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        baseURL: "http://127.0.0.1:4173",
      });
      const api = await installApi(context, entry);
      const page = context.pages()[0]!;
      const errors = errorsFor(page);
      await create(page, entry);
      const original = api.posts[0];
      expect(errors).toEqual([]);
      await context.close();
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        baseURL: "http://127.0.0.1:4173",
      });
      const restarted = await installApi(context, entry);
      const next = context.pages()[0]!;
      const nextErrors = errorsFor(next);
      await next.goto(`/finance/accounts?ledger=${otherLedger.id}`);
      await expect.poll(() => restarted.lookups).toBeGreaterThan(0);
      expect(restarted.posts).toEqual([]);
      restarted.allowRetry();
      await next
        .getByRole("button", { name: "Retry original submission" })
        .click();
      await expect(
        next.getByRole("status", { name: /^Transaction created:/ }),
      ).toBeVisible();
      expect(restarted.posts[0]).toEqual(original);
      expect(nextErrors).toEqual([]);
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}

test("acknowledgement in another tab cannot be undone by a delayed retry response", async ({
  page,
  context,
}) => {
  const entry = entries[0]!;
  const errors = errorsFor(page);
  const api = await installApi(context, entry);
  await create(page, entry);
  const sibling = await context.newPage();
  const siblingErrors = errorsFor(sibling);
  await sibling.goto(`/finance/accounts?ledger=${ledger.id}`);
  await expect(
    sibling.getByRole("button", { name: "Check outcome" }),
  ).toBeEnabled();
  api.allowRetry();
  api.holdReplay();
  await page.getByRole("button", { name: "Retry original submission" }).click();
  await expect.poll(() => api.posts.length).toBe(2);
  api.completeLookup();
  await sibling.getByRole("button", { name: "Check outcome" }).click();
  await sibling.getByRole("button", { name: "Acknowledge outcome" }).click();
  await expect.poll(() => stored(sibling)).toEqual([]);
  api.releaseReplay();
  await expect(
    page.getByRole("status", { name: /^Transaction created:/ }),
  ).toHaveCount(0);
  await page.reload();
  await expect.poll(() => stored(page)).toEqual([]);
  expect(api.posts).toHaveLength(2);
  expect(errors).toEqual([]);
  expect(siblingErrors).toEqual([]);
});

test("IndexedDB preparation abort prevents the initial Transaction POST", async ({
  page,
  context,
}) => {
  const errors = errorsFor(page);
  const api = await installApi(context, entries[0]!);
  await context.addInitScript(() => {
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      const request = originalAdd.apply(this, args);
      this.transaction.abort();
      return request;
    };
  });
  // Fill through the same keyboard-first flow; its expected result is storage failure.
  await page.goto(
    `/finance/overview?ledger=${ledger.id}&month=2026-10&date=${date}`,
  );
  const form = page.getByRole("form", { name: "Quick Entry" });
  await form.getByLabel("Amount", { exact: true }).fill("12.34");
  await form.getByRole("button", { name: "Record expense" }).click();
  await expect(form.getByRole("alert")).toContainText("storage write failed");
  expect(api.posts).toEqual([]);
  expect(await stored(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a late original create response cannot reset or focus a new workflow after navigation", async ({
  page,
  context,
}) => {
  const errors = errorsFor(page);
  const api = await installApi(context, entries[0]!);
  api.allowRetry();
  api.holdReplay();
  await create(page, entries[0]!, false);
  await expect.poll(() => api.posts.length).toBe(1);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  const next = page.getByRole("form", { name: "Quick Entry" });
  await next.getByLabel("Amount", { exact: true }).fill("77.77");
  const note = next.getByLabel("Note", { exact: true });
  await note.fill("New workflow draft");
  await note.focus();
  api.releaseReplay();
  await expect(
    page.getByRole("status", { name: /^Transaction created:/ }),
  ).toBeVisible();
  await expect
    .poll(async () => (await stored(page))[0]?.state)
    .toBe("resolved");
  await expect(next.getByLabel("Amount", { exact: true })).toHaveValue("77.77");
  await expect(note).toHaveValue("New workflow draft");
  await expect(note).toBeFocused();
  await expect(page).toHaveURL(/\/finance\/overview/);
  expect(api.posts).toHaveLength(1);
  expect(api.posts[0]!.body).toEqual(transactionTestBody("expense"));
  expect(errors).toEqual([]);
});
