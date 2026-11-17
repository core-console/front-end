import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

const backend = process.env.FINANCE_T14_TEST_BACKEND;
test.skip(!backend, "Requires the guarded T14 PostgreSQL browser fixture.");
const money = (amount: string) => ({ amount, currency: "CNY" });

async function read(request: APIRequestContext, path: string) {
  const response = await request.get(`${backend}${path}`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

test("real backend and browser retain a released receipt as credit", async ({
  page,
  context,
  request,
}) => {
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
    name: `T14 ${randomUUID()}`,
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
    amount: money("200.00"),
    ownerShare: money("0.00"),
    participantShare: money("200.00"),
    note: null,
  };
  const advancePlan = await preview(`${base}/advances/preview`, advanceDraft);
  const advance = await create(`${base}/advances`, {
    ...advanceDraft,
    previewToken: advancePlan.previewToken,
  });
  const receipts = [];
  for (const amount of ["50.00", "30.00"]) {
    const draft = {
      participantId: participant,
      receivingAccountId: account,
      transactionDate: "2026-10-22",
      amount: money(amount),
      note: null,
    };
    const plan = await preview(`${base}/settlements/preview`, draft);
    receipts.push(
      await create(`${base}/settlements`, {
        ...draft,
        previewToken: plan.previewToken,
      }),
    );
  }
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
  await page.goto(`/finance/advances?ledger=${ledger}&advance_id=${advance}`);
  await page.getByRole("button", { name: "Correct Advance" }).click();
  const dialog = page.getByRole("dialog", { name: "Correct Advance" });
  await dialog.getByLabel("Reason").fill("Correct original participant share");
  await dialog.getByLabel("Owner share").fill("130.00");
  await dialog.getByLabel("Participant 1 share").fill("70.00");
  await dialog.getByRole("button", { name: "Preview Correction" }).click();
  const releases = dialog.getByRole("region", {
    name: "Released cash and credit origins",
  });
  await expect(releases).toContainText("10.00");
  await expect(
    releases.getByRole("link", { name: "Open originating receipt" }),
  ).toHaveAttribute("href", new RegExp(receipts[1]!));
  await dialog.getByRole("button", { name: "Confirm Correction" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Advance Correction history" }),
  ).toContainText("10.00");
  const history = await read(
    request,
    `${base}/advances/${advance}/corrections`,
  );
  expect(history).toHaveLength(1);
  expect(history[0].cashReleases[0].settlementId).toBe(receipts[1]);
  expect(history[0].after.obligations[0].cashPaid).toEqual(money("70.00"));
  expect(history[0].after.obligations[0].remaining).toEqual(money("0.00"));
  const positions = await read(
    request,
    `${base}/participants/${participant}/positions`,
  );
  expect(positions[0].outstandingReceivables).toEqual(money("0.00"));
  expect(positions[0].availableCredits).toEqual(money("10.00"));
  const accountRows = await read(request, `${base}/accounts`);
  expect(
    accountRows.find((a: { id: string }) => a.id === account).currentBalance,
  ).toEqual(money("880.00"));
  expect(
    (await read(request, `${base}/settlements/${receipts[1]}`)).amount,
  ).toEqual(money("30.00"));
  expect(errors).toEqual([]);
});
