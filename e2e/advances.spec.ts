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
  sharedParticipant,
  cardFunding,
  sharedPreview,
  sharedAdvance,
  sharedAdvanceReceipt,
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
  shared = false,
) {
  const version = shared ? "2" : "1";
  const receipt = shared ? sharedAdvanceReceipt : createdAdvanceReceipt;
  const source = shared ? sharedAdvance : advance;
  const effects = shared ? sharedPreview : preview;
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
          ...(shared ? cardFunding : funding),
          currentBalance: confirmed
            ? effects.fundingBalanceAfter
            : funding.currentBalance,
        },
      ];
    else if (path.endsWith("/participants"))
      body = (shared ? [person, sharedParticipant] : [person]).map((item) => ({
        ...item,
        status: lookupCreated ? "archived" : "active",
      }));
    else if (path.endsWith("/obligations"))
      body =
        confirmed || lookupCreated
          ? shared
            ? sharedAdvance.obligations.filter((item) =>
                path.includes(item.participantId),
              )
            : [advance.obligation]
          : [];
    else if (path.endsWith(`/advances/${advance.id}`)) body = source;
    else if (path.includes("/submissions/")) {
      const key = path.split("/").at(-1)!;
      body = lookupCreated
        ? { state: "terminal", receipt: receipt(key) }
        : {
            state: "unfinished",
            submissionId: key,
            operation: "createFinanceAdvance",
            commandVersion: version,
            targetLedgerId: ledger.id,
            admittedAt: "2026-10-18T00:00:00Z",
          };
    } else if (path.endsWith("/advances/preview")) {
      previews++;
      body = {
        ...effects,
        previewToken: (previews === 1 ? "a" : "b").repeat(64),
      };
    } else if (path.endsWith("/advances") && request.method() === "POST") {
      const key = request.headers()["idempotency-key"]!;
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
      expect(request.headers()["finance-submission-owner"]).toBe(
        submissionTestUser.id,
      );
      expect(request.headers()["finance-command-version"]).toBe(version);
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
            ...receipt(key),
            outcome: { kind: "rejected", problem },
          },
        };
      } else {
        confirmed = true;
        body = receipt(key);
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

async function fillSharedDraft(page: Page) {
  const record = page.getByRole("button", {
    name: "Record shared purchase",
    exact: true,
  });
  await expect(record).toBeEnabled();
  await record.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Record shared purchase" });
  await expect(
    dialog.getByLabel("Participant 1", { exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel("Participant 1", { exact: true })
    .selectOption(person.id);
  await dialog.getByLabel("Participant 1 share", { exact: true }).fill("120");
  await dialog
    .getByRole("button", { name: "Add Participant", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByLabel("Participant 2", { exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel("Participant 2", { exact: true })
    .selectOption(sharedParticipant.id);
  await dialog.getByLabel("Participant 2 share", { exact: true }).fill("80");
  await dialog.getByLabel("Owner share", { exact: true }).fill("100");
  await dialog
    .getByLabel("Funding Account", { exact: true })
    .selectOption(cardFunding.id);
  await dialog.getByLabel("Amount", { exact: true }).fill("300");
  await dialog.getByLabel("Date", { exact: true }).fill("2027-01-02");
  await dialog.getByLabel("Note", { exact: true }).fill("Shared purchase");
  await dialog
    .getByRole("button", { name: "Preview Advance", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Confirm Advance", exact: true }),
  ).toBeFocused();
  return dialog;
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

for (const shared of [false, true]) {
  const fill = shared ? fillSharedDraft : fillDraft;
  const triggerName = shared ? "Record shared purchase" : "Record Advance";
  const note = shared ? "Shared purchase" : "Travel cash";
  test(`${shared ? "shared" : "pure"} Advance preview, confirmation and composition support keyboard and axe at desktop widths`, async ({
    page,
    context,
  }, testInfo) => {
    const errors = captureErrors(page);
    const state = await api(context, "created", shared);
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`/finance/advances?ledger=${ledger.id}`);
    await expect(
      page.getByRole("heading", { name: "Advances", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: triggerName, exact: true }),
    ).toBeEnabled();
    await axe(page);
    await page.screenshot({
      path: testInfo.outputPath("advances-before-1024.png"),
      fullPage: true,
    });
    let dialog = await fill(page);
    await expect(dialog).toHaveJSProperty(
      "scrollWidth",
      await dialog.evaluate((element) => element.clientWidth),
    );
    await expect(
      dialog.getByText(shared ? "400.00 CNY" : "74.99 CNY", { exact: true }),
    ).toBeVisible();
    if (shared) {
      await expect(
        dialog.getByText(/Liability increases by 300 CNY/),
      ).toBeVisible();
      await expect(dialog.getByText(/Alex.*120.00 CNY/)).toBeVisible();
      await expect(dialog.getByText(/Blair.*80.00 CNY/)).toBeVisible();
    }
    await axe(page);
    await page.screenshot({
      path: testInfo.outputPath("advance-preview-1024.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: triggerName, exact: true }),
    ).toBeFocused();
    expect(state.posts).toHaveLength(0);
    dialog = await fill(page);
    await page.keyboard.press("Enter");
    await expect(dialog).not.toBeVisible();
    const source = page.getByRole("region", {
      name: "Confirmed Advance source",
    });
    await expect(source.getByText(note, { exact: true })).toBeVisible();
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

  test(`${shared ? "shared" : "pure"} pending confirmation cannot duplicate and stale rejection requires renewed preview and a new deliberate action`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const state = await api(context, "stale", shared);
    await page.goto(`/finance/advances?ledger=${ledger.id}`);
    const dialog = await fill(page);
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
      shared ? "300" : "25.01",
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

  test(`${shared ? "shared" : "pure"} response loss recovers the original action after reload and Participant archive without another POST`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const state = await api(context, "unknown", shared);
    await page.goto(`/finance/advances?ledger=${ledger.id}`);
    const dialog = await fill(page);
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
}
