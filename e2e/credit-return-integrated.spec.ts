import { AxeBuilder } from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  AccountResponse,
  CreditReturnResponse,
  CreditReturnPreview,
  ParticipantPositionResponse,
  SettlementCreatedReceipt,
  FinanceSubmissionResponse,
} from "../src/api/generated/schemas/index.ts";

const backend = process.env.FINANCE_T11_TEST_BACKEND;
test.skip(
  !backend,
  "Requires the exact-P server on guarded PostgreSQL at 127.0.0.1:8298.",
);
test.describe.configure({ mode: "serial" });
const money = (amount: string) => ({ amount, currency: "CNY" });
async function seed(request: APIRequestContext, nature = "asset") {
  expect(backend).toBe("http://127.0.0.1:8298");
  const owner = (await (await request.get(`${backend}/api/me`)).json())
    .id as string;
  async function create(path: string, data: unknown, version = "1") {
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
  const ledger = await create("/api/finance/ledgers", {
    name: `T11 ${randomUUID()}`,
  });
  const base = `/api/finance/ledgers/${ledger}`;
  const account = await create(`${base}/accounts`, {
    name: "Return funding",
    nature,
    currency: "CNY",
    openingBalance: money("100"),
    trackingStartDate: "2026-01-01",
  });
  const participant = (
    await (
      await request.post(`${backend}${base}/participants`, {
        data: { name: "Credit participant" },
      })
    ).json()
  ).id as string;
  const origins: string[] = [];
  for (const [amount, date] of [
    ["20", "2026-10-24"],
    ["30", "2026-10-23"],
  ]) {
    const draft = {
      participantId: participant,
      receivingAccountId: account,
      transactionDate: date,
      amount: money(amount!),
      excessDisposition: "retainCredit",
    };
    const preview = await request.post(
      `${backend}${base}/settlements/preview`,
      { data: draft },
    );
    expect(preview.status(), await preview.text()).toBe(200);
    origins.push(
      await create(
        `${base}/settlements`,
        { ...draft, previewToken: (await preview.json()).previewToken },
        "2",
      ),
    );
  }
  // Existing debt stays separate from returning credit.
  const advance = {
    fundingAccountId: account,
    transactionDate: "2026-10-25",
    amount: money("10"),
    ownerShare: money("0"),
    participantShares: [{ participantId: participant, amount: money("10") }],
  };
  const preview = await request.post(`${backend}${base}/advances/preview`, {
    data: advance,
  });
  expect(preview.status(), await preview.text()).toBe(200);
  await create(
    `${base}/advances`,
    {
      ...advance,
      previewToken: (await preview.json()).previewToken,
    },
    "2",
  );
  await request.post(`${backend}${base}/participants/${participant}/archive`);
  return { owner, ledger, base, account, participant, origins };
}
async function read(request: APIRequestContext, path: string) {
  const response = await request.get(`${backend}${path}`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
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
for (const recovery of ["lookup", "retry"] as const) {
  test(`T11 exact P committed receipt loss, reload and original ${recovery} preserves financial effects`, async ({
    page,
    context,
    request,
  }) => {
    const data = await seed(
      request,
      recovery === "retry" ? "liability" : "asset",
    );
    const beforeAccounts = AccountResponse.array().parse(
      await read(request, `${data.base}/accounts`),
    );
    const beforeDebt = await read(
      request,
      `${data.base}/participants/${data.participant}/obligations`,
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const posts: {
      key: string;
      version: string;
      owner: string;
      body: string;
    }[] = [];
    let withheld: unknown;
    let observed: unknown;
    let plan: CreditReturnPreview | undefined;
    let allowLookup = false;
    await context.route("**/api/**", async (route) => {
      const original = route.request();
      const path = new URL(original.url()).pathname;
      if (
        path.includes("/submissions/") &&
        (!allowLookup || recovery === "retry")
      ) {
        // Lookup is temporarily unavailable; it cannot prove non-admission.
        await route.fulfill({
          json: {
            state: "unfinished",
            submissionId: posts[0]!.key,
            operation: "createFinanceSettlement",
            commandVersion: "8",
            targetLedgerId: data.ledger,
            admittedAt: "2026-10-29T00:00:00Z",
          },
        });
        return;
      }
      const response = await route.fetch({
        url: `${backend}${path}${new URL(original.url()).search}`,
      });
      if (original.method() === "POST" && path.endsWith("/settlements/preview"))
        plan = CreditReturnPreview.parse(await response.json());
      if (original.method() === "POST" && path.endsWith("/settlements")) {
        posts.push({
          key: original.headers()["idempotency-key"]!,
          version: original.headers()["finance-command-version"]!,
          owner: original.headers()["finance-submission-owner"]!,
          body: original.postData()!,
        });
        expect(response.status(), await response.text()).toBe(201);
        if (posts.length === 1) {
          withheld = SettlementCreatedReceipt.parse(await response.json());
          // A separate PostgreSQL connection observes committed fragments,
          // movements and terminal command before the browser loses its receipt.
          observed = await read(request, `/t11-test/effects/${data.ledger}`);
          await route.fulfill({ status: 201, json: {} });
          return;
        }
      }
      await route.fulfill({ response });
    });
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.goto(
      `/finance/repayments?ledger=${data.ledger}&participant_id=${data.participant}`,
    );
    const trigger = page.getByRole("button", {
      name: "Return credit",
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Return credit" });
    await expect(
      dialog.getByLabel("Participant", { exact: true }),
    ).toBeFocused();
    await dialog
      .getByLabel("Paying Account", { exact: true })
      .selectOption(data.account);
    await dialog.getByLabel("Return date").fill("2026-10-29");
    await dialog.getByLabel("Return amount").fill("25");
    const note = "\u0085" + "😀".repeat(500) + "\u0085";
    await dialog.getByLabel("Note", { exact: true }).fill(note);
    await dialog.getByRole("button", { name: "Preview credit return" }).click();
    await expect(
      dialog.getByRole("button", { name: "Confirm credit return" }),
    ).toBeFocused();
    await axe(page);
    await mkdir(".agent/t11/screenshots", { recursive: true });
    await page.screenshot({
      path: `.agent/t11/screenshots/real-${recovery}-preview.png`,
      fullPage: true,
    });
    await page.keyboard.press("Enter");
    await expect(dialog).toContainText(
      "The original credit return is retained",
    );
    await expect.poll(() => observed).toBeDefined();
    await expect(
      dialog.getByRole("button", { name: "Confirm credit return" }),
    ).toBeDisabled();
    expect(plan!.origins.map((row) => row.originSettlementId)).toEqual(
      data.origins,
    );
    expect(plan!.origins.map((row) => row.amount.amount)).toEqual([
      "20.00",
      "5.00",
    ]);
    expect(observed).toMatchObject({
      fragments: [
        { position: 1, amount: "20.00" },
        { position: 2, amount: "5.00" },
      ],
      movements:
        recovery === "retry"
          ? ["-20.00", "-5.00", "20.00", "5.00"]
          : ["-20.00", "-20.00", "-5.00", "-5.00"],
      commands: [{ key: posts[0]!.key, version: "8" }],
    });
    await page.reload();
    await expect(trigger).toBeDisabled();
    const journal = page.getByRole("region", {
      name: "Finance submission recovery",
    });
    await expect(journal).toContainText(`Credit return 25 CNY`);
    await expect(journal).toContainText(data.account);
    await axe(page);
    allowLookup = true;
    await journal
      .getByRole("button", {
        name:
          recovery === "lookup" ? "Check outcome" : "Retry original submission",
      })
      .click();
    await expect(
      journal.getByRole("link", { name: "Open Settlement" }),
    ).toBeVisible();
    expect(posts).toHaveLength(recovery === "lookup" ? 1 : 2);
    if (recovery === "retry") expect(posts[1]).toEqual(posts[0]);
    expect(posts[0]).toMatchObject({ version: "8", owner: data.owner });
    expect(JSON.parse(posts[0]!.body)).toMatchObject({
      payingAccountId: data.account,
      participantId: data.participant,
      amount: money("25"),
      transactionDate: "2026-10-29",
      note,
    });
    const lookup = await request.get(
      `${backend}/api/finance/submissions/${posts[0]!.key}`,
      {
        headers: {
          "Finance-Command-Version": "8",
          "Finance-Submission-Owner": data.owner,
        },
      },
    );
    expect(lookup.status(), await lookup.text()).toBe(200);
    const terminal = FinanceSubmissionResponse.parse(await lookup.json());
    expect(terminal).toEqual({ state: "terminal", receipt: withheld });
    await journal.getByRole("link", { name: "Open Settlement" }).click();
    const detail = page.getByRole("region", { name: "Confirmed Settlement" });
    await expect(detail).toContainText(
      "Credit returned / Account outflow25.00 CNY",
    );
    await expect(detail).not.toContainText("Cash received");
    await expect(
      detail.getByRole("list", { name: "Consumed credit origins" }),
    ).toContainText("Available after 25.00 CNY");
    await axe(page);
    await page.screenshot({
      path: `.agent/t11/screenshots/real-${recovery}-history.png`,
      fullPage: true,
    });
    const receipt = SettlementCreatedReceipt.parse(withheld);
    const source = CreditReturnResponse.parse(
      await read(
        request,
        `${data.base}/settlements/${receipt.outcome.resource.id}`,
      ),
    );
    expect(source.origins).toEqual(plan!.origins);
    expect(source.note).toBe("😀".repeat(500));
    const afterAccounts = AccountResponse.array().parse(
      await read(request, `${data.base}/accounts`),
    );
    expect(
      beforeAccounts.find((row) => row.id === data.account)!.currentBalance
        .amount,
    ).toBe(recovery === "retry" ? "60.00" : "140.00");
    expect(
      afterAccounts.find((row) => row.id === data.account)!.currentBalance
        .amount,
    ).toBe(recovery === "retry" ? "85.00" : "115.00");
    expect(
      source.origins.map(
        (origin) =>
          beforeAccounts.find((row) => row.id === origin.liabilityAccountId)!
            .currentBalance.amount,
      ),
    ).toEqual(["20.00", "30.00"]);
    expect(
      source.origins.map(
        (origin) =>
          afterAccounts.find((row) => row.id === origin.liabilityAccountId)!
            .currentBalance.amount,
      ),
    ).toEqual(["0.00", "25.00"]);
    expect(
      await read(
        request,
        `${data.base}/participants/${data.participant}/obligations`,
      ),
    ).toEqual(beforeDebt);
    const position = ParticipantPositionResponse.array().parse(
      await read(
        request,
        `${data.base}/participants/${data.participant}/positions`,
      ),
    );
    expect(position).toMatchObject([
      {
        outstandingReceivables: money("10.00"),
        availableCredits: money("25.00"),
        netExposure: money("-15.00"),
      },
    ]);
    const overview = await read(request, `${data.base}/overview?month=2026-10`);
    expect(overview.monthSummaryByCurrency[0]).toMatchObject({
      income: money("0.00"),
      expense: money("0.00"),
    });
    for (const id of source.transactionIds)
      expect(
        await read(request, `${data.base}/transactions/${id}`),
      ).toMatchObject({ kind: "internalTransfer" });
    expect(await read(request, `/t11-test/effects/${data.ledger}`)).toEqual(
      observed,
    );
    await page.reload();
    await expect(detail).toContainText("Credit returned / Account outflow");
    expect(errors).toEqual([]);
    await writeFile(
      `.agent/t11/real-${recovery}.json`,
      JSON.stringify(
        {
          producer: "e57e5a66ae2fbcac02741d227da1e2181492b0ec",
          posts,
          withheld,
          observed,
          plan,
          source,
          beforeAccounts,
          afterAccounts,
          position,
          overview,
        },
        null,
        2,
      ),
    );
  });
}
