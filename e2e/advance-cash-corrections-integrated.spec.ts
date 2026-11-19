import { AxeBuilder } from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";

const backend = process.env.FINANCE_T14_TEST_BACKEND;
test.skip(!backend, "Requires the guarded PostgreSQL browser fixture.");
const money = (amount: string) => ({ amount, currency: "CNY" });

async function read(request: APIRequestContext, path: string) {
  const response = await request.get(`${backend}${path}`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function seedAdvance(request: APIRequestContext, label: string) {
  const owner = (await read(request, "/api/me")).id as string;
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
  async function preview(path: string, data: object) {
    const response = await request.post(`${backend}${path}`, { data });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  }
  const ledger = await create("/api/finance/ledgers", {
    name: `${label} ${randomUUID()}`,
  });
  const base = `/api/finance/ledgers/${ledger}`;
  const account = await create(`${base}/accounts`, {
    name: "Checking",
    nature: "asset",
    currency: "CNY",
    openingBalance: money("1000.00"),
    trackingStartDate: "2026-01-01",
  });
  const participantResponse = await request.post(
    `${backend}${base}/participants`,
    { data: { name: "Alex" } },
  );
  expect(participantResponse.status()).toBe(201);
  const participant = (await participantResponse.json()).id as string;
  const advanceDraft = {
    fundingAccountId: account,
    participantId: participant,
    transactionDate: "2026-10-20",
    amount: money("100.00"),
    ownerShare: money("0.00"),
    participantShare: money("100.00"),
    note: null,
  };
  const advancePlan = await preview(`${base}/advances/preview`, advanceDraft);
  const advance = await create(`${base}/advances`, {
    ...advanceDraft,
    previewToken: advancePlan.previewToken,
  });
  const source = await read(request, `${base}/advances/${advance}`);
  return {
    ledger,
    base,
    account,
    participant,
    advance,
    obligation: source.obligation.id as string,
    create,
    preview,
  };
}

async function proxyBackend(page: Page, context: BrowserContext) {
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
  return errors;
}

test("real backend and browser show accepted Income and released Credit on one receipt", async ({
  page,
  context,
  request,
}) => {
  const { ledger, base, account, participant, advance, create, preview } =
    await seedAdvance(request, "T14");
  const draft = {
    participantId: participant,
    receivingAccountId: account,
    transactionDate: "2026-10-22",
    amount: money("102.00"),
    note: null,
    excessDisposition: "acceptIncome",
    categoryAllocations: [{ amount: money("2.00") }],
  };
  const plan = await preview(`${base}/settlements/preview`, draft);
  const receiptId = await create(
    `${base}/settlements`,
    { ...draft, previewToken: plan.previewToken },
    "3",
  );
  const errors = await proxyBackend(page, context);
  await page.goto(`/finance/advances?ledger=${ledger}&advance_id=${advance}`);
  await page.getByRole("button", { name: "Correct Advance" }).click();
  const dialog = page.getByRole("dialog", { name: "Correct Advance" });
  await dialog.getByLabel("Reason").fill("Correct original participant share");
  await dialog.getByLabel("Owner share").fill("30.00");
  await dialog.getByLabel("Participant 1 share").fill("70.00");
  await dialog.getByRole("button", { name: "Preview Correction" }).click();
  const releases = dialog.getByRole("region", {
    name: "Released cash and credit origins",
  });
  await expect(releases).toContainText("30.00");
  await expect(
    releases.getByRole("link", { name: "Open originating receipt" }),
  ).toHaveAttribute("href", new RegExp(receiptId));
  await dialog.getByRole("button", { name: "Confirm Correction" }).click();
  await expect(dialog).toBeHidden();
  const correctionHistory = page.getByRole("region", {
    name: "Advance Correction history",
  });
  await expect(correctionHistory).toContainText("30.00");
  const history = await read(
    request,
    `${base}/advances/${advance}/corrections`,
  );
  expect(history).toHaveLength(1);
  const release = history[0].cashReleases[0];
  expect(release.settlementId).toBe(receiptId);
  expect(history[0].after.obligations[0].cashPaid).toEqual(money("70.00"));
  expect(history[0].after.obligations[0].remaining).toEqual(money("0.00"));
  const positions = await read(
    request,
    `${base}/participants/${participant}/positions`,
  );
  expect(positions[0].outstandingReceivables).toEqual(money("0.00"));
  expect(positions[0].availableCredits).toEqual(money("30.00"));
  const accountRows = await read(request, `${base}/accounts`);
  expect(
    accountRows.find((a: { id: string }) => a.id === account).currentBalance,
  ).toEqual(money("1002.00"));
  await correctionHistory
    .getByRole("link", { name: "Open originating receipt" })
    .click();
  const receipt = page.getByRole("region", { name: "Confirmed Settlement" });
  await expect(receipt.getByText("102.00 CNY", { exact: true })).toBeVisible();
  await expect(receipt.getByRole("cell", { name: "70.00 CNY" })).toBeVisible();
  await expect(
    receipt.getByRole("cell", { name: "0.00 CNY", exact: true }),
  ).toBeVisible();
  await expect(receipt.getByText("2.00 CNY", { exact: true })).toBeVisible();
  await expect(
    receipt.getByText("Released Credit", { exact: true }).locator(".."),
  ).toContainText("30.00 CNY");
  const creditTransfer = receipt.getByRole("link", {
    name: /View released Credit Internal Transfer/,
  });
  await expect(creditTransfer).toHaveAttribute(
    "href",
    `/finance/transactions/${release.financialEffect.transactionId}?ledger=${ledger}`,
  );
  expect(errors).toEqual([]);
});

test("corrects an Advance after a combined Settlement through the owner workflow", async ({
  page,
  context,
  request,
}) => {
  const {
    ledger,
    base,
    account,
    participant,
    advance,
    obligation,
    create,
    preview,
  } = await seedAdvance(request, "T15A");
  const settlementDraft = {
    kind: "combined",
    participantId: participant,
    receivingAccountId: account,
    transactionDate: "2026-11-01",
    amount: money("60.00"),
    forgivenessAmount: money("40.00"),
    reason: "Waive the remaining twenty plus the recorded error",
    selectedObligationIds: [obligation],
  };
  const plan = await preview(`${base}/settlements/preview`, settlementDraft);
  const settlementId = await create(
    `${base}/settlements`,
    { ...settlementDraft, previewToken: plan.previewToken },
    "6",
  );
  const errors = await proxyBackend(page, context);
  await page.goto(`/finance/advances?ledger=${ledger}&advance_id=${advance}`);
  await page.getByRole("button", { name: "Correct Advance" }).click();
  const dialog = page.getByRole("dialog", { name: "Correct Advance" });
  await dialog
    .getByLabel("Reason")
    .fill("Correct original share after forgiveness");
  await dialog.getByLabel("Owner share").fill("20.00");
  await dialog.getByLabel("Participant 1 share").fill("80.00");
  await dialog.getByRole("button", { name: "Preview Correction" }).click();

  const expenses = dialog.getByRole("region", {
    name: "Forgiveness Expense restatements",
  });
  await expect(expenses).toContainText("2026-11-01 · 40.00 CNY → 20.00 CNY");
  await expect(
    dialog.getByRole("region", { name: "After correction facts" }),
  ).toContainText("Cash paid 60.00 CNY · Forgiven 20.00 CNY");
  await expect(
    dialog.getByRole("region", { name: "After correction facts" }),
  ).toContainText("Owner purchase Expense: 20.00 CNY");
  await expect(dialog.getByText("No Credit released.")).toBeVisible();
  expect(
    await read(request, `${base}/advances/${advance}/corrections`),
  ).toEqual([]);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  const confirm = dialog.getByRole("button", { name: "Confirm Correction" });
  await expect(confirm).toBeFocused();
  await confirm.press("Enter");
  await expect(dialog).toBeHidden();

  const history = page.getByRole("region", {
    name: "Advance Correction history",
  });
  await expect(history).toContainText("40.00 CNY → 20.00 CNY");
  await expect(history).toContainText("Remaining 0.00 CNY");
  const [position] = await read(
    request,
    `${base}/participants/${participant}/positions`,
  );
  expect(position.outstandingReceivables).toEqual(money("0.00"));
  expect(position.availableCredits).toEqual(money("0.00"));
  for (const month of ["2026-10", "2026-11"]) {
    const overview = await read(request, `${base}/overview?month=${month}`);
    expect(overview.monthSummaryByCurrency[0].expense).toEqual(money("20.00"));
  }
  const origin = history.getByRole("link", {
    name: "Open originating Settlement",
  });
  await expect(origin).toHaveAttribute("href", new RegExp(settlementId));
  await origin.click();
  const detail = page.getByRole("region", { name: "Confirmed Settlement" });
  await expect(
    detail.getByRole("cell", { name: "60.00 CNY", exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("cell", { name: /20.00 CNY.*Originally 40.00 CNY/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
