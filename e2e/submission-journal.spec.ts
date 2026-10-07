/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { submissionTestUser } from "../src/test/submission-fixtures.ts";
import {
  AccountValidationProblem,
  SubmissionNonterminalProblem,
} from "../src/api/generated/schemas/index.ts";
import {
  captureErrors,
  entries,
  retained,
  installApi,
  seed,
  enter,
  stored,
  holdNextJournalRead,
  releaseJournalRead,
  receipt,
  barrier,
  abortJournalWrite,
  waitForJournalAbort,
  databaseName,
  writeRecords,
} from "./support/submission-journal.ts";

test("an older journal read cannot resurrect acknowledged evidence", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const record = retained(entries[0]);
  const api = await installApi(context, [record]);
  await seed(page, [record]);
  await enter(page);
  await holdNextJournalRead(page);
  api.complete();
  await page.getByRole("button", { name: "Check outcome" }).click();
  await expect(
    page.getByRole("button", { name: "Acknowledge outcome" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Acknowledge outcome" }).click();
  await expect(
    page.getByRole("button", { name: "Acknowledge outcome" }),
  ).toHaveCount(0);
  await releaseJournalRead(page);
  await expect(
    page.getByRole("button", { name: "Retry original submission" }),
  ).toHaveCount(0);
  expect(await stored(page)).toEqual([]);
  expect(api.posts).toEqual([]);
  expect(errors).toEqual([]);
});

test("unavailable BroadcastChannel does not prevent durable recovery", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const record = retained(entries[0]);
  const api = await installApi(context, [record]);
  await page.addInitScript(() => {
    window.BroadcastChannel = class {
      constructor() {
        throw new DOMException("Unavailable", "SecurityError");
      }
    } as unknown as typeof BroadcastChannel;
  });
  await seed(page, [record]);
  await enter(page);
  await page.getByRole("button", { name: "Retry original submission" }).click();
  await expect(
    page.getByRole("button", { name: "Acknowledge outcome" }),
  ).toBeEnabled();
  expect(api.posts).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("an incompatible database key schema fails closed before preparation", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const api = await installApi(context, []);
  await seed(page, [], 1, ["submissionId"]);
  await page.goto("/finance/accounts");
  await expect(page.getByRole("alert")).toContainText(
    "storage is incompatible",
  );
  expect(api.posts).toEqual([]);
  expect(await stored(page)).toEqual([]);
  expect(errors).toEqual([]);
});

for (const entry of entries) {
  test(`${entry.operation}: legacy v1 command retries unchanged and acknowledgement survives reload`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const record = retained(entry);
    const api = await installApi(context, [record]);
    await seed(page, [record]);
    await enter(page);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Retry original submission" }),
    ).toBeEnabled();
    expect(api.posts).toEqual([]);
    expect(await stored(page)).toEqual([record]);
    await page
      .getByRole("button", { name: "Retry original submission" })
      .click();
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toBeEnabled();
    expect(api.posts).toEqual([
      {
        key: record.submissionId,
        version: "1",
        owner: record.ownerId,
        path: `/api${record.endpoint}`,
        body: record.body,
      },
    ]);
    expect(await stored(page)).toEqual([
      {
        ...record,
        state: "resolved",
        resolution: { kind: "receipt", receipt: receipt(record) },
      },
    ]);
    await page.getByRole("button", { name: "Acknowledge outcome" }).click();
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Personal", exact: true }),
    ).toBeVisible();
    expect(await stored(page)).toEqual([]);
    expect(api.posts).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test(`${entry.operation}: concurrent retries converge without notifications despite a late failure`, async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      Object.defineProperty(window, "BroadcastChannel", { value: undefined });
    });
    const errors = captureErrors(page);
    const record = retained(entry);
    const api = await installApi(context, [record]);
    const firstEntered = barrier();
    const secondEntered = barrier();
    const firstResponse = barrier();
    const secondResponse = barrier();
    const lateDelivered = barrier();
    api.onPost(async (route, current) => {
      if (api.posts.length === 1) {
        firstEntered.release();
        await firstResponse.promise;
        await route.fulfill({
          json: receipt(current),
          status: entry.operation === "createBalanceAdjustment" ? 200 : 201,
        });
      } else {
        secondEntered.release();
        await secondResponse.promise;
        await route.fulfill({ json: {} });
        lateDelivered.release();
      }
    });
    await seed(page, [record]);
    await enter(page);
    const other = await context.newPage();
    const otherErrors = captureErrors(other);
    await enter(other);
    await page
      .getByRole("button", { name: "Retry original submission" })
      .click();
    await firstEntered.promise;
    await other
      .getByRole("button", { name: "Retry original submission" })
      .click();
    await secondEntered.promise;
    firstResponse.release();
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toBeEnabled();
    secondResponse.release();
    await lateDelivered.promise;
    await expect(
      other.getByRole("button", { name: "Acknowledge outcome" }),
    ).toBeEnabled();
    await expect(
      other.getByRole("button", { name: "Retry original submission" }),
    ).toHaveCount(0);
    expect(api.posts[1]).toEqual(api.posts[0]);
    expect(api.posts).toHaveLength(2);
    await page.getByRole("button", { name: "Acknowledge outcome" }).click();
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toHaveCount(0);
    // With hints absent, normal recovery activation must reread the deletion.
    await other.bringToFront();
    await other.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      other.getByRole("button", { name: "Acknowledge outcome" }),
    ).toHaveCount(0);
    expect(await stored(other)).toEqual([]);
    expect([...errors, ...otherErrors]).toEqual([]);
  });

  test(`${entry.operation}: failed resolution and acknowledgement commits retain evidence`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const record = retained(entry);
    const api = await installApi(context, [record]);
    await seed(page, [record]);
    await enter(page);
    await abortJournalWrite(page, "put");
    await page
      .getByRole("button", { name: "Retry original submission" })
      .click();
    await waitForJournalAbort(page);
    await expect(
      page.getByRole("region", { name: "Finance submission recovery" }),
    ).toContainText("Browser storage write failed");
    await expect(
      page.getByRole("button", { name: "Retry original submission" }),
    ).toBeEnabled();
    expect(await stored(page)).toEqual([record]);
    api.complete();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toBeEnabled();
    await abortJournalWrite(page, "delete");
    await page.getByRole("button", { name: "Acknowledge outcome" }).click();
    await waitForJournalAbort(page);
    await expect(
      page.getByRole("region", { name: "Finance submission recovery" }),
    ).toContainText("Browser storage write failed");
    expect(await stored(page)).toEqual([
      {
        ...record,
        state: "resolved",
        resolution: { kind: "receipt", receipt: receipt(record) },
      },
    ]);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Acknowledge outcome" }).click();
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toHaveCount(0);
    expect(await stored(page)).toEqual([]);
    expect(api.posts).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test(`${entry.operation}: acknowledgement wins against a delayed receipt in a stale tab`, async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      Object.defineProperty(window, "BroadcastChannel", { value: undefined });
    });
    const errors = captureErrors(page);
    const record = retained(entry);
    const api = await installApi(context, [record]);
    const entered = barrier();
    const release = barrier();
    await seed(page, [record]);
    await enter(page);
    const other = await context.newPage();
    const otherErrors = captureErrors(other);
    await enter(other);
    // Hold the stale tab's transport while the other tab resolves and acknowledges.
    api.onPost(async (route, current) => {
      if (route.request().frame().page() === other) {
        entered.release();
        await release.promise;
      }
      await route.fulfill({
        json: receipt(current),
        status: entry.operation === "createBalanceAdjustment" ? 200 : 201,
      });
    });
    await other
      .getByRole("button", { name: "Retry original submission" })
      .click();
    await entered.promise;
    await page
      .getByRole("button", { name: "Retry original submission" })
      .click();
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Acknowledge outcome" }).click();
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toHaveCount(0);
    release.release();
    await expect(
      other.getByRole("button", { name: "Retry original submission" }),
    ).toHaveCount(0);
    await expect(
      other.getByRole("button", { name: "Acknowledge outcome" }),
    ).toHaveCount(0);
    expect(await stored(other)).toEqual([]);
    expect(api.posts[1]).toEqual(api.posts[0]);
    expect(api.posts).toHaveLength(2);
    expect([...errors, ...otherErrors]).toEqual([]);
  });
}

for (const damage of [
  { localSchemaVersion: 99 },
  { commandVersion: "99" },
  { operation: "unknownCreate" },
  { endpoint: "https://unsafe.example/create" },
  { body: { name: 42 } },
  { unexpected: "field" },
]) {
  test(`retains incompatible evidence ${JSON.stringify(damage)} without lookup or POST`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const record = retained(entries[0], damage);
    const api = await installApi(context, [record]);
    await seed(page, [record]);
    await page.goto("/finance/accounts");
    await expect(page.getByRole("alert")).toContainText(
      "incompatible or damaged",
    );
    expect(await stored(page)).toEqual([record]);
    expect(api.posts).toEqual([]);
    expect(api.lookups).toEqual([]);
    await page.getByRole("button", { name: "Reload recovery" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "incompatible or damaged",
    );
    expect(await stored(page)).toEqual([record]);
    expect(errors).toEqual([]);
  });
}

test("foreign namespaces remain hidden and do not block a valid current partition", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const active = retained(entries[0]);
  const foreignOwner = retained(entries[1], {
    ownerId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    localSchemaVersion: 99,
  });
  const foreignApi = retained(entries[2], {
    apiBaseUrl: "https://other.example/api",
    localSchemaVersion: 99,
  });
  const api = await installApi(context, [active, foreignOwner, foreignApi]);
  await seed(page, [active, foreignOwner, foreignApi]);
  await enter(page);
  await expect(
    page.getByRole("status", { name: /outcome unknown:/ }),
  ).toHaveCount(1);
  expect(api.lookups.every((id) => id === active.submissionId)).toBe(true);
  api.switchOwner({ ...submissionTestUser, id: foreignOwner.ownerId });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "incompatible or damaged",
  );
  await expect(
    page.getByRole("status", { name: /outcome unknown:/ }),
  ).toHaveCount(0);
  api.switchOwner(submissionTestUser);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry original submission" }),
  ).toBeEnabled();
  expect(await stored(page)).toHaveLength(3);
  expect(api.posts).toEqual([]);
  expect(errors).toEqual([]);
});

test("an absent record in a stale tab cannot dispatch or mint another key", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", { value: undefined });
  });
  const errors = captureErrors(page);
  const record = retained(entries[0]);
  const api = await installApi(context, [record]);
  await seed(page, [record]);
  await enter(page);
  const other = await context.newPage();
  const otherErrors = captureErrors(other);
  await enter(other);
  await page.getByRole("button", { name: "Retry original submission" }).click();
  await expect(
    page.getByRole("button", { name: "Acknowledge outcome" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Acknowledge outcome" }).click();
  await expect(
    page.getByRole("button", { name: "Acknowledge outcome" }),
  ).toHaveCount(0);
  // No hint reaches this tab. Its explicit retry must discover absence durably.
  await other
    .getByRole("button", { name: "Retry original submission" })
    .click();
  await expect(
    other.getByRole("region", { name: "Finance submission recovery" }),
  ).toContainText("already acknowledged");
  expect(api.posts).toHaveLength(1);
  expect(await stored(other)).toEqual([]);
  await other.bringToFront();
  await other.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    other.getByRole("button", { name: "Retry original submission" }),
  ).toHaveCount(0);
  expect([...errors, ...otherErrors]).toEqual([]);
});

test("a blocked upgrade and subsequent versionchange preserve records and close stale access", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const record = retained(entries[0]);
  const api = await installApi(context, [record]);
  await seed(page, [record]);
  await enter(page);
  const blocker = await context.newPage();
  const otherErrors = captureErrors(blocker);
  await blocker.goto("/");
  await blocker.evaluate(async (databaseName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(databaseName, 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    Object.assign(window, { blockingDatabase: db });
  }, databaseName);
  await holdNextJournalRead(page);
  await page.evaluate(async (databaseName) => {
    const upgrade = indexedDB.open(databaseName, 2);
    Object.assign(window, {
      upgradeDone: new Promise<void>((resolve, reject) => {
        upgrade.onsuccess = () => {
          upgrade.result.close();
          resolve();
        };
        upgrade.onerror = () => reject(upgrade.error);
      }),
    });
    await new Promise<void>((resolve) => {
      upgrade.onblocked = () => resolve();
    });
  }, databaseName);
  expect(api.posts).toEqual([]);
  await blocker.evaluate(() =>
    (
      window as typeof window & { blockingDatabase: IDBDatabase }
    ).blockingDatabase.close(),
  );
  await page.evaluate(
    () =>
      (window as typeof window & { upgradeDone: Promise<void> }).upgradeDone,
  );
  await releaseJournalRead(page);
  await expect(page.getByRole("alert")).toContainText("storage could not open");
  expect(await stored(page)).toEqual([record]);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("storage could not open");
  expect(await stored(page)).toEqual([record]);
  expect(api.posts).toEqual([]);
  expect([...errors, ...otherErrors]).toEqual([]);
});

for (const denial of ["false", "reject", "throw"] as const) {
  test(`persistent storage ${denial} permits a durably prepared create`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const api = await installApi(context, []);
    await page.addInitScript((denial) => {
      Object.defineProperty(navigator.storage, "persist", {
        value: () => {
          if (denial === "throw")
            throw new DOMException("Denied", "SecurityError");
          return denial === "false"
            ? Promise.resolve(false)
            : Promise.reject(new DOMException("Denied", "SecurityError"));
        },
      });
    }, denial);
    await page.goto("/finance/accounts");
    await page.getByRole("button", { name: "Personal", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Create Ledger", exact: true })
      .click();
    const form = page.getByRole("dialog", { name: "Create Ledger" });
    await form
      .getByRole("textbox", { name: "Ledger name" })
      .fill("Retained Ledger");
    await form.getByRole("button", { name: "Create", exact: true }).click();
    await expect
      .poll(() => stored(page))
      .toMatchObject([{ state: "resolved" }]);
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toBeEnabled();
    expect(api.posts).toHaveLength(1);
    expect(await stored(page)).toMatchObject([
      { body: { name: "Retained Ledger" }, state: "resolved" },
    ]);
    expect(errors).toEqual([]);
  });
}

test("an old owner's delayed receipt preserves the current owner's draft and focus", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const record = retained(entries[0]);
  const independent = retained(entries[2]);
  const api = await installApi(context, [record, independent]);
  const entered = barrier();
  const release = barrier();
  api.onPost(async (route, current) => {
    entered.release();
    await release.promise;
    await route.fulfill({ json: receipt(current), status: 201 });
  });
  await seed(page, [record, independent]);
  await enter(page);
  await page
    .getByRole("status", { name: "Ledger outcome unknown: Retained Ledger" })
    .getByRole("button", { name: "Retry original submission" })
    .click();
  await entered.promise;
  api.switchOwner({
    ...submissionTestUser,
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    displayName: "Second Owner",
  });
  // A separate explicit lookup reasserts identity while the old POST is held.
  await page
    .getByRole("status", {
      name: "Category outcome unknown: Retained Category",
    })
    .getByRole("button", { name: "Check outcome" })
    .click();
  await expect(page.getByRole("group", { name: "当前用户" })).toContainText(
    "Second Owner",
  );
  await expect(
    page.getByRole("status", { name: /Retained Ledger/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Personal", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Create Ledger", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "Create Ledger" });
  const draft = form.getByRole("textbox", { name: "Ledger name" });
  await draft.fill("Current owner's draft");
  await draft.focus();
  release.release();
  await expect
    .poll(async () =>
      (await stored(page)).find(
        (value) =>
          value &&
          typeof value === "object" &&
          "submissionId" in value &&
          value.submissionId === record.submissionId,
      ),
    )
    .toMatchObject({ ownerId: record.ownerId, state: "resolved" });
  await expect(draft).toHaveValue("Current owner's draft");
  await expect(draft).toBeFocused();
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("button", { name: "Acknowledge outcome" }),
  ).toHaveCount(0);
  expect(api.posts).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("an inactive owner's completion cannot suppress the current owner's recovery read", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", { value: undefined });
  });
  const errors = captureErrors(page);
  const original = retained(entries[0]);
  const independent = retained(entries[2]);
  const current = retained(entries[1], {
    ownerId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  });
  const api = await installApi(context, [original, independent, current]);
  const entered = barrier();
  const release = barrier();
  api.onPost(async (route, record) => {
    entered.release();
    await release.promise;
    await route.fulfill({ json: receipt(record), status: 201 });
  });
  await seed(page, [original, independent]);
  await enter(page);
  await page
    .getByRole("status", { name: "Ledger outcome unknown: Retained Ledger" })
    .getByRole("button", { name: "Retry original submission" })
    .click();
  await entered.promise;
  api.switchOwner({
    ...submissionTestUser,
    id: current.ownerId,
    displayName: "Second Owner",
  });
  await page
    .getByRole("status", {
      name: "Category outcome unknown: Retained Category",
    })
    .getByRole("button", { name: "Check outcome" })
    .click();
  await expect(page.getByRole("group", { name: "当前用户" })).toContainText(
    "Second Owner",
  );
  await expect(
    page.getByRole("status", { name: /outcome unknown:/ }),
  ).toHaveCount(0);
  // Another context durably prepares without delivering a notification.
  await writeRecords(page, [current]);
  await holdNextJournalRead(page);
  release.release();
  await expect
    .poll(() => stored(page))
    .toContainEqual({
      ...original,
      state: "resolved",
      resolution: { kind: "receipt", receipt: receipt(original) },
    });
  await expect(
    page.getByRole("status", {
      name: "Account outcome unknown: Retained Account",
    }),
  ).toBeVisible();
  await releaseJournalRead(page);
  await expect(
    page.getByRole("status", {
      name: "Account outcome unknown: Retained Account",
    }),
  ).toBeVisible();
  expect(api.posts).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const proof of [
  "valid",
  "bodyMismatch",
  "ownerMismatch",
  "generic",
  "closedVersion",
  "unsupportedVersion",
] as const) {
  test(`controlled HTTP evidence ${proof} preserves version and only exact Q29 resolves`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const record = retained(entries[1], {
      body: {
        ...entries[1].body,
        openingBalance: { amount: "invalid-money", currency: "USD" },
      },
    });
    const api = await installApi(context, [record]);
    const problem = ["closedVersion", "unsupportedVersion"].includes(proof)
      ? SubmissionNonterminalProblem.parse({
          type: "about:blank",
          title: "Update required",
          status: 409,
          code:
            proof === "closedVersion"
              ? "finance_command_version_closed"
              : "finance_command_version_unsupported",
        })
      : proof === "generic"
        ? {
            type: "about:blank",
            title: "Validation Error",
            status: 422,
            code: "validation_error",
            errors: [],
          }
        : AccountValidationProblem.parse({
            type: "about:blank",
            title: "Validation Error",
            status: 422,
            code: "validation_error",
            errors: [],
            commandValidationRejection: {
              kind: "definitivelyNotAdmitted",
              submissionId: record.submissionId,
              ownerId:
                proof === "ownerMismatch"
                  ? "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
                  : record.ownerId,
              commandVersion: "1",
              operation: "createFinanceAccount",
              targetLedgerId: record.targetLedgerId,
              attemptedBody:
                proof === "bodyMismatch"
                  ? { ...record.body, note: null }
                  : record.body,
            },
          });
    // Return a controlled HTTP Response at the Fetch boundary so expected error
    // statuses do not introduce browser network-console errors. Generated client
    // parsing and classification, IndexedDB, and the recovery UI remain real.
    await page.addInitScript(
      ({ endpoint, problem }) => {
        const original = window.fetch;
        window.fetch = function (input, init) {
          if (init?.method === "POST" && String(input).endsWith(endpoint)) {
            Object.assign(window, {
              controlledPost: {
                body: JSON.parse(String(init.body)) as unknown,
                key: new Headers(init.headers).get("Idempotency-Key"),
                version: new Headers(init.headers).get(
                  "Finance-Command-Version",
                ),
              },
            });
            return Promise.resolve(
              new Response(JSON.stringify(problem), {
                status: problem.status,
                headers: { "Content-Type": "application/problem+json" },
              }),
            );
          }
          return original.call(this, input, init);
        };
      },
      { endpoint: record.endpoint, problem },
    );
    await seed(page, [record]);
    await enter(page);
    await page
      .getByRole("button", { name: "Retry original submission" })
      .click();
    if (proof === "valid") {
      await expect(
        page.getByRole("button", { name: "Acknowledge outcome" }),
      ).toBeEnabled();
      expect(await stored(page)).toEqual([
        {
          ...record,
          state: "resolved",
          resolution: { kind: "notAdmitted", problem },
        },
      ]);
      await page.getByRole("button", { name: "Acknowledge outcome" }).click();
      await expect(
        page.getByRole("button", { name: "Acknowledge outcome" }),
      ).toHaveCount(0);
      expect(await stored(page)).toEqual([]);
    } else {
      await expect(
        page.getByRole("button", { name: "Retry original submission" }),
      ).toBeEnabled();
      expect(await stored(page)).toEqual([record]);
      await expect(
        page.getByRole("button", { name: "Acknowledge outcome" }),
      ).toHaveCount(0);
    }
    expect(
      await page.evaluate(
        () => Reflect.get(window, "controlledPost") as unknown,
      ),
    ).toEqual({ body: record.body, key: record.submissionId, version: "1" });
    expect(api.posts).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const lookup of [
  "absent",
  "inaccessible",
  "failed",
  "mismatched",
] as const) {
  test(`fresh ${lookup} lookup retains uncertainty without execution`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const record = retained(entries[0]);
    const api = await installApi(context, [record]);
    const response =
      lookup === "mismatched"
        ? {
            state: "terminal",
            receipt: { ...receipt(record), submissionId: crypto.randomUUID() },
          }
        : {
            type: "about:blank",
            title: "Unavailable",
            status:
              lookup === "absent" ? 404 : lookup === "inaccessible" ? 403 : 503,
            code: "finance_submission_not_found",
          };
    await page.addInitScript(
      ({ response, lookup }) => {
        const original = window.fetch;
        const reads: (RequestCache | undefined)[] = [];
        Object.assign(window, { controlledLookups: reads });
        window.fetch = function (input, init) {
          if (String(input).includes("/finance/submissions/")) {
            reads.push(init?.cache);
            return Promise.resolve(
              new Response(JSON.stringify(response), {
                status:
                  lookup === "mismatched"
                    ? 200
                    : "status" in response
                      ? response.status
                      : 500,
                headers: {
                  "Content-Type": "application/json",
                  "Cache-Control": "no-store",
                },
              }),
            );
          }
          return original.call(this, input, init);
        };
      },
      { response, lookup },
    );
    await seed(page, [record]);
    await enter(page);
    await page.getByRole("button", { name: "Check outcome" }).click();
    await expect(
      page.getByRole("button", { name: "Check outcome" }),
    ).toBeEnabled();
    const requests = await page.evaluate(
      () => Reflect.get(window, "controlledLookups") as unknown,
    );
    expect(requests).toEqual(["no-store", "no-store"]);
    expect(await stored(page)).toEqual([record]);
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toHaveCount(0);
    expect(api.posts).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("a blocked open reports recovery guidance and preserves existing evidence", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const record = retained(entries[0]);
  const api = await installApi(context, [record]);
  await seed(page, [record]);
  await page.addInitScript(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (
      ...args: Parameters<typeof original>
    ) {
      const request = original.apply(this, args);
      if (args[0] === "core-console.finance.submissions" && args[1] === 1)
        queueMicrotask(() => request.dispatchEvent(new Event("blocked")));
      return request;
    };
  });
  await page.goto("/finance/accounts");
  await expect(page.getByRole("alert")).toContainText(
    "storage upgrade is blocked",
  );
  expect(await stored(page)).toEqual([record]);
  expect(api.posts).toEqual([]);
  expect(api.lookups).toEqual([]);
  expect(errors).toEqual([]);
});

test("quota failure during preparation preserves the draft and sends nothing", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const api = await installApi(context, []);
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (
      ...args: Parameters<typeof original>
    ) {
      if (this.name === "submissions")
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page.goto("/finance/accounts");
  await page.getByRole("button", { name: "Personal", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Create Ledger", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "Create Ledger" });
  const draft = form.getByRole("textbox", { name: "Ledger name" });
  await draft.fill("Retained draft");
  await form.getByRole("button", { name: "Create", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText(
    "Browser storage write failed",
  );
  await expect(draft).toHaveValue("Retained draft");
  expect(await stored(page)).toEqual([]);
  expect(api.posts).toEqual([]);
  expect(errors).toEqual([]);
});
