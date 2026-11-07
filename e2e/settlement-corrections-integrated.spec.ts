import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  SettlementCorrectionResponse,
  FinanceSubmissionResponse,
} from "../src/api/generated/schemas/index.ts";
const backend = process.env.FINANCE_T13_TEST_BACKEND;
test.skip(
  !backend,
  "Requires exact P on guarded PostgreSQL at 127.0.0.1:8301.",
);
test.describe.configure({ mode: "serial" });
const money = (amount: string) => ({ amount, currency: "CNY" });
async function read(request: APIRequestContext, path: string, owner?: string) {
  const response = await request.get(
    `${backend}${path}`,
    owner ? { headers: { "Finance-Submission-Owner": owner } } : {},
  );
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function seed(
  request: APIRequestContext,
  nature: "asset" | "liability",
  creditOnly = false,
  originalAmount = "100",
) {
  expect(backend).toBe("http://127.0.0.1:8301");
  const owner = (await read(request, "/api/me")).id as string;
  const create = async (path: string, data: unknown, version = "1") => {
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
  };
  const preview = async (path: string, data: unknown) => {
    const response = await request.post(`${backend}${path}`, { data });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const ledger = await create("/api/finance/ledgers", {
      name: `T13 ${randomUUID()}`,
    }),
    base = `/api/finance/ledgers/${ledger}`;
  const account = await create(`${base}/accounts`, {
    name: "Receiving",
    nature,
    currency: "CNY",
    openingBalance: money("1000"),
    trackingStartDate: "2026-01-01",
  });

  const p = await request.post(`${backend}${base}/participants`, {
    data: { name: "Alex" },
  });
  expect(p.status()).toBe(201);
  const person = (await p.json()).id as string;
  for (const [amount, date] of [
    ["40", "2026-01-01"],
    ["60", "2026-02-01"],
  ]) {
    if (creditOnly) break;
    const draft = {
      fundingAccountId: account,
      transactionDate: date,
      amount: money(amount!),
      ownerShare: money("0"),
      participantShares: [{ participantId: person, amount: money(amount!) }],
      note: null,
    };
    const plan = await preview(`${base}/advances/preview`, draft);
    await create(
      `${base}/advances`,
      {
        ...draft,
        previewToken: plan.previewToken,
      },
      "2",
    );
  }
  const draft = {
    participantId: person,
    receivingAccountId: account,
    transactionDate: "2027-01-02",
    amount: money(originalAmount),
    note: "Actual receipt",
    ...(creditOnly ? { excessDisposition: "retainCredit" } : {}),
  };
  const plan = await preview(`${base}/settlements/preview`, draft);
  const settlement = await create(
    `${base}/settlements`,
    {
      ...draft,
      previewToken: plan.previewToken,
    },
    creditOnly ? "2" : "1",
  );
  return { owner, ledger, base, account, person, settlement, preview, create };
}
for (const recovery of ["lookup", "retry"] as const)
  test(`real P restates ${recovery === "lookup" ? "80" : "100"} to 70 with reverse-order release and committed-loss ${recovery}`, async ({
    page,
    context,
    request,
  }, info) => {
    const data = await seed(
      request,
      recovery === "lookup" ? "asset" : "liability",
      false,
      recovery === "lookup" ? "80" : "100",
    );
    const posts: {
      key: string;
      owner: string;
      version: string;
      body: string;
    }[] = [];
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    let observed: unknown;
    let completeResponseLoss!: () => void;
    const responseLossCompleted = new Promise<void>((resolve) => {
      completeResponseLoss = resolve;
    });
    await context.route("**/api/**", async (route) => {
      const r = route.request(),
        path = new URL(r.url()).pathname;
      const response = await route.fetch({
        url: `${backend}${path}${new URL(r.url()).search}`,
      });
      if (r.method() === "POST" && path.endsWith("/settlement-corrections")) {
        posts.push({
          key: r.headers()["idempotency-key"]!,
          owner: r.headers()["finance-submission-owner"]!,
          version: r.headers()["finance-command-version"]!,
          body: r.postData()!,
        });
        expect(response.status()).toBe(201);
        if (posts.length === 1) {
          const committed = await read(
            request,
            `/t13-test/effects/${data.ledger}`,
          );
          expect(committed.corrections).toHaveLength(1);
          expect(committed.commands).toHaveLength(1);
          expect(committed.commands[0].outcome).not.toBeNull();
          observed = committed;
          await route.fulfill({ status: 201, json: {} });
          completeResponseLoss();
          return;
        }
      }
      if (recovery === "retry" && path.includes("/submissions/")) {
        await route.fulfill({
          json: {
            state: "unfinished",
            submissionId: path.split("/").at(-1)!,
            operation: "createFinanceSettlementCorrection",
            commandVersion: "1",
            targetLedgerId: data.ledger,
            admittedAt: "2026-11-03T00:00:00Z",
          },
        });
        return;
      }
      await route.fulfill({ response });
    });
    await page.goto(
      `/finance/repayments?ledger=${data.ledger}&settlement_id=${data.settlement}`,
    );
    await page
      .getByRole("button", { name: "Correct cash repayment", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Correct cash repayment" });
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Correct false original receipt 100 to actual 70");
    await dialog.getByLabel("Corrected cash receipt").fill("70.00");
    await dialog.getByRole("button", { name: "Preview Correction" }).click();
    await expect(
      dialog.getByRole("region", { name: "After receipt facts" }),
    ).toContainText("Effective cash 30.00 CNY");
    await dialog.getByRole("button", { name: "Confirm Correction" }).click();
    await expect(
      dialog.getByText(/The original command is retained/),
    ).toBeVisible();
    await responseLossCompleted;
    await dialog
      .locator("form")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.reload();
    if (recovery === "retry") {
      await expect(
        page.getByText(
          "The original submission is unfinished. Retry it explicitly to continue.",
          { exact: true },
        ),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Retry original submission", exact: true })
        .click();
    }
    await expect(
      page.getByRole("region", { name: "Finance submission recovery" }),
    ).toContainText("Cash repayment Correction is confirmed");
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome" }),
    ).toBeVisible();
    if (recovery === "retry") {
      expect(posts).toHaveLength(2);
      expect(posts[0]).toEqual(posts[1]);
    } else expect(posts).toHaveLength(1);
    const durable = await read(request, `/t13-test/effects/${data.ledger}`);
    expect(durable.corrections).toHaveLength(1);
    expect(durable.commands).toHaveLength(1);
    const correction = SettlementCorrectionResponse.parse(
      await read(
        request,
        `${data.base}/settlement-corrections/${durable.corrections[0].id}`,
      ),
    );
    expect(correction.after.allocations.map((a) => a.cashPaid.amount)).toEqual([
      "40.00",
      "30.00",
    ]);
    expect(
      correction.after.allocations.map((a) => a.originalCashPaid.amount),
    ).toEqual(["40.00", recovery === "lookup" ? "40.00" : "60.00"]);
    expect(correction.obligationsAfter.map((o) => o.remaining.amount)).toEqual([
      "0.00",
      "30.00",
    ]);
    expect(correction.obligationsAfter.map((o) => o.forgiven.amount)).toEqual([
      "0.00",
      "0.00",
    ]);
    const evidence = FinanceSubmissionResponse.parse(
      await read(
        request,
        `/api/finance/submissions/${posts[0]!.key}`,
        data.owner,
      ),
    );
    expect(evidence.state).toBe("terminal");
    await page
      .getByRole("link", { name: "Open Cash repayment Correction history" })
      .click();
    await expect(
      page.getByRole("region", { name: "Cash repayment Correction history" }),
    ).toContainText("Revision 1");
    expect(errors).toEqual([]);
    await writeFile(
      info.outputPath("committed-evidence.json"),
      JSON.stringify(
        {
          producer: "26290aeb2fbc125896c3687e284e8f055330f15f",
          data: { ...data, create: undefined, preview: undefined },
          observedBeforeResponseLoss: observed,
          durable,
          posts,
          evidence,
        },
        null,
        2,
      ),
    );
  });

for (const disposition of ["retainCredit", "acceptIncome"] as const)
  test(`real P explicitly disposes increased excess as ${disposition} and retains two revisions`, async ({
    page,
    context,
    request,
  }, info) => {
    const data = await seed(request, "asset");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await context.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        response: await route.fetch({
          url: `${backend}${url.pathname}${url.search}`,
        }),
      });
    });
    await page.goto(
      `/finance/repayments?ledger=${data.ledger}&settlement_id=${data.settlement}`,
    );
    for (const [amount, choice] of [
      ["130.00", disposition],
      ["80.00", "none"],
    ] as const) {
      await page
        .getByRole("button", { name: "Correct cash repayment", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Correct cash repayment",
      });
      await dialog
        .getByLabel("Reason", { exact: true })
        .fill(`Correct original cash to ${amount}`);
      await dialog.getByLabel("Corrected cash receipt").fill(amount);
      await expect(dialog.getByLabel("Excess disposition")).toHaveValue("none");
      await dialog.getByLabel("Excess disposition").selectOption(choice);
      await dialog.getByRole("button", { name: "Preview Correction" }).click();
      const after = dialog.getByRole("region", {
        name: "After receipt facts",
      });
      await expect(after).toContainText(`Cash receipt ${amount} CNY`);
      if (amount === "130.00")
        await expect(after).toContainText(
          choice === "retainCredit"
            ? "Retained credit 30.00 CNY"
            : "Accepted Income 30.00 CNY",
        );
      await dialog.getByRole("button", { name: "Confirm Correction" }).click();
      await expect(dialog).toBeHidden();
    }
    const history = await read(
      request,
      `${data.base}/settlements/${data.settlement}/corrections`,
    );
    expect(history.map((r: { revision: number }) => r.revision)).toEqual([
      1, 2,
    ]);
    const latest = SettlementCorrectionResponse.parse(history[1]);
    expect(
      latest.after.allocations.map((a) => a.originalCashPaid.amount),
    ).toEqual(["40.00", "60.00"]);
    expect(latest.after.allocations.map((a) => a.cashPaid.amount)).toEqual([
      "40.00",
      "40.00",
    ]);
    expect(latest.after.retainedCredit.amount).toBe("0.00");
    expect(latest.after.acceptedSurplus.amount).toBe("0.00");
    await expect(
      page.getByRole("region", { name: "Cash repayment Correction history" }),
    ).toContainText("Revision 2");
    expect(errors).toEqual([]);
    await writeFile(
      info.outputPath("excess-history.json"),
      JSON.stringify(history, null, 2),
    );
  });

test("real P corrects a credit-only receipt without inventing an Obligation", async ({
  page,
  context,
  request,
}, info) => {
  const data = await seed(request, "asset", true);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      response: await route.fetch({
        url: `${backend}${url.pathname}${url.search}`,
      }),
    });
  });
  await page.goto(
    `/finance/repayments?ledger=${data.ledger}&settlement_id=${data.settlement}`,
  );
  await page
    .getByRole("button", { name: "Correct cash repayment", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Correct cash repayment" });
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Actual credit-only cash was 70");
  await dialog.getByLabel("Corrected cash receipt").fill("70.00");
  await dialog.getByLabel("Excess disposition").selectOption("retainCredit");
  await dialog.getByRole("button", { name: "Preview Correction" }).click();
  await expect(
    dialog.getByRole("region", { name: "After receipt facts" }),
  ).toContainText("Retained credit 70.00 CNY");
  await dialog.getByRole("button", { name: "Confirm Correction" }).click();
  await expect(dialog).toBeHidden();
  const history = await read(
    request,
    `${data.base}/settlements/${data.settlement}/corrections`,
  );
  const correction = SettlementCorrectionResponse.parse(history[0]);
  expect(correction.after.allocations).toEqual([]);
  expect(correction.obligationsAfter).toEqual([]);
  const source = await read(
    request,
    `${data.base}/settlements/${data.settlement}`,
  );
  expect(source.creditOrigin.available.amount).toBe("70.00");
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath("credit-only-history.json"),
    JSON.stringify({ correction, source }, null, 2),
  );
});
