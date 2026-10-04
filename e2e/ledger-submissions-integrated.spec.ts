import { expect, test } from "@playwright/test";

import { LedgerCreatedReceipt } from "../src/api/generated/schemas/index.ts";

test("recovers an actual T02 PostgreSQL commit after its response receipt is lost", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.FINANCE_SUBMISSION_TEST_BACKEND,
    "Requires the guarded isolated T02 test server.",
  );
  const backend = process.env.FINANCE_SUBMISSION_TEST_BACKEND!;
  expect(backend).toBe("http://127.0.0.1:8290");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  let receipt: LedgerCreatedReceipt | undefined;
  let posts = 0;
  let allowLookup = false;
  const dispatched: { body: unknown; headers: Record<string, string> }[] = [];
  await page.route("**/api/**", async (route) => {
    const original = route.request();
    const url = new URL(original.url());
    if (url.pathname.startsWith("/api/finance/submissions/") && !allowLookup) {
      await route.fulfill({
        json: {
          state: "unfinished",
          submissionId: receipt!.submissionId,
          operation: "createFinanceLedger",
          targetLedgerId: null,
          commandVersion: "1",
          admittedAt: receipt!.admittedAt,
        },
      });
      return;
    }
    const response = await route.fetch({
      url: `${backend}${url.pathname}${url.search}`,
    });
    if (
      original.method() === "POST" &&
      url.pathname === "/api/finance/ledgers"
    ) {
      posts += 1;
      const headers = original.headers();
      dispatched.push({
        body: original.postDataJSON(),
        headers: {
          key: headers["idempotency-key"]!,
          owner: headers["finance-submission-owner"]!,
          version: headers["finance-command-version"]!,
        },
      });
      expect(response.status()).toBe(201);
      const terminal = LedgerCreatedReceipt.parse(await response.json());
      if (posts === 1) {
        receipt = terminal;
        // Backend completion has already committed. Discard the receipt bytes
        // at this test transport boundary, leaving an unusable partial response.
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: "{",
        });
        return;
      }
      expect(terminal).toEqual(receipt);
    }
    await route.fulfill({ response });
  });
  await page.goto("/finance/accounts");
  await page
    .getByRole("textbox", { name: "Ledger name" })
    .fill("T03 real recovery");
  await page.getByRole("button", { name: "Create Ledger" }).click();
  const recovery = page.getByRole("region", {
    name: "Ledger submission recovery",
  });
  await expect(
    recovery.getByRole("status", {
      name: "Ledger outcome unknown: T03 real recovery",
    }),
  ).toBeVisible();
  await expect(recovery).toContainText("The Ledger outcome is unknown.");
  expect(
    await (await request.get(`${backend}/t03-test/effects`)).json(),
  ).toEqual({ ledgers: 1, submissions: 1 });
  await recovery
    .getByRole("button", { name: "Retry original submission" })
    .click();
  await expect(
    recovery.getByRole("status", { name: "Ledger created: T03 real recovery" }),
  ).toBeVisible();
  expect(dispatched[1]).toEqual(dispatched[0]);
  expect(
    await (await request.get(`${backend}/t03-test/effects`)).json(),
  ).toEqual({ ledgers: 1, submissions: 1 });
  allowLookup = true;
  await page.reload();
  await expect(
    recovery.getByRole("status", { name: "Ledger created: T03 real recovery" }),
  ).toBeVisible();
  expect(posts).toBe(2);
  expect(errors).toEqual([]);
});
