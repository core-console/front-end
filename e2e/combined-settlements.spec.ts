/// <reference lib="dom" />
import { AxeBuilder } from "@axe-core/playwright";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { CreateFinanceSettlementBody } from "../src/api/generated/schemas/index.ts";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as account,
} from "../src/test/advance-fixtures.ts";
import { submissionTestUser } from "../src/test/submission-fixtures.ts";
import {
  outstandingObligations,
  money,
} from "../src/test/settlement-fixtures.ts";
import {
  combinedSettlement,
  combinedPreview,
  combinedReceipt,
  combinedObligations,
} from "../src/test/combined-settlement-fixtures.ts";

function errorsOn(page: Page) {
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
  mode: "created" | "unknown" | "stale" = "created",
) {
  const posts: { key: string; owner: string; version: string; body: string }[] =
    [];
  const previews: unknown[] = [];
  let confirmed = false;
  let terminalLookup = false;
  let invalidReceipt = false;
  let sourceFails = false;
  let currentOwner = submissionTestUser.id;
  let hold: Promise<void> | undefined;
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown;
    let status = 200;
    if (path === "/api/me") body = { ...submissionTestUser, id: currentOwner };
    else if (path === "/api/finance/ledgers") body = [ledger];
    else if (path === "/api/finance/currencies")
      body = [{ code: "CNY", minorUnit: 2 }];
    else if (path.endsWith("/accounts")) body = [account];
    else if (path.endsWith("/participants"))
      body = [{ ...person, status: "archived" }];
    else if (path.endsWith("/positions") || path.endsWith("/credits"))
      body = [];
    else if (path.endsWith("/obligations"))
      body = confirmed ? combinedObligations : outstandingObligations;
    else if (path.includes("/participants/") && path.endsWith("/settlements"))
      body = confirmed ? [combinedSettlement] : [];
    else if (path.endsWith(`/settlements/${combinedSettlement.id}`))
      body = sourceFails ? {} : combinedSettlement;
    else if (path.includes("/submissions/")) {
      const key = path.split("/").at(-1)!;
      body = terminalLookup
        ? {
            state: "terminal",
            receipt: {
              ...combinedReceipt(key),
              commandVersion: invalidReceipt ? "4" : "6",
            },
          }
        : {
            state: "unfinished",
            submissionId: key,
            operation: "createFinanceSettlement",
            commandVersion: "6",
            targetLedgerId: ledger.id,
            admittedAt: combinedSettlement.confirmedAt,
          };
    } else if (path.endsWith("/settlements/preview")) {
      previews.push(request.postDataJSON());
      if (mode === "stale" && previews.length === 2) body = {};
      else
        body = {
          ...combinedPreview,
          previewToken: (previews.length === 1 ? "f" : "b").repeat(64),
        };
    } else if (path.endsWith("/settlements") && request.method() === "POST") {
      const key = request.headers()["idempotency-key"]!;
      const command = CreateFinanceSettlementBody.parse(request.postDataJSON());
      expect(command).toMatchObject({
        kind: "combined",
        reason: combinedSettlement.reason,
        selectedObligationIds: [
          ...combinedSettlement.selectedObligationIds,
        ].reverse(),
        amount: money("90"),
        forgivenessAmount: money("10"),
      });
      expect(command).toHaveProperty("receivingAccountId", account.id);
      expect(request.headers()["finance-command-version"]).toBe("6");
      expect(request.headers()["finance-submission-owner"]).toBe(
        submissionTestUser.id,
      );
      posts.push({
        key,
        owner: request.headers()["finance-submission-owner"]!,
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
          detail: "Selected debt changed.",
        };
        body = {
          ...problem,
          submissionReceipt: {
            ...combinedReceipt(key),
            outcome: { kind: "rejected", problem },
          },
        };
      } else {
        confirmed = true;
        status = 201;
        body = combinedReceipt(key);
      }
    } else
      throw new Error(`Unexpected API request: ${request.method()} ${path}`);
    await route.fulfill({ status, json: body });
  });
  return {
    posts,
    previews,
    resolveLookup: (invalid = false) => {
      terminalLookup = true;
      invalidReceipt = invalid;
      confirmed = !invalid;
    },
    failSource: () => {
      sourceFails = true;
    },
    changeOwner: (id: string) => {
      currentOwner = id;
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
  await page.goto(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  const trigger = page.getByRole("button", {
    name: "Record combined Settlement",
    exact: true,
  });
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Record combined Settlement",
  });
  await expect(dialog.getByLabel("Participant", { exact: true })).toBeFocused();
  await dialog.getByLabel("Receiving Account").selectOption(account.id);
  await dialog
    .getByLabel("Settlement date")
    .fill(combinedSettlement.transactionDate);
  await dialog
    .getByRole("checkbox", { name: new RegExp(outstandingObligations[1]!.id) })
    .focus();
  await page.keyboard.press("Space");
  await dialog
    .getByRole("checkbox", { name: new RegExp(outstandingObligations[0]!.id) })
    .focus();
  await page.keyboard.press("Space");
  await dialog.getByLabel("Cash received").fill("90");
  await dialog.getByLabel("Forgiveness amount").fill("10");
  await dialog.getByLabel("Reason").fill(combinedSettlement.reason);
  await dialog
    .getByRole("button", { name: "Preview combined Settlement" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Confirm combined Settlement" }),
  ).toBeFocused();
  return dialog;
}

test("explicit keyboard selection, preview, pending protection and cash and forgiveness history at 1024px", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  const backend = await api(context);
  await page.setViewportSize({ width: 1024, height: 900 });
  let dialog = await draft(page);
  await expect(dialog.getByLabel("Receiving Account")).toHaveValue(account.id);
  await expect(
    dialog.getByRole("columnheader", { name: "Cash paid", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("columnheader", { name: "Forgiven", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Expense increase", { exact: true }),
  ).toBeVisible();
  await axe(page);
  await mkdir(".tmp/t09", { recursive: true });
  await page.screenshot({
    path: ".tmp/t09/combined-preview-1024.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", {
      name: "Record combined Settlement",
      exact: true,
    }),
  ).toBeFocused();
  expect(backend.posts).toHaveLength(0);
  dialog = await draft(page);
  const release = backend.hold();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Confirming…" }),
  ).toBeDisabled();
  await expect(dialog.getByLabel("Reason")).toBeDisabled();
  await expect.poll(() => backend.posts.length).toBe(1);
  await page.keyboard.press("Enter");
  const command = { ...backend.posts[0]! };
  const review = dialog.getByRole("region", {
    name: "Combined Settlement preview",
  });
  const reviewedText = await review.textContent();
  for (const obligation of [...outstandingObligations].reverse()) {
    const selected = combinedSettlement.selectedObligationIds.includes(
      obligation.id,
    );
    const checkbox = dialog.getByRole("checkbox", {
      name: new RegExp(obligation.id),
    });
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).toBeChecked({ checked: selected });
    // Use physical pointer input: locator.click waits for disabled controls.
    for (const target of [
      checkbox,
      dialog.locator("label", { hasText: obligation.id }),
    ]) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expect(checkbox).toBeChecked({ checked: selected });
    }
    await expect(checkbox).toBeDisabled();
  }
  await expect(review).toHaveText(reviewedText!);
  await dialog.getByRole("button", { name: "Close to recovery" }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("checkbox").first()).not.toBeFocused();
  await expect(dialog.getByRole("checkbox").last()).not.toBeFocused();
  await axe(page);
  expect(backend.posts).toHaveLength(1);
  expect(backend.posts[0]).toEqual(command);
  release();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  const detail = page.getByRole("region", { name: "Confirmed Settlement" });
  await expect(
    detail.getByText(combinedSettlement.reason, { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByText("Cash received", { exact: true }),
  ).toBeVisible();
  await expect(
    detail
      .getByRole("link", { name: /linked cash \/ Expense Transaction/ })
      .first(),
  ).toBeVisible();
  const rows = page
    .getByRole("table", { name: "Participant receivable composition" })
    .getByRole("row");
  await expect(rows.nth(1)).toContainText("40.00 CNY");
  await expect(rows.nth(2)).toContainText("50.00 CNY");
  await expect(rows.nth(2)).toContainText("10.00 CNY");
  await expect(
    page.getByRole("region", { name: "Settlement history" }),
  ).toContainText("Cash received 90.00 CNY · Forgiven 10.00 CNY");
  await axe(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("reload retains the original v6 command and explicit retry sends identical bytes", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  const backend = await api(context, "unknown");
  const dialog = await draft(page);
  await dialog
    .getByRole("button", { name: "Confirm combined Settlement" })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Close to recovery" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close to recovery" }).click();
  await expect(
    page.getByRole("button", { name: "Retry original submission" }),
  ).toBeEnabled();
  expect(backend.posts).toHaveLength(1);
  await page.reload();
  const retry = page.getByRole("button", { name: "Retry original submission" });
  await expect(retry).toBeEnabled();
  await expect(
    page.getByRole("button", {
      name: "Record combined Settlement",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Finance submission recovery" }),
  ).toContainText(combinedSettlement.reason);
  await retry.click();
  await expect(
    page.getByRole("link", { name: "Open Settlement", exact: true }),
  ).toBeVisible();
  expect(backend.posts).toHaveLength(2);
  expect(backend.posts[1]).toEqual(backend.posts[0]);
  await page
    .getByRole("link", { name: "Open Settlement", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Confirmed Settlement" }),
  ).toContainText(combinedSettlement.reason);
  await axe(page);
  expect(errors).toEqual([]);
});

test("lookup rejects mismatched receipt versions and resolves without a new financial request", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  const backend = await api(context, "unknown");
  const dialog = await draft(page);
  await dialog
    .getByRole("button", { name: "Confirm combined Settlement" })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Close to recovery" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close to recovery" }).click();
  const check = page.getByRole("button", { name: "Check outcome" });
  await expect(check).toBeEnabled();
  backend.resolveLookup(true);
  await check.click();
  await expect(
    page.getByRole("button", { name: "Retry original submission" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("link", { name: "Open Settlement", exact: true }),
  ).toHaveCount(0);
  backend.resolveLookup();
  await check.click();
  await expect(
    page.getByRole("link", { name: "Open Settlement", exact: true }),
  ).toBeVisible();
  expect(backend.posts).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("stale rejection and failed refresh retain intent and require a new preview and confirmation", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  const backend = await api(context, "stale");
  const dialog = await draft(page);
  await dialog
    .getByRole("button", { name: "Confirm combined Settlement" })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Confirm combined Settlement" }),
  ).toHaveCount(0);
  await expect(dialog.getByLabel("Reason")).toHaveValue(
    combinedSettlement.reason,
  );
  await dialog.getByRole("button", { name: "Refresh preview" }).click();
  await expect(
    dialog.getByText(/Your combined Settlement intent is preserved/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirm combined Settlement" }),
  ).toHaveCount(0);
  expect(backend.posts).toHaveLength(1);
  await dialog
    .getByRole("button", { name: "Preview combined Settlement" })
    .click();
  const confirm = dialog.getByRole("button", {
    name: "Confirm combined Settlement",
  });
  await expect(confirm).toBeFocused();
  await confirm.click();
  await expect(dialog).toBeHidden();
  expect(backend.posts).toHaveLength(2);
  expect(backend.posts[0]!.key).not.toBe(backend.posts[1]!.key);
  expect(JSON.parse(backend.posts[1]!.body)).toMatchObject({
    previewToken: "b".repeat(64),
    reason: combinedSettlement.reason,
    selectedObligationIds: [
      ...combinedSettlement.selectedObligationIds,
    ].reverse(),
  });
  await axe(page);
  expect(errors).toEqual([
    "Failed to load resource: the server responded with a status of 409 (Conflict)",
  ]);
});

test("confirmed source-read failure keeps the receipt terminal and offers resource refresh", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  const backend = await api(context);
  backend.failSource();
  const dialog = await draft(page);
  await dialog
    .getByRole("button", { name: "Confirm combined Settlement" })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Refresh Settlement source" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Refresh Settlement source" }).click();
  await expect(
    page.getByRole("button", { name: "Retry original submission" }),
  ).toHaveCount(0);
  expect(backend.posts).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("another owner cannot see or recover the retained combined Settlement", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  const backend = await api(context, "unknown");
  const dialog = await draft(page);
  await dialog
    .getByRole("button", { name: "Confirm combined Settlement" })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Close to recovery" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close to recovery" }).click();
  await expect(
    page.getByRole("button", { name: "Retry original submission" }),
  ).toBeEnabled();
  expect(backend.posts).toHaveLength(1);
  backend.changeOwner("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Record combined Settlement",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Retry original submission" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Finance submission recovery" }),
  ).not.toContainText(combinedSettlement.reason);
  backend.changeOwner(submissionTestUser.id);
  backend.resolveLookup();
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Open Settlement", exact: true }),
  ).toBeVisible();
  expect(backend.posts).toHaveLength(1);
  expect(errors).toEqual([]);
});
