/// <reference lib="dom" />
import { AxeBuilder } from "@axe-core/playwright";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as account,
} from "../src/test/advance-fixtures.ts";
import {
  repaymentPreview as preview,
  settlement,
  settlementReceipt,
  outstandingObligations,
  repaidObligations,
  money,
} from "../src/test/settlement-fixtures.ts";
import { submissionTestUser } from "../src/test/submission-fixtures.ts";
import { CreateFinanceSettlementBody } from "../src/api/generated/schemas/index.ts";

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
  liability = false,
) {
  const posts: { key: string; body: CreateFinanceSettlementBody }[] = [];
  const lookups: string[] = [];
  const admitted = new Set<string>();
  let confirmed = false;
  let previews = 0;
  let lookupCreated = false;
  let hold: Promise<void> | undefined;
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown;
    let status = 200;
    if (path === "/api/me") body = submissionTestUser;
    else if (path === "/api/finance/ledgers") body = [ledger];
    else if (path === "/api/finance/currencies")
      body = [{ code: "CNY", minorUnit: 2 }];
    else if (path.endsWith("/accounts"))
      body = [{ ...account, nature: liability ? "liability" : "asset" }];
    else if (path.endsWith("/participants"))
      body = [{ ...person, status: "archived" }];
    else if (path.endsWith("/obligations"))
      body =
        confirmed || lookupCreated ? repaidObligations : outstandingObligations;
    else if (path.endsWith(`/settlements/${settlement.id}`)) body = settlement;
    else if (path.includes("/participants/") && path.endsWith("/settlements"))
      body = confirmed || lookupCreated ? [settlement] : [];
    else if (path.includes("/submissions/")) {
      const key = path.split("/").at(-1)!;
      lookups.push(key);
      if (!admitted.has(key)) {
        status = 404;
        body = {
          type: "about:blank",
          title: "Not Found",
          status,
          code: "finance_submission_not_found",
        };
      } else
        body = lookupCreated
          ? {
              state: "terminal",
              receipt: settlementReceipt(path.split("/").at(-1)!),
            }
          : {
              state: "unfinished",
              submissionId: path.split("/").at(-1),
              operation: "createFinanceSettlement",
              commandVersion: "1",
              targetLedgerId: ledger.id,
              admittedAt: "2026-10-20T00:00:00Z",
            };
    } else if (path.endsWith("/settlements/preview")) {
      previews++;
      body = {
        ...preview,
        previewToken: (previews === 1 ? "a" : "b").repeat(64),
        receivingBalanceAfter: money(liability ? "50.00" : "150.00"),
      };
    } else if (path.endsWith("/settlements") && request.method() === "POST") {
      const key = request.headers()["idempotency-key"]!;
      expect(request.headers()["finance-command-version"]).toBe("1");
      expect(request.headers()["finance-submission-owner"]).toBe(
        submissionTestUser.id,
      );
      posts.push({
        key,
        body: CreateFinanceSettlementBody.parse(request.postDataJSON()),
      });
      if (hold) await hold;
      admitted.add(key);
      status = 201;
      if (mode === "unknown" && posts.length === 1) body = {};
      else if (mode === "stale" && posts.length === 1) {
        const problem = {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "finance_settlement_preview_stale",
          detail: "Changed preview.",
        };
        status = 409;
        body = {
          ...problem,
          submissionReceipt: {
            ...settlementReceipt(key),
            outcome: { kind: "rejected", problem },
          },
        };
      } else {
        confirmed = true;
        body = settlementReceipt(key);
      }
    } else
      throw new Error(`Unexpected API request: ${request.method()} ${path}`);
    await route.fulfill({ status, json: body });
  });
  return {
    posts,
    lookups,
    previews: () => previews,
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
  const record = page.getByRole("button", {
    name: "Record repayment",
    exact: true,
  });
  await expect(record).toBeEnabled();
  await record.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Record repayment" });
  await expect(dialog.getByLabel("Participant", { exact: true })).toBeFocused();
  await dialog
    .getByLabel("Participant", { exact: true })
    .selectOption(person.id);
  await dialog
    .getByLabel("Receiving Account", { exact: true })
    .selectOption(account.id);
  await dialog.getByLabel("Amount", { exact: true }).fill("50");
  await dialog.getByLabel("Date", { exact: true }).fill("2027-01-02");
  await dialog.getByLabel("Note", { exact: true }).fill("Cash repayment");
  await dialog.getByRole("button", { name: "Preview repayment" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toBeFocused();
  return dialog;
}

test("keyboard preview, discard, pending double-confirm guard and retained cash composition at 1024px", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const backend = await api(context);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`/finance/repayments?ledger=${ledger.id}`);
  let dialog = await draft(page);
  await expect(
    dialog.getByRole("table", { name: "Proposed Allocations" }),
  ).toContainText("40.00 CNY");
  await expect(dialog.getByRole("table")).toContainText("10.00 CNY");
  await axe(page);
  await dialog.screenshot({ path: ".tmp/t04-preview-1024.png" });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Record repayment" }),
  ).toBeFocused();
  expect(backend.posts).toHaveLength(0);
  dialog = await draft(page);
  const release = backend.hold();
  await page.keyboard.press("Enter");
  await expect.poll(() => backend.posts.length).toBe(1);
  await expect(dialog.getByLabel("Amount", { exact: true })).toBeDisabled();
  await page.keyboard.press("Enter");
  expect(backend.posts).toHaveLength(1);
  release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Confirmed Settlement" }),
  ).toContainText("Cash repayment");
  await expect(
    page.getByRole("table", { name: "Participant receivable composition" }),
  ).toContainText("50.00 CNY");
  await expect(
    page.getByRole("heading", { name: "Repayments", exact: true }),
  ).toBeFocused();
  await axe(page);
  await page.screenshot({ path: ".tmp/t04-result-1024.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("stale terminal evidence preserves intent and requires refreshed review with a new identity", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const backend = await api(context, "stale");
  await page.goto(`/finance/repayments?ledger=${ledger.id}`);
  const dialog = await draft(page);
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Refresh preview" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toHaveCount(0);
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("50");
  await expect(dialog.getByLabel("Participant", { exact: true })).toBeFocused();
  expect(backend.previews()).toBe(1);
  expect(backend.posts).toHaveLength(1);
  await axe(page);
  await dialog.getByRole("button", { name: "Refresh preview" }).click();
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toBeFocused();
  expect(backend.posts).toHaveLength(1);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Confirmed Settlement" }),
  ).toContainText(settlement.id);
  expect(backend.posts[0]!.key).not.toBe(backend.posts[1]!.key);
  expect(backend.posts.map((item) => item.body.previewToken)).toEqual([
    "a".repeat(64),
    "b".repeat(64),
  ]);
  expect(backend.lookups).toEqual([]);
  expect(errors).toEqual([
    "Failed to load resource: the server responded with a status of 409 (Conflict)",
  ]);
});
for (const recovery of ["retry", "lookup"] as const) {
  test(`uncertain result survives reload; ${recovery} preserves original action and retained history`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const backend = await api(context, "unknown");
    await page.goto(`/finance/repayments?ledger=${ledger.id}`);
    const dialog = await draft(page);
    await page.keyboard.press("Enter");
    await expect(dialog).toContainText("outcome is unknown");
    await expect(dialog.getByLabel("Amount", { exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Close to recovery" }).click();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Record repayment", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Retry original submission" }),
    ).toBeEnabled();
    expect(backend.posts).toHaveLength(1);
    await axe(page);
    if (recovery === "lookup") {
      backend.resolveLookup();
      await page.getByRole("button", { name: "Check outcome" }).click();
    } else
      await page
        .getByRole("button", { name: "Retry original submission" })
        .click();
    await expect(
      page.getByRole("link", { name: "Open Settlement" }),
    ).toBeVisible();
    if (recovery === "retry") {
      expect(backend.posts).toHaveLength(2);
      expect(backend.posts[1]).toEqual(backend.posts[0]);
    } else expect(backend.posts).toHaveLength(1);
    await page.getByRole("link", { name: "Open Settlement" }).click();
    await expect(
      page.getByRole("table", { name: "Confirmed Allocations" }),
    ).toContainText("10.00 CNY");
    await expect(
      page.getByRole("table", { name: "Participant receivable composition" }),
    ).toContainText("50.00 CNY");
    await axe(page);
    expect(errors).toEqual([]);
  });
}
test("receiving into a Liability shows reduction and field precision errors preserve focus", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  await api(context, "created", true);
  await page.goto(`/finance/repayments?ledger=${ledger.id}`);
  const dialog = await draft(page);
  await expect(dialog).toContainText("Receiving Liability decreases");
  await dialog.getByLabel("Amount", { exact: true }).fill("98.000");
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Preview repayment" }).click();
  await expect(dialog.getByLabel("Amount", { exact: true })).toBeFocused();
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await axe(page);
  expect(errors).toEqual([]);
});
