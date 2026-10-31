/// <reference lib="dom" />
import { AxeBuilder } from "@axe-core/playwright";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as account,
} from "../src/test/advance-fixtures.ts";
import {
  outstandingObligations,
  money,
} from "../src/test/settlement-fixtures.ts";
import {
  creditReturn,
  returnPreview,
  returnReceipt,
} from "../src/test/credit-return-fixtures.ts";
import { submissionTestUser } from "../src/test/submission-fixtures.ts";

async function api(
  context: BrowserContext,
  mode: "created" | "loss" | "stale" = "created",
) {
  const posts: { key: string; version: string; owner: string; body: string }[] =
    [];
  let committed = false;
  let previews = 0;
  const previewBodies: string[] = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    let body: unknown;
    let status = 200;
    if (path === "/api/me") body = submissionTestUser;
    else if (path === "/api/finance/ledgers") body = [ledger];
    else if (path.endsWith("/currencies"))
      body = [{ code: "CNY", minorUnit: 2 }];
    else if (path.endsWith("/accounts")) body = [account];
    else if (path.endsWith("/participants"))
      body = [{ ...person, status: "archived" }];
    else if (path.endsWith("/positions"))
      body = [
        {
          currency: "CNY",
          outstandingReceivables: money("100"),
          availableCredits: money(committed ? "25" : "50"),
          netExposure: money(committed ? "75" : "50"),
        },
      ];
    else if (path.endsWith("/credits")) body = [];
    else if (path.endsWith("/obligations")) body = outstandingObligations;
    else if (path.endsWith("/settlements/preview")) {
      previews++;
      previewBodies.push(request.postData()!);
      body = {
        ...returnPreview,
        previewToken: (previews === 1 ? "d" : "f").repeat(64),
      };
    } else if (path.includes("/submissions/"))
      body = {
        state: "unfinished",
        submissionId: path.split("/").at(-1),
        operation: "createFinanceSettlement",
        commandVersion: "8",
        targetLedgerId: ledger.id,
        admittedAt: creditReturn.confirmedAt,
      };
    else if (path.endsWith("/settlements") && request.method() === "POST") {
      const key = request.headers()["idempotency-key"]!;
      posts.push({
        key,
        version: request.headers()["finance-command-version"]!,
        owner: request.headers()["finance-submission-owner"]!,
        body: request.postData()!,
      });
      if (mode === "stale" && posts.length === 1) {
        const problem = {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "finance_settlement_preview_stale",
          detail: "Credit changed.",
        };
        body = {
          ...problem,
          submissionReceipt: {
            ...returnReceipt(key),
            outcome: { kind: "rejected", problem },
          },
        };
        status = 409;
      } else {
        committed = true;
        body = mode === "loss" && posts.length === 1 ? {} : returnReceipt(key);
        status = 201;
      }
    } else if (path.includes("/participants/") && path.endsWith("/settlements"))
      body = committed ? [creditReturn] : [];
    else if (path.endsWith(`/settlements/${creditReturn.id}`))
      body = creditReturn;
    else throw new Error(`Unhandled T11 request ${request.method()} ${path}`);
    await route.fulfill({ status, json: body });
  });
  return {
    posts,
    previewBodies,
    get committed() {
      return committed;
    },
  };
}
function errorsOn(page: Page, expectedConflict = false) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // Chromium reports our intentional 409 fixture as a resource error.
    if (
      expectedConflict &&
      message.text() ===
        "Failed to load resource: the server responded with a status of 409 (Conflict)"
    )
      return;
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
async function draft(page: Page) {
  await page.goto(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  await page
    .getByRole("button", { name: "Return credit", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Return credit" });
  await expect(dialog.getByLabel("Participant", { exact: true })).toBeFocused();
  await dialog
    .getByLabel("Paying Account", { exact: true })
    .selectOption(account.id);
  await dialog.getByLabel("Return date").fill("2026-10-29");
  await dialog.getByLabel("Return amount").fill("25");
  return dialog;
}

test("T11 keyboard preview, origin provenance, confirmed gross composition and axe at 1024px", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  const state = await api(context);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  await expect(
    page.getByRole("button", { name: "Return credit", exact: true }),
  ).toBeEnabled();
  await mkdir(".agent/t11/screenshots", { recursive: true });
  await page.screenshot({
    path: ".agent/t11/screenshots/before.png",
    fullPage: true,
  });
  const dialog = await draft(page);
  await axe(page);
  await dialog.getByRole("button", { name: "Preview credit return" }).click();
  await expect(
    dialog.getByRole("button", { name: "Confirm credit return" }),
  ).toBeFocused();
  const origins = dialog.getByRole("list", { name: "Consumed credit origins" });
  await expect(origins.getByRole("listitem").nth(0)).toContainText(
    "Consumed 20 CNY",
  );
  await expect(origins.getByRole("listitem").nth(1)).toContainText(
    "Available after 25 CNY",
  );
  await axe(page);
  await page.screenshot({
    path: ".agent/t11/screenshots/preview.png",
    fullPage: true,
  });
  await page.keyboard.press("Enter");
  const detail = page.getByRole("region", { name: "Confirmed Settlement" });
  await expect(
    detail.getByRole("list", { name: "Consumed credit origins" }),
  ).toBeVisible();
  await expect(detail).toContainText("Credit returned / Account outflow25 CNY");
  await expect(detail).not.toContainText("Cash received");
  await expect(page.locator("#finance-title")).toBeFocused();
  await axe(page);
  await page.screenshot({
    path: ".agent/t11/screenshots/confirmed.png",
    fullPage: true,
  });
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toMatchObject({
    version: "8",
    owner: submissionTestUser.id,
  });
  expect(errors).toEqual([]);
});
test("T11 Unicode boundary survives preview, response loss, reload and original-key retry", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  const state = await api(context, "loss");
  const dialog = await draft(page);
  const note = "\u0085" + "😀".repeat(500) + "\u0085";
  await dialog.getByLabel("Note", { exact: true }).fill(note);
  await dialog.getByRole("button", { name: "Preview credit return" }).click();
  await expect(
    dialog.getByRole("region", { name: "Credit return preview" }),
  ).toBeVisible();
  expect(state.previewBodies).toHaveLength(1);
  expect(JSON.parse(state.previewBodies[0]!).note).toBe(note);
  await dialog.getByRole("button", { name: "Confirm credit return" }).click();
  await expect(
    dialog.getByRole("button", { name: "Close to recovery" }),
  ).toBeVisible();
  await expect.poll(() => state.committed).toBe(true);
  await expect(dialog).toContainText("The original credit return is retained");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Return credit", exact: true }),
  ).toBeDisabled();
  const recovery = page.getByRole("region", {
    name: "Finance submission recovery",
  });
  await expect(recovery).toContainText("Credit return 25 CNY");
  await axe(page);
  await recovery
    .getByRole("button", { name: "Retry original submission" })
    .click();
  await expect(
    recovery.getByRole("link", { name: "Open Settlement" }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(JSON.parse(state.posts[0]!.body).note).toBe(note);
  expect(state.posts[1]).toEqual(state.posts[0]);
  await recovery.getByRole("link", { name: "Open Settlement" }).click();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Confirmed Settlement" })
      .getByRole("list", { name: "Consumed credit origins" }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(errors).toEqual([]);
});
test("T11 rejects 501 emoji without preview or altering the note", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  const state = await api(context);
  const dialog = await draft(page);
  const note = "\u0085" + "😀".repeat(501) + "\u0085";
  await dialog.getByLabel("Note", { exact: true }).fill(note);
  await dialog.getByRole("button", { name: "Preview credit return" }).click();
  await expect(
    dialog.getByText("Enter a note of at most 500 characters."),
  ).toBeVisible();
  await expect(dialog.getByLabel("Note", { exact: true })).toBeFocused();
  await expect(dialog.getByLabel("Note", { exact: true })).toHaveValue(note);
  await expect(
    dialog.getByRole("button", { name: "Confirm credit return" }),
  ).toHaveCount(0);
  expect(state.previewBodies).toEqual([]);
  expect(state.posts).toEqual([]);
  await axe(page);
  expect(errors).toEqual([]);
});

test("T11 stale preview preserves explicit intent and requires a new key and confirmation", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page, true);
  const state = await api(context, "stale");
  const dialog = await draft(page);
  await dialog.getByRole("button", { name: "Preview credit return" }).click();
  await dialog.getByRole("button", { name: "Confirm credit return" }).click();
  await expect(
    dialog.getByRole("button", { name: "Confirm credit return" }),
  ).toHaveCount(0);
  await expect(dialog.getByLabel("Return amount")).toHaveValue("25");
  await axe(page);
  await dialog.getByRole("button", { name: "Refresh preview" }).click();
  expect(state.posts).toHaveLength(1);
  await dialog.getByRole("button", { name: "Confirm credit return" }).click();
  await expect(
    page
      .getByRole("region", { name: "Confirmed Settlement" })
      .getByRole("list", { name: "Consumed credit origins" }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[1]!.key).not.toBe(state.posts[0]!.key);
  expect(errors).toEqual([]);
});

test("T11 pending command locks its draft and closes safely to recovery", async ({
  page,
  context,
}) => {
  const errors = errorsOn(page);
  await api(context);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = false;
  await context.route(
    `**/api/finance/ledgers/${ledger.id}/settlements`,
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      entered = true;
      await held;
      await route.fulfill({
        status: 201,
        json: returnReceipt(route.request().headers()["idempotency-key"]!),
      });
    },
  );
  const dialog = await draft(page);
  await dialog.getByRole("button", { name: "Preview credit return" }).click();
  await dialog.getByRole("button", { name: "Confirm credit return" }).click();
  await expect.poll(() => entered).toBe(true);
  await expect(dialog.getByLabel("Return amount")).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Preview credit return" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Confirming…" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Close to recovery" }).click();
  await expect(page.locator("#finance-title")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Return credit", exact: true }),
  ).toBeDisabled();
  release();
  await expect(
    page
      .getByRole("region", { name: "Finance submission recovery" })
      .getByRole("link", { name: "Open Settlement" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
