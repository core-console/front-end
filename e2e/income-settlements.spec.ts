/// <reference lib="dom" />
import { AxeBuilder } from "@axe-core/playwright";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { CreateFinanceSettlementBody } from "../src/api/generated/schemas/index.ts";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as account,
} from "../src/test/advance-fixtures.ts";
import {
  incomeCategory,
  incomePreview,
  incomeSettlement,
  incomeReceipt,
} from "../src/test/income-settlement-fixtures.ts";
import {
  outstandingObligations,
  money,
} from "../src/test/settlement-fixtures.ts";
import { submissionTestUser } from "../src/test/submission-fixtures.ts";

function captureErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}
async function axe(page: Page) {
  await page.locator("body").evaluate(async (body) => {
    await Promise.all(
      body
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
async function api(
  context: BrowserContext,
  mode: "created" | "stale" | "unknown" = "created",
) {
  const posts: { key: string; version: string; body: string }[] = [];
  const previews: unknown[] = [];
  let confirmed = false;
  let lookupCreated = false;
  let hold: Promise<void> | undefined;
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown;
    let status = 200;
    const adjusted = mode === "stale" && previews.length > 2;
    const source = adjusted
      ? {
          ...incomeSettlement,
          acceptedSurplus: money("22.00"),
          allocations: incomePreview.allocations.map((item) => ({
            ...item,
            cashPaid: money("40.00"),
          })),
        }
      : incomeSettlement;
    if (path === "/api/me") body = submissionTestUser;
    else if (path === "/api/finance/ledgers") body = [ledger];
    else if (path === "/api/finance/currencies")
      body = [{ code: "CNY", minorUnit: 2 }];
    else if (path.endsWith("/accounts")) body = [account];
    else if (path.endsWith("/participants"))
      body = [{ ...person, status: "archived" }];
    else if (path.endsWith("/categories")) body = [incomeCategory];
    else if (path.endsWith("/credits") || path.endsWith("/positions"))
      body = [];
    else if (path.endsWith("/obligations"))
      body = outstandingObligations.map((item, index) =>
        confirmed || lookupCreated
          ? {
              ...item,
              cashPaid: source.allocations[index]!.cashPaid,
              remaining: money("0.00"),
            }
          : item,
      );
    else if (path.includes("/participants/") && path.endsWith("/settlements"))
      body = confirmed || lookupCreated ? [source] : [];
    else if (path.endsWith(`/settlements/${source.id}`)) body = source;
    else if (path.includes("/submissions/"))
      body = lookupCreated
        ? { state: "terminal", receipt: incomeReceipt(path.split("/").at(-1)!) }
        : {
            state: "unfinished",
            submissionId: path.split("/").at(-1)!,
            operation: "createFinanceSettlement",
            commandVersion: "3",
            targetLedgerId: ledger.id,
            admittedAt: "2026-10-23T00:00:00Z",
          };
    else if (path.endsWith("/settlements/preview")) {
      previews.push(request.postDataJSON());
      if (mode === "stale" && previews.length === 2) {
        status = 422;
        body = {
          type: "about:blank",
          title: "Invalid",
          status,
          code: "validation_error",
          detail: "Income no longer matches actual surplus.",
        };
      } else
        body =
          previews.length > 2
            ? {
                ...incomePreview,
                previewToken: "b".repeat(64),
                acceptedSurplus: money("22.00"),
                outstandingBefore: money("80.00"),
                categoryAllocations: [
                  { amount: money("22.00"), categoryId: incomeCategory.id },
                ],
                allocations: incomePreview.allocations.map((item) => ({
                  ...item,
                  cashPaid: money("40.00"),
                })),
              }
            : incomePreview;
    } else if (path.endsWith("/settlements") && request.method() === "POST") {
      const key = request.headers()["idempotency-key"]!;
      expect(request.headers()["finance-command-version"]).toBe("3");
      expect(request.headers()["finance-submission-owner"]).toBe(
        submissionTestUser.id,
      );
      expect(
        CreateFinanceSettlementBody.parse(request.postDataJSON()),
      ).toMatchObject({ excessDisposition: "acceptIncome" });
      posts.push({
        key,
        version: request.headers()["finance-command-version"]!,
        body: request.postData()!,
      });
      if (hold) await hold;
      if (mode === "unknown" && posts.length === 1) body = {};
      else if (mode === "stale" && posts.length === 1) {
        status = 409;
        const problem = {
          type: "about:blank",
          title: "Conflict",
          status,
          code: "finance_settlement_preview_stale",
          detail: "Debt changed.",
        };
        body = {
          ...problem,
          submissionReceipt: {
            ...incomeReceipt(key),
            outcome: { kind: "rejected", problem },
          },
        };
      } else {
        confirmed = true;
        status = 201;
        body = incomeReceipt(key);
      }
    } else
      throw new Error(`Unexpected API request: ${request.method()} ${path}`);
    await route.fulfill({ status, json: body });
  });
  return {
    posts,
    previews,
    resolveLookup: () => {
      lookupCreated = true;
    },
    hold: () => {
      let release = () => {};
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        hold = undefined;
        release();
      };
    },
  };
}
async function draft(page: Page) {
  const trigger = page.getByRole("button", {
    name: "Record repayment",
    exact: true,
  });
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Record repayment" });
  await expect(dialog.getByLabel("Participant", { exact: true })).toBeFocused();
  await dialog
    .getByLabel("Participant", { exact: true })
    .selectOption(person.id);
  await dialog
    .getByLabel("Receiving Account", { exact: true })
    .selectOption(account.id);
  await dialog.getByLabel("Amount", { exact: true }).fill("102");
  await dialog.getByLabel("Date", { exact: true }).fill("2027-01-02");
  await expect(dialog.getByLabel("Surplus handling")).toHaveValue("repayOnly");
  await dialog.getByLabel("Surplus handling").selectOption("acceptIncome");
  await dialog.getByLabel("Accepted Income amount").fill("2");
  await expect(dialog.getByRole("option", { name: /Gifts/ })).toHaveCount(1);
  await dialog.getByLabel("Income Category").selectOption(incomeCategory.id);
  await dialog.getByRole("button", { name: "Preview repayment" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toBeFocused();
  return dialog;
}

test("keyboard preview, discard, pending guard and Income result at 1024px", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const backend = await api(context);
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.goto(`/finance/repayments?ledger=${ledger.id}`);
  let dialog = await draft(page);
  await expect(dialog).toContainText("No Participant credit is created");
  await axe(page);
  await dialog.screenshot({ path: ".tmp/t06-preview-1024.png" });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Record repayment", exact: true }),
  ).toBeFocused();
  expect(backend.posts).toEqual([]);
  dialog = await draft(page);
  const release = backend.hold();
  await page.keyboard.press("Enter");
  await expect.poll(() => backend.posts.length).toBe(1);
  await expect(dialog.getByLabel("Accepted Income amount")).toBeDisabled();
  await page.keyboard.press("Enter");
  expect(backend.posts).toHaveLength(1);
  release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const result = page.getByRole("region", { name: "Confirmed Settlement" });
  await expect(result).toContainText("Accepted surplus Income");
  await expect(result).toContainText("2.00 CNY");
  await expect(
    result.getByRole("link", { name: /View accepted Income Transaction/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Repayments", exact: true }),
  ).toBeFocused();
  await axe(page);
  await page.screenshot({ path: ".tmp/t06-result-1024.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("stale regeneration failure preserves explicit Income until the user adjusts and reconfirms", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const backend = await api(context, "stale");
  await page.goto(`/finance/repayments?ledger=${ledger.id}`);
  const dialog = await draft(page);
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Refresh preview" }).click();
  await expect(dialog).toContainText("Your Income intent is preserved");
  await expect(dialog.getByLabel("Accepted Income amount")).toHaveValue("2");
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("102");
  await expect(dialog.getByLabel("Income Category")).toHaveValue(
    incomeCategory.id,
  );
  await expect(dialog.getByLabel("Surplus handling")).toHaveValue(
    "acceptIncome",
  );
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toHaveCount(0);
  expect(backend.posts).toHaveLength(1);
  await axe(page);
  await dialog.getByLabel("Accepted Income amount").fill("22");
  await dialog.getByRole("button", { name: "Preview repayment" }).click();
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toBeFocused();
  expect(backend.posts).toHaveLength(1);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Confirmed Settlement" }),
  ).toContainText("22.00 CNY");
  expect(backend.posts[1]!.key).not.toBe(backend.posts[0]!.key);
  expect(JSON.parse(backend.posts[1]!.body)).toMatchObject({
    excessDisposition: "acceptIncome",
    categoryAllocations: [{ amount: money("22") }],
    previewToken: "b".repeat(64),
  });
  expect(errors).toEqual([
    "Failed to load resource: the server responded with a status of 409 (Conflict)",
    "Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)",
  ]);
});

for (const recovery of ["retry", "lookup"] as const) {
  test(`uncertain Income survives reload and ${recovery} retains the complete original command`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const backend = await api(context, "unknown");
    await page.goto(`/finance/repayments?ledger=${ledger.id}`);
    const dialog = await draft(page);
    await page.keyboard.press("Enter");
    await expect(dialog).toContainText("outcome is unknown");
    await dialog.getByRole("button", { name: "Close to recovery" }).click();
    await page.reload();
    const retained = page.getByRole("region", {
      name: "Finance submission recovery",
    });
    await expect(retained).toContainText("Accepted Income 2 CNY");
    await expect(
      page.getByRole("button", { name: "Record repayment", exact: true }),
    ).toBeDisabled();
    expect(backend.posts).toHaveLength(1);
    await axe(page);
    if (recovery === "lookup") {
      backend.resolveLookup();
      await retained.getByRole("button", { name: "Check outcome" }).click();
    } else
      await retained
        .getByRole("button", { name: "Retry original submission" })
        .click();
    await expect(
      retained.getByRole("link", { name: "Open Settlement" }),
    ).toBeVisible();
    if (recovery === "retry")
      expect(backend.posts).toEqual([backend.posts[0], backend.posts[0]]);
    else expect(backend.posts).toHaveLength(1);
    await retained.getByRole("link", { name: "Open Settlement" }).click();
    await expect(
      page.getByRole("region", { name: "Confirmed Settlement" }),
    ).toContainText("Accepted surplus Income");
    await axe(page);
    expect(errors).toEqual([]);
  });
}
