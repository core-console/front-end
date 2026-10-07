/// <reference lib="dom" />
import {
  expect,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import {
  FinanceSubmissionResponse,
  SubmissionReceipt,
} from "../../src/api/generated/schemas/index.ts";
import { submissionTestUser } from "../../src/test/submission-fixtures.ts";
import { adjustmentTestBody } from "../../src/test/adjustment-submission-fixtures.ts";
import {
  transactionTestBody,
  transactionTestLedger as ledger,
  transactionTestResource,
} from "../../src/test/transaction-submission-fixtures.ts";

export { ledger };
export const databaseName = "core-console.finance.submissions";
export const entries = [
  {
    operation: "createFinanceLedger",
    workflow: "additional",
    endpoint: "/finance/ledgers",
    targetLedgerId: null,
    body: { name: "Retained Ledger" },
    resourceType: "ledger",
  },
  {
    operation: "createFinanceAccount",
    workflow: "account",
    endpoint: `/finance/ledgers/${ledger.id}/accounts`,
    targetLedgerId: ledger.id,
    body: {
      name: "Retained Account",
      currency: "USD",
      nature: "liability",
      openingBalance: { amount: "-9007199254740993.01", currency: "USD" },
      trackingStartDate: "2026-10-05",
    },
    resourceType: "account",
  },
  {
    operation: "createFinanceCategory",
    workflow: "category",
    endpoint: `/finance/ledgers/${ledger.id}/categories`,
    targetLedgerId: ledger.id,
    body: { name: "Retained Category" },
    resourceType: "category",
  },
  {
    operation: "createFinanceTransaction",
    workflow: "transaction",
    endpoint: `/finance/ledgers/${ledger.id}/transactions`,
    targetLedgerId: ledger.id,
    body: transactionTestBody("expense"),
    resourceType: "transaction",
  },
  {
    operation: "createBalanceAdjustment",
    workflow: "balanceAdjustment",
    endpoint: `/finance/ledgers/${ledger.id}/balance-adjustments`,
    targetLedgerId: ledger.id,
    body: adjustmentTestBody,
    resourceType: "transaction",
  },
] as const;
export type Entry = (typeof entries)[number];
export function retained(entry: Entry, extra: Record<string, unknown> = {}) {
  const { resourceType: _resourceType, ...command } = entry;
  return {
    ...command,
    apiBaseUrl: "http://127.0.0.1:4173/api",
    ownerId: submissionTestUser.id,
    submissionId: crypto.randomUUID(),
    commandVersion: "1",
    localSchemaVersion: 1,
    preparedAt: "2026-10-03T00:00:00Z",
    state: "unresolved",
    integrityBlocked: false,
    ...extra,
  };
}
export type Retained = ReturnType<typeof retained>;
export function receipt(record: Retained) {
  const entry = entries.find((entry) => entry.operation === record.operation)!;
  return SubmissionReceipt.parse({
    submissionId: record.submissionId,
    commandVersion: "1",
    operation: record.operation,
    targetLedgerId: record.targetLedgerId,
    admittedAt: "2026-10-03T00:00:00Z",
    resolvedAt: "2026-10-03T00:00:01Z",
    outcome:
      record.operation === "createBalanceAdjustment"
        ? { kind: "noChange" }
        : {
            kind: "created",
            resource: {
              type: entry.resourceType,
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            },
          },
  });
}
export function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
export function captureErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

// Transport fixtures control browser evidence only; they do not model a DB commit.
export async function installApi(context: BrowserContext, records: Retained[]) {
  const posts: {
    key: string;
    owner: string;
    version: string;
    path: string;
    body: unknown;
  }[] = [];
  const lookups: string[] = [];
  let terminal = false;
  let owner = submissionTestUser;
  let postHandler:
    ((route: Route, record: Retained) => Promise<void>) | undefined;
  let lookupHandler:
    ((route: Route, record: Retained) => Promise<void>) | undefined;
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: owner });
    if (path === "/api/finance/currencies")
      return route.fulfill({ json: [{ code: "USD", minorUnit: 2 }] });
    if (request.method() === "POST") {
      const key = request.headers()["idempotency-key"]!;
      let record = records.find((record) => record.submissionId === key);
      if (!record) {
        const entry = entries.find(
          (entry) => `/api${entry.endpoint}` === path,
        )!;
        expect(entry).toBeTruthy();
        record = retained(entry, {
          submissionId: key,
          body: request.postDataJSON(),
        });
        records.push(record);
      }
      posts.push({
        key,
        owner: request.headers()["finance-submission-owner"]!,
        version: request.headers()["finance-command-version"]!,
        path,
        body: request.postDataJSON(),
      });
      if (postHandler) return postHandler(route, record);
      return route.fulfill({
        json: receipt(record),
        status: record.operation === "createBalanceAdjustment" ? 200 : 201,
      });
    }
    if (path.includes("/submissions/")) {
      const key = path.split("/").at(-1)!;
      const record = records.find((record) => record.submissionId === key)!;
      expect(record).toBeTruthy();
      expect(request.headers()["finance-submission-owner"]).toBe(
        record.ownerId,
      );
      lookups.push(key);
      if (lookupHandler) return lookupHandler(route, record);
      return route.fulfill({
        headers: { "Cache-Control": "no-store" },
        json: FinanceSubmissionResponse.parse(
          terminal
            ? { state: "terminal", receipt: receipt(record) }
            : {
                state: "unfinished",
                submissionId: key,
                operation: record.operation,
                targetLedgerId: record.targetLedgerId,
                commandVersion: "1",
                admittedAt: "2026-10-03T00:00:00Z",
              },
        ),
      });
    }
    if (path === "/api/finance/ledgers")
      return route.fulfill({ json: [ledger] });
    if (path.endsWith("/accounts") || path.endsWith("/categories"))
      return route.fulfill({ json: [] });
    if (path.endsWith("/transactions"))
      return route.fulfill({ json: { items: [], nextCursor: null } });
    if (path.includes("/transactions/"))
      return route.fulfill({
        json: transactionTestResource("expense"),
      });
    if (path.endsWith("/overview"))
      return route.fulfill({
        json: {
          ledger,
          month: new URL(request.url()).searchParams.get("month"),
          accounts: [],
          days: [],
          financialPositionByCurrency: [],
          monthSummaryByCurrency: [],
        },
      });
    throw new Error(`Unexpected API request: ${request.method()} ${path}`);
  });
  return {
    posts,
    lookups,
    complete() {
      terminal = true;
    },
    switchOwner(value: typeof owner) {
      owner = value;
    },
    onPost(handler: typeof postHandler) {
      postHandler = handler;
    },
    onLookup(handler: typeof lookupHandler) {
      lookupHandler = handler;
    },
  };
}

export async function seed(
  page: Page,
  records: unknown[],
  version = 1,
  keyPath = ["apiBaseUrl", "ownerId", "submissionId"],
) {
  // Initialize storage before the Finance provider mounts.
  await page.goto("/");
  await writeRecords(page, records, version, keyPath);
}

export async function writeRecords(
  page: Page,
  records: unknown[],
  version = 1,
  keyPath = ["apiBaseUrl", "ownerId", "submissionId"],
) {
  await page.evaluate(
    async ({ records, version, keyPath, databaseName }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(databaseName, version);
        open.onupgradeneeded = () =>
          open.result.createObjectStore("submissions", { keyPath });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("submissions", "readwrite");
          records.forEach((record) =>
            tx.objectStore("submissions").add(record),
          );
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
    },
    { records, version, keyPath, databaseName },
  );
}
export async function stored(page: Page) {
  return page.evaluate(
    async (databaseName) =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open(databaseName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("submissions", "readonly");
          const get = tx.objectStore("submissions").getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(get.result);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    databaseName,
  );
}
export async function enter(page: Page) {
  await page.goto(`/finance/accounts?ledger=${ledger.id}`);
  await expect(
    page.getByRole("button", { name: "Retry original submission" }).first(),
  ).toBeEnabled();
}

export async function holdNextJournalRead(page: Page) {
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    let held = false;
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const control = { entered, release, done: Promise.resolve() };
    Object.assign(window, { journalRead: control });
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<typeof original>
    ) {
      const tx = original.apply(this, args);
      if (
        !held &&
        args[1] === "readonly" &&
        this.name === "core-console.finance.submissions"
      ) {
        held = true;
        IDBDatabase.prototype.transaction = original;
        Object.defineProperty(tx, "oncomplete", {
          set(handler: (event: Event) => void) {
            tx.addEventListener("complete", (event) => {
              enter();
              control.done = pending.then(() => handler.call(tx, event));
            });
          },
        });
      }
      return tx;
    };
    window.dispatchEvent(new Event("finance-submissions-changed"));
  });
  await page.evaluate(
    () =>
      (window as typeof window & { journalRead: { entered: Promise<void> } })
        .journalRead.entered,
  );
}
export async function releaseJournalRead(page: Page) {
  await page.evaluate(async () => {
    const control = (
      window as typeof window & {
        journalRead: { release: () => void; done: Promise<void> };
      }
    ).journalRead;
    control.release();
    await control.done;
  });
}

export async function abortJournalWrite(page: Page, method: "put" | "delete") {
  await page.evaluate((method) => {
    const original = IDBObjectStore.prototype[method];
    let aborted!: () => void;
    const done = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    Object.assign(window, { journalAbort: done });
    Object.defineProperty(IDBObjectStore.prototype, method, {
      configurable: true,
      writable: true,
      value: function (this: IDBObjectStore, ...args: unknown[]) {
        const request = Reflect.apply(
          original,
          this,
          args,
        ) as IDBRequest<unknown>;
        if (this.name === "submissions") {
          Object.defineProperty(IDBObjectStore.prototype, method, {
            value: original,
          });
          this.transaction.addEventListener("abort", aborted);
          request.addEventListener("success", () => this.transaction.abort());
        }
        return request;
      },
    });
  }, method);
}
export async function waitForJournalAbort(page: Page) {
  await page.evaluate(
    () =>
      (window as typeof window & { journalAbort: Promise<void> }).journalAbort,
  );
}
