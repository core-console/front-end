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
  forgiveness,
  forgivenessPreview,
  forgivenessReceipt,
  forgivenObligations,
} from "@/test/forgiveness-fixtures";

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
      HttpResponse.json(forgiveness),
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
    { name: "Record forgiveness" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  const dialog = screen.getByRole("dialog", { name: "Record forgiveness" });
  await user.selectOptions(
    within(dialog).getByLabelText("Currency", { exact: true }),
    "CNY",
  );
  await user.clear(within(dialog).getByLabelText("Forgiveness date"));
  await user.type(
    within(dialog).getByLabelText("Forgiveness date"),
    forgiveness.transactionDate,
  );
  await user.click(
    await within(dialog).findByRole("checkbox", {
      name: new RegExp(outstandingObligations[1]!.id),
    }),
  );
  await user.type(within(dialog).getByLabelText("Forgiveness amount"), "20");
  await user.type(within(dialog).getByLabelText("Reason"), forgiveness.reason);
  return { user, dialog };
}

it("forgives only selected debt, creates v5 intent and shows Expense separately from cash", async () => {
  let confirmed = false;
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        expect(await request.json()).toEqual({
          kind: "forgiveness",
          participantId: person.id,
          selectedObligationIds: forgiveness.selectedObligationIds,
          transactionDate: forgiveness.transactionDate,
          amount: money("20"),
          reason: forgiveness.reason,
          note: null,
        });
        return HttpResponse.json(forgivenessPreview);
      },
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        expect(request.headers.get("Finance-Command-Version")).toBe("5");
        expect(request.headers.get("Finance-Submission-Owner")).toBe(
          submissionTestUser.id,
        );
        expect(await request.json()).toMatchObject({
          kind: "forgiveness",
          previewToken: forgivenessPreview.previewToken,
          reason: forgiveness.reason,
        });
        confirmed = true;
        return HttpResponse.json(
          forgivenessReceipt(request.headers.get("Idempotency-Key")!),
          { status: 201 },
        );
      },
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () =>
        HttpResponse.json(
          confirmed ? forgivenObligations : outstandingObligations,
        ),
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/settlements",
      () => HttpResponse.json(confirmed ? [forgiveness] : []),
    ),
  );
  const { user, dialog } = await draft();
  expect(
    within(dialog).queryByLabelText("Receiving Account"),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview forgiveness" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Forgiveness preview",
  });
  expect(within(review).getByText("Expense increase")).toBeVisible();
  expect(
    within(review).getByRole("columnheader", { name: "Forgiven" }),
  ).toBeVisible();
  expect(
    within(review).queryByRole("columnheader", { name: "Cash paid" }),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm forgiveness" }),
  );
  const detail = await screen.findByRole("region", {
    name: "Confirmed Settlement",
  });
  expect(await within(detail).findByText(forgiveness.reason)).toBeVisible();
  expect(within(detail).queryByText("Cash received")).not.toBeInTheDocument();
  expect(
    within(detail).getByRole("link", {
      name: /View linked Expense Transaction/,
    }),
  ).toBeVisible();
  const history = screen.getByRole("region", { name: "Settlement history" });
  expect(
    await within(history).findByRole("link", { name: /Forgiven 20.00 CNY/ }),
  ).toBeVisible();
  expect(within(detail).getByText(/archived/)).toBeVisible();
});

it("rejects a retained source that attributes forgiveness outside its selected debt", async () => {
  server.use(
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json({
        ...forgiveness,
        selectedObligationIds: [outstandingObligations[0]!.id],
      }),
    ),
  );
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}&settlement_id=${forgiveness.id}`,
  );
  expect(
    await screen.findByText(
      /Settlement source is unavailable/,
      {},
      { timeout: 5000 },
    ),
  ).toBeVisible();
  expect(
    screen.queryByText(forgiveness.reason, { exact: true }),
  ).not.toBeInTheDocument();
});

it.each([
  {
    label: "zero",
    amount: "0",
    reason: forgiveness.reason,
    message: /positive exact amount/,
  },
  {
    label: "excess precision",
    amount: "20.001",
    reason: forgiveness.reason,
    message: /positive exact amount/,
  },
  {
    label: "over capacity",
    amount: "61",
    reason: forgiveness.reason,
    message: /cannot exceed selected/,
  },
  {
    label: "missing reason",
    amount: "20",
    reason: "   ",
    message: /reason of 1–500/,
  },
  {
    label: "long reason",
    amount: "20",
    reason: "a".repeat(501),
    message: /reason of 1–500/,
  },
])(
  "rejects $label without requesting a preview",
  async ({ amount, reason, message }) => {
    let requests = 0;
    server.use(
      http.post("*/api/finance/ledgers/:ledger/settlements/preview", () => {
        requests++;
        return HttpResponse.json(forgivenessPreview);
      }),
    );
    const { user, dialog } = await draft();
    await user.clear(within(dialog).getByLabelText("Forgiveness amount"));
    await user.type(
      within(dialog).getByLabelText("Forgiveness amount"),
      amount,
    );
    await user.clear(within(dialog).getByLabelText("Reason"));
    await user.click(within(dialog).getByLabelText("Reason"));
    await user.paste(reason);
    await user.click(
      within(dialog).getByRole("button", { name: "Preview forgiveness" }),
    );
    expect(await within(dialog).findByText(message)).toBeVisible();
    expect(requests).toBe(0);
    expect(
      within(dialog).queryByRole("button", { name: "Confirm forgiveness" }),
    ).not.toBeInTheDocument();
  },
);

it.each([
  {
    label: "outside selection",
    change: {
      allocations: [
        {
          ...forgivenessPreview.allocations[0]!,
          obligationId: outstandingObligations[0]!.id,
        },
      ],
    },
  },
  { label: "different Expense", change: { expense: money("21.00") } },
  { label: "cash preview", change: { receivingBalance: money("100.00") } },
])("refuses a $label preview and preserves the draft", async ({ change }) => {
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json({ ...forgivenessPreview, ...change }),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview forgiveness" }),
  );
  expect(
    await within(dialog).findByText(/Your forgiveness intent is preserved/),
  ).toBeVisible();
  expect(within(dialog).getByLabelText("Forgiveness amount")).toHaveValue("20");
  expect(
    within(dialog).queryByRole("button", { name: "Confirm forgiveness" }),
  ).not.toBeInTheDocument();
});

it("requires explicit removal of debt made unavailable by a date change", async () => {
  const { user, dialog } = await draft();
  await user.clear(within(dialog).getByLabelText("Forgiveness date"));
  await user.type(
    within(dialog).getByLabelText("Forgiveness date"),
    "2026-01-10",
  );
  const unavailable = within(dialog).getByRole("checkbox", {
    name: /Unavailable selection/,
  });
  expect(unavailable).toBeChecked();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview forgiveness" }),
  );
  expect(
    await within(dialog).findByText(/Remove unavailable selections explicitly/),
  ).toBeVisible();
  await user.click(unavailable);
  expect(
    within(dialog).queryByRole("checkbox", { name: /Unavailable selection/ }),
  ).not.toBeInTheDocument();
});

it("retries only the original v5 body, owner and key after an uncertain outcome", async () => {
  const posts: {
    key: string | null;
    version: string | null;
    owner: string | null;
    body: string;
  }[] = [];
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(forgivenessPreview),
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
          : HttpResponse.json(forgivenessReceipt(posts[0]!.key!), {
              status: 201,
            });
      },
    ),
    http.get("*/api/finance/submissions/:id", ({ params }) =>
      HttpResponse.json({
        state: "unfinished",
        submissionId: params.id,
        operation: "createFinanceSettlement",
        commandVersion: "5",
        targetLedgerId: ledger.id,
        admittedAt: forgiveness.confirmedAt,
      }),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview forgiveness" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Confirm forgiveness" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Close to recovery" }),
  );
  const retry = await screen.findByRole("button", {
    name: "Retry original submission",
  });
  await waitFor(() => expect(retry).toBeEnabled());
  expect(
    screen.getByRole("button", { name: "Record forgiveness" }),
  ).toBeDisabled();
  await user.click(retry);
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]).toEqual(posts[0]);
  expect(posts[0]).toMatchObject({
    version: "5",
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
        ...forgivenessPreview,
        previewToken: (previews === 1 ? "a" : "b").repeat(64),
      });
    }),
    http.post("*/api/finance/ledgers/:ledger/settlements", ({ request }) => {
      const key = request.headers.get("Idempotency-Key")!;
      keys.push(key);
      if (keys.length > 1)
        return HttpResponse.json(forgivenessReceipt(key), { status: 201 });
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
            ...forgivenessReceipt(key),
            outcome: { kind: "rejected", problem },
          },
        },
        { status: 409 },
      );
    }),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview forgiveness" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Confirm forgiveness" }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByRole("button", { name: "Confirm forgiveness" }),
    ).not.toBeInTheDocument(),
  );
  expect(within(dialog).getByLabelText("Reason")).toHaveValue(
    forgiveness.reason,
  );
  const refresh = await within(dialog).findByRole("button", {
    name: "Refresh preview",
  });
  await waitFor(() => expect(refresh).toBeEnabled());
  await user.click(refresh);
  expect(keys).toHaveLength(1);
  await user.click(
    await within(dialog).findByRole("button", { name: "Confirm forgiveness" }),
  );
  await waitFor(() => expect(keys).toHaveLength(2));
  expect(keys[0]).not.toBe(keys[1]);
});

it("retains backend Allocation order across multiple deliberately selected Obligations", async () => {
  const preview = {
    ...forgivenessPreview,
    amount: money("60.00"),
    expense: money("60.00"),
    outstandingBefore: money("100.00"),
    outstandingAfter: money("40.00"),
    allocations: [
      {
        ...forgivenessPreview.allocations[0]!,
        position: 1,
        obligationId: outstandingObligations[0]!.id,
        advanceId: outstandingObligations[0]!.advanceId,
        sourceDate: "2026-01-01",
        forgiven: money("40.00"),
        remainingAfter: money("0.00"),
      },
      { ...forgivenessPreview.allocations[0]!, position: 2 },
    ],
  };
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(preview),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("checkbox", {
      name: new RegExp(outstandingObligations[0]!.id),
    }),
  );
  await user.clear(within(dialog).getByLabelText("Forgiveness amount"));
  await user.type(within(dialog).getByLabelText("Forgiveness amount"), "60");
  await user.click(
    within(dialog).getByRole("button", { name: "Preview forgiveness" }),
  );
  const table = await within(dialog).findByRole("table", {
    name: "Proposed Allocations",
  });
  const rows = within(table).getAllByRole("row");
  expect(rows[1]).toHaveTextContent(outstandingObligations[0]!.id);
  expect(rows[2]).toHaveTextContent(outstandingObligations[1]!.id);
  await user.clear(within(dialog).getByLabelText("Reason"));
  expect(
    within(dialog).queryByRole("button", { name: "Confirm forgiveness" }),
  ).not.toBeInTheDocument();
});

it("blocks debt responses from another Participant before preview or selection", async () => {
  server.use(
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () =>
        HttpResponse.json(
          outstandingObligations.map((row) => ({
            ...row,
            participantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          })),
        ),
    ),
  );
  const user = userEvent.setup();
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  const trigger = await screen.findByRole(
    "button",
    { name: "Record forgiveness" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Record forgiveness" });
  await user.selectOptions(
    within(dialog).getByLabelText("Currency", { exact: true }),
    "CNY",
  );
  expect(await within(dialog).findByText(/Debt could not load/)).toBeVisible();
  expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
});
