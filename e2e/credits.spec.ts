/// <reference lib="dom" />
import { AxeBuilder } from "@axe-core/playwright";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { CreateFinanceSettlementBody } from "../src/api/generated/schemas/index.ts";
import {
  creditPreview,
  creditSettlement,
  creditReceipt,
  noDebtPreview,
} from "../src/test/credit-fixtures.ts";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as account,
  advancePreview,
  confirmedAdvance,
  createdAdvanceReceipt,
} from "../src/test/advance-fixtures.ts";
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
  options: {
    noDebt?: boolean;
    liability?: boolean;
    mode?: "stale" | "unknown";
    existingCredit?: boolean;
  } = {},
) {
  const posts: { key: string; body: string; version: string }[] = [];
  const advancePosts: unknown[] = [];
  const lookups: string[] = [];
  let confirmed = false;
  let lookupCreated = false;
  let advanceCreated = false;
  let previews = 0;
  let hold: Promise<void> | undefined;
  const origin = {
    ...creditSettlement.creditOrigin,
    ...(options.noDebt
      ? { amount: money("50.00"), available: money("50.00") }
      : {}),
  };
  const source = {
    ...creditSettlement,
    ...(options.noDebt
      ? {
          amount: money("50.00"),
          allocations: [],
          transactionIds: [origin.transactionId],
        }
      : {}),
    creditOrigin: origin,
  };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown;
    let status = 200;
    const resolved = confirmed || lookupCreated || options.existingCredit;
    const retained =
      options.mode === "stale" && previews > 1 ? "22.00" : "2.00";
    const currentOrigin = options.noDebt
      ? origin
      : { ...origin, amount: money(retained), available: money(retained) };
    const currentSource = {
      ...source,
      creditOrigin: currentOrigin,
      allocations:
        options.mode === "stale" && previews > 1
          ? source.allocations.map((item, index) => ({
              ...item,
              cashPaid: money(index === 0 ? "40.00" : "40.00"),
            }))
          : source.allocations,
    };
    if (path === "/api/me") body = submissionTestUser;
    else if (path === "/api/finance/ledgers") body = [ledger];
    else if (path === "/api/finance/currencies")
      body = [{ code: "CNY", minorUnit: 2 }];
    else if (path.endsWith("/accounts"))
      body = [
        { ...account, nature: options.liability ? "liability" : "asset" },
      ];
    else if (path.endsWith("/participants"))
      body = [
        { ...person, status: options.existingCredit ? "active" : "archived" },
      ];
    else if (path.endsWith("/positions"))
      body = [
        {
          currency: "CNY",
          outstandingReceivables: money(
            advanceCreated
              ? "25.01"
              : options.noDebt || resolved
                ? "0.00"
                : "100.00",
          ),
          availableCredits: money(
            resolved ? (options.noDebt ? "50.00" : retained) : "0.00",
          ),
          netExposure: money(
            advanceCreated
              ? "23.01"
              : resolved
                ? options.noDebt
                  ? "-50.00"
                  : `-${retained}`
                : options.noDebt
                  ? "0.00"
                  : "100.00",
          ),
        },
      ];
    else if (path.endsWith("/credits")) body = resolved ? [currentOrigin] : [];
    else if (path.endsWith("/obligations"))
      body = options.noDebt
        ? []
        : resolved
          ? [
              ...outstandingObligations.map((item, index) => ({
                ...item,
                cashPaid: money(index === 0 ? "40.00" : "60.00"),
                remaining: money("0.00"),
              })),
              ...(advanceCreated ? [confirmedAdvance.obligation] : []),
            ]
          : outstandingObligations;
    else if (path.includes("/participants/") && path.endsWith("/settlements"))
      body = resolved ? [currentSource] : [];
    else if (path.endsWith(`/settlements/${source.id}`)) body = currentSource;
    else if (path.endsWith("/advances/preview")) body = advancePreview;
    else if (path.endsWith(`/advances/${confirmedAdvance.id}`))
      body = confirmedAdvance;
    else if (path.endsWith("/advances") && request.method() === "POST") {
      advancePosts.push(request.postDataJSON());
      expect(request.headers()["finance-command-version"]).toBe("1");
      advanceCreated = true;
      status = 201;
      body = createdAdvanceReceipt(request.headers()["idempotency-key"]!);
    } else if (path.includes("/submissions/")) {
      const key = path.split("/").at(-1)!;
      lookups.push(key);
      body = lookupCreated
        ? { state: "terminal", receipt: creditReceipt(key) }
        : {
            state: "unfinished",
            submissionId: key,
            operation: "createFinanceSettlement",
            commandVersion: "2",
            targetLedgerId: ledger.id,
            admittedAt: "2026-10-22T00:00:00Z",
          };
    } else if (path.endsWith("/settlements/preview")) {
      expect(request.postDataJSON().excessDisposition).toBe("retainCredit");
      previews++;
      body = {
        ...(options.noDebt ? noDebtPreview : creditPreview),
        ...(options.noDebt
          ? {
              availableCreditBefore: money("0.00"),
              availableCreditAfter: money("50.00"),
            }
          : {}),
        ...(options.liability ? { receivingBalanceAfter: money("50.00") } : {}),
        previewToken: (previews === 1 ? "a" : "b").repeat(64),
        ...(options.mode === "stale" && previews > 1
          ? {
              retainedCredit: money("22.00"),
              availableCreditAfter: money("22.00"),
              outstandingBefore: money("80.00"),
            }
          : {}),
      };
    } else if (path.endsWith("/settlements") && request.method() === "POST") {
      const parsed = CreateFinanceSettlementBody.parse(request.postDataJSON());
      expect(parsed).toHaveProperty("excessDisposition", "retainCredit");
      expect(request.headers()["finance-command-version"]).toBe("2");
      expect(request.headers()["finance-submission-owner"]).toBe(
        submissionTestUser.id,
      );
      const key = request.headers()["idempotency-key"]!;
      posts.push({
        key,
        body: request.postData()!,
        version: request.headers()["finance-command-version"]!,
      });
      if (hold) await hold;
      status = 201;
      if (options.mode === "unknown" && posts.length === 1) body = {};
      else if (options.mode === "stale" && posts.length === 1) {
        status = 409;
        const problem = {
          type: "about:blank",
          title: "Conflict",
          status,
          code: "finance_settlement_preview_stale",
          detail: "Changed credit consequences.",
        };
        body = {
          ...problem,
          submissionReceipt: {
            ...creditReceipt(key),
            outcome: { kind: "rejected", problem },
          },
        };
      } else {
        confirmed = true;
        body = creditReceipt(key);
      }
    } else
      throw new Error(`Unexpected API request: ${request.method()} ${path}`);
    await route.fulfill({ status, json: body });
  });
  return {
    posts,
    advancePosts,
    lookups,
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
async function draft(page: Page, amount = "102") {
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
  await dialog.getByLabel("Amount", { exact: true }).fill(amount);
  await dialog.getByLabel("Date", { exact: true }).fill("2027-01-02");
  const choice = dialog.getByLabel("Surplus handling");
  await expect(choice).toHaveValue("repayOnly");
  await choice.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Tab");
  await expect(choice).toHaveValue("retainCredit");
  await dialog.getByRole("button", { name: "Preview repayment" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toBeFocused();
  return dialog;
}

test("keyboard retain-credit choice, pending guard and gross positions at 1024px", async ({
  page,
  context,
}, testInfo) => {
  const errors = captureErrors(page);
  const backend = await api(context);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  const dialog = await draft(page);
  await expect(dialog).toContainText("Retained credit Liability");
  await expect(dialog).toContainText("2.00 CNY");
  await axe(page);
  await testInfo.attach("retained-surplus-preview-1024", {
    body: await page.screenshot({
      path: ".tmp/t05/retained-surplus-preview-1024.png",
    }),
    contentType: "image/png",
  });
  const release = backend.hold();
  try {
    await page.keyboard.press("Enter");
    await expect.poll(() => backend.posts.length).toBe(1);
    await expect(dialog.getByLabel("Surplus handling")).toBeDisabled();
    await page.keyboard.press("Enter");
    expect(backend.posts).toHaveLength(1);
  } finally {
    release();
  }
  const source = page.getByRole("region", { name: "Confirmed Settlement" });
  await expect(source).toContainText("102.00 CNY");
  await expect(source).toContainText("Retained credit Liability");
  await expect(
    page.getByRole("list", { name: "Receipt-backed credit origins" }),
  ).toContainText("Available 2.00 CNY");
  await expect(
    page.getByRole("table", { name: "Participant positions by currency" }),
  ).toContainText("-2.00 CNY");
  await expect(
    page.getByRole("table", { name: "Participant receivable composition" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await axe(page);
  await testInfo.attach("retained-surplus-confirmed-1024", {
    body: await page.screenshot({
      path: ".tmp/t05/retained-surplus-confirmed-1024.png",
      fullPage: true,
    }),
    contentType: "image/png",
  });
  expect(errors).toEqual([]);
});

test("no-debt receipt shows full receiving Liability reduction and credit without fictitious debt at 1280px", async ({
  page,
  context,
}, testInfo) => {
  const errors = captureErrors(page);
  await api(context, { noDebt: true, liability: true });
  await page.setViewportSize({ width: 1280, height: 1024 });
  await page.goto(`/finance/repayments?ledger=${ledger.id}`);
  const dialog = await draft(page, "50");
  await expect(dialog).toContainText("Receiving Liability decreases");
  await expect(dialog).toContainText("No eligible debt is paid");
  await axe(page);
  await testInfo.attach("no-debt-preview-1280", {
    body: await page.screenshot({ path: ".tmp/t05/no-debt-preview-1280.png" }),
    contentType: "image/png",
  });
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Confirmed Settlement" }),
  ).toContainText("50.00 CNY");
  await expect(
    page.getByText("No receivables for this Participant", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Receipt-backed credit origins" }),
  ).toContainText("Available 50.00 CNY");
  await axe(page);
  expect(errors).toEqual([]);
});

for (const recovery of ["lookup", "retry"] as const) {
  test(`version 2 lost response survives reload and ${recovery} retains the original identity`, async ({
    page,
    context,
  }) => {
    const errors = captureErrors(page);
    const backend = await api(context, { mode: "unknown" });
    await page.goto(`/finance/repayments?ledger=${ledger.id}`);
    const dialog = await draft(page);
    await page.keyboard.press("Enter");
    await expect(dialog).toContainText("outcome is unknown");
    await dialog.getByRole("button", { name: "Close to recovery" }).click();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Record repayment", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Retry original submission" }),
    ).toBeEnabled();
    expect(backend.posts).toHaveLength(1);
    if (recovery === "lookup") {
      backend.resolveLookup();
      await page.getByRole("button", { name: "Check outcome" }).click();
    } else
      await page
        .getByRole("button", { name: "Retry original submission" })
        .click();
    await page.getByRole("link", { name: "Open Settlement" }).click();
    await expect(
      page.getByRole("region", { name: "Confirmed Settlement" }),
    ).toContainText("Retained credit Liability");
    expect(backend.posts).toHaveLength(recovery === "lookup" ? 1 : 2);
    if (recovery === "retry")
      expect(backend.posts[1]).toEqual(backend.posts[0]);
    await axe(page);
    expect(errors).toEqual([]);
  });
}

test("stale credit preview retains choice and requires another reviewed confirmation with a fresh identity", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const backend = await api(context, { mode: "stale" });
  await page.goto(`/finance/repayments?ledger=${ledger.id}`);
  const dialog = await draft(page);
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Refresh preview" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Participant", { exact: true })).toBeFocused();
  await expect(dialog.getByLabel("Surplus handling")).toHaveValue(
    "retainCredit",
  );
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Refresh preview" }).click();
  await expect(dialog).toContainText("22.00 CNY");
  expect(backend.posts).toHaveLength(1);
  await axe(page);
  await dialog.getByRole("button", { name: "Confirm repayment" }).click();
  await expect(
    page.getByRole("region", { name: "Confirmed Settlement" }),
  ).toBeVisible();
  expect(backend.posts[1]!.key).not.toBe(backend.posts[0]!.key);
  expect(
    backend.posts.map((item) => JSON.parse(item.body).previewToken),
  ).toEqual(["a".repeat(64), "b".repeat(64)]);
  expect(errors).toEqual([
    "Failed to load resource: the server responded with a status of 409 (Conflict)",
  ]);
});

test("creating another Advance leaves receipt-backed credit unapplied", async ({
  page,
  context,
}) => {
  const errors = captureErrors(page);
  const backend = await api(context, { existingCredit: true });
  await page.goto(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  await expect(
    page.getByRole("table", { name: "Participant positions by currency" }),
  ).toContainText("-2.00 CNY");
  await page.goto(`/finance/advances?ledger=${ledger.id}`);
  await page
    .getByRole("button", { name: "Record Advance", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Record pure Advance" });
  await dialog
    .getByLabel("Participant", { exact: true })
    .selectOption(person.id);
  await dialog.getByLabel("Funding Asset Account").selectOption(account.id);
  await dialog.getByLabel("Amount", { exact: true }).fill("25.01");
  await dialog.getByLabel("Date", { exact: true }).fill("2027-01-02");
  await dialog.getByLabel("Note", { exact: true }).fill("Travel cash");
  await dialog
    .getByRole("button", { name: "Preview Advance", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm Advance", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Confirmed Advance" }),
  ).toContainText("Travel cash");
  expect(backend.advancePosts).toHaveLength(1);
  expect(backend.advancePosts[0]).not.toHaveProperty("creditApplied");
  expect(backend.posts).toEqual([]);
  await page.goto(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  await expect(
    page.getByRole("list", { name: "Receipt-backed credit origins" }),
  ).toContainText("Available 2.00 CNY");
  await expect(
    page.getByRole("table", { name: "Participant positions by currency" }),
  ).toContainText("23.01 CNY");
  await axe(page);
  expect(errors).toEqual([]);
});
