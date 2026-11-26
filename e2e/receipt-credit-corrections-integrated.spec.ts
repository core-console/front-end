import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { SettlementCorrectionResponse } from "../src/api/generated/schemas/index.ts";

const backend = process.env.FINANCE_T16B_TEST_BACKEND;
test.skip(!backend, "Requires the real Backend on guarded PostgreSQL.");
const money = (amount: string) => ({ amount, currency: "CNY" });

async function seedReceipt(request: APIRequestContext) {
  async function read(path: string) {
    const response = await request.get(`${backend}${path}`);
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  }
  const owner = (await read("/api/me")).id as string;
  async function create(path: string, data: object, version = "1") {
    const response = await request.post(`${backend}${path}`, {
      data,
      headers: {
        "Idempotency-Key": randomUUID(),
        "Finance-Command-Version": version,
        "Finance-Submission-Owner": owner,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()).outcome.resource.id as string;
  }
  async function confirm(path: string, data: object, version: string) {
    const preview = await request.post(`${backend}${path}/preview`, { data });
    expect(preview.status(), await preview.text()).toBe(200);
    return create(
      path,
      { ...data, previewToken: (await preview.json()).previewToken },
      version,
    );
  }

  const ledger = await create("/api/finance/ledgers", {
    name: `T16B ${randomUUID()}`,
  });
  const base = `/api/finance/ledgers/${ledger}`;
  const cash = await create(`${base}/accounts`, {
    name: "Receiving",
    nature: "asset",
    currency: "CNY",
    openingBalance: money("1000.00"),
    trackingStartDate: "2026-01-01",
  });
  const created = await request.post(`${backend}${base}/participants`, {
    data: { name: "Alex" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const person = (await created.json()).id as string;
  const settlements = `${base}/settlements`;
  const origin = await confirm(
    settlements,
    {
      participantId: person,
      receivingAccountId: cash,
      transactionDate: "2026-10-22",
      amount: money("30.00"),
      excessDisposition: "retainCredit",
    },
    "2",
  );
  const advance = await confirm(
    `${base}/advances`,
    {
      participantId: person,
      fundingAccountId: cash,
      transactionDate: "2026-10-23",
      amount: money("25.00"),
      ownerShare: money("0.00"),
      participantShare: money("25.00"),
    },
    "1",
  );
  const obligation = (await read(`${base}/advances/${advance}`)).obligation
    .id as string;
  const applyCredit = (amount: string) =>
    confirm(
      settlements,
      {
        kind: "creditApplication",
        participantId: person,
        selectedObligationIds: [obligation],
        transactionDate: "2026-10-24",
        amount: money(amount),
      },
      "7",
    );
  const application = await applyCredit("20.00");
  const source = await read(`${settlements}/${origin}`);
  return {
    read,
    confirm,
    applyCredit,
    base,
    cash,
    settlements,
    person,
    source,
    origin,
    application,
    advance,
    url: `/finance/repayments?ledger=${ledger}&participant_id=${person}&settlement_id=${origin}`,
    historyPath: `${settlements}/${origin}/corrections`,
  };
}

test("reviews preserved and released applied credit, reconfirms stale changes and recovers the committed correction", async ({
  page,
  context,
  request,
}) => {
  const seeded = await seedReceipt(request);
  const errors: string[] = [];
  const submissionIds: string[] = [];
  let stale = 0;
  let loseResponse = false;
  let responseLost = false;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (
      stale &&
      message.location().url.endsWith("/settlement-corrections") &&
      message.text() ===
        "Failed to load resource: the server responded with a status of 409 (Conflict)"
    )
      return;
    errors.push(message.text());
  });
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `${backend}${url.pathname}${url.search}`,
    });
    if (
      route.request().method() === "POST" &&
      url.pathname.endsWith("/settlement-corrections")
    ) {
      submissionIds.push(route.request().headers()["idempotency-key"]!);
      if (response.status() === 409) stale++;
      if (loseResponse && response.status() === 201) {
        const history = SettlementCorrectionResponse.array().parse(
          await seeded.read(seeded.historyPath),
        );
        expect(history).toHaveLength(2);
        expect(
          history[1]?.creditCorrection?.participantPosition
            .outstandingReceivablesAfter,
        ).toEqual(money("10.00"));
        await route.fulfill({ status: 201, json: {} });
        responseLost = true;
        return;
      }
    }
    await route.fulfill({ response });
  });

  await page.goto(seeded.url);
  const title = "Correct cash repayment";
  const open = page.getByRole("button", { name: title, exact: true });
  const dialog = page.getByRole("dialog", { name: title });
  const reason = dialog.getByLabel("Reason", { exact: true });
  const amount = dialog.getByLabel("Corrected cash receipt");
  const preview = dialog.getByRole("button", { name: "Preview Correction" });
  const confirm = dialog.getByRole("button", { name: "Confirm Correction" });
  const consequences = dialog.getByRole("region", {
    name: "Applied credit consequences",
  });
  const history = page.getByRole("region", {
    name: "Cash repayment Correction history",
  });
  const explanation = "Correct the amount on the original receipt";

  async function previewAmount(value: string) {
    await expect(open).toBeEnabled();
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(reason).toBeFocused();
    await reason.fill(explanation);
    await amount.fill(value);
    await dialog.getByLabel("Excess disposition").selectOption("retainCredit");
    await preview.click();
    await expect(confirm).toBeFocused();
  }
  await previewAmount("25.00");
  await expect(consequences).toContainText("Application preserved");
  await expect(consequences).toContainText(
    "Available from receipt 10.00 CNY → 5.00 CNY",
  );
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#finance-title")).toBeFocused();
  await expect(history).toContainText("Revision 1");
  await expect(history).toContainText("Application preserved");

  await previewAmount("15.00");
  await expect(consequences).toContainText("Released 5.00 CNY to reopen debt");
  const latest = await seeded.applyCredit("5.00");
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByText(/Request a fresh complete preview/),
  ).toBeVisible();
  await expect(reason).toBeFocused();
  await expect(reason).toHaveValue(explanation);
  await expect(amount).toHaveValue("15.00");
  await expect(confirm).toHaveCount(0);
  await expect.poll(() => seeded.read(seeded.historyPath)).toHaveLength(1);
  await preview.click();
  await expect(confirm).toBeFocused();
  const links = consequences.getByRole("link", { name: /Credit application/ });
  await expect(links).toHaveText([
    `Credit application ${latest}`,
    `Credit application ${seeded.application}`,
  ]);
  await expect(consequences).toContainText(
    "Participant outstanding receivables 0.00 CNY → 10.00 CNY",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  loseResponse = true;
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByText(/The original command is retained/),
  ).toBeVisible();
  await expect(confirm).toBeDisabled();
  await expect.poll(() => responseLost).toBe(true);
  await page.reload();
  await page
    .getByRole("status", { name: /Correction created.*Cash 15\.00 CNY/ })
    .getByRole("link", { name: "Open Cash repayment Correction history" })
    .click();
  await expect(history).toContainText("Revision 2");
  await expect(history).toContainText("Applied 20.00 CNY → 15.00 CNY");
  expect(stale).toBe(1);
  expect(submissionIds).toHaveLength(3);
  expect(new Set(submissionIds).size).toBe(3);

  const after = await seeded.read(`${seeded.settlements}/${seeded.origin}`);
  expect(after.confirmationOrder).toBe(seeded.source.confirmationOrder);
  expect(after.creditOrigin.transactionId).toBe(
    seeded.source.creditOrigin.transactionId,
  );
  expect(after.amount).toEqual(money("15.00"));
  expect(after.creditOrigin.available).toEqual(money("0.00"));
  const debt = (await seeded.read(`${seeded.base}/advances/${seeded.advance}`))
    .obligation;
  expect(debt.remaining).toEqual(money("10.00"));
  expect(debt.creditApplied).toEqual(money("15.00"));
  const accounts = await seeded.read(`${seeded.base}/accounts`);
  expect(accounts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: seeded.cash,
        currentBalance: money("990.00"),
      }),
      expect.objectContaining({
        id: after.creditOrigin.liabilityAccountId,
        currentBalance: money("0.00"),
      }),
      expect.objectContaining({
        id: debt.receivableAccountId,
        currentBalance: money("10.00"),
      }),
    ]),
  );
  const overview = await seeded.read(`${seeded.base}/overview?month=2026-10`);
  expect(overview.financialPositionByCurrency).toEqual([
    expect.objectContaining({
      assetTotal: money("1000.00"),
      liabilityTotal: money("0.00"),
    }),
  ]);
  expect(overview.monthSummaryByCurrency).toEqual([
    expect.objectContaining({ income: money("0.00"), expense: money("0.00") }),
  ]);

  const revision = history.getByRole("region", {
    name: "Cash Correction revision 2",
  });
  const balances = revision.getByRole("region", {
    name: "Affected Account balances",
  });
  await expect(balances.getByText(new RegExp(seeded.cash))).toContainText(
    "1,000.00 CNY → 990.00 CNY",
  );
  const detail = page.getByRole("region", { name: "Confirmed Settlement" });
  await expect(detail).toContainText("Cash received15.00 CNY");
  await detail
    .getByRole("link", {
      name: "Inspect current Participant debt and Settlement history",
    })
    .click();
  const positions = page.getByRole("table", {
    name: "Participant positions by currency",
  });
  await expect(positions.getByRole("row").last()).toContainText("10.00 CNY");
  const settlementHistory = page.getByRole("region", {
    name: "Settlement history",
  });
  await expect(
    settlementHistory.getByRole("link", {
      name: /Effective credit applied 0\.00 CNY · Originally applied 5\.00 CNY/,
    }),
  ).toHaveAttribute("href", new RegExp(`settlement_id=${latest}$`));
  await expect(
    settlementHistory.getByRole("link", {
      name: /Effective credit applied 15\.00 CNY · Originally applied 20\.00 CNY/,
    }),
  ).toHaveAttribute("href", new RegExp(`settlement_id=${seeded.application}$`));
  await revision
    .getByRole("link", { name: `Credit application ${seeded.application}` })
    .click();
  await expect(detail).toContainText("Originally applied credit20.00 CNY");
  await expect(detail).toContainText("Effective credit applied15.00 CNY");
  await expect(
    detail.getByRole("table", { name: "Confirmed Allocations" }),
  ).toContainText("Originally 20.00 CNY");
  expect(errors).toEqual([]);
});

test("blocks the correction on a receipt that has a real credit return", async ({
  page,
  context,
  request,
}) => {
  const seeded = await seedReceipt(request);
  await seeded.confirm(
    seeded.settlements,
    {
      kind: "creditReturn",
      participantId: seeded.person,
      payingAccountId: seeded.cash,
      transactionDate: "2026-10-25",
      amount: money("5.00"),
    },
    "8",
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      response: await route.fetch({
        url: `${backend}${url.pathname}${url.search}`,
      }),
    });
  });
  await page.goto(seeded.url);
  await expect(
    page.getByText(/Credit from this receipt has been returned/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Correct cash repayment", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Cash repayment Correction history" }),
  ).toContainText("No cash repayment Corrections recorded");
  expect(errors).toEqual([]);
});
