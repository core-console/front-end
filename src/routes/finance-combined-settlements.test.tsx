import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it } from "vitest";
import {
  getGetCurrentUserMockHandler,
  getListFinanceLedgersMockHandler,
  getListFinanceAccountsMockHandler,
  getListFinanceParticipantsMockHandler,
  getListFinanceCurrenciesMockHandler,
} from "@/api/generated/core-console.msw";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import { submissionTestUser } from "@/test/submission-fixtures";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as account,
} from "@/test/advance-fixtures";
import { outstandingObligations, money } from "@/test/settlement-fixtures";
import {
  combinedSettlement,
  combinedPreview,
  combinedReceipt,
  combinedObligations,
} from "@/test/combined-settlement-fixtures";

beforeEach(() =>
  server.use(
    getGetCurrentUserMockHandler(submissionTestUser),
    getListFinanceLedgersMockHandler([ledger]),
    getListFinanceAccountsMockHandler([account]),
    getListFinanceParticipantsMockHandler([{ ...person, status: "archived" }]),
    getListFinanceCurrenciesMockHandler([
      { code: "CNY", minorUnit: 2 },
      { code: "JPY", minorUnit: 0 },
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
      HttpResponse.json(combinedSettlement),
    ),
  ),
);

async function draft() {
  const user = userEvent.setup();
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  const button = await screen.findByRole(
    "button",
    { name: "Record combined Settlement" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  const dialog = screen.getByRole("dialog", {
    name: "Record combined Settlement",
  });
  await user.selectOptions(
    within(dialog).getByLabelText("Receiving Account"),
    account.id,
  );
  await user.clear(within(dialog).getByLabelText("Settlement date"));
  await user.type(
    within(dialog).getByLabelText("Settlement date"),
    combinedSettlement.transactionDate,
  );
  await user.click(
    await within(dialog).findByRole("checkbox", {
      name: new RegExp(outstandingObligations[1]!.id),
    }),
  );
  await user.click(
    within(dialog).getByRole("checkbox", {
      name: new RegExp(outstandingObligations[0]!.id),
    }),
  );
  await user.type(within(dialog).getByLabelText("Cash received"), "90");
  await user.type(within(dialog).getByLabelText("Forgiveness amount"), "10");
  await user.type(
    within(dialog).getByLabelText("Reason"),
    combinedSettlement.reason,
  );
  return { user, dialog };
}

it("retries only the original v6 body, owner and key after an uncertain outcome", async () => {
  const posts: {
    key: string | null;
    version: string | null;
    owner: string | null;
    body: string;
  }[] = [];
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(combinedPreview),
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        posts.push({
          key: request.headers.get("Idempotency-Key"),
          version: request.headers.get("Finance-Command-Version"),
          owner: request.headers.get("Finance-Submission-Owner"),
          body: await request.text(),
        });
        return posts.length === 1
          ? HttpResponse.json({})
          : HttpResponse.json(combinedReceipt(posts[0]!.key!), {
              status: 201,
            });
      },
    ),
    http.get("*/api/finance/submissions/:id", ({ params }) =>
      HttpResponse.json({
        state: "unfinished",
        submissionId: params.id,
        operation: "createFinanceSettlement",
        commandVersion: "6",
        targetLedgerId: ledger.id,
        admittedAt: combinedSettlement.confirmedAt,
      }),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview combined Settlement" }),
  );
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm combined Settlement",
    }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Close to recovery" }),
  );
  const retry = await screen.findByRole("button", {
    name: "Retry original submission",
  });
  await waitFor(() => expect(retry).toBeEnabled());
  expect(
    screen.getByRole("button", { name: "Record combined Settlement" }),
  ).toBeDisabled();
  await user.click(retry);
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]).toEqual(posts[0]);
  expect(posts[0]).toMatchObject({
    version: "6",
    owner: submissionTestUser.id,
  });
  expect(
    await screen.findByRole("link", { name: /Open Settlement/ }),
  ).toBeVisible();
});

it("drops stale confirmation but preserves intent until a new preview and deliberate action", async () => {
  let previews = 0;
  const keys: string[] = [];
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () => {
      previews++;
      return HttpResponse.json({
        ...combinedPreview,
        previewToken: (previews === 1 ? "a" : "b").repeat(64),
      });
    }),
    http.post("*/api/finance/ledgers/:ledger/settlements", ({ request }) => {
      const key = request.headers.get("Idempotency-Key")!;
      keys.push(key);
      if (keys.length > 1)
        return HttpResponse.json(combinedReceipt(key), { status: 201 });
      const problem = {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "finance_settlement_preview_stale",
        detail: "Selected debt changed.",
      };
      return HttpResponse.json(
        {
          ...problem,
          submissionReceipt: {
            ...combinedReceipt(key),
            outcome: { kind: "rejected", problem },
          },
        },
        { status: 409 },
      );
    }),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview combined Settlement" }),
  );
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm combined Settlement",
    }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByRole("button", {
        name: "Confirm combined Settlement",
      }),
    ).not.toBeInTheDocument(),
  );
  expect(within(dialog).getByLabelText("Reason")).toHaveValue(
    combinedSettlement.reason,
  );
  const refresh = await within(dialog).findByRole("button", {
    name: "Refresh preview",
  });
  await waitFor(() => expect(refresh).toBeEnabled());
  await user.click(refresh);
  expect(keys).toHaveLength(1);
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm combined Settlement",
    }),
  );
  await waitFor(() => expect(keys).toHaveLength(2));
  expect(keys[0]).not.toBe(keys[1]);
});

it("previews cash 40 + 50 before forgiveness 10 and confirms the whole v6 action", async () => {
  let confirmed = false;
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        expect(await request.json()).toEqual({
          kind: "combined",
          participantId: person.id,
          receivingAccountId: account.id,
          selectedObligationIds: [
            ...combinedSettlement.selectedObligationIds,
          ].reverse(),
          transactionDate: combinedSettlement.transactionDate,
          amount: money("90"),
          forgivenessAmount: money("10"),
          reason: combinedSettlement.reason,
          note: null,
        });
        return HttpResponse.json(combinedPreview);
      },
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        expect(request.headers.get("Finance-Command-Version")).toBe("6");
        expect(request.headers.get("Finance-Submission-Owner")).toBe(
          submissionTestUser.id,
        );
        expect(await request.json()).toMatchObject({
          kind: "combined",
          amount: money("90"),
          forgivenessAmount: money("10"),
          previewToken: combinedPreview.previewToken,
        });
        confirmed = true;
        return HttpResponse.json(
          combinedReceipt(request.headers.get("Idempotency-Key")!),
          { status: 201 },
        );
      },
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () =>
        HttpResponse.json(
          confirmed ? combinedObligations : outstandingObligations,
        ),
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/settlements",
      () => HttpResponse.json(confirmed ? [combinedSettlement] : []),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview combined Settlement" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Combined Settlement preview",
  });
  expect(within(review).getByText("Expense increase")).toBeVisible();
  expect(
    within(review).getByRole("columnheader", { name: "Cash paid" }),
  ).toBeVisible();
  expect(
    within(review).getByRole("columnheader", { name: "Forgiven" }),
  ).toBeVisible();
  const rows = within(review).getAllByRole("row");
  expect(rows).toHaveLength(4);
  expect(rows[1]).toHaveTextContent("40.00 CNY");
  expect(rows[2]).toHaveTextContent("50.00 CNY");
  expect(rows[3]).toHaveTextContent("10.00 CNY");
  expect(rows[2]).toHaveTextContent(outstandingObligations[1]!.id);
  expect(rows[3]).toHaveTextContent(outstandingObligations[1]!.id);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm combined Settlement" }),
  );
  const detail = await screen.findByRole("region", {
    name: "Confirmed Settlement",
  });
  expect(
    await within(detail).findByText(combinedSettlement.reason),
  ).toBeVisible();
  expect(within(detail).getByText("Cash received")).toBeVisible();
  expect(
    within(detail).getByText("Forgiven principal / Expense"),
  ).toBeVisible();
  expect(
    within(detail).getAllByRole("link", {
      name: /View linked cash \/ Expense Transaction/,
    }),
  ).toHaveLength(3);
  expect(within(detail).getByText(/archived/)).toBeVisible();
  const history = screen.getByRole("region", { name: "Settlement history" });
  expect(
    await within(history).findByRole("link", {
      name: /Cash received 90.00 CNY · Forgiven 10.00 CNY/,
    }),
  ).toBeVisible();
});

it.each([
  { cash: "0", amount: "10", reason: "Reason", message: /positive exact cash/ },
  {
    cash: "90.001",
    amount: "10",
    reason: "Reason",
    message: /positive exact cash/,
  },
  {
    cash: "90",
    amount: "0",
    reason: "Reason",
    message: /positive exact amount/,
  },
  {
    cash: "90",
    amount: "10.001",
    reason: "Reason",
    message: /positive exact amount/,
  },
  {
    cash: "90",
    amount: "11",
    reason: "Reason",
    message: /remaining selected capacity after cash/,
  },
  {
    cash: "101",
    amount: "1",
    reason: "Reason",
    message: /remaining selected capacity after cash/,
  },
  { cash: "90", amount: "10", reason: "   ", message: /reason of 1–500/ },
  {
    cash: "90",
    amount: "10",
    reason: "x".repeat(501),
    message: /reason of 1–500/,
  },
])(
  "blocks invalid combined intent $cash / $amount before preview",
  async ({ cash, amount, reason, message }) => {
    let calls = 0;
    server.use(
      http.post("*/api/finance/ledgers/:ledger/settlements/preview", () => {
        calls++;
        return HttpResponse.json(combinedPreview);
      }),
    );
    const { user, dialog } = await draft();
    for (const [label, value] of [
      ["Cash received", cash],
      ["Forgiveness amount", amount],
      ["Reason", reason],
    ]) {
      await user.clear(within(dialog).getByLabelText(label!));
      await user.click(within(dialog).getByLabelText(label!));
      await user.paste(value!);
    }
    await user.click(
      within(dialog).getByRole("button", {
        name: "Preview combined Settlement",
      }),
    );
    expect(await within(dialog).findByText(message)).toBeVisible();
    expect(calls).toBe(0);
    expect(
      within(dialog).queryByRole("button", {
        name: "Confirm combined Settlement",
      }),
    ).not.toBeInTheDocument();
  },
);

it.each([
  { label: "wrong cash", change: { amount: money("91") } },
  { label: "wrong forgiveness", change: { forgivenessAmount: money("9") } },
  { label: "wrong Expense", change: { expense: money("11") } },
  {
    label: "wrong receiving effect",
    change: { receivingBalanceAfter: money("200") },
  },
  {
    label: "wrong currency",
    change: { expense: { amount: "10", currency: "USD" } },
  },
  { label: "wrong remaining debt", change: { outstandingAfter: money("1") } },
  {
    label: "forgiveness before cash",
    change: {
      allocations: [
        combinedPreview.allocations[2],
        ...combinedPreview.allocations.slice(0, 2),
      ].map((row, index) => ({ ...row, position: index + 1 })),
    },
  },
  {
    label: "allocation outside scope",
    change: {
      allocations: combinedPreview.allocations.map((row) => ({
        ...row,
        obligationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      })),
    },
  },
])("rejects a $label preview without replacing intent", async ({ change }) => {
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json({ ...combinedPreview, ...change }),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview combined Settlement" }),
  );
  expect(
    await within(dialog).findByText(
      /Your combined Settlement intent is preserved/,
    ),
  ).toBeVisible();
  expect(within(dialog).getByLabelText("Cash received")).toHaveValue("90");
  expect(within(dialog).getByLabelText("Forgiveness amount")).toHaveValue("10");
  expect(
    within(dialog).queryByRole("button", {
      name: "Confirm combined Settlement",
    }),
  ).not.toBeInTheDocument();
});

it.each(["asset", "liability"] as const)(
  "shows AC15 cash 98 / forgiveness 2 on a receiving %s",
  async (nature) => {
    const preview = {
      ...combinedPreview,
      amount: money("98.00"),
      forgivenessAmount: money("2.00"),
      expense: money("2.00"),
      receivingBalanceAfter: money(nature === "asset" ? "198.00" : "2.00"),
      allocations: combinedPreview.allocations.map((row, index) =>
        index === 1
          ? { ...row, cashPaid: money("58.00"), remainingAfter: money("2.00") }
          : index === 2
            ? { ...row, forgiven: money("2.00") }
            : row,
      ),
    };
    server.use(
      getListFinanceAccountsMockHandler([{ ...account, nature }]),
      http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
        HttpResponse.json(preview),
      ),
    );
    const { user, dialog } = await draft();
    await user.clear(within(dialog).getByLabelText("Cash received"));
    await user.type(within(dialog).getByLabelText("Cash received"), "98");
    await user.clear(within(dialog).getByLabelText("Forgiveness amount"));
    await user.type(within(dialog).getByLabelText("Forgiveness amount"), "2");
    await user.click(
      within(dialog).getByRole("button", {
        name: "Preview combined Settlement",
      }),
    );
    const review = await within(dialog).findByRole("region", {
      name: "Combined Settlement preview",
    });
    expect(
      within(review).getByText("98.00 CNY", { exact: true }),
    ).toBeVisible();
    expect(within(review).getByText("Expense increase")).toBeVisible();
    expect(
      within(dialog).getByRole("button", {
        name: "Confirm combined Settlement",
      }),
    ).toBeEnabled();
    await user.type(within(dialog).getByLabelText("Reason"), " changed");
    expect(
      within(dialog).queryByRole("button", {
        name: "Confirm combined Settlement",
      }),
    ).not.toBeInTheDocument();
  },
);

it("retains an explicit shortfall and unavailable selection without silently clearing debt", async () => {
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json({
        ...combinedPreview,
        forgivenessAmount: money("9.00"),
        expense: money("9.00"),
        outstandingAfter: money("1.00"),
        allocations: combinedPreview.allocations.map((row, index) =>
          index === 2
            ? { ...row, forgiven: money("9.00"), remainingAfter: money("1.00") }
            : row,
        ),
      }),
    ),
  );
  const { user, dialog } = await draft();
  await user.clear(within(dialog).getByLabelText("Forgiveness amount"));
  await user.type(within(dialog).getByLabelText("Forgiveness amount"), "9");
  await user.click(
    within(dialog).getByRole("button", { name: "Preview combined Settlement" }),
  );
  expect(
    await within(dialog).findByText(/any remaining shortfall stay outstanding/),
  ).toBeVisible();
  await user.clear(within(dialog).getByLabelText("Settlement date"));
  await user.type(
    within(dialog).getByLabelText("Settlement date"),
    "2026-01-10",
  );
  expect(
    within(dialog).getByRole("checkbox", { name: /Unavailable selection/ }),
  ).toBeChecked();
  expect(
    within(dialog).queryByRole("button", {
      name: "Confirm combined Settlement",
    }),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview combined Settlement" }),
  );
  expect(
    await within(dialog).findByText(/Remove unavailable selections explicitly/),
  ).toBeVisible();
});

it("rejects retained combined history with inconsistent typed composition", async () => {
  server.use(
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json({
        ...combinedSettlement,
        forgivenessAmount: money("11.00"),
      }),
    ),
  );
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}&settlement_id=${combinedSettlement.id}`,
  );
  expect(
    await screen.findByText(
      /Settlement source is unavailable/,
      {},
      { timeout: 5000 },
    ),
  ).toBeVisible();
  expect(
    screen.queryByText(combinedSettlement.reason, { exact: true }),
  ).not.toBeInTheDocument();
});

it("rejects debt from another Participant before selecting or previewing", async () => {
  server.use(
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () =>
        HttpResponse.json(
          outstandingObligations.map((row) => ({
            ...row,
            participantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          })),
        ),
    ),
  );
  const user = userEvent.setup();
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  const trigger = await screen.findByRole("button", {
    name: "Record combined Settlement",
  });
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", {
    name: "Record combined Settlement",
  });
  await user.selectOptions(
    within(dialog).getByLabelText("Receiving Account"),
    account.id,
  );
  expect(await within(dialog).findByText(/Debt could not load/)).toBeVisible();
  expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
});

it("previews and submits a contract-valid reason with 300 Unicode characters", async () => {
  const reason = "😀".repeat(300);
  let posted = false;
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        expect(await request.json()).toMatchObject({ reason });
        return HttpResponse.json(combinedPreview);
      },
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        expect(await request.json()).toMatchObject({ reason });
        expect(request.headers.get("Finance-Command-Version")).toBe("6");
        posted = true;
        return HttpResponse.json(
          combinedReceipt(request.headers.get("Idempotency-Key")!),
          { status: 201 },
        );
      },
    ),
  );
  const { user, dialog } = await draft();
  await user.clear(within(dialog).getByLabelText("Reason"));
  await user.click(within(dialog).getByLabelText("Reason"));
  await user.paste(reason);
  await user.click(
    within(dialog).getByRole("button", { name: "Preview combined Settlement" }),
  );
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm combined Settlement",
    }),
  );
  await waitFor(() => expect(posted).toBe(true));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
});
