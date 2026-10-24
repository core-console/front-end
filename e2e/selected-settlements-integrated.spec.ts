import { AxeBuilder } from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  SettlementCreatedReceipt,
  SettlementTerminalProblem,
  SettlementRejectedReceipt,
} from "../src/api/generated/schemas/index.ts";

const backend = process.env.FINANCE_T07_TEST_BACKEND;
test.skip(
  !backend,
  "Requires the guarded T07 candidate server on 127.0.0.1:8297.",
);
test.describe.configure({ mode: "serial" });

async function seed(request: APIRequestContext) {
  expect(backend).toBe("http://127.0.0.1:8297");
  const owner = (await (await request.get(`${backend}/api/me`)).json())
    .id as string;
  async function create(path: string, data: unknown) {
    const response = await request.post(`${backend}${path}`, {
      data,
      headers: {
        "Idempotency-Key": randomUUID(),
        "Finance-Command-Version": "1",
        "Finance-Submission-Owner": owner,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()).outcome.resource.id as string;
  }
  const ledger = await create("/api/finance/ledgers", {
    name: `T07 ${randomUUID()}`,
  });
  const base = `/api/finance/ledgers/${ledger}`;
  const account = await create(`${base}/accounts`, {
    name: "Cash",
    nature: "asset",
    currency: "CNY",
    openingBalance: { amount: "100.00", currency: "CNY" },
    trackingStartDate: "2026-01-01",
  });
  const person = (
    await (
      await request.post(`${backend}${base}/participants`, {
        data: { name: "T07 Participant" },
      })
    ).json()
  ).id as string;
  const sources: { id: string; obligation: { id: string } }[] = [];
  for (const [amount, date] of [
    ["40.00", "2026-10-20"],
    ["60.00", "2026-10-21"],
  ]) {
    const draft = {
      participantId: person,
      fundingAccountId: account,
      transactionDate: date,
      amount: { amount, currency: "CNY" },
      ownerShare: { amount: "0.00", currency: "CNY" },
      participantShare: { amount, currency: "CNY" },
      note: null,
    };
    const preview = await request.post(`${backend}${base}/advances/preview`, {
      data: draft,
    });
    expect(preview.status(), await preview.text()).toBe(200);
    const id = await create(`${base}/advances`, {
      ...draft,
      previewToken: (await preview.json()).previewToken,
    });
    sources.push(
      await (await request.get(`${backend}${base}/advances/${id}`)).json(),
    );
  }
  return { owner, ledger, base, account, person, sources };
}
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
async function form(
  page: Page,
  data: Awaited<ReturnType<typeof seed>>,
  amount: string,
) {
  await page.goto(
    `/finance/repayments?ledger=${data.ledger}&participant_id=${data.person}`,
  );
  const trigger = page.getByRole("button", {
    name: "Record repayment",
    exact: true,
  });
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Record repayment" });
  await expect(dialog.getByLabel("Participant", { exact: true })).toBeFocused();
  await dialog.getByLabel("Receiving Account").selectOption(data.account);
  await dialog.getByLabel("Amount", { exact: true }).fill(amount);
  await dialog.getByLabel("Date", { exact: true }).fill("2026-10-24");
  await dialog.getByLabel("Repayment scope").selectOption("selected");
  const second = dialog.getByRole("checkbox", {
    name: new RegExp(data.sources[1]!.obligation.id),
  });
  await expect(second).not.toBeChecked();
  await second.focus();
  await page.keyboard.press("Space");
  return dialog;
}

for (const disposition of [
  "repayOnly",
  "retainCredit",
  "acceptIncome",
] as const) {
  test(`real selected receipt with ${disposition} preserves unselected debt`, async ({
    page,
    request,
  }) => {
    const data = await seed(request);
    const errors = captureErrors(page);
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        response: await route.fetch({
          url: `${backend}${url.pathname}${url.search}`,
        }),
      });
    });
    const dialog = await form(
      page,
      data,
      disposition === "repayOnly" ? "60" : "80",
    );
    if (disposition !== "repayOnly")
      await dialog.getByLabel("Surplus handling").selectOption(disposition);
    if (disposition === "acceptIncome")
      await dialog.getByLabel("Accepted Income amount").fill("20");
    await dialog.getByRole("button", { name: "Preview repayment" }).focus();
    await page.keyboard.press("Enter");
    const confirm = dialog.getByRole("button", { name: "Confirm repayment" });
    await expect(confirm).toBeFocused();
    const preview = dialog.getByRole("region", { name: "Repayment preview" });
    await expect(preview).toContainText(data.sources[1]!.obligation.id);
    await expect(preview).not.toContainText(data.sources[0]!.obligation.id);
    await axe(page);
    await dialog.screenshot({ path: `.tmp/t07-${disposition}-preview.png` });
    await page.keyboard.press("Enter");
    const result = page.getByRole("region", { name: "Confirmed Settlement" });
    await expect(
      result.getByRole("heading", { name: "Confirmed selected scope" }),
    ).toBeVisible();
    await expect(result).toContainText(data.sources[1]!.obligation.id);
    await expect(
      page.getByRole("heading", { name: "Repayments", exact: true }),
    ).toBeFocused();
    const obligations = await (
      await request.get(
        `${backend}${data.base}/participants/${data.person}/obligations`,
      )
    ).json();
    expect(
      obligations.map(
        (row: { remaining: { amount: string } }) => row.remaining.amount,
      ),
    ).toEqual(["40.00", "0.00"]);
    const positions = await (
      await request.get(
        `${backend}${data.base}/participants/${data.person}/positions`,
      )
    ).json();
    expect(positions[0].outstandingReceivables.amount).toBe("40.00");
    expect(positions[0].availableCredits.amount).toBe(
      disposition === "retainCredit" ? "20.00" : "0.00",
    );
    const accounts = await (
      await request.get(`${backend}${data.base}/accounts`)
    ).json();
    expect(
      accounts.find((row: { id: string }) => row.id === data.account)
        .currentBalance.amount,
    ).toBe(disposition === "repayOnly" ? "60.00" : "80.00");
    await test.info().attach("t07-committed-financial-effects", {
      body: Buffer.from(
        JSON.stringify(
          {
            ledger: data.ledger,
            disposition,
            obligations,
            positions,
            accounts,
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
    await axe(page);
    await page.screenshot({
      path: `.tmp/t07-${disposition}-result.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("scope expansion removes confirmation until a new preview is reviewed", async ({
  page,
  request,
}) => {
  const data = await seed(request);
  const errors = captureErrors(page);
  const commands: { selectedObligationIds: string[] }[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/settlements/preview"))
      commands.push(route.request().postDataJSON());
    await route.fulfill({
      response: await route.fetch({
        url: `${backend}${url.pathname}${url.search}`,
      }),
    });
  });
  const dialog = await form(page, data, "80");
  await dialog.getByLabel("Surplus handling").selectOption("retainCredit");
  await dialog.getByRole("button", { name: "Preview repayment" }).click();
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toBeVisible();
  await dialog
    .getByRole("checkbox", { name: new RegExp(data.sources[0]!.obligation.id) })
    .check();
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Preview repayment" }).click();
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toBeFocused();
  const preview = dialog.getByRole("region", { name: "Repayment preview" });
  await expect(preview.getByRole("table")).toContainText("40.00 CNY");
  expect(commands).toHaveLength(2);
  expect(commands.map((command) => command.selectedObligationIds)).toEqual([
    [data.sources[1]!.obligation.id],
    [data.sources[1]!.obligation.id, data.sources[0]!.obligation.id],
  ]);
  await axe(page);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Confirmed Settlement" }),
  ).toBeVisible();
  const history = await (
    await request.get(
      `${backend}${data.base}/participants/${data.person}/settlements`,
    )
  ).json();
  expect(history).toHaveLength(1);
  expect(history[0].selectedObligationIds.toSorted()).toEqual(
    data.sources.map((source) => source.obligation.id).toSorted(),
  );
  expect(
    history[0].allocations.map(
      (allocation: { obligationId: string; cashPaid: { amount: string } }) => [
        allocation.obligationId,
        allocation.cashPaid.amount,
      ],
    ),
  ).toEqual([
    [data.sources[0]!.obligation.id, "40.00"],
    [data.sources[1]!.obligation.id, "40.00"],
  ]);
  const effects = await (
    await request.get(`${backend}/t07-test/effects/${data.ledger}`)
  ).json();
  expect(effects.counts).toMatchObject({
    finance_settlements: 1,
    finance_settlement_allocations: 2,
    finance_credit_origins: 0,
    finance_settlement_income: 0,
  });
  expect(errors).toEqual([]);
});

for (const recoveryMode of ["retry", "reload lookup"] as const) {
  test(`committed response loss recovers via ${recoveryMode} without duplicate effects`, async ({
    page,
    request,
  }) => {
    const data = await seed(request);
    const errors = captureErrors(page);
    const posts: {
      body: string | null;
      key: string;
      version: string;
      owner: string;
    }[] = [];
    const lookups: unknown[] = [];
    let receipt: SettlementCreatedReceipt | undefined;
    await page.route("**/api/**", async (route) => {
      const original = route.request();
      const url = new URL(original.url());
      const response = await route.fetch({
        url: `${backend}${url.pathname}${url.search}`,
      });
      if (url.pathname.includes("/submissions/") && response.status() === 200)
        lookups.push(await response.json());
      if (
        url.pathname.endsWith("/settlements") &&
        original.method() === "POST"
      ) {
        posts.push({
          body: original.postData(),
          key: original.headers()["idempotency-key"]!,
          version: original.headers()["finance-command-version"]!,
          owner: original.headers()["finance-submission-owner"]!,
        });
        const terminal = SettlementCreatedReceipt.parse(await response.json());
        if (posts.length === 1) {
          receipt = terminal;
          const effects = await (
            await request.get(`${backend}/t07-test/effects/${data.ledger}`)
          ).json();
          expect(effects.counts).toMatchObject({
            finance_settlements: 1,
            finance_settlement_allocations: 1,
            finance_credit_origins: 1,
            finance_settlement_income: 0,
          });
          expect(effects.scopes).toEqual([[data.sources[1]!.obligation.id]]);
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: "{",
          });
          return;
        }
        expect(terminal).toEqual(receipt);
      }
      await route.fulfill({ response });
    });
    const dialog = await form(page, data, "100");
    await dialog.getByLabel("Surplus handling").selectOption("retainCredit");
    await dialog.getByRole("button", { name: "Preview repayment" }).click();
    await dialog.getByRole("button", { name: "Confirm repayment" }).click();
    await expect(dialog).toContainText("original repayment is retained");
    await dialog.getByRole("button", { name: "Close to recovery" }).click();
    const recovery = page.getByRole("region", {
      name: "Finance submission recovery",
    });
    if (recoveryMode === "reload lookup") await page.reload();
    else
      await recovery
        .getByRole("button", { name: "Retry original submission" })
        .click();
    await expect(recovery).toContainText("Settlement created");
    expect(posts).toHaveLength(recoveryMode === "retry" ? 2 : 1);
    if (recoveryMode === "retry") expect(posts[1]).toEqual(posts[0]);
    else expect(lookups).toEqual([{ state: "terminal", receipt }]);
    expect(posts[0]!.version).toBe("4");
    expect(posts[0]!.owner).toBe(data.owner);
    await page.reload();
    const positions = page.getByRole("region", {
      name: "Participant credit and positions",
    });
    await expect(positions).toContainText("40.00 CNY");
    await expect(
      page.getByRole("table", { name: "Participant receivable composition" }),
    ).toContainText("40.00 CNY");
    const effects = await (
      await request.get(`${backend}/t07-test/effects/${data.ledger}`)
    ).json();
    expect(effects.counts.finance_settlements).toBe(1);
    await test.info().attach("t07-original-command-and-recovered-effects", {
      body: Buffer.from(
        JSON.stringify(
          {
            ledger: data.ledger,
            recoveryMode,
            posts,
            lookups,
            receipt,
            effects,
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
    await axe(page);
    expect(errors).toEqual([]);
  });
}

test("a real competing receipt preserves scope and disposition and requires renewed confirmation", async ({
  page,
  request,
}) => {
  const data = await seed(request);
  const errors = captureErrors(page);
  const keys: string[] = [];
  const rejections: SettlementRejectedReceipt[] = [];
  await page.route("**/api/**", async (route) => {
    const original = route.request();
    const url = new URL(original.url());
    if (url.pathname.endsWith("/settlements") && original.method() === "POST")
      keys.push(original.headers()["idempotency-key"]!);
    const response = await route.fetch({
      url: `${backend}${url.pathname}${url.search}`,
    });
    if (url.pathname.endsWith("/settlements") && response.status() === 409) {
      expect(response.headers()["content-type"]).toContain(
        "application/problem+json",
      );
      const problem = SettlementTerminalProblem.parse(await response.json());
      expect(problem).toMatchObject({
        status: 409,
        code: "finance_settlement_preview_stale",
      });
      rejections.push(
        SettlementRejectedReceipt.parse(problem.submissionReceipt),
      );
    }
    await route.fulfill({ response });
  });
  const dialog = await form(page, data, "80");
  await dialog.getByLabel("Surplus handling").selectOption("retainCredit");
  await dialog.getByRole("button", { name: "Preview repayment" }).click();
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toBeFocused();
  const competing = {
    participantId: data.person,
    receivingAccountId: data.account,
    transactionDate: "2026-10-24",
    amount: { amount: "10.00", currency: "CNY" },
    selectedObligationIds: [data.sources[1]!.obligation.id],
  };
  const preview = await request.post(
    `${backend}${data.base}/settlements/preview`,
    { data: competing },
  );
  expect(preview.status(), await preview.text()).toBe(200);
  const settled = await request.post(`${backend}${data.base}/settlements`, {
    data: { ...competing, previewToken: (await preview.json()).previewToken },
    headers: {
      "Idempotency-Key": randomUUID(),
      "Finance-Command-Version": "4",
      "Finance-Submission-Owner": data.owner,
    },
  });
  expect(settled.status()).toBe(201);
  await dialog.getByRole("button", { name: "Confirm repayment" }).click();
  await expect(dialog).toContainText("original action was rejected");
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("checkbox", {
      name: new RegExp(data.sources[1]!.obligation.id),
    }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", {
      name: new RegExp(data.sources[0]!.obligation.id),
    }),
  ).not.toBeChecked();
  await expect(dialog.getByLabel("Surplus handling")).toHaveValue(
    "retainCredit",
  );
  await dialog.getByRole("button", { name: "Refresh preview" }).click();
  await expect(
    dialog.getByRole("region", { name: "Repayment preview" }),
  ).toContainText("30.00 CNY");
  await expect(
    dialog.getByRole("button", { name: "Confirm repayment" }),
  ).toBeFocused();
  expect(keys).toHaveLength(1);
  expect(rejections).toHaveLength(1);
  expect(rejections[0]).toMatchObject({
    submissionId: keys[0],
    commandVersion: "4",
    operation: "createFinanceSettlement",
    targetLedgerId: data.ledger,
    outcome: {
      kind: "rejected",
      problem: { status: 409, code: "finance_settlement_preview_stale" },
    },
  });
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Confirmed Settlement" }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
  const obligations = await (
    await request.get(
      `${backend}${data.base}/participants/${data.person}/obligations`,
    )
  ).json();
  expect(
    obligations.map(
      (row: { remaining: { amount: string } }) => row.remaining.amount,
    ),
  ).toEqual(["40.00", "0.00"]);
  await axe(page);
  // The deliberately asserted stale HTTP response produces this browser diagnostic.
  // Exact count and text still fail on every additional console/page error.
  expect(errors).toEqual([
    "Failed to load resource: the server responded with a status of 409 (Conflict)",
  ]);
});

test("pending confirmation locks selection and prevents duplicate dispatch", async ({
  page,
  request,
}) => {
  const data = await seed(request);
  const errors = captureErrors(page);
  let posts = 0;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const original = route.request();
    const url = new URL(original.url());
    const response = await route.fetch({
      url: `${backend}${url.pathname}${url.search}`,
    });
    if (url.pathname.endsWith("/settlements") && original.method() === "POST") {
      posts += 1;
      await held;
    }
    await route.fulfill({ response });
  });
  try {
    const dialog = await form(page, data, "60");
    await dialog.getByRole("button", { name: "Preview repayment" }).click();
    await dialog.getByRole("button", { name: "Confirm repayment" }).click();
    await expect.poll(() => posts).toBe(1);
    await expect(dialog.getByLabel("Repayment scope")).toBeDisabled();
    await expect(dialog.getByRole("checkbox").first()).toBeDisabled();
    await page.keyboard.press("Enter");
    expect(posts).toBe(1);
    release();
    await expect(
      page.getByRole("region", { name: "Confirmed Settlement" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});
