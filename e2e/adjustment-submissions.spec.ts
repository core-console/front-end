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
  adjustmentReceipt,
  adjustmentTestBody,
  adjustmentTestContext,
  adjustmentTestResource,
} from "../src/test/adjustment-submission-fixtures.ts";
import { submissionTestUser } from "../src/test/submission-fixtures.ts";
import {
  transactionTestLedger as ledger,
  transactionTestOtherLedger as otherLedger,
  transactionTestAccounts as accounts,
  transactionTestDate as date,
  transactionTestOverview,
  transactionTestDay,
} from "../src/test/transaction-submission-fixtures.ts";

function errorsFor(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
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

async function installApi(
  context: BrowserContext,
  kind: "created" | "noChange",
) {
  const posts: {
    key: string;
    owner: string;
    version: string;
    path: string;
    body: unknown;
  }[] = [];
  let replay = false;
  let terminal = false;
  let changed = false;
  let detailReads = 0;
  let lookups = 0;
  let release: (() => void) | undefined;
  let hold: Promise<void> | undefined;
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
      return route.fulfill({ json: [] });
    if (url.pathname.endsWith("/overview"))
      return route.fulfill({
        json: {
          ...transactionTestOverview,
          month: url.searchParams.get("month"),
        },
      });
    if (url.pathname.endsWith("/overview/day"))
      return route.fulfill({
        json: { ...transactionTestDay, date: url.searchParams.get("date") },
      });
    if (url.pathname.endsWith("/balance-adjustment-context"))
      return route.fulfill({
        json: {
          ...adjustmentTestContext,
          transactionDate: url.searchParams.get("transactionDate"),
          ...(changed
            ? {
                accountNature: "liability",
                derivedComparisonBalance: { amount: "123.45", currency: "USD" },
              }
            : {}),
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
        json: terminal
          ? {
              state: "terminal",
              receipt: adjustmentReceipt(
                key,
                kind === "created"
                  ? {
                      kind,
                      resource: {
                        type: "transaction",
                        id: adjustmentTestResource.id,
                      },
                    }
                  : { kind },
              ),
            }
          : {
              state: "unfinished",
              operation: "createBalanceAdjustment",
              submissionId: key,
              commandVersion: "1",
              targetLedgerId: ledger.id,
              admittedAt: "2026-10-06T00:00:00Z",
            },
      });
    }
    if (url.pathname.endsWith("/balance-adjustments")) {
      expect(request.method()).toBe("POST");
      posts.push({
        key: request.headers()["idempotency-key"]!,
        owner: request.headers()["finance-submission-owner"]!,
        version: request.headers()["finance-command-version"]!,
        path: url.pathname,
        body: request.postDataJSON(),
      });
      if (!replay) return route.fulfill({ json: {} });
      if (hold) await hold;
      terminal = true;
      return route.fulfill({
        json: adjustmentReceipt(
          posts.at(-1)!.key,
          kind === "created"
            ? {
                kind,
                resource: {
                  type: "transaction",
                  id: adjustmentTestResource.id,
                },
              }
            : { kind },
        ),
      });
    }
    if (url.pathname.endsWith("/transactions"))
      return route.fulfill({ json: { items: [], nextCursor: null } });
    if (url.pathname.endsWith(`/transactions/${adjustmentTestResource.id}`)) {
      detailReads += 1;
      return route.fulfill({ json: adjustmentTestResource });
    }
    throw new Error(
      `Unexpected API request: ${request.method()} ${url.pathname}`,
    );
  });
  return {
    posts,
    get detailReads() {
      return detailReads;
    },
    get lookups() {
      return lookups;
    },
    allowRetry() {
      replay = true;
      changed = true;
    },
    completeLookup() {
      terminal = true;
      changed = true;
    },
    holdResponse() {
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseResponse() {
      release?.();
    },
  };
}
async function create(
  page: Page,
  origin: "transactions" | "overview",
  expectUnknown = true,
) {
  await page.goto(
    `/finance/${origin}?ledger=${ledger.id}&month=2026-10&date=${date}`,
  );
  await page
    .getByRole("button", {
      name:
        origin === "transactions"
          ? "Record transaction"
          : "Other transaction actions",
    })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Balance Adjustment" }).click();
  const form = page.getByRole("dialog", { name: "Record balance adjustment" });
  await form.getByLabel("Transaction date").fill(date);
  await form
    .getByLabel("Target balance")
    .fill(adjustmentTestBody.targetBalance.amount);
  await form.getByLabel("Note", { exact: true }).fill(adjustmentTestBody.note!);
  await form.getByRole("button", { name: "Record adjustment" }).click();
  if (expectUnknown)
    await expect(form.getByRole("alert").first()).toContainText(
      "outcome is unknown",
    );
  return form;
}

test("aborted IndexedDB preparation sends no initial Adjustment POST", async ({
  page,
  context,
}) => {
  const errors = errorsFor(page);
  const api = await installApi(context, "noChange");
  await context.addInitScript(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      const request = original.apply(this, args);
      this.transaction.abort();
      return request;
    };
  });
  const form = await create(page, "transactions", false);
  await expect(form.getByRole("alert")).toContainText("storage write failed");
  expect(api.posts).toEqual([]);
  expect(await stored(page)).toEqual([]);
  expect(errors).toEqual([]);
});

for (const origin of ["transactions", "overview"] as const) {
  for (const kind of ["created", "noChange"] as const) {
    test(`${origin}: reload and keyboard retry preserve exact adjustment inputs for ${kind}`, async ({
      page,
      context,
    }) => {
      const errors = errorsFor(page);
      const api = await installApi(context, kind);
      const form = await create(page, origin);
      expect(api.posts[0]).toMatchObject({
        body: adjustmentTestBody,
        owner: submissionTestUser.id,
        version: "1",
      });
      await form.getByLabel("Target balance").fill("12.34");
      await form.getByLabel("Note", { exact: true }).fill("New transient note");
      await expect(
        form.getByRole("button", { name: "Record adjustment" }),
      ).toBeDisabled();
      await form.getByRole("button", { name: "Cancel" }).click();
      await expect(form).not.toBeVisible();
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(axe.violations).toEqual([]);
      await page.reload();
      await expect.poll(() => api.lookups).toBeGreaterThan(0);
      expect(api.posts).toHaveLength(1);
      expect((await stored(page))[0]!.body).toEqual(adjustmentTestBody);
      api.allowRetry();
      await expect(
        page.getByRole("button", { name: "Retry original submission" }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "Retry original submission" })
        .focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("status", {
          name:
            kind === "created"
              ? /^Balance Adjustment created:/
              : /^Balance Adjustment requires no change:/,
        }),
      ).toBeVisible();
      await expect
        .poll(async () => (await stored(page))[0]?.state)
        .toBe("resolved");
      expect(api.posts[1]).toEqual(api.posts[0]);
      expect(api.detailReads).toBe(kind === "created" ? 1 : 0);
      if (origin === "transactions" && kind === "noChange")
        await page.screenshot({
          path: "test-results/t09-no-change-recovery.png",
          fullPage: true,
        });
      await page.getByRole("button", { name: "Acknowledge outcome" }).click();
      await expect.poll(() => stored(page)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test("noChange lookup remains success after later balances change, without executing or reading a Transaction", async ({
  page,
  context,
}) => {
  const errors = errorsFor(page);
  const api = await installApi(context, "noChange");
  await create(page, "overview");
  api.completeLookup();
  await page.reload();
  await expect(
    page.getByRole("status", {
      name: /^Balance Adjustment requires no change:/,
    }),
  ).toBeVisible();
  expect(api.posts).toHaveLength(1);
  expect(api.detailReads).toBe(0);
  expect((await stored(page))[0]!.body).toEqual(adjustmentTestBody);
  expect(errors).toEqual([]);
});

test("late adjustment completion cannot close or focus a newer workflow", async ({
  page,
  context,
}) => {
  const errors = errorsFor(page);
  const api = await installApi(context, "created");
  api.allowRetry();
  api.holdResponse();
  await page.goto(`/finance/categories?ledger=${ledger.id}`);
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Other transaction actions" }).click();
  await page.getByRole("menuitem", { name: "Balance Adjustment" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Target balance").fill("-0.00");
  await form.getByRole("button", { name: "Record adjustment" }).click();
  await expect.poll(() => api.posts.length).toBe(1);
  await page.goBack();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  const quick = page.getByRole("form", { name: "Quick Entry" });
  await quick.getByLabel("Amount", { exact: true }).fill("19.99");
  await quick.getByLabel("Amount", { exact: true }).focus();
  api.releaseResponse();
  await expect(
    page.getByRole("status", { name: /^Balance Adjustment created:/ }),
  ).toBeVisible();
  await expect(quick.getByLabel("Amount", { exact: true })).toHaveValue(
    "19.99",
  );
  await expect(quick.getByLabel("Amount", { exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

for (const kind of ["created", "noChange"] as const) {
  test(`persistent-profile restart recovers ${kind} through lookup only`, async () => {
    const profile = await mkdtemp(join(tmpdir(), "core-console-t09-"));
    if (
      resolve(dirname(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("core-console-t09-")
    )
      throw new Error("Unexpected test profile cleanup path.");
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        baseURL: "http://127.0.0.1:4173",
      });
      const api = await installApi(context, kind);
      const page = context.pages()[0]!;
      const errors = errorsFor(page);
      await create(page, "transactions");
      const original = (await stored(page))[0]!;
      await context.close();
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        baseURL: "http://127.0.0.1:4173",
      });
      const recovered = await installApi(context, kind);
      recovered.completeLookup();
      const restored = context.pages()[0]!;
      const restoredErrors = errorsFor(restored);
      await restored.goto(`/finance/categories?ledger=${otherLedger.id}`);
      await expect(
        restored.getByRole("button", { name: "Acknowledge outcome" }),
      ).toBeVisible();
      expect((await stored(restored))[0]).toMatchObject({
        submissionId: original.submissionId,
        body: original.body,
        state: "resolved",
      });
      expect(api.posts).toHaveLength(1);
      expect(recovered.posts).toHaveLength(0);
      expect(errors).toEqual([]);
      expect(restoredErrors).toEqual([]);
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
