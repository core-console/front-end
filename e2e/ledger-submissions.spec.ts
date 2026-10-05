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
  createdLedgerReceipt,
  submissionTestUser,
} from "../src/test/submission-fixtures.ts";

const existing = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Existing",
};
const created = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Household",
};
type RequestEvidence = {
  key: string;
  version: string;
  owner: string;
  body: unknown;
};

function captureErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function installApi(context: BrowserContext, additional: boolean) {
  const posts: RequestEvidence[] = [];
  let completed = false;
  let lookups = 0;
  let retryReady = false;
  let heldReplay: Promise<void> | null = null;
  let enteredReplay: (() => void) | null = null;
  let firstReplay: Promise<void> | null = null;
  let enteredFirstReplay: (() => void) | null = null;
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/me") {
      await route.fulfill({ json: submissionTestUser });
      return;
    }
    if (url.pathname === "/api/finance/ledgers") {
      if (request.method() === "POST") {
        posts.push({
          key: request.headers()["idempotency-key"]!,
          owner: request.headers()["finance-submission-owner"]!,
          version: request.headers()["finance-command-version"]!,
          body: request.postDataJSON(),
        });
        const attempt = posts.length;
        // A malformed body at HTTP 201 simulates loss of usable response evidence
        // without browser console errors. It does not claim a PostgreSQL commit.
        if (!retryReady)
          await route.fulfill({
            body: "{",
            contentType: "application/json",
            status: 201,
          });
        else {
          if (attempt === 2 && firstReplay) {
            enteredFirstReplay?.();
            await firstReplay;
          }
          if (attempt === 3 && heldReplay) {
            enteredReplay?.();
            await heldReplay;
          }
          completed = true;
          await route.fulfill({
            json: createdLedgerReceipt(posts[0]!.key, created.id),
            status: 201,
          });
        }
      } else
        await route.fulfill({
          json: [
            ...(additional ? [existing] : []),
            ...(completed ? [created] : []),
          ],
        });
      return;
    }
    if (url.pathname.startsWith("/api/finance/submissions/")) {
      lookups += 1;
      const submissionId = url.pathname.split("/").at(-1)!;
      expect(request.headers()["finance-submission-owner"]).toBe(
        submissionTestUser.id,
      );
      await route.fulfill({
        json: completed
          ? {
              state: "terminal",
              receipt: createdLedgerReceipt(submissionId, created.id),
            }
          : {
              state: "unfinished",
              submissionId,
              commandVersion: "1",
              operation: "createFinanceLedger",
              targetLedgerId: null,
              admittedAt: "2026-10-03T00:00:00Z",
            },
        headers: { "Cache-Control": "no-store" },
      });
      return;
    }
    if (url.pathname.endsWith("/overview")) {
      const id = url.pathname.split("/")[4];
      await route.fulfill({
        json: {
          accounts: [],
          days: [],
          financialPositionByCurrency: [],
          monthSummaryByCurrency: [],
          month: url.searchParams.get("month"),
          ledger: id === created.id ? created : existing,
        },
      });
      return;
    }
    if (url.pathname.endsWith("/transactions")) {
      await route.fulfill({ json: { items: [], nextCursor: null } });
      return;
    }
    if (url.pathname === "/api/finance/currencies") {
      await route.fulfill({ json: [{ code: "CNY", minorUnit: 2 }] });
      return;
    }
    if (
      url.pathname.endsWith("/accounts") ||
      url.pathname.endsWith("/categories")
    ) {
      await route.fulfill({ json: [] });
      return;
    }
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
      retryReady = true;
    },
    holdSecondRetry(pending: Promise<void>, entered: () => void) {
      heldReplay = pending;
      enteredReplay = entered;
    },
    holdFirstRetry(pending: Promise<void>, entered: () => void) {
      firstReplay = pending;
      enteredFirstReplay = entered;
    },
  };
}

async function beginCreate(page: Page, additional: boolean) {
  await page.goto("http://127.0.0.1:4173/finance/accounts");
  if (additional) {
    await page.getByRole("button", { name: "Existing", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Create Ledger", exact: true })
      .click();
  }
  const form = additional
    ? page.getByRole("dialog", { name: "Create Ledger" })
    : page;
  await form.getByRole("textbox", { name: "Ledger name" }).fill("Household");
  await form
    .getByRole("button", {
      name: additional ? "Create" : "Create Ledger",
      exact: true,
    })
    .click();
  if (additional) await form.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("status", { name: "Ledger outcome unknown: Household" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Finance submission recovery" }),
  ).toContainText("The Ledger outcome is unknown.");
}

for (const additional of [false, true]) {
  test(`durably recovers ${additional ? "additional" : "first"} Ledger after reload with keyboard retry and acknowledgement`, async ({
    page,
    context,
  }, testInfo) => {
    const errors = captureErrors(page);
    const api = await installApi(context, additional);
    await page.addInitScript(() => {
      const committedKeys = new Set<string>();
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (
          this.name === "submissions" &&
          value &&
          typeof value === "object" &&
          "submissionId" in value
        ) {
          const id = String(value.submissionId);
          this.transaction.addEventListener("complete", () =>
            committedKeys.add(id),
          );
        }
        return key === undefined
          ? add.call(this, value)
          : add.call(this, value, key);
      };
      const fetchOriginal = window.fetch;
      window.fetch = function (input, init) {
        if (
          init?.method === "POST" &&
          String(input).endsWith("/finance/ledgers")
        ) {
          const id = new Headers(init.headers).get("Idempotency-Key")!;
          (
            window as typeof window & { preparedBeforeDispatch: boolean }
          ).preparedBeforeDispatch = committedKeys.has(id);
        }
        return fetchOriginal.call(this, input, init);
      };
    });
    await beginCreate(page, additional);
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { preparedBeforeDispatch: boolean })
            .preparedBeforeDispatch,
      ),
    ).toBe(true);
    expect(api.posts).toHaveLength(1);
    await page.reload();
    const recovery = page.getByRole("region", {
      name: "Finance submission recovery",
    });
    await expect(recovery).toContainText(
      "The original submission is unfinished.",
    );
    expect(api.lookups).toBeGreaterThan(0);
    expect(api.posts).toHaveLength(1);
    await expect
      .poll(() =>
        page
          .getByRole("link", { name: "Finance", exact: true })
          .locator("span")
          .evaluate((element) => getComputedStyle(element).opacity),
      )
      .toBe("1");
    const violations = (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations;
    expect(violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("recovery-unknown.png"),
      fullPage: true,
    });
    api.allowRetry();
    const retry = recovery.getByRole("button", {
      name: "Retry original submission",
    });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(
      recovery.getByRole("status", { name: "Ledger created: Household" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("recovery-created.png"),
      fullPage: true,
    });
    expect(api.posts[1]).toEqual(api.posts[0]);
    await recovery.getByRole("link", { name: "Open Ledger" }).click();
    await expect(
      page.getByRole("button", { name: "Household", exact: true }),
    ).toBeVisible();
    const acknowledgement = recovery.getByRole("button", {
      name: "Acknowledge outcome",
    });
    await expect(acknowledgement).toBeEnabled();
    await acknowledgement.focus();
    await page.keyboard.press("Enter");
    await expect(
      recovery.getByRole("status", { name: "Ledger created: Household" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Household", exact: true }),
    ).toBeVisible();
    await expect(
      recovery.getByRole("button", { name: "Retry original submission" }),
    ).toHaveCount(0);
    expect(api.posts).toHaveLength(2);
    expect(errors).toEqual([]);
  });
}

async function removeTestProfile(profile: string) {
  if (
    resolve(dirname(profile)) !== resolve(tmpdir()) ||
    !basename(profile).startsWith("core-console-ledger-t03-")
  )
    throw new Error("Unexpected test profile cleanup path.");
  await rm(profile, { recursive: true, force: true });
}

test("recovers an unresolved Ledger across a persistent Chromium profile restart", async () => {
  const profile = await mkdtemp(join(tmpdir(), "core-console-ledger-t03-"));
  let context = await chromium.launchPersistentContext(profile, {
    headless: true,
  });
  try {
    const api = await installApi(context, false);
    const page = await context.newPage();
    const errors = captureErrors(page);
    await beginCreate(page, false);
    const original = api.posts[0]!;
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const resumed = await installApi(context, false);
    resumed.allowRetry();
    const reopened = await context.newPage();
    const reopenedErrors = captureErrors(reopened);
    await reopened.goto("http://127.0.0.1:4173/finance/accounts");
    await expect(
      reopened.getByRole("region", { name: "Finance submission recovery" }),
    ).toContainText("The original submission is unfinished.");
    expect(resumed.posts).toHaveLength(0);
    await reopened
      .getByRole("button", { name: "Retry original submission" })
      .click();
    await expect(
      reopened.getByRole("status", { name: "Ledger created: Household" }),
    ).toBeVisible();
    expect(resumed.posts[0]).toEqual(original);
    expect([...errors, ...reopenedErrors]).toEqual([]);
  } finally {
    await context.close();
    await removeTestProfile(profile);
  }
});

test("does not dispatch when an IndexedDB request succeeds but its preparation transaction aborts", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const api = await installApi(context, false);
  await page.addInitScript(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request =
        key === undefined ? add.call(this, value) : add.call(this, value, key);
      if (this.name === "submissions")
        request.addEventListener("success", () => this.transaction.abort());
      return request;
    };
  });
  await page.goto("/finance/accounts");
  await page.getByRole("button", { name: "Create Ledger" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Browser storage write failed",
  );
  expect(api.posts).toHaveLength(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Create Ledger" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Retry original submission" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("recovers durable preparation when its page terminates before transport dispatch", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const api = await installApi(context, false);
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch;
    window.fetch = function (input, init) {
      if (
        init?.method === "POST" &&
        String(input).endsWith("/finance/ledgers")
      ) {
        (window as typeof window & { preparedKey: string }).preparedKey =
          new Headers(init.headers).get("Idempotency-Key")!;
        return new Promise<Response>(() => undefined);
      }
      return fetchOriginal.call(this, input, init);
    };
  });
  await page.goto("/finance/accounts");
  await page.getByRole("textbox", { name: "Ledger name" }).fill("Household");
  await page.getByRole("button", { name: "Create Ledger" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { preparedKey?: string }).preparedKey,
      ),
    )
    .toBeTruthy();
  const originalKey = await page.evaluate(
    () => (window as typeof window & { preparedKey: string }).preparedKey,
  );
  expect(api.posts).toHaveLength(0);
  await page.close();
  const resumed = await context.newPage();
  const resumedErrors = captureErrors(resumed);
  await resumed.goto("/finance/accounts");
  await expect(
    resumed.getByRole("region", { name: "Finance submission recovery" }),
  ).toContainText("The original submission is unfinished.");
  expect(api.posts).toHaveLength(0);
  api.allowRetry();
  await resumed
    .getByRole("button", { name: "Retry original submission" })
    .click();
  await expect(
    resumed.getByRole("status", { name: "Ledger created: Household" }),
  ).toBeVisible();
  expect(api.posts[0]).toMatchObject({
    key: originalKey,
    body: { name: "Household" },
    version: "1",
    owner: submissionTestUser.id,
  });
  expect([...errors, ...resumedErrors]).toEqual([]);
});

test("blocks incompatible stored commands without dispatching a persisted URL or erasing evidence", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const api = await installApi(context, false);
  await beginCreate(page, false);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("core-console.finance.submissions", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("submissions", "readwrite");
        const store = tx.objectStore("submissions");
        const get = store.getAll();
        get.onsuccess = () =>
          store.put({
            ...get.result[0],
            localSchemaVersion: 99,
            endpoint: "https://unsafe.example/create",
          });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "incompatible or damaged",
  );
  await expect(
    page.getByRole("button", { name: "Create Ledger" }),
  ).toBeDisabled();
  expect(api.posts).toHaveLength(1);
  expect(api.lookups).toBe(0);
  expect(errors).toEqual([]);
});

test("an acknowledged submission stays removed when a stale tab receives a delayed retry receipt", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const api = await installApi(context, true);
  await beginCreate(page, true);
  const second = await context.newPage();
  const otherErrors = captureErrors(second);
  await second.goto("/finance/accounts");
  await expect(
    second.getByRole("region", { name: "Finance submission recovery" }),
  ).toContainText("The original submission is unfinished.");
  api.allowRetry();
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstEntered!: () => void;
  const firstHeld = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  api.holdFirstRetry(firstPending, firstEntered);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    entered = resolve;
  });
  api.holdSecondRetry(pending, entered);
  await Promise.all([
    page.getByRole("button", { name: "Retry original submission" }).click(),
    second.getByRole("button", { name: "Retry original submission" }).click(),
  ]);
  await held;
  await firstHeld;
  releaseFirst();
  // Broadcast delivery can resolve either tab first; the completed tab owns
  // an enabled acknowledgement while the other transport remains in flight.
  await expect
    .poll(async () => {
      const a = page.getByRole("button", { name: "Acknowledge outcome" });
      const b = second.getByRole("button", { name: "Acknowledge outcome" });
      return (
        ((await a.count()) && (await a.isEnabled())) ||
        ((await b.count()) && (await b.isEnabled()))
      );
    })
    .toBeTruthy();
  const acknowledgement = page.getByRole("button", {
    name: "Acknowledge outcome",
  });
  const completedPage =
    (await acknowledgement.count()) && (await acknowledgement.isEnabled())
      ? page
      : second;
  await completedPage
    .getByRole("button", { name: "Acknowledge outcome" })
    .click();
  await expect(
    completedPage.getByRole("button", { name: "Acknowledge outcome" }),
  ).toHaveCount(0);
  release();
  await expect(
    page.getByRole("button", { name: "Retry original submission" }),
  ).toHaveCount(0);
  await expect(
    second.getByRole("button", { name: "Retry original submission" }),
  ).toHaveCount(0);
  await second.reload();
  await expect(
    second.getByRole("button", { name: "Acknowledge outcome" }),
  ).toHaveCount(0);
  expect(api.posts).toHaveLength(3);
  expect(api.posts[1]).toEqual(api.posts[0]);
  expect(api.posts[2]).toEqual(api.posts[0]);
  expect([...errors, ...otherErrors]).toEqual([]);
});
