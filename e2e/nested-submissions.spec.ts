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
  createdAccountReceipt,
  createdCategoryReceipt,
  submissionTestUser,
} from "../src/test/submission-fixtures.ts";

const ledger = { id: "11111111-1111-4111-8111-111111111111", name: "Personal" };
const secondLedger = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "Team",
};
const resourceId = "22222222-2222-4222-8222-222222222222";
const accountBody = {
  name: "Reserve",
  currency: "CNY",
  nature: "liability",
  openingBalance: { amount: "-9007199254740993.01", currency: "CNY" },
  trackingStartDate: "2026-10-05",
};
type Entry = {
  label: string;
  slug: string;
  operation: "createFinanceAccount" | "createFinanceCategory";
  receipt: typeof createdAccountReceipt | typeof createdCategoryReceipt;
};
const entries: Entry[] = [
  {
    label: "Account",
    slug: "accounts",
    operation: "createFinanceAccount",
    receipt: createdAccountReceipt,
  },
  {
    label: "Category",
    slug: "categories",
    operation: "createFinanceCategory",
    receipt: createdCategoryReceipt,
  },
];

function captureErrors(page: Page) {
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
  let complete = false;
  let retry = false;
  let lookups = 0;
  let held: Promise<void> | null = null;
  let release: (() => void) | undefined;
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/me")
      return route.fulfill({ json: submissionTestUser });
    if (url.pathname === "/api/finance/ledgers")
      return route.fulfill({ json: [ledger, secondLedger] });
    if (url.pathname === "/api/finance/currencies")
      return route.fulfill({ json: [{ code: "CNY", minorUnit: 2 }] });
    if (url.pathname.includes("/submissions/")) {
      lookups += 1;
      expect(request.headers()["finance-submission-owner"]).toBe(
        submissionTestUser.id,
      );
      const key = url.pathname.split("/").at(-1)!;
      return route.fulfill({
        headers: { "Cache-Control": "no-store" },
        json: complete
          ? {
              state: "terminal",
              receipt: entry.receipt(key, ledger.id, resourceId),
            }
          : {
              state: "unfinished",
              submissionId: key,
              commandVersion: "1",
              operation: entry.operation,
              targetLedgerId: ledger.id,
              admittedAt: "2026-10-03T00:00:00Z",
            },
      });
    }
    if (
      url.pathname.endsWith(`/${entry.slug}`) &&
      request.method() === "POST"
    ) {
      posts.push({
        key: request.headers()["idempotency-key"]!,
        owner: request.headers()["finance-submission-owner"]!,
        version: request.headers()["finance-command-version"]!,
        path: url.pathname,
        body: request.postDataJSON(),
      });
      const key = posts.at(-1)!.key;
      if (!retry) return route.fulfill({ json: {}, status: 201 });
      if (posts.length === 2 && held) await held;
      complete = true;
      return route.fulfill({
        json: entry.receipt(key, ledger.id, resourceId),
        status: 201,
      });
    }
    if (url.pathname.endsWith("/accounts"))
      return route.fulfill({
        json:
          complete && url.pathname.includes(ledger.id)
            ? [
                {
                  ...accountBody,
                  id: resourceId,
                  status: "active",
                  currentBalance: accountBody.openingBalance,
                },
              ]
            : [],
      });
    if (url.pathname.endsWith("/categories"))
      return route.fulfill({
        json:
          complete && url.pathname.includes(ledger.id)
            ? [{ id: resourceId, name: "Reserve", status: "active" }]
            : [],
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
      retry = true;
    },
    holdReplay() {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseReplay() {
      release?.();
    },
  };
}

async function create(page: Page, entry: Entry) {
  await page.goto(
    `http://127.0.0.1:4173/finance/${entry.slug}?ledger=${ledger.id}`,
  );
  await page
    .getByRole("button", { name: `Create ${entry.label.toLowerCase()}` })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(`${entry.label} name`).fill("Reserve");
  if (entry.operation === "createFinanceAccount") {
    await dialog.getByLabel("Nature").selectOption("liability");
    await dialog
      .getByLabel("Opening balance")
      .fill(accountBody.openingBalance.amount);
    await dialog
      .getByLabel("Tracking start date")
      .fill(accountBody.trackingStartDate);
  }
  await dialog
    .getByRole("button", { name: `Create ${entry.label.toLowerCase()}` })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("outcome is unknown");
  return dialog;
}

async function removeTestProfile(profile: string) {
  if (
    resolve(dirname(profile)) !== resolve(tmpdir()) ||
    !basename(profile).startsWith("core-console-nested-t05-")
  )
    throw new Error("Unexpected test profile cleanup path.");
  await rm(profile, { recursive: true, force: true });
}

for (const entry of entries) {
  test(`${entry.label} recovers real IndexedDB after reload and Ledger navigation with keyboard and axe`, async ({
    page,
    context,
  }, testInfo) => {
    const errors = captureErrors(page);
    const api = await installApi(context, entry);
    await page.addInitScript(() => {
      const committed = new Set<string>();
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
            committed.add(id),
          );
        }
        return key === undefined
          ? add.call(this, value)
          : add.call(this, value, key);
      };
      const fetchOriginal = window.fetch;
      window.fetch = function (input, init) {
        if (init?.method === "POST") {
          (
            window as typeof window & { preparedBeforeDispatch: boolean }
          ).preparedBeforeDispatch = committed.has(
            new Headers(init.headers).get("Idempotency-Key")!,
          );
        }
        return fetchOriginal.call(this, input, init);
      };
    });
    const dialog = await create(page, entry);
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { preparedBeforeDispatch: boolean })
            .preparedBeforeDispatch,
      ),
    ).toBe(true);
    await dialog.getByLabel(`${entry.label} name`).fill("Later edit");
    await expect(
      dialog.getByRole("button", {
        name: `Create ${entry.label.toLowerCase()}`,
      }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.goto(`/finance/${entry.slug}?ledger=${secondLedger.id}`);
    await page.reload();
    const recovery = page.getByRole("region", {
      name: "Finance submission recovery",
    });
    await expect(recovery).toContainText("original submission is unfinished");
    expect(api.posts).toHaveLength(1);
    expect(api.lookups).toBeGreaterThan(0);
    if (entry.operation === "createFinanceAccount")
      await expect(recovery).toContainText(accountBody.openingBalance.amount);
    // Wait for the shell's existing transition before assessing text contrast.
    await expect
      .poll(() =>
        page
          .getByRole("link", { name: "Finance", exact: true })
          .locator("span")
          .evaluate((element) => getComputedStyle(element).opacity),
      )
      .toBe("1");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("recovery-unknown.png"),
      fullPage: true,
    });
    api.allowRetry();
    await recovery
      .getByRole("button", { name: "Retry original submission" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      recovery.getByRole("status", { name: `${entry.label} created: Reserve` }),
    ).toBeVisible();
    expect(api.posts[1]).toEqual(api.posts[0]);
    await recovery
      .getByRole("link", {
        name:
          entry.operation === "createFinanceAccount"
            ? "Open Accounts"
            : "Open Categories",
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`ledger=${ledger.id}`));
    await expect(page.getByRole("article", { name: "Reserve" })).toBeVisible();
    await recovery.getByRole("button", { name: "Acknowledge outcome" }).focus();
    await page.keyboard.press("Enter");
    await expect(recovery.getByRole("status")).toHaveCount(0);
    await page.reload();
    await expect(
      recovery.getByRole("button", { name: "Retry original submission" }),
    ).toHaveCount(0);
    expect(api.posts).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  test(`${entry.label} preparation transaction abort sends no create`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const api = await installApi(context, entry);
    await page.addInitScript(() => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (
        value: unknown,
        key?: IDBValidKey,
      ) {
        const request =
          key === undefined
            ? add.call(this, value)
            : add.call(this, value, key);
        if (this.name === "submissions")
          request.addEventListener("success", () => this.transaction.abort());
        return request;
      };
    });
    await page.goto(`/finance/${entry.slug}?ledger=${ledger.id}`);
    await page
      .getByRole("button", { name: `Create ${entry.label.toLowerCase()}` })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(`${entry.label} name`).fill("Reserve");
    await dialog
      .getByRole("button", { name: `Create ${entry.label.toLowerCase()}` })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Browser storage write failed",
    );
    expect(api.posts).toHaveLength(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Retry original submission" }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`${entry.label} concurrent tabs cannot resurrect an acknowledged command after a delayed response`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const api = await installApi(context, entry);
    const dialog = await create(page, entry);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const second = await context.newPage();
    const secondErrors = captureErrors(second);
    await second.goto(`/finance/${entry.slug}?ledger=${secondLedger.id}`);
    await expect(
      second.getByRole("button", { name: "Retry original submission" }),
    ).toBeEnabled();
    api.allowRetry();
    api.holdReplay();
    await page
      .getByRole("button", { name: "Retry original submission" })
      .click();
    await expect.poll(() => api.posts.length).toBe(2);
    await second
      .getByRole("button", { name: "Retry original submission" })
      .click();
    await expect(
      second.getByRole("status", { name: `${entry.label} created: Reserve` }),
    ).toBeVisible();
    await second.getByRole("button", { name: "Acknowledge outcome" }).click();
    await expect(
      second.getByRole("status", { name: `${entry.label} created: Reserve` }),
    ).toHaveCount(0);
    api.releaseReplay();
    await expect(
      page.getByRole("button", { name: "Retry original submission" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toHaveCount(0);
    expect(api.posts).toHaveLength(3);
    expect(api.posts[1]).toEqual(api.posts[0]);
    expect(api.posts[2]).toEqual(api.posts[0]);
    expect([...errors, ...secondErrors]).toEqual([]);
  });

  test(`${entry.label} recovers across persistent Chromium profile restart without automatic POST`, async () => {
    const profile = await mkdtemp(join(tmpdir(), "core-console-nested-t05-"));
    let context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    try {
      const originalApi = await installApi(context, entry);
      const page = await context.newPage();
      const errors = captureErrors(page);
      await create(page, entry);
      const original = originalApi.posts[0];
      await context.close();
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
      });
      const resumed = await installApi(context, entry);
      resumed.allowRetry();
      const reopened = await context.newPage();
      const reopenedErrors = captureErrors(reopened);
      await reopened.goto(
        `http://127.0.0.1:4173/finance/${entry.slug}?ledger=${secondLedger.id}`,
      );
      await expect(
        reopened.getByRole("region", { name: "Finance submission recovery" }),
      ).toContainText("original submission is unfinished");
      expect(resumed.posts).toHaveLength(0);
      await reopened
        .getByRole("button", { name: "Retry original submission" })
        .click();
      await expect(
        reopened.getByRole("status", {
          name: `${entry.label} created: Reserve`,
        }),
      ).toBeVisible();
      expect(resumed.posts[0]).toEqual(original);
      expect([...errors, ...reopenedErrors]).toEqual([]);
    } finally {
      await context.close();
      await removeTestProfile(profile);
    }
  });
}
