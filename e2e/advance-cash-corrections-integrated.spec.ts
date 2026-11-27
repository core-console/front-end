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

async function seedAdvance(
  request: APIRequestContext,
  label: string,
  principal = "100.00",
) {
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
    amount: money(principal),
    ownerShare: money("0.00"),
    participantShare: money(principal),
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

for (const kind of ["Advance", "receipt"] as const) {
  test(`corrects a returned Credit origin through the ${kind} workflow`, async ({
    page,
    context,
    request,
  }) => {
    const { ledger, base, account, participant, advance, create, preview } =
      await seedAdvance(request, "Returned Credit");
    const settle = async (data: object, version = "1") =>
      create(
        `${base}/settlements`,
        {
          ...data,
          previewToken: (await preview(`${base}/settlements/preview`, data))
            .previewToken,
        },
        version,
      );
    const cash = {
      participantId: participant,
      receivingAccountId: account,
      transactionDate: "2026-10-22",
    };
    await settle({ ...cash, amount: money("20.00") });
    const origin = await settle(
      { ...cash, amount: money("100.00"), excessDisposition: "retainCredit" },
      "2",
    );
    const returnCredit = (amount: string) =>
      settle(
        {
          kind: "creditReturn",
          participantId: participant,
          payingAccountId: account,
          transactionDate: "2026-10-29",
          amount: money(amount),
        },
        "8",
      );
    const returnId = await returnCredit("15.00");
    const path = `${base}/settlements/${returnId}`;
    const returnBefore = await read(request, path);
    const advanceCorrection = kind === "Advance";
    const target = advanceCorrection
      ? `${base}/advances/${advance}/corrections`
      : `${base}/settlements/${origin}/corrections`;
    const correctionEndpoint = advanceCorrection
      ? "/advance-corrections"
      : "/settlement-corrections";
    const errors: string[] = [];
    const submissions: string[] = [];
    let stale = false;
    let committed = false;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !(
          stale &&
          message.location().url.endsWith(correctionEndpoint) &&
          message.text() ===
            "Failed to load resource: the server responded with a status of 409 (Conflict)"
        )
      )
        errors.push(message.text());
    });
    await context.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: `${backend}${url.pathname}${url.search}`,
      });
      if (
        route.request().method() === "POST" &&
        url.pathname.endsWith(correctionEndpoint)
      ) {
        submissions.push(route.request().headers()["idempotency-key"]!);
        if (response.status() === 409) stale = true;
        if (response.status() === 201) {
          expect(await read(request, target)).toHaveLength(1);
          await route.fulfill({ status: 201, json: {} });
          committed = true;
          return;
        }
      }
      await route.fulfill({ response });
    });

    await page.goto(
      advanceCorrection
        ? `/finance/advances?ledger=${ledger}&advance_id=${advance}`
        : `/finance/repayments?ledger=${ledger}&participant_id=${participant}&settlement_id=${origin}`,
    );
    const title = advanceCorrection
      ? "Correct Advance"
      : "Correct cash repayment";
    const trigger = page.getByRole("button", { name: title, exact: true });
    await expect(trigger).toBeEnabled();
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: title });
    const reason = dialog.getByLabel("Reason", { exact: true });
    await expect(reason).toBeFocused();
    await reason.fill("Correct the recorded original amount");
    if (advanceCorrection) {
      await dialog.getByLabel("Owner share").fill("10.00");
      await dialog.getByLabel("Participant 1 share").fill("90.00");
    } else {
      await dialog.getByLabel("Corrected cash receipt").fill("90.00");
      await dialog
        .getByLabel("Excess disposition")
        .selectOption("retainCredit");
    }
    const previewButton = dialog.getByRole("button", {
      name: "Preview Correction",
    });
    const confirmButton = dialog.getByRole("button", {
      name: "Confirm Correction",
    });
    await previewButton.click();
    await expect(confirmButton).toBeFocused();
    await expect(
      dialog.getByRole("link", { name: /Return of 15.00 CNY/ }),
    ).toBeVisible();
    const secondReturn = await returnCredit("5.00");
    const secondPath = `${base}/settlements/${secondReturn}`;
    const secondBefore = await read(request, secondPath);
    await confirmButton.press("Enter");
    await expect(
      dialog.getByText(/The original Correction was rejected/),
    ).toBeVisible();
    await expect(confirmButton).toHaveCount(0);
    expect(await read(request, target)).toEqual([]);

    await previewButton.click();
    await expect(confirmButton).toBeFocused();
    await expect(
      dialog.getByRole("link", { name: /Return of 5.00 CNY/ }),
    ).toBeVisible();
    if (advanceCorrection) {
      await expect(
        dialog.getByRole("region", {
          name: "Credit origin with actual returns",
        }),
      ).toContainText("Available Credit 0.00 CNY → 10.00 CNY");
    } else {
      await expect(
        dialog.getByRole("region", {
          name: "Credit applications and actual returns",
        }),
      ).toContainText(
        "Reduce direct cash Allocations by 10.00 CNY to preserve the actual returns",
      );
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);

    await confirmButton.press("Enter");
    await expect(
      dialog.getByText(/The original command is retained/),
    ).toBeVisible();
    await expect.poll(() => committed).toBe(true);
    await page.reload();
    const history = page.getByRole("region", {
      name: advanceCorrection
        ? "Advance Correction history"
        : "Cash repayment Correction history",
    });
    await expect(
      history.getByRole("link", { name: /Return of 5.00 CNY/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Finance submission recovery" }),
    ).toContainText(/Correction (is confirmed|created)/);
    expect(new Set(submissions).size).toBe(2);
    expect(await read(request, target)).toHaveLength(1);
    expect(await read(request, path)).toEqual(returnBefore);
    expect(await read(request, secondPath)).toEqual(secondBefore);
    const [position] = await read(
      request,
      `${base}/participants/${participant}/positions`,
    );
    expect(position.outstandingReceivables).toEqual(
      money(advanceCorrection ? "0.00" : "10.00"),
    );
    expect(position.availableCredits).toEqual(
      money(advanceCorrection ? "10.00" : "0.00"),
    );
    expect(errors).toEqual([]);
  });
}

test("shows direct cash released and zero remaining debt when forgiveness is corrected", async ({
  page,
  context,
  request,
}) => {
  const { ledger, base, account, participant, obligation, create, preview } =
    await seedAdvance(request, "Returned Credit with forgiveness", "40.00");
  const confirm = async (resource: string, data: object, version: string) => {
    const path = `${base}/${resource}`;
    const plan = await preview(`${path}/preview`, data);
    return create(path, { ...data, previewToken: plan.previewToken }, version);
  };
  const origin = await confirm(
    "settlements",
    {
      kind: "combined",
      participantId: participant,
      receivingAccountId: account,
      transactionDate: "2026-10-22",
      amount: money("30.00"),
      forgivenessAmount: money("5.00"),
      selectedObligationIds: [obligation],
      reason: "Recorded original forgiveness",
    },
    "6",
  );
  await confirm(
    "settlement-corrections",
    {
      settlementId: origin,
      amount: money("60.00"),
      forgivenessAmount: money("0.00"),
      excessDisposition: "retainCredit",
      categoryId: null,
      reason: "Restate original receipt with retained Credit",
    },
    "2",
  );
  const returned = await confirm(
    "settlements",
    {
      kind: "creditReturn",
      participantId: participant,
      payingAccountId: account,
      transactionDate: "2026-10-29",
      amount: money("20.00"),
    },
    "8",
  );
  const returnPath = `${base}/settlements/${returned}`;
  const actualReturn = await read(request, returnPath);
  const errors = await proxyBackend(page, context);
  await page.goto(
    `/finance/repayments?ledger=${ledger}&participant_id=${participant}&settlement_id=${origin}`,
  );
  await page
    .getByRole("button", { name: "Correct combined Settlement" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Correct combined Settlement",
  });
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Correct cash and forgiveness");
  await dialog.getByLabel("Corrected cash receipt").fill("50.00");
  await dialog.getByLabel("Corrected forgiveness").fill("10.00");
  const disposition = dialog.getByLabel("Excess disposition");
  await disposition.selectOption("none");
  await dialog.getByRole("button", { name: "Preview Correction" }).click();

  async function expectConsequences(container: ReturnType<Page["getByRole"]>) {
    const lifecycle = container.getByRole("region", {
      name: "Credit applications and actual returns",
    });
    await expect(
      lifecycle.getByText(
        "Reduce direct cash Allocations by 10.00 CNY to preserve the actual returns.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      lifecycle.getByRole("link", { name: /Return of 20.00 CNY/ }),
    ).toBeVisible();
    const after = container.getByRole("region", {
      name: "After Settlement facts",
    });
    await expect(after.getByText(/Principal 40.00 CNY/)).toContainText(
      "Cash paid 30.00 CNY · Forgiven 10.00 CNY · Credit applied 0.00 CNY · Remaining 0.00 CNY",
    );
    await expect(
      container.getByText("Excess disposition No uncommitted excess"),
    ).toBeVisible();
  }

  await expectConsequences(dialog);
  await expect(
    disposition.getByRole("option", { name: "No uncommitted excess" }),
  ).toBeAttached();
  await dialog.getByRole("button", { name: "Confirm Correction" }).click();
  await expect(dialog).toBeHidden();
  await expectConsequences(
    page.getByRole("region", { name: "Settlement Correction revision 2" }),
  );
  expect(await read(request, returnPath)).toEqual(actualReturn);
  expect(errors).toEqual([]);
});

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

test("restores applied Credit after a stale preview and recovers a committed Correction", async ({
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
  } = await seedAdvance(request, "T16A");
  const confirm = async (path: string, draft: object, version = "1") =>
    create(
      `${base}/${path}`,
      {
        ...draft,
        previewToken: (await preview(`${base}/${path}/preview`, draft))
          .previewToken,
      },
      version,
    );
  const cash = {
    participantId: participant,
    receivingAccountId: account,
    transactionDate: "2026-10-28",
    amount: money("60.00"),
  };
  const origin = await confirm(
    "settlements",
    {
      ...cash,
      amount: money("20.00"),
      transactionDate: "2026-10-19",
      excessDisposition: "retainCredit",
    },
    "2",
  );
  const cashId = await confirm("settlements", cash);
  const applied = await confirm(
    "settlements",
    {
      kind: "creditApplication",
      participantId: participant,
      amount: money("20.00"),
      transactionDate: "2026-10-27",
      selectedObligationIds: [obligation],
    },
    "7",
  );
  await confirm(
    "settlements",
    {
      kind: "forgiveness",
      participantId: participant,
      amount: money("20.00"),
      transactionDate: "2026-11-01",
      reason: "Forgive the remaining share",
      selectedObligationIds: [obligation],
    },
    "5",
  );
  const historyPath = `${base}/advances/${advance}/corrections`;
  const receipt = await read(request, `${base}/settlements/${cashId}`);
  const cashPath = `${base}/transactions/${receipt.transactionIds[0]}`;
  const originalCash = await read(request, cashPath);

  const errors: string[] = [];
  const submissions: string[] = [];
  const recovered: string[] = [];
  let stale = false;
  let lostResponseDelivered = false;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const expectedConflict =
      stale &&
      message.location().url.endsWith("/advance-corrections") &&
      message.text() ===
        "Failed to load resource: the server responded with a status of 409 (Conflict)";
    if (message.type() === "error" && !expectedConflict)
      errors.push(message.text());
  });
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `${backend}${url.pathname}${url.search}`,
    });
    if (
      route.request().method() === "GET" &&
      url.pathname === `/api/finance/submissions/${submissions[1]}`
    ) {
      const evidence = await response.json();
      recovered.push(evidence.state);
    }
    if (
      route.request().method() === "POST" &&
      url.pathname.endsWith("/advance-corrections")
    ) {
      submissions.push(route.request().headers()["idempotency-key"]!);
      if (!stale) {
        expect(response.status(), await response.text()).toBe(409);
        expect((await response.json()).code).toBe(
          "finance_advance_correction_preview_stale",
        );
        stale = true;
      } else {
        expect(response.status(), await response.text()).toBe(201);
        expect((await response.json()).submissionId).toBe(submissions[1]);
        expect(await read(request, historyPath)).toHaveLength(1);
        const lookup = await request.get(
          `${backend}/api/finance/submissions/${submissions[1]}`,
          {
            headers: {
              "Finance-Submission-Owner": route.request().headers()[
                "finance-submission-owner"
              ]!,
            },
          },
        );
        expect(lookup.status(), await lookup.text()).toBe(200);
        expect(await lookup.json()).toMatchObject({
          state: "terminal",
          receipt: {
            submissionId: submissions[1],
            outcome: { kind: "created" },
          },
        });
        await route.fulfill({ status: 201, json: {} });
        lostResponseDelivered = true;
        return;
      }
    }
    await route.fulfill({ response });
  });

  await page.goto(`/finance/advances?ledger=${ledger}&advance_id=${advance}`);
  const trigger = page.getByRole("button", {
    name: "Correct Advance",
    exact: true,
  });
  await expect(trigger).toBeEnabled();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Correct Advance" });
  const reason = dialog.getByLabel("Reason");
  await expect(reason).toBeFocused();
  await reason.fill("Correct the original share");
  await dialog.getByLabel("Owner share").fill("30.00");
  await dialog.getByLabel("Participant 1 share").fill("70.00");
  const previewButton = dialog.getByRole("button", {
    name: "Preview Correction",
  });
  const confirmButton = dialog.getByRole("button", {
    name: "Confirm Correction",
  });
  await previewButton.click();
  await expect(confirmButton).toBeFocused();
  const applications = dialog.getByRole("region", {
    name: "Applied Credit and original receipts",
  });
  await expect(applications).toContainText(
    "Originally applied 20.00 CNY · Effective 20.00 CNY → 10.00 CNY · Restored 10.00 CNY",
  );
  await expect(
    applications.getByRole("link", { name: "Open original Credit receipt" }),
  ).toHaveAttribute("href", new RegExp(origin));
  await expect(
    dialog.getByRole("region", { name: "Forgiveness Expense restatements" }),
  ).toContainText("2026-11-01 · 20.00 CNY → 0.00 CNY");

  await confirm("advances", {
    fundingAccountId: account,
    transactionDate: "2026-11-02",
    amount: money("5.00"),
    ownerShare: money("0.00"),
    participantId: participant,
    participantShare: money("5.00"),
  });
  await confirmButton.press("Enter");
  await expect(
    dialog.getByText(/The original Correction was rejected/),
  ).toBeVisible();
  await expect(confirmButton).toHaveCount(0);
  expect(await read(request, historyPath)).toEqual([]);
  await previewButton.click();
  await expect(
    dialog.getByRole("region", { name: "Gross Participant positions" }),
  ).toContainText("Outstanding receivables 5.00 CNY → 5.00 CNY");
  await expect(confirmButton).toBeFocused();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await confirmButton.press("Enter");
  await expect(
    dialog.getByText(/The original command is retained/),
  ).toBeVisible();
  await expect.poll(() => lostResponseDelivered).toBe(true);

  await page.reload();
  await expect.poll(() => recovered).toContain("terminal");
  await expect(
    page.getByRole("region", { name: "Finance submission recovery" }),
  ).toContainText("Advance Correction is confirmed");
  const history = page.getByRole("region", {
    name: "Advance Correction history",
  });
  await expect(history).toContainText("Available Credit 0.00 CNY → 10.00 CNY");
  await expect(history).toContainText("Restored 10.00 CNY");
  expect(submissions).toHaveLength(2);
  expect(new Set(submissions).size).toBe(2);
  expect(await read(request, cashPath)).toEqual(originalCash);
  const [position] = await read(
    request,
    `${base}/participants/${participant}/positions`,
  );
  expect(position.outstandingReceivables).toEqual(money("5.00"));
  expect(position.availableCredits).toEqual(money("10.00"));
  const [credit] = await read(
    request,
    `${base}/participants/${participant}/credits`,
  );
  expect(credit.settlementId).toBe(origin);
  expect(credit.available).toEqual(money("10.00"));

  const applicationLink = history.getByRole("link", {
    name: "Open Credit application",
  });
  await expect(applicationLink).toHaveAttribute("href", new RegExp(applied));
  await applicationLink.click();
  await expect(
    page.getByRole("cell", { name: /10.00 CNY.*Originally 20.00 CNY/ }),
  ).toBeVisible();
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
    detail
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "2", exact: true }) })
      .getByRole("cell", { name: /20.00 CNY.*Originally 40.00 CNY/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
