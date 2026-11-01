import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  AdvanceCorrectionResponse,
  FinanceSubmissionResponse,
} from "../src/api/generated/schemas/index.ts";
const backend = process.env.FINANCE_T12_TEST_BACKEND;
test.skip(
  !backend,
  "Requires exact-P server on guarded PostgreSQL at 127.0.0.1:8299.",
);
test.describe.configure({ mode: "serial" });
const money = (amount: string) => ({ amount, currency: "CNY" });
async function read(request: APIRequestContext, path: string) {
  const response = await request.get(
    `${backend}${path}`,
    path.includes("/submissions/")
      ? {
          headers: {
            "Finance-Submission-Owner": (
              await (await request.get(`${backend}/api/me`)).json()
            ).id,
          },
        }
      : {},
  );
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function seed(request: APIRequestContext) {
  expect(backend).toBe("http://127.0.0.1:8299");
  const owner = (await read(request, "/api/me")).id as string;
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
      name: `T12 ${randomUUID()}`,
    }),
    base = `/api/finance/ledgers/${ledger}`;
  const account = await create(`${base}/accounts`, {
    name: "Checking",
    nature: "asset",
    currency: "CNY",
    openingBalance: money("1000"),
    trackingStartDate: "2026-01-01",
  });
  const card = await create(`${base}/accounts`, {
    name: "Card",
    nature: "liability",
    currency: "CNY",
    openingBalance: money("100"),
    trackingStartDate: "2026-01-01",
  });
  const people: string[] = [];
  for (const name of ["Alex", "Blair"]) {
    const response = await request.post(`${backend}${base}/participants`, {
      data: { name },
    });
    expect(response.status()).toBe(201);
    people.push((await response.json()).id);
  }
  const p1 = people[0]!,
    p2 = people[1]!;
  const original = {
    fundingAccountId: card,
    transactionDate: "2026-10-20",
    amount: money("300"),
    ownerShare: money("100"),
    participantShares: [
      { participantId: p1, amount: money("120") },
      { participantId: p2, amount: money("80") },
    ],
    note: "Original purchase",
  };
  const preview = await readPreview(
    request,
    `${base}/advances/preview`,
    original,
  );
  const advance = await create(
    `${base}/advances`,
    { ...original, previewToken: preview.previewToken },
    "2",
  );
  const receipt = {
    participantId: p1,
    receivingAccountId: account,
    transactionDate: "2026-10-01",
    amount: money("25"),
    excessDisposition: "retainCredit",
  };
  const cp = await readPreview(request, `${base}/settlements/preview`, receipt);
  await create(
    `${base}/settlements`,
    { ...receipt, previewToken: cp.previewToken },
    "2",
  );
  return { owner, ledger, base, account, card, p1, p2, advance, create };
}
async function readPreview(
  request: APIRequestContext,
  path: string,
  data: unknown,
) {
  const response = await request.post(`${backend}${path}`, { data });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
function errorsOn(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}
for (const recovery of ["lookup", "retry"] as const)
  test(`real P correction restates exact funding/shares and recovers committed response loss by ${recovery}`, async ({
    page,
    context,
    request,
  }, info) => {
    const data = await seed(request);
    const errors = errorsOn(page);
    const posts: {
      key: string;
      version: string;
      owner: string;
      body: string;
    }[] = [];
    let observed: unknown;
    await context.route("**/api/**", async (route) => {
      const r = route.request(),
        path = new URL(r.url()).pathname;
      const response = await route.fetch({
        url: `${backend}${path}${new URL(r.url()).search}`,
      });
      if (
        path === `${data.base}/advance-corrections` &&
        r.method() === "POST"
      ) {
        posts.push({
          key: r.headers()["idempotency-key"]!,
          version: r.headers()["finance-command-version"]!,
          owner: r.headers()["finance-submission-owner"]!,
          body: r.postData()!,
        });
        if (posts.length === 1) {
          expect(response.status(), await response.text()).toBe(201);
          observed = await read(request, `/t12-test/effects/${data.ledger}`);
          expect(
            (observed as { corrections: unknown[] }).corrections,
          ).toHaveLength(1);
          await route.fulfill({ status: 201, json: {} });
          return;
        }
      }
      await route.fulfill({ response });
    });
    await page.goto(
      `/finance/advances?ledger=${data.ledger}&advance_id=${data.advance}`,
    );
    await page
      .getByRole("button", { name: "Correct Advance", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Correct Advance",
      exact: true,
    });
    const reason = "😀".repeat(500);
    await dialog.getByLabel("Reason", { exact: true }).fill(reason);
    await dialog
      .getByLabel("Funding Account", { exact: true })
      .selectOption(data.account);
    await dialog
      .getByLabel("Original financial date", { exact: true })
      .fill("2026-10-15");
    await dialog.getByLabel("Total funding", { exact: true }).fill("280");
    await dialog.getByLabel("Owner share", { exact: true }).fill("110");
    // Obligation ordering is producer-owned, select by Participant ID rather than list assumptions.
    for (const i of [1, 2]) {
      const participant = await dialog
        .getByLabel(`Participant ${i}`, { exact: true })
        .inputValue();
      await dialog
        .getByLabel(`Participant ${i} share`, { exact: true })
        .fill(participant === data.p1 ? "100" : "70");
    }
    await dialog.getByLabel("Note", { exact: true }).fill("😀".repeat(500));
    await dialog.getByRole("button", { name: "Preview Correction" }).click();
    await expect(
      dialog.getByRole("button", { name: "Confirm Correction" }),
    ).toBeFocused();
    await page.screenshot({ path: info.outputPath("real-preview.png") });
    await dialog.getByRole("button", { name: "Confirm Correction" }).click();
    await expect(
      dialog.getByText(/The original command is retained/),
    ).toBeVisible();
    await dialog
      .locator("form")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Correct Advance", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", {
        name:
          recovery === "lookup" ? "Check outcome" : "Retry original submission",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Acknowledge outcome", exact: true }),
    ).toBeVisible();
    const history = page.getByRole("region", {
      name: "Advance Correction history",
      exact: true,
    });
    await expect(history).toContainText("Revision 1");
    await expect(history).toContainText(reason);
    await page.screenshot({ path: info.outputPath("real-history.png") });
    const corrections: AdvanceCorrectionResponse[] = (
      await read(request, `${data.base}/advances/${data.advance}/corrections`)
    ).map((c: unknown) => AdvanceCorrectionResponse.parse(c));
    expect(corrections).toHaveLength(1);
    const c = corrections[0]!;
    expect(c.after.amount).toEqual(money("280.00"));
    expect(c.after.ownerShare).toEqual(money("110.00"));
    expect(c.after.confirmedAt).toBe(c.before.confirmedAt);
    expect(c.after.transactionDate).toBe("2026-10-15");
    expect(c.before.amount).toEqual(money("300.00"));
    expect(c.after.obligations.map((o) => o.principal.amount).sort()).toEqual([
      "100.00",
      "70.00",
    ]);
    const accounts = await read(request, `${data.base}/accounts`);
    expect(
      accounts.find((a: { id: string }) => a.id === data.card).currentBalance,
    ).toEqual(money("100.00"));
    expect(
      accounts.find((a: { id: string }) => a.id === data.account)
        .currentBalance,
    ).toEqual(money("745.00"));
    const positions = await read(
      request,
      `${data.base}/participants/${data.p1}/positions`,
    );
    expect(positions[0].availableCredits).toEqual(money("25.00"));
    expect(positions[0].outstandingReceivables).toEqual(money("100.00"));
    const terminal = FinanceSubmissionResponse.parse(
      await read(request, `/api/finance/submissions/${posts[0]!.key}`),
    );
    expect(terminal.state).toBe("terminal");
    const effects = await read(request, `/t12-test/effects/${data.ledger}`);
    expect(effects.corrections).toHaveLength(1);
    expect(effects.commands).toHaveLength(1);
    if (recovery === "retry") {
      expect(posts).toHaveLength(2);
      expect(posts[1]).toEqual(posts[0]);
    } else expect(posts).toHaveLength(1);
    expect(posts[0]!.version).toBe("1");
    expect(posts[0]!.owner).toBe(data.owner);
    await mkdir(info.outputPath("evidence"), { recursive: true });
    await writeFile(
      info.outputPath(`evidence/${recovery}.json`),
      JSON.stringify(
        {
          producer: "d87550d839d2b45a9bb8d5c804016e0936e20163",
          data: { ...data, create: undefined },
          posts,
          observed,
          corrections,
          accounts,
          positions,
          terminal,
          effects,
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
  });

test("real P retains original and intermediate attribution through repeated and fully owner-funded future-date correction", async ({
  page,
  context,
  request,
}, info) => {
  const data = await seed(request);
  const errors = errorsOn(page);
  const first = {
    advanceId: data.advance,
    fundingAccountId: data.card,
    transactionDate: "2026-10-10",
    amount: money("300"),
    ownerShare: money("200"),
    participantShares: [{ participantId: data.p1, amount: money("100") }],
    reason: "Incorrect share attribution",
    note: null,
  };
  const preview = await readPreview(
    request,
    `${data.base}/advance-corrections/preview`,
    first,
  );
  await data.create(`${data.base}/advance-corrections`, {
    ...first,
    previewToken: preview.previewToken,
  });
  await context.route("**/api/**", async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    await route.fulfill({
      response: await route.fetch({
        url: `${backend}${url.pathname}${url.search}`,
      }),
    });
  });
  await page.goto(
    `/finance/advances?ledger=${data.ledger}&advance_id=${data.advance}`,
  );
  await page
    .getByRole("button", { name: "Correct Advance", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Correct Advance",
    exact: true,
  });
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Truthful owner-funded purchase; amount was entered incorrectly");
  await dialog.getByLabel("Total funding", { exact: true }).fill("250");
  await dialog.getByLabel("Owner share", { exact: true }).fill("250");
  await dialog
    .getByRole("button", { name: "Remove Participant 1", exact: true })
    .click();
  await dialog
    .getByLabel("Original financial date", { exact: true })
    .fill("2027-01-02");
  await dialog
    .getByRole("button", { name: "Preview Correction", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Confirm Correction", exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "Confirm Correction", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const history = page.getByRole("region", {
    name: "Advance Correction history",
    exact: true,
  });
  await expect(history).toContainText("Revision 2");
  const corrections: AdvanceCorrectionResponse[] = (
    await read(request, `${data.base}/advances/${data.advance}/corrections`)
  ).map((c: unknown) => AdvanceCorrectionResponse.parse(c));
  expect(corrections.map((c) => c.revision)).toEqual([1, 2]);
  expect(corrections[0]!.before.amount).toEqual(money("300.00"));
  expect(corrections[1]!.before).toEqual(corrections[0]!.after);
  expect(corrections[1]!.after.obligations.map((o) => o.id).sort()).toEqual(
    corrections[0]!.after.obligations.map((o) => o.id).sort(),
  );
  expect(
    corrections[1]!.after.obligations.every(
      (o) => o.principal.amount === "0.00" && o.remaining.amount === "0.00",
    ),
  ).toBe(true);
  expect(corrections[1]!.financialEffectsAfter).toHaveLength(1);
  expect(corrections[1]!.financialEffectsAfter[0]!.kind).toBe("expense");
  expect(corrections[1]!.financialEffectsAfter[0]!.ownerExpense).toEqual(
    money("250.00"),
  );
  expect(corrections[1]!.after.transactionDate).toBe("2027-01-02");
  const accounts = await read(request, `${data.base}/accounts`);
  expect(
    accounts.find((a: { id: string }) => a.id === data.card).currentBalance,
  ).toEqual(money("350.00"));
  const positions = await read(
    request,
    `${data.base}/participants/${data.p1}/positions`,
  );
  expect(positions[0].outstandingReceivables).toEqual(money("0.00"));
  expect(positions[0].availableCredits).toEqual(money("25.00"));
  await writeFile(
    info.outputPath("repeated-correction.json"),
    JSON.stringify(
      {
        data: { ...data, create: undefined },
        corrections,
        accounts,
        positions,
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});
