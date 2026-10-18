/// <reference lib="dom" />
import { AxeBuilder } from "@axe-core/playwright";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as funding,
  advancePreview as preview,
  confirmedAdvance as advance,
  createdAdvanceReceipt,
} from "../src/test/advance-fixtures.ts";
import { submissionTestUser } from "../src/test/submission-fixtures.ts";
import { CreateFinanceAdvanceBody } from "../src/api/generated/schemas/index.ts";

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
  mode: "created" | "unknown" | "stale" = "created",
) {
  const posts: { key: string; body: CreateFinanceAdvanceBody }[] = [];
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
      body = [
        {
          ...funding,
          currentBalance: confirmed
            ? preview.fundingBalanceAfter
            : funding.currentBalance,
        },
      ];
    else if (path.endsWith("/participants"))
      body = [{ ...person, status: lookupCreated ? "archived" : "active" }];
    else if (path.endsWith("/obligations"))
      body = confirmed || lookupCreated ? [advance.obligation] : [];
    else if (path.endsWith(`/advances/${advance.id}`)) body = advance;
    else if (path.includes("/submissions/")) {
      const key = path.split("/").at(-1)!;
      body = lookupCreated
        ? { state: "terminal", receipt: createdAdvanceReceipt(key) }
        : {
            state: "unfinished",
            submissionId: key,
            operation: "createFinanceAdvance",
            commandVersion: "1",
            targetLedgerId: ledger.id,
            admittedAt: "2026-10-18T00:00:00Z",
          };
    } else if (path.endsWith("/advances/preview")) {
      previews++;
      body = {
        ...preview,
        previewToken: (previews === 1 ? "a" : "b").repeat(64),
      };
    } else if (path.endsWith("/advances") && request.method() === "POST") {
      const key = request.headers()["idempotency-key"]!;
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
      expect(request.headers()["finance-submission-owner"]).toBe(
        submissionTestUser.id,
      );
      expect(request.headers()["finance-command-version"]).toBe("1");
      posts.push({
        key,
        body: CreateFinanceAdvanceBody.parse(request.postDataJSON()),
      });
      if (hold) await hold;
      status = 201;
      if (mode === "unknown" && posts.length === 1) body = {};
      else if (mode === "stale" && posts.length === 1) {
        // The HTTP payload carries terminal evidence; a generic conflict would remain unknown.
        const problem = {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "finance_advance_preview_stale",
          detail: "Changed preview.",
        };
        status = 409;
        body = {
          ...problem,
          submissionReceipt: {
            ...createdAdvanceReceipt(key),
            outcome: { kind: "rejected", problem },
          },
        };
      } else {
        confirmed = true;
        body = createdAdvanceReceipt(key);
      }
    } else
      throw new Error(`Unexpected API request: ${request.method()} ${path}`);
    await route.fulfill({ status, json: body });
  });
  return {
    posts,
    getPreviews: () => previews,
    resolveLookup: () => {
      lookupCreated = true;
    },
    holdConfirmation: () => {
      let release: () => void = () => undefined;
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
async function fillDraft(page: Page) {
  const record = page.getByRole("button", {
    name: "Record Advance",
    exact: true,
  });
  await expect(record).toBeEnabled();
  await record.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Record pure Advance" });
  await expect(dialog.getByLabel("Participant", { exact: true })).toBeFocused();
  await dialog
    .getByLabel("Participant", { exact: true })
    .selectOption(person.id);
  await dialog.getByLabel("Funding Asset Account").selectOption(funding.id);
  await dialog.getByLabel("Amount", { exact: true }).fill("25.01");
  await dialog.getByLabel("Date", { exact: true }).fill("2027-01-02");
  await dialog.getByLabel("Note", { exact: true }).fill("Travel cash");
  await dialog
    .getByRole("button", { name: "Preview Advance", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Confirm Advance", exact: true }),
  ).toBeFocused();
  return dialog;
}

test("pure Advance preview, confirmation and composition support keyboard and axe at desktop widths", async ({
  page,
  context,
}, testInfo) => {
  const errors = captureErrors(page);
  const state = await api(context);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`/finance/advances?ledger=${ledger.id}`);
  await expect(
    page.getByRole("heading", { name: "Advances", exact: true }),
  ).toBeVisible();
  await axe(page);
  let dialog = await fillDraft(page);
  await expect(dialog).toHaveJSProperty(
    "scrollWidth",
    await dialog.evaluate((element) => element.clientWidth),
  );
  await expect(dialog.getByText("74.99 CNY", { exact: true })).toBeVisible();
  await axe(page);
  await page.screenshot({
    path: testInfo.outputPath("advance-preview-1024.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Record Advance", exact: true }),
  ).toBeFocused();
  expect(state.posts).toHaveLength(0);
  dialog = await fillDraft(page);
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  const source = page.getByRole("region", { name: "Confirmed Advance source" });
  await expect(source.getByText("Travel cash", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Participant receivable composition" }),
  ).toBeVisible();
  await axe(page);
  expect(state.posts).toHaveLength(1);
  await page.screenshot({
    path: testInfo.outputPath("advance-confirmed-1024.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 1024 });
  await axe(page);
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 1280);
  await page.reload();
  await expect(source.getByText(advance.id, { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("pending confirmation cannot duplicate and stale rejection requires renewed preview and a new deliberate action", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const state = await api(context, "stale");
  await page.goto(`/finance/advances?ledger=${ledger.id}`);
  const dialog = await fillDraft(page);
  const release = state.holdConfirmation();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Confirming…" }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect.poll(() => state.posts.length).toBe(1);
  release();
  await expect(
    dialog.getByRole("button", { name: "Refresh preview", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue(
    "25.01",
  );
  expect(state.getPreviews()).toBe(1);
  await axe(page);
  await dialog
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Confirm Advance", exact: true }),
  ).toBeFocused();
  expect(state.posts).toHaveLength(1);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Confirmed Advance source" }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[1]!.key).not.toBe(state.posts[0]!.key);
  expect(state.posts.map((post) => post.body.previewToken)).toEqual([
    "a".repeat(64),
    "b".repeat(64),
  ]);
  expect(errors).toEqual([
    "Failed to load resource: the server responded with a status of 409 (Conflict)",
  ]);
});

test("response loss recovers the original action after reload and Participant archive without another POST", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const state = await api(context, "unknown");
  await page.goto(`/finance/advances?ledger=${ledger.id}`);
  const dialog = await fillDraft(page);
  await page.keyboard.press("Enter");
  await expect(dialog.getByText(/outcome is unknown/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close to recovery" }).click();
  await expect(
    page.getByRole("button", { name: "Record Advance", exact: true }),
  ).toBeDisabled();
  await axe(page);
  state.resolveLookup();
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Open Advance", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open Advance", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Confirmed Advance source" })
      .getByText(/Alex \(archived\)/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry original submission" }),
  ).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
  await axe(page);
  expect(errors).toEqual([]);
});
