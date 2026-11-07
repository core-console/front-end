/// <reference lib="dom" />
import { AxeBuilder } from "@axe-core/playwright";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  ledger,
  person,
  funding,
  before,
  correction,
  correctionPreview,
  correctionReceipt,
} from "../src/test/advance-correction-fixtures.ts";
import { submissionTestUser } from "../src/test/submission-fixtures.ts";
async function api(
  context: BrowserContext,
  mode: "created" | "stale" | "lookup" | "manual" | "retry" = "created",
) {
  const posts: { key: string; owner: string; version: string; body: string }[] =
    [];
  let committed = false;
  let previews = 0;
  let terminalLookup = mode === "lookup";
  let lookups = 0;
  let completeResponseLoss!: () => void;
  const responseLoss = new Promise<void>((resolve) => {
    completeResponseLoss = resolve;
  });
  let releaseRetry!: () => void;
  const retryResponse = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
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
    else if (path.endsWith("/corrections"))
      body = committed ? [correction] : [];
    else if (path.endsWith("/advance-corrections/preview")) {
      previews++;
      const { reason, note } = JSON.parse(r.postData()!);
      body = {
        ...correctionPreview,
        reason,
        previewToken: (previews === 1 ? "f" : "e").repeat(64),
        ...(committed
          ? {
              before: correction.after,
              after: { ...correction.after, note },
              financialEffectsBefore: correction.financialEffectsAfter,
              financialEffectsAfter: correction.financialEffectsAfter.map(
                (effect) => ({ ...effect, note }),
              ),
              accountEffects: correction.accountEffects.map((effect) => ({
                ...effect,
                balanceBefore: effect.balanceAfter,
              })),
            }
          : {}),
      };
    } else if (path.endsWith("/advance-corrections") && r.method() === "POST") {
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
          code: "finance_advance_correction_preview_stale",
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
        if (mode !== "created" && mode !== "stale" && posts.length === 1) {
          await route.fulfill({ status: 201, json: {} });
          completeResponseLoss();
          return;
        }
        if (mode === "retry") await retryResponse;
        body = correctionReceipt(key);
        status = 201;
      }
    } else if (path.includes("/submissions/")) {
      const key = path.split("/").at(-1)!;
      lookups++;
      body = terminalLookup
        ? { state: "terminal", receipt: correctionReceipt(key) }
        : {
            state: "unfinished",
            submissionId: key,
            operation: "createFinanceAdvanceCorrection",
            commandVersion: "1",
            targetLedgerId: ledger.id,
            admittedAt: correction.confirmedAt,
          };
    } else if (path.endsWith(`/advance-corrections/${correction.id}`))
      body = correction;
    else if (path.endsWith(`/advances/${before.id}`))
      body = committed ? correction.after : before;
    else throw new Error(`Unhandled T12 ${r.method()} ${path}`);
    await route.fulfill({ status, json: body });
  });
  return {
    posts,
    responseLoss,
    releaseRetry,
    revealTerminal() {
      terminalLookup = true;
    },
    get lookups() {
      return lookups;
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
    `/finance/advances?ledger=${ledger.id}&advance_id=${before.id}`,
  );
  await page
    .getByRole("button", { name: "Correct Advance", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Correct Advance",
    exact: true,
  });
  await expect(dialog.getByLabel("Reason", { exact: true })).toBeFocused();
  await dialog.getByLabel("Reason", { exact: true }).fill(correction.reason);
  await dialog.getByLabel("Owner share", { exact: true }).fill("25.01");
  await dialog.getByRole("button", { name: "Remove Participant 1" }).click();
  await dialog
    .getByLabel("Original financial date", { exact: true })
    .fill("2026-10-20");
  await dialog.getByLabel("Note", { exact: true }).fill("");
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
      dialog.getByRole("region", { name: "Before correction facts" }),
    ).toContainText("25.01 CNY");
    await axe(page);
    await page.screenshot({ path: info.outputPath("shots/preview.png") });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("region", { name: "Advance Correction history" }),
    ).toContainText("Revision 1");
    await expect(
      page.getByRole("button", { name: "Correct Advance", exact: true }),
    ).toBeFocused();
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
for (const [mode, title] of [
  [
    "lookup",
    "fresh page automatically recovers the terminal Advance Correction",
  ],
  [
    "manual",
    "manual lookup resolves a deliberately unfinished Advance Correction",
  ],
  [
    "retry",
    "fresh page recovers original uncertain command through exact-key retry without duplicate Correction",
  ],
] as const)
  test(title, async ({ page, context }) => {
    const errors = errorsOn(page);
    const state = await api(context, mode);
    const dialog = await draft(page);
    await dialog.getByRole("button", { name: "Preview Correction" }).click();
    await dialog.getByRole("button", { name: "Confirm Correction" }).click();
    await expect(
      dialog.getByText(/The original command is retained/),
    ).toBeVisible();
    await state.responseLoss;
    await dialog
      .locator("form")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    const lookupsBeforeReload = state.lookups;
    await page.reload();

    const action = page.getByRole("button", {
      name: "Correct Advance",
      exact: true,
    });
    const journal = page.getByRole("region", {
      name: "Finance submission recovery",
    });
    const check = journal.getByRole("button", {
      name: "Check outcome",
      exact: true,
    });
    const retry = journal.getByRole("button", {
      name: "Retry original submission",
      exact: true,
    });
    if (mode !== "lookup") {
      await expect(journal).toContainText(
        "The original submission is unfinished. Retry it explicitly to continue.",
      );
      await expect(action).toBeDisabled();
      await expect(check).toBeEnabled();
      await expect(retry).toBeEnabled();
      expect(state.posts).toHaveLength(1);
    }
    if (mode === "manual") {
      const lookupsBeforeUnfinished = state.lookups;
      await check.click();
      await expect.poll(() => state.lookups).toBe(lookupsBeforeUnfinished + 1);
      await expect(check).toBeEnabled();
      await expect(action).toBeDisabled();
      expect(state.posts).toHaveLength(1);

      const lookupsBeforeClick = state.lookups;
      state.revealTerminal();
      await check.click();
      await expect.poll(() => state.lookups).toBe(lookupsBeforeClick + 1);
    }
    if (mode === "retry") {
      try {
        await retry.click();
        await expect.poll(() => state.posts.length).toBe(2);
        await expect(action).toBeDisabled();
        await expect(check).toBeDisabled();
        await expect(retry).toBeDisabled();
        expect(state.posts[1]).toEqual(state.posts[0]);
      } finally {
        state.releaseRetry();
      }
    }
    await expect(journal).toContainText("Advance Correction is confirmed");
    expect(state.lookups).toBeGreaterThan(lookupsBeforeReload);
    await expect(check).toHaveCount(0);
    await expect(retry).toHaveCount(0);
    const acknowledge = journal.getByRole("button", {
      name: "Acknowledge outcome",
      exact: true,
    });
    await expect(acknowledge).toBeEnabled();
    await expect(action).toBeEnabled();
    await journal
      .getByRole("link", { name: "Open Advance Correction history" })
      .click();
    const history = page.getByRole("region", {
      name: "Advance Correction history",
    });
    await expect(history).toContainText("Revision 1");

    await acknowledge.click();
    await expect(acknowledge).toHaveCount(0);
    await page.reload();
    await expect(history).toContainText("Revision 1");
    await expect(action).toBeEnabled();
    await expect(acknowledge).toHaveCount(0);
    const expectedPosts = mode === "retry" ? 2 : 1;
    await action.click();
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", {
      name: "Confirm Correction",
      exact: true,
    });
    await expect(confirm).toHaveCount(0);
    expect(state.posts).toHaveLength(expectedPosts);
    expect(state.previews).toBe(1);
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Review a new change");
    await dialog
      .getByLabel("Note", { exact: true })
      .fill("Updated purchase note");
    await dialog
      .getByRole("button", { name: "Preview Correction", exact: true })
      .click();
    await expect(confirm).toBeEnabled();
    expect(state.previews).toBe(2);
    expect(state.posts).toHaveLength(expectedPosts);
    expect(errors).toEqual([]);
  });
