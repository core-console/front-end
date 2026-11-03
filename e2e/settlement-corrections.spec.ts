/// <reference lib="dom" />
import { AxeBuilder } from "@axe-core/playwright";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  ledger,
  person,
  account as funding,
  receiptBefore as before,
  receiptAfter,
  receiptCorrection as correction,
  receiptCorrectionPreview as correctionPreview,
  receiptCorrectionReceipt as correctionReceipt,
} from "../src/test/settlement-correction-fixtures.ts";
import { submissionTestUser } from "../src/test/submission-fixtures.ts";
async function api(context: BrowserContext, mode = "created") {
  const posts: { key: string; owner: string; version: string; body: string }[] =
    [];
  let committed = false;
  let previews = 0;
  let lookupReady = false;
  await context.route("**/api/**", async (route) => {
    const r = route.request(),
      path = new URL(r.url()).pathname;
    let body: unknown;
    let status = 200;
    if (path === "/api/me") body = submissionTestUser;
    else if (path === "/api/finance/ledgers") body = [ledger];
    else if (path.endsWith("/currencies"))
      body = [{ code: "CNY", minorUnit: 2 }];
    else if (path.endsWith("/accounts")) body = [funding];
    else if (path.endsWith("/participants")) body = [person];
    else if (path.endsWith("/categories")) body = [];
    else if (path.endsWith("/corrections"))
      body = committed ? [correction] : [];
    else if (path.endsWith("/settlement-corrections/preview")) {
      previews++;
      body = {
        ...correctionPreview,
        reason: JSON.parse(r.postData()!).reason,
        previewToken: (previews === 1 ? "f" : "e").repeat(64),
      };
    } else if (
      path.endsWith("/settlement-corrections") &&
      r.method() === "POST"
    ) {
      const key = r.headers()["idempotency-key"]!;
      posts.push({
        key,
        version: r.headers()["finance-command-version"]!,
        owner: r.headers()["finance-submission-owner"]!,
        body: r.postData()!,
      });
      if (mode === "stale" && posts.length === 1) {
        const problem = {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "finance_settlement_correction_preview_stale",
          detail: "Facts changed.",
        };
        body = {
          ...problem,
          submissionReceipt: {
            ...correctionReceipt(key),
            outcome: { kind: "rejected", problem },
          },
        };
        status = 409;
      } else {
        committed = true;
        body =
          (mode === "loss" || mode === "lookup") && posts.length === 1
            ? {}
            : correctionReceipt(key);
        status = 201;
      }
    } else if (path.includes("/submissions/")) {
      const key = path.split("/").at(-1)!;
      body =
        mode === "lookup" && lookupReady
          ? { state: "terminal", receipt: correctionReceipt(key) }
          : {
              state: "unfinished",
              submissionId: key,
              operation: "createFinanceSettlementCorrection",
              commandVersion: "1",
              targetLedgerId: ledger.id,
              admittedAt: correction.confirmedAt,
            };
    } else if (path.endsWith(`/settlement-corrections/${correction.id}`))
      body = correction;
    else if (path.endsWith(`/settlements/${before.id}`))
      body = committed ? receiptAfter : before;
    else throw new Error(`Unhandled T13 ${r.method()} ${path}`);
    await route.fulfill({ status, json: body });
  });
  return {
    posts,
    revealTerminal: () => {
      lookupReady = true;
    },
    get previews() {
      return previews;
    },
  };
}
function errorsOn(page: Page, conflict = false) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      conflict &&
      m.text() ===
        "Failed to load resource: the server responded with a status of 409 (Conflict)"
    )
      return;
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}
async function axe(page: Page) {
  await page.locator("body").evaluate(async (b) => {
    await Promise.all(
      b
        .getAnimations({ subtree: true })
        .map((a) => a.finished.catch(() => undefined)),
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
async function draft(page: Page) {
  await page.goto(
    `/finance/repayments?ledger=${ledger.id}&settlement_id=${before.id}`,
  );
  await page
    .getByRole("button", { name: "Correct cash repayment", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Correct cash repayment",
    exact: true,
  });
  await expect(dialog.getByLabel("Reason", { exact: true })).toBeFocused();
  await dialog.getByLabel("Reason", { exact: true }).fill(correction.reason);
  await dialog
    .getByLabel("Corrected cash receipt", { exact: true })
    .fill("70.00");
  return dialog;
}
for (const width of [1024, 1280, 1600])
  test(`correction complete preview, explicit confirmation, retained history, keyboard and axe at ${width}px`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 1024 });
    const errors = errorsOn(page);
    const state = await api(context);
    const dialog = await draft(page);
    await mkdir(info.outputPath("shots"), { recursive: true });
    await page.screenshot({ path: info.outputPath("shots/before.png") });
    await dialog.getByRole("button", { name: "Preview Correction" }).click();
    await expect(
      dialog.getByRole("button", { name: "Confirm Correction" }),
    ).toBeFocused();
    expect(state.posts).toHaveLength(0);
    await expect(
      dialog.getByRole("region", { name: "Before receipt facts" }),
    ).toContainText("100.00 CNY");
    await axe(page);
    await page.screenshot({ path: info.outputPath("shots/preview.png") });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("region", { name: "Cash repayment Correction history" }),
    ).toContainText("Revision 1");
    await expect(page.locator("#finance-title")).toBeFocused();
    await axe(page);
    await page.screenshot({ path: info.outputPath("shots/history.png") });
    expect(state.posts).toHaveLength(1);
    expect(state.posts[0]!.version).toBe("1");
    expect(errors).toEqual([]);
  });
test("stale Correction preserves draft and requires refreshed preview and a new explicit confirmation", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page, true);
  const state = await api(context, "stale");
  const dialog = await draft(page);
  await dialog.getByRole("button", { name: "Preview Correction" }).click();
  await dialog.getByRole("button", { name: "Confirm Correction" }).click();
  await expect(
    dialog.getByText(/The original Correction was rejected/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirm Correction" }),
  ).toBeHidden();
  await expect(dialog.getByLabel("Reason", { exact: true })).toHaveValue(
    correction.reason,
  );
  await dialog.getByRole("button", { name: "Preview Correction" }).click();
  await expect(
    dialog.getByRole("button", { name: "Confirm Correction" }),
  ).toBeFocused();
  expect(state.posts).toHaveLength(1);
  await dialog.getByRole("button", { name: "Confirm Correction" }).click();
  await expect(dialog).toBeHidden();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0]!.key).not.toBe(state.posts[1]!.key);
  expect(state.previews).toBe(2);
  expect(errors).toEqual([]);
});

test("terminal lookup recovers a lost response without executing another command", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  const state = await api(context, "lookup");
  const dialog = await draft(page);
  await dialog.getByRole("button", { name: "Preview Correction" }).click();
  await dialog.getByRole("button", { name: "Confirm Correction" }).click();
  await expect(
    dialog.getByText(/The original command is retained/),
  ).toBeVisible();
  await dialog
    .locator("form")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByText(
      "The original submission is unfinished. Retry it explicitly to continue.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check outcome", exact: true }),
  ).toBeEnabled();
  state.revealTerminal();
  await page
    .getByRole("button", { name: "Check outcome", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Acknowledge outcome" }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("pending preview locks authored intent and Escape restores the invoker", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  await api(context);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route("**/settlement-corrections/preview", async (route) => {
    await held;
    await route.fulfill({ json: correctionPreview });
  });
  const dialog = await draft(page);
  await dialog.getByRole("button", { name: "Preview Correction" }).click();
  await expect(dialog.getByLabel("Reason", { exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Preview Correction" }),
  ).toBeDisabled();
  release();
  await expect(
    dialog.getByRole("button", { name: "Confirm Correction" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Correct cash repayment", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});
test("fresh page recovers original uncertain command through exact-key retry without duplicate Correction", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  const state = await api(context, "loss");
  const dialog = await draft(page);
  await dialog.getByRole("button", { name: "Preview Correction" }).click();
  await dialog.getByRole("button", { name: "Confirm Correction" }).click();
  await expect(
    dialog.getByText(/The original command is retained/),
  ).toBeVisible();
  await dialog
    .locator("form")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Correct cash repayment", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Check outcome" }).click();
  await expect(
    page.getByRole("button", { name: "Retry original submission" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry original submission" }).click();
  await expect(
    page.getByRole("button", { name: "Acknowledge outcome" }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0]).toEqual(state.posts[1]);
  await page
    .getByRole("link", { name: "Open Cash repayment Correction history" })
    .click();
  await expect(
    page.getByRole("region", { name: "Cash repayment Correction history" }),
  ).toContainText("Revision 1");
  expect(errors).toEqual([]);
});
