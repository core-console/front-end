import { act, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it } from "vitest";
import {
  getGetCurrentUserMockHandler,
  getListFinanceLedgersMockHandler,
  getListFinanceAccountsMockHandler,
  getListFinanceParticipantsMockHandler,
  getListFinanceCurrenciesMockHandler,
  getListFinanceCategoriesMockHandler,
} from "@/api/generated/core-console.msw";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import { submissionTestUser } from "@/test/submission-fixtures";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as account,
} from "@/test/advance-fixtures";
import {
  incomeCategory,
  incomePreview,
  incomeSettlement,
  incomeReceipt,
} from "@/test/income-settlement-fixtures";
import { outstandingObligations, money } from "@/test/settlement-fixtures";

beforeEach(() =>
  server.use(
    getGetCurrentUserMockHandler(submissionTestUser),
    getListFinanceLedgersMockHandler([ledger]),
    getListFinanceAccountsMockHandler([account]),
    getListFinanceParticipantsMockHandler([{ ...person, status: "archived" }]),
    getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
    getListFinanceCategoriesMockHandler([
      incomeCategory,
      {
        ...incomeCategory,
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        name: "Archived",
        status: "archived",
      },
    ]),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () => HttpResponse.json(outstandingObligations),
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/settlements",
      () => HttpResponse.json([]),
    ),
    http.get("*/api/finance/ledgers/:ledger/participants/:person/credits", () =>
      HttpResponse.json([]),
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/positions",
      () => HttpResponse.json([]),
    ),
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json(incomeSettlement),
    ),
  ),
);
async function draft() {
  const user = userEvent.setup();
  const record = await screen.findByRole(
    "button",
    { name: "Record repayment" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(record).toBeEnabled());
  await user.click(record);
  const dialog = screen.getByRole("dialog", { name: "Record repayment" });
  await user.selectOptions(
    within(dialog).getByLabelText("Participant"),
    person.id,
  );
  await user.selectOptions(
    within(dialog).getByLabelText("Receiving Account"),
    account.id,
  );
  await user.type(
    within(dialog).getByLabelText("Amount", { exact: true }),
    "102",
  );
  await user.clear(within(dialog).getByLabelText("Date"));
  await user.type(within(dialog).getByLabelText("Date"), "2027-01-02");
  expect(within(dialog).getByLabelText("Surplus handling")).toHaveValue(
    "repayOnly",
  );
  await user.selectOptions(
    within(dialog).getByLabelText("Surplus handling"),
    "acceptIncome",
  );
  await user.type(within(dialog).getByLabelText("Accepted Income amount"), "2");
  await within(dialog).findByRole("option", { name: /Gifts/ });
  await user.selectOptions(
    within(dialog).getByLabelText("Income Category"),
    incomeCategory.id,
  );
  return { user, dialog };
}
it("explicitly accepts Income 2 from receipt 102 and previews and retains principal 100 without creating credit", async () => {
  const expected = {
    participantId: person.id,
    receivingAccountId: account.id,
    transactionDate: "2027-01-02",
    amount: money("102"),
    note: null,
    excessDisposition: "acceptIncome",
    categoryAllocations: [
      { amount: money("2"), categoryId: incomeCategory.id },
    ],
  };
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        expect(await request.json()).toEqual(expected);
        return HttpResponse.json(incomePreview);
      },
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        expect(request.headers.get("Finance-Command-Version")).toBe("3");
        expect(await request.json()).toEqual({
          ...expected,
          previewToken: incomePreview.previewToken,
        });
        return HttpResponse.json(
          incomeReceipt(request.headers.get("Idempotency-Key")!),
          { status: 201 },
        );
      },
    ),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  expect(
    within(dialog).queryByRole("option", { name: /Archived/ }),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Repayment preview",
  });
  expect(
    within(review).getByText("Accepted surplus Income").nextElementSibling,
  ).toHaveTextContent("2.00 CNY");
  expect(
    within(review).getByText("Income Category").nextElementSibling,
  ).toHaveTextContent("Gifts");
  expect(review).toHaveTextContent("No Participant credit is created");
  expect(
    within(review).getByText("Available credit after").nextElementSibling,
  ).toHaveTextContent("5.00 CNY");
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm repayment" }),
  );
  const result = await screen.findByRole("region", {
    name: "Confirmed Settlement",
  });
  expect(
    await within(result).findByText("Accepted surplus Income"),
  ).toBeVisible();
  expect(
    within(result).getByText("Accepted surplus Income").nextElementSibling,
  ).toHaveTextContent("2.00 CNY");
  expect(
    within(result).getByRole("link", {
      name: /View accepted Income Transaction/,
    }),
  ).toHaveAttribute(
    "href",
    `/finance/transactions/${incomeSettlement.incomeTransactionId}?ledger=${ledger.id}`,
  );
});

it("rejects invalid Income precision locally without rounding or dispatching a preview", async () => {
  const previews: unknown[] = [];
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        previews.push(await request.json());
        return HttpResponse.json(incomePreview);
      },
    ),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.clear(within(dialog).getByLabelText("Accepted Income amount"));
  await user.type(
    within(dialog).getByLabelText("Accepted Income amount"),
    "2.000",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  expect(
    within(dialog).getByLabelText("Accepted Income amount"),
  ).toHaveAttribute("aria-invalid", "true");
  expect(within(dialog).getByLabelText("Accepted Income amount")).toHaveFocus();
  expect(within(dialog).getByLabelText("Accepted Income amount")).toHaveValue(
    "2.000",
  );
  expect(previews).toEqual([]);
  expect(
    within(dialog).queryByRole("button", { name: "Confirm repayment" }),
  ).not.toBeInTheDocument();
});

it("preserves Income intent when stale state prevents regeneration, then requires explicit adjustment and a new confirmation", async () => {
  const previews: unknown[] = [];
  const posts: { key: string; body: unknown }[] = [];
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        const body = (await request.json()) as {
          categoryAllocations: { amount: { amount: string } }[];
        };
        previews.push(body);
        if (
          previews.length > 1 &&
          body.categoryAllocations[0]!.amount.amount === "2"
        )
          return HttpResponse.json(
            {
              type: "about:blank",
              title: "Invalid",
              status: 422,
              code: "validation_error",
              detail: "Classification no longer matches surplus.",
            },
            { status: 422 },
          );
        return HttpResponse.json(
          previews.length === 1
            ? incomePreview
            : {
                ...incomePreview,
                previewToken: "b".repeat(64),
                acceptedSurplus: money("22.00"),
                categoryAllocations: [
                  { amount: money("22.00"), categoryId: incomeCategory.id },
                ],
                outstandingBefore: money("80.00"),
                allocations: incomePreview.allocations.map((item) => ({
                  ...item,
                  cashPaid: money("40.00"),
                })),
              },
        );
      },
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        const key = request.headers.get("Idempotency-Key")!;
        posts.push({ key, body: await request.json() });
        const problem = {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "finance_settlement_preview_stale",
          detail: "Debt changed.",
        };
        return posts.length === 1
          ? HttpResponse.json(
              {
                ...problem,
                submissionReceipt: {
                  ...incomeReceipt(key),
                  outcome: { kind: "rejected", problem },
                },
              },
              { status: 409 },
            )
          : HttpResponse.json(incomeReceipt(key), { status: 201 });
      },
    ),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Confirm repayment" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Refresh preview" }),
  );
  expect(
    await within(dialog).findByText(/Your Income intent is preserved/),
  ).toBeVisible();
  expect(within(dialog).getByLabelText("Amount", { exact: true })).toHaveValue(
    "102",
  );
  expect(within(dialog).getByLabelText("Accepted Income amount")).toHaveValue(
    "2",
  );
  expect(within(dialog).getByLabelText("Income Category")).toHaveValue(
    incomeCategory.id,
  );
  expect(within(dialog).getByLabelText("Surplus handling")).toHaveValue(
    "acceptIncome",
  );
  expect(
    within(dialog).queryByRole("button", { name: "Confirm repayment" }),
  ).not.toBeInTheDocument();
  expect(posts).toHaveLength(1);
  await user.clear(within(dialog).getByLabelText("Accepted Income amount"));
  await user.type(
    within(dialog).getByLabelText("Accepted Income amount"),
    "22",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Repayment preview",
  });
  expect(
    within(review).getByText("Accepted surplus Income").nextElementSibling,
  ).toHaveTextContent("22.00 CNY");
  expect(posts).toHaveLength(1);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm repayment" }),
  );
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]!.key).not.toBe(posts[0]!.key);
  expect(posts[1]!.body).toMatchObject({
    excessDisposition: "acceptIncome",
    previewToken: "b".repeat(64),
    categoryAllocations: [{ amount: money("22") }],
  });
});

it("does not offer confirmation for a preview that substitutes a different Income amount", async () => {
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json({
        ...incomePreview,
        acceptedSurplus: money("22.00"),
        categoryAllocations: [
          { amount: money("22.00"), categoryId: incomeCategory.id },
        ],
      }),
    ),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  expect(
    await within(dialog).findByText(/Your Income intent is preserved/),
  ).toBeVisible();
  expect(within(dialog).getByLabelText("Accepted Income amount")).toHaveValue(
    "2",
  );
  expect(
    within(dialog).queryByRole("button", { name: "Confirm repayment" }),
  ).not.toBeInTheDocument();
});

it("keeps an unavailable selected Income Category visible and requires explicit replacement", async () => {
  const previews: unknown[] = [];
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        previews.push(await request.json());
        return HttpResponse.json(incomePreview);
      },
    ),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  server.use(getListFinanceCategoriesMockHandler([]));
  await user.click(
    within(dialog).getByRole("button", { name: "Refresh dependencies" }),
  );
  expect(
    await within(dialog).findByRole("option", { name: /Unavailable Category/ }),
  ).toHaveValue(incomeCategory.id);
  expect(within(dialog).getByLabelText("Income Category")).toHaveValue(
    incomeCategory.id,
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  expect(within(dialog).getByLabelText("Income Category")).toHaveFocus();
  expect(within(dialog).getByLabelText("Income Category")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(previews).toEqual([]);
});

it("accepts a whole unallocated receipt as uncategorized Income into a Liability without fabricating debt", async () => {
  const whole = {
    ...incomePreview,
    amount: money("50.00"),
    acceptedSurplus: money("50.00"),
    categoryAllocations: [{ amount: money("50.00"), categoryId: null }],
    allocations: [],
    outstandingBefore: money("0.00"),
    outstandingAfter: money("0.00"),
    receivingBalanceAfter: money("50.00"),
  };
  server.use(
    getListFinanceAccountsMockHandler([{ ...account, nature: "liability" }]),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        expect(await request.json()).toMatchObject({
          amount: money("50"),
          excessDisposition: "acceptIncome",
          categoryAllocations: [{ amount: money("50"), categoryId: null }],
        });
        return HttpResponse.json(whole);
      },
    ),
    http.post("*/api/finance/ledgers/:ledger/settlements", ({ request }) =>
      HttpResponse.json(
        incomeReceipt(request.headers.get("Idempotency-Key")!),
        { status: 201 },
      ),
    ),
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json({
        ...incomeSettlement,
        amount: money("50.00"),
        acceptedSurplus: money("50.00"),
        allocations: [],
        transactionIds: [incomeSettlement.incomeTransactionId],
      }),
    ),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.clear(within(dialog).getByLabelText("Amount", { exact: true }));
  await user.type(
    within(dialog).getByLabelText("Amount", { exact: true }),
    "50",
  );
  await user.clear(within(dialog).getByLabelText("Accepted Income amount"));
  await user.type(
    within(dialog).getByLabelText("Accepted Income amount"),
    "50",
  );
  await user.selectOptions(
    within(dialog).getByLabelText("Income Category"),
    "",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Repayment preview",
  });
  expect(review).toHaveTextContent("Receiving Liability decreases");
  expect(review).toHaveTextContent("No Obligation is created");
  expect(
    within(review).getByText("Income Category").nextElementSibling,
  ).toHaveTextContent("Uncategorized");
  expect(
    within(review).getByRole("table").querySelectorAll("tbody tr"),
  ).toHaveLength(0);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm repayment" }),
  );
  const source = await screen.findByRole("region", {
    name: "Confirmed Settlement",
  });
  await waitFor(() => expect(source).toHaveTextContent("50.00 CNY"));
});

it("rejects an Income source whose linked Income Transaction is outside its retained transaction list", async () => {
  server.use(
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json({
        ...incomeSettlement,
        incomeTransactionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      }),
    ),
  );
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}&settlement_id=${incomeSettlement.id}`,
  );
  expect(
    await screen.findByText(
      /Settlement source is unavailable/,
      {},
      { timeout: 5000 },
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /View accepted Income Transaction/ }),
  ).not.toBeInTheDocument();
});

it.each(["retry", "lookup"])(
  "recovers an uncertain Income command through %s without changing its version, key, amount or Category",
  async (mode) => {
    const posts: { key: string; version: string; body: unknown }[] = [];
    let terminal = false;
    server.use(
      http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
        HttpResponse.json(incomePreview),
      ),
      http.post(
        "*/api/finance/ledgers/:ledger/settlements",
        async ({ request }) => {
          const key = request.headers.get("Idempotency-Key")!;
          posts.push({
            key,
            version: request.headers.get("Finance-Command-Version")!,
            body: await request.json(),
          });
          return posts.length === 1
            ? HttpResponse.error()
            : HttpResponse.json(incomeReceipt(key), { status: 201 });
        },
      ),
      http.get("*/api/finance/submissions/:id", ({ params }) =>
        terminal
          ? HttpResponse.json({
              state: "terminal",
              receipt: incomeReceipt(String(params.id)),
            })
          : HttpResponse.json(
              {
                type: "about:blank",
                title: "Not found",
                status: 404,
                code: "finance_submission_not_found",
              },
              { status: 404 },
            ),
      ),
      http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
        HttpResponse.json(
          { type: "about:blank", title: "Unavailable", status: 503 },
          { status: 503 },
        ),
      ),
    );
    const { router } = renderRoute(`/finance/repayments?ledger=${ledger.id}`);
    const { user, dialog } = await draft();
    await user.click(
      within(dialog).getByRole("button", { name: "Preview repayment" }),
    );
    await user.click(
      await within(dialog).findByRole("button", { name: "Confirm repayment" }),
    );
    expect(await within(dialog).findByText(/outcome is unknown/)).toBeVisible();
    expect(
      within(dialog).getByLabelText("Accepted Income amount"),
    ).toBeDisabled();
    await user.click(
      within(dialog).getByRole("button", { name: "Close to recovery" }),
    );
    await act(() => router.navigate("/"));
    await act(() => router.navigate(`/finance/repayments?ledger=${ledger.id}`));
    const recovery = await screen.findByRole("region", {
      name: "Finance submission recovery",
    });
    await waitFor(() =>
      expect(recovery).toHaveTextContent("Accepted Income 2 CNY"),
    );
    expect(recovery).toHaveTextContent(incomeCategory.id);
    expect(
      await screen.findByRole("button", { name: "Record repayment" }),
    ).toBeDisabled();
    expect(posts).toHaveLength(1);
    if (mode === "lookup") {
      terminal = true;
      await user.click(
        within(recovery).getByRole("button", { name: "Check outcome" }),
      );
    } else
      await user.click(
        within(recovery).getByRole("button", {
          name: "Retry original submission",
        }),
      );
    await within(recovery).findByRole("link", { name: "Open Settlement" });
    expect(posts[0]).toMatchObject({
      version: "3",
      body: {
        excessDisposition: "acceptIncome",
        categoryAllocations: [
          { amount: money("2"), categoryId: incomeCategory.id },
        ],
      },
    });
    if (mode === "retry") expect(posts).toEqual([posts[0], posts[0]]);
    else expect(posts).toHaveLength(1);
    expect(
      within(recovery).queryByRole("button", {
        name: "Retry original submission",
      }),
    ).not.toBeInTheDocument();
  },
);
