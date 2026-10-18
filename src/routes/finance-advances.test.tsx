import { screen, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import {
  getGetCurrentUserMockHandler,
  getListFinanceLedgersMockHandler,
  getListFinanceAccountsMockHandler,
  getListFinanceParticipantsMockHandler,
  getListFinanceCurrenciesMockHandler,
  getGetFinanceAdvanceMockHandler503,
} from "@/api/generated/core-console.msw";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import { submissionTestUser } from "@/test/submission-fixtures";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as funding,
  advancePreview as preview,
  confirmedAdvance,
  createdAdvanceReceipt,
  sharedParticipant,
  cardFunding,
  sharedPreview,
  sharedAdvance,
  sharedAdvanceReceipt,
} from "@/test/advance-fixtures";

it("previews and confirms a shared card purchase as one action with exact owner and participant effects", async () => {
  let creates = 0;
  server.use(
    getListFinanceParticipantsMockHandler([person, sharedParticipant]),
    getListFinanceAccountsMockHandler([funding, cardFunding]),
    http.post(
      "*/api/finance/ledgers/:ledger/advances/preview",
      async ({ request }) => {
        expect(await request.json()).toMatchObject({
          amount: { amount: "300", currency: "CNY" },
          ownerShare: { amount: "100", currency: "CNY" },
          participantShares: [
            {
              participantId: person.id,
              amount: { amount: "120", currency: "CNY" },
            },
            {
              participantId: sharedParticipant.id,
              amount: { amount: "80", currency: "CNY" },
            },
          ],
        });
        return HttpResponse.json(sharedPreview);
      },
    ),
    http.post("*/api/finance/ledgers/:ledger/advances", async ({ request }) => {
      creates++;
      expect(request.headers.get("Finance-Command-Version")).toBe("2");
      expect(await request.json()).toMatchObject({
        previewToken: sharedPreview.previewToken,
      });
      return HttpResponse.json(
        sharedAdvanceReceipt(request.headers.get("Idempotency-Key")!),
        { status: 201 },
      );
    }),
    http.get("*/api/finance/ledgers/:ledger/advances/:id", () =>
      HttpResponse.json(sharedAdvance),
    ),
  );
  renderRoute(`/finance/advances?ledger=${ledger.id}`);
  const { user, dialog } = await sharedDraft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Advance preview",
  });
  expect(within(review).getAllByText("100.00 CNY")).toHaveLength(2);
  expect(within(review).getByText("200.00 CNY")).toBeVisible();
  expect(within(review).getByText("400.00 CNY")).toBeVisible();
  expect(
    within(review).getByText(/Liability increases by 300 CNY/),
  ).toBeVisible();
  expect(within(review).getByText(/Alex.*120.00 CNY/)).toBeVisible();
  expect(within(review).getByText(/Blair.*80.00 CNY/)).toBeVisible();
  expect(creates).toBe(0);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm Advance" }),
  );
  const source = await screen.findByRole("region", {
    name: "Confirmed Advance source",
  });
  expect(await within(source).findByText("Shared purchase")).toBeVisible();
  expect(
    within(source).getAllByRole("link", { name: "View linked Transaction" }),
  ).toHaveLength(3);
  expect(within(source).getByText(/Alex \(active\)/)).toBeVisible();
  expect(within(source).getByText(/Blair \(active\)/)).toBeVisible();
  expect(creates).toBe(1);
});

async function sharedDraft() {
  const user = userEvent.setup();
  const record = await screen.findByRole(
    "button",
    {
      name: "Record shared purchase",
    },
    { timeout: 5000 },
  );
  await waitFor(() => expect(record).toBeEnabled());
  await user.click(record);
  const dialog = screen.getByRole("dialog", { name: "Record shared purchase" });
  await user.selectOptions(
    within(dialog).getByLabelText("Participant 1"),
    person.id,
  );
  await user.selectOptions(
    within(dialog).getByLabelText("Funding Account"),
    cardFunding.id,
  );
  await user.type(
    within(dialog).getByLabelText("Amount", { exact: true }),
    "300",
  );
  await user.type(within(dialog).getByLabelText("Owner share"), "100");
  await user.type(within(dialog).getByLabelText("Participant 1 share"), "120");
  await user.click(
    within(dialog).getByRole("button", { name: "Add Participant" }),
  );
  await user.selectOptions(
    within(dialog).getByLabelText("Participant 2"),
    sharedParticipant.id,
  );
  await user.type(within(dialog).getByLabelText("Participant 2 share"), "80");
  await user.clear(within(dialog).getByLabelText("Date"));
  await user.type(within(dialog).getByLabelText("Date"), "2027-01-02");
  await user.type(within(dialog).getByLabelText("Note"), "Shared purchase");
  return { user, dialog };
}

it("focuses the first invalid shared field in reading order when several fields are invalid", async () => {
  renderRoute(`/finance/advances?ledger=${ledger.id}`);
  const user = userEvent.setup();
  const record = await screen.findByRole(
    "button",
    { name: "Record shared purchase" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(record).toBeEnabled());
  await user.click(record);
  const dialog = screen.getByRole("dialog", { name: "Record shared purchase" });
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  expect(
    within(dialog).getByLabelText("Participant 1", { exact: true }),
  ).toHaveFocus();
});

it.each([
  ["Amount", "300.01"],
  ["Owner share", "-1"],
  ["Owner share", "100.000"],
  ["Participant 2 share", "0"],
  ["Participant 2 share", "80.001"],
  ["Participant 2 share", "8e1"],
])(
  "rejects inconsistent or inexact shared input in %s without submitting",
  async (label, value) => {
    let requests = 0;
    server.use(
      getListFinanceParticipantsMockHandler([person, sharedParticipant]),
      getListFinanceAccountsMockHandler([funding, cardFunding]),
      http.post("*/api/finance/ledgers/:ledger/advances/preview", () => {
        requests++;
        return HttpResponse.json(sharedPreview);
      }),
      http.post("*/api/finance/ledgers/:ledger/advances", () => {
        requests++;
        return HttpResponse.error();
      }),
    );
    renderRoute(`/finance/advances?ledger=${ledger.id}`);
    const { user, dialog } = await sharedDraft();
    const input = within(dialog).getByLabelText(label, { exact: true });
    await user.clear(input);
    await user.type(input, value);
    await user.click(
      within(dialog).getByRole("button", { name: "Preview Advance" }),
    );
    expect(input).toHaveValue(value);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(
      within(dialog).queryByRole("button", { name: "Confirm Advance" }),
    ).not.toBeInTheDocument();
    expect(requests).toBe(0);
  },
);

it("requires distinct active Participants and invalidates a reviewed preview after share removal or editing", async () => {
  let previews = 0;
  server.use(
    getListFinanceParticipantsMockHandler([
      person,
      sharedParticipant,
      {
        ...person,
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        status: "archived",
      },
    ]),
    getListFinanceAccountsMockHandler([funding, cardFunding]),
    http.post("*/api/finance/ledgers/:ledger/advances/preview", () => {
      previews++;
      return HttpResponse.json(sharedPreview);
    }),
  );
  renderRoute(`/finance/advances?ledger=${ledger.id}`);
  const { user, dialog } = await sharedDraft();
  const second = within(dialog).getByLabelText("Participant 2", {
    exact: true,
  });
  expect(within(second).getAllByRole("option")).toHaveLength(3);
  await user.selectOptions(second, person.id);
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  expect(second).toHaveFocus();
  expect(second).toHaveAttribute("aria-invalid", "true");
  expect(previews).toBe(0);
  await user.selectOptions(second, sharedParticipant.id);
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  await within(dialog).findByRole("button", { name: "Confirm Advance" });
  await user.type(within(dialog).getByLabelText("Note"), " edited");
  expect(
    within(dialog).queryByRole("button", { name: "Confirm Advance" }),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  await within(dialog).findByRole("button", { name: "Confirm Advance" });
  await user.click(
    within(dialog).getByRole("button", { name: "Remove Participant 1" }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByLabelText("Participant 1", { exact: true }),
    ).toHaveFocus(),
  );
  expect(within(dialog).getByLabelText("Participant 1 share")).toHaveValue(
    "80",
  );
  expect(
    within(dialog).queryByRole("button", { name: "Confirm Advance" }),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  expect(
    within(dialog).getByLabelText("Amount", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  expect(previews).toBe(2);
});

it("previews Asset funding with zero owner share and exact amounts beyond floating point precision", async () => {
  server.use(
    getListFinanceParticipantsMockHandler([person, sharedParticipant]),
    getListFinanceAccountsMockHandler([funding, cardFunding]),
    http.post(
      "*/api/finance/ledgers/:ledger/advances/preview",
      async ({ request }) => {
        expect(await request.json()).toMatchObject({
          fundingAccountId: funding.id,
          amount: { amount: "9007199254740993.03", currency: "CNY" },
          ownerShare: { amount: "0", currency: "CNY" },
        });
        return HttpResponse.json({
          ...sharedPreview,
          fundingBalanceAfter: {
            amount: "-9007199254740893.03",
            currency: "CNY",
          },
          ownerExpense: { amount: "0.00", currency: "CNY" },
          receivableIncrease: {
            amount: "9007199254740993.03",
            currency: "CNY",
          },
          participantReceivables: [
            {
              participantId: person.id,
              principal: { amount: "9007199254740993.01", currency: "CNY" },
            },
            {
              participantId: sharedParticipant.id,
              principal: { amount: "0.02", currency: "CNY" },
            },
          ],
        });
      },
    ),
  );
  renderRoute(`/finance/advances?ledger=${ledger.id}`);
  const { user, dialog } = await sharedDraft();
  await user.selectOptions(
    within(dialog).getByLabelText("Funding Account"),
    funding.id,
  );
  for (const [label, value] of [
    ["Owner share", "0"],
    ["Amount", "9007199254740993.03"],
    ["Participant 1 share", "9007199254740993.01"],
    ["Participant 2 share", "0.02"],
  ]) {
    const field = within(dialog).getByLabelText(label!, { exact: true });
    await user.clear(field);
    await user.type(field, value!);
  }
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Advance preview",
  });
  expect(
    within(review).getByText(/Asset decreases by 9,007,199,254,740,993.03 CNY/),
  ).toBeVisible();
  expect(within(review).getByText("0.00 CNY")).toBeVisible();
  expect(
    within(review).getByText("-9,007,199,254,740,893.03 CNY"),
  ).toBeVisible();
});

beforeEach(() =>
  server.use(
    getGetCurrentUserMockHandler(submissionTestUser),
    getListFinanceLedgersMockHandler([ledger]),
    getListFinanceAccountsMockHandler([funding]),
    getListFinanceParticipantsMockHandler([person]),
    getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () => HttpResponse.json([]),
    ),
  ),
);

async function draft() {
  const user = userEvent.setup();
  const record = await screen.findByRole(
    "button",
    { name: "Record Advance" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(record).toBeEnabled());
  await user.click(record);
  const dialog = screen.getByRole("dialog", { name: "Record pure Advance" });
  await user.selectOptions(
    within(dialog).getByLabelText("Participant"),
    person.id,
  );
  await user.selectOptions(
    within(dialog).getByLabelText("Funding Asset Account"),
    funding.id,
  );
  await user.type(within(dialog).getByLabelText("Amount"), "25.01");
  await user.clear(within(dialog).getByLabelText("Date"));
  await user.type(within(dialog).getByLabelText("Date"), "2027-01-02");
  await user.type(within(dialog).getByLabelText("Note"), "Travel cash");
  return { user, dialog };
}

it("previews exact effects for a future-dated pure Advance and discards without confirmation", async () => {
  let previews = 0;
  let creates = 0;
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/advances/preview",
      async ({ request }) => {
        previews++;
        expect(await request.json()).toEqual({
          fundingAccountId: funding.id,
          participantId: person.id,
          transactionDate: "2027-01-02",
          amount: { amount: "25.01", currency: "CNY" },
          ownerShare: { amount: "0", currency: "CNY" },
          participantShare: { amount: "25.01", currency: "CNY" },
          note: "Travel cash",
        });
        return HttpResponse.json(preview);
      },
    ),
    http.post("*/api/finance/ledgers/:ledger/advances", () => {
      creates++;
      return HttpResponse.error();
    }),
  );
  renderRoute(`/finance/advances?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  expect(await within(dialog).findByText("74.99 CNY")).toBeVisible();
  expect(within(dialog).getByText("Owner purchase Expense")).toBeVisible();
  expect(within(dialog).getByText("0.00 CNY")).toBeVisible();
  expect(
    within(dialog).getByText(/affects Current Balance immediately/),
  ).toBeVisible();
  await user.click(
    within(dialog).getByRole("button", { name: "Discard draft" }),
  );
  expect(previews).toBe(1);
  expect(creates).toBe(0);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("requires a refreshed preview and a deliberate new identity after correlated stale rejection", async () => {
  const keys: string[] = [];
  const tokens: string[] = [];
  let previews = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/advances/preview", () => {
      previews++;
      return HttpResponse.json({
        ...preview,
        previewToken: (previews === 1 ? "a" : "b").repeat(64),
        fundingBalanceAfter: {
          amount: previews === 1 ? "74.99" : "64.99",
          currency: "CNY",
        },
      });
    }),
    http.post("*/api/finance/ledgers/:ledger/advances", async ({ request }) => {
      const key = request.headers.get("Idempotency-Key")!;
      keys.push(key);
      tokens.push(
        ((await request.json()) as { previewToken: string }).previewToken,
      );
      const problem = {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "finance_advance_preview_stale",
        detail: "Preview changed.",
      };
      return HttpResponse.json(
        {
          ...problem,
          submissionReceipt: {
            ...createdAdvanceReceipt(key),
            outcome: { kind: "rejected", problem },
          },
        },
        { status: 409 },
      );
    }),
  );
  renderRoute(`/finance/advances?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Confirm Advance" }),
  );
  await within(dialog).findByRole("button", { name: "Refresh preview" });
  expect(previews).toBe(1);
  expect(keys).toHaveLength(1);
  expect(
    within(dialog).queryByRole("button", { name: "Confirm Advance" }),
  ).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText("Amount")).toHaveValue("25.01");
  await user.click(
    within(dialog).getByRole("button", { name: "Refresh preview" }),
  );
  expect(await within(dialog).findByText("64.99 CNY")).toBeVisible();
  expect(keys).toHaveLength(1);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm Advance" }),
  );
  await waitFor(() => expect(keys).toHaveLength(2));
  expect(keys[0]).not.toBe(keys[1]);
  expect(tokens).toEqual(["a".repeat(64), "b".repeat(64)]);
});

it.each([false, true])(
  "retains an uncertain original command across navigation and retries it unchanged despite missing lookup (shared=%s)",
  async (shared) => {
    const sent: { key: string; body: unknown }[] = [];
    server.use(
      getListFinanceParticipantsMockHandler(
        shared ? [person, sharedParticipant] : [person],
      ),
      getListFinanceAccountsMockHandler(
        shared ? [funding, cardFunding] : [funding],
      ),
      http.post("*/api/finance/ledgers/:ledger/advances/preview", () =>
        HttpResponse.json(shared ? sharedPreview : preview),
      ),
      http.post(
        "*/api/finance/ledgers/:ledger/advances",
        async ({ request }) => {
          const key = request.headers.get("Idempotency-Key")!;
          expect(request.headers.get("Finance-Command-Version")).toBe(
            shared ? "2" : "1",
          );
          sent.push({ key, body: await request.json() });
          return sent.length === 1
            ? HttpResponse.error()
            : HttpResponse.json(
                (shared ? sharedAdvanceReceipt : createdAdvanceReceipt)(key),
                { status: 201 },
              );
        },
      ),
      http.get("*/api/finance/submissions/:id", () =>
        HttpResponse.json(
          { type: "about:blank", title: "Not found", status: 404 },
          { status: 404 },
        ),
      ),
      getGetFinanceAdvanceMockHandler503(),
    );
    const { router } = renderRoute(`/finance/advances?ledger=${ledger.id}`);
    const { user, dialog } = await (shared ? sharedDraft() : draft());
    await user.click(
      within(dialog).getByRole("button", { name: "Preview Advance" }),
    );
    await user.click(
      await within(dialog).findByRole("button", { name: "Confirm Advance" }),
    );
    expect(await within(dialog).findByText(/outcome is unknown/)).toBeVisible();
    expect(within(dialog).getByLabelText("Amount")).toBeDisabled();
    await user.click(
      within(dialog).getByRole("button", { name: "Close to recovery" }),
    );
    await act(() => router.navigate("/"));
    await act(() => router.navigate(`/finance/advances?ledger=${ledger.id}`));
    expect(
      await screen.findByRole("button", { name: "Record Advance" }),
    ).toBeDisabled();
    expect(sent).toHaveLength(1);
    await user.click(
      await screen.findByRole("button", { name: "Retry original submission" }),
    );
    await screen.findByRole("status", { name: /Advance created:/ });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(
      await screen.findByRole("link", { name: "Open Advance" }),
    ).toHaveAttribute("href", expect.stringContaining(confirmedAdvance.id));
    expect(
      screen.queryByRole("button", { name: "Retry original submission" }),
    ).not.toBeInTheDocument();
  },
);

it("keeps a shared command unresolved when a same-key receipt has the old command version", async () => {
  server.use(
    getListFinanceParticipantsMockHandler([person, sharedParticipant]),
    getListFinanceAccountsMockHandler([funding, cardFunding]),
    http.post("*/api/finance/ledgers/:ledger/advances/preview", () =>
      HttpResponse.json(sharedPreview),
    ),
    http.post("*/api/finance/ledgers/:ledger/advances", ({ request }) =>
      HttpResponse.json(
        createdAdvanceReceipt(request.headers.get("Idempotency-Key")!),
        { status: 201 },
      ),
    ),
  );
  renderRoute(`/finance/advances?ledger=${ledger.id}`);
  const { user, dialog } = await sharedDraft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Confirm Advance" }),
  );
  expect(await within(dialog).findByText(/outcome is unknown/)).toBeVisible();
  expect(within(dialog).getByLabelText("Owner share")).toBeDisabled();
  expect(
    within(dialog).getByRole("button", { name: "Confirm Advance" }),
  ).toBeDisabled();
  await user.click(
    within(dialog).getByRole("button", { name: "Close to recovery" }),
  );
  expect(
    screen.getByRole("button", { name: "Record shared purchase" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("link", { name: "Open Advance" }),
  ).not.toBeInTheDocument();
});

it("blocks dispatch if durable browser preparation fails", async () => {
  let creates = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/advances/preview", () =>
      HttpResponse.json(preview),
    ),
    http.post("*/api/finance/ledgers/:ledger/advances", () => {
      creates++;
      return HttpResponse.error();
    }),
  );
  renderRoute(`/finance/advances?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  const confirm = await within(dialog).findByRole("button", {
    name: "Confirm Advance",
  });
  const storage = vi.spyOn(indexedDB, "open").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  await user.click(confirm);
  expect(
    await within(dialog).findByText(/Browser preparation failed/),
  ).toBeVisible();
  expect(creates).toBe(0);
  storage.mockRestore();
});

it("rejects excess precision and dates before tracking without previewing or rounding", async () => {
  let previews = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/advances/preview", () => {
      previews++;
      return HttpResponse.json(preview);
    }),
  );
  renderRoute(`/finance/advances?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  const amount = within(dialog).getByLabelText("Amount");
  await user.clear(amount);
  await user.type(amount, "25.010");
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  expect(amount).toHaveFocus();
  expect(amount).toHaveAttribute("aria-invalid", "true");
  expect(amount).toHaveValue("25.010");
  await user.clear(amount);
  await user.type(amount, "25.01");
  const date = within(dialog).getByLabelText("Date");
  await user.clear(date);
  await user.type(date, "2025-12-31");
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  expect(date).toHaveFocus();
  expect(date).toHaveAttribute("aria-invalid", "true");
  expect(previews).toBe(0);
});

it("inspects archived Participant debt while excluding archived people and non-Asset funding from new drafts", async () => {
  const archived = { ...person, status: "archived" as const };
  server.use(
    getListFinanceParticipantsMockHandler([archived]),
    getListFinanceAccountsMockHandler([
      funding,
      {
        ...funding,
        id: "88888888-8888-4888-8888-888888888888",
        nature: "liability",
      },
      {
        ...funding,
        id: "99999999-9999-4999-8999-999999999999",
        status: "archived",
      },
    ]),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () => HttpResponse.json([confirmedAdvance.obligation]),
    ),
  );
  renderRoute(
    `/finance/advances?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  expect(
    await screen.findByRole("table", {
      name: "Participant receivable composition",
    }),
  ).toBeVisible();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Record Advance" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(
    within(within(dialog).getByLabelText("Participant")).getAllByRole("option"),
  ).toHaveLength(1);
  expect(
    within(within(dialog).getByLabelText("Funding Asset Account")).getAllByRole(
      "option",
    ),
  ).toHaveLength(2);
});

it("does not treat a generic stale error or mismatched receipt as terminal proof", async () => {
  let attempts = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/advances/preview", () =>
      HttpResponse.json(preview),
    ),
    http.post("*/api/finance/ledgers/:ledger/advances", () => {
      attempts++;
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "finance_advance_preview_stale",
          submissionReceipt: {
            ...createdAdvanceReceipt("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
          },
        },
        { status: 409 },
      );
    }),
  );
  renderRoute(`/finance/advances?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Confirm Advance" }),
  );
  await within(dialog).findByText(/outcome is unknown/);
  expect(
    within(dialog).queryByRole("button", { name: "Refresh preview" }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "Confirm Advance" }),
  ).toBeDisabled();
  expect(attempts).toBe(1);
});

it("drops the old draft on Ledger navigation and does not reuse its preview", async () => {
  const other = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Other" };
  server.use(
    getListFinanceLedgersMockHandler([ledger, other]),
    getListFinanceParticipantsMockHandler(({ params }) =>
      params.ledgerId === ledger.id ? [person] : [],
    ),
  );
  const { router } = renderRoute(`/finance/advances?ledger=${ledger.id}`);
  await draft();
  await act(() => router.navigate(`/finance/advances?ledger=${other.id}`));
  await screen.findByRole("button", { name: "Record Advance" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Record Advance" }));
  expect(
    within(screen.getByRole("dialog")).getByLabelText("Amount"),
  ).toHaveValue("");
  expect(
    screen.queryByRole("button", { name: "Confirm Advance" }),
  ).not.toBeInTheDocument();
});

it("confirms the preview once and exposes source and exact unpaid composition", async () => {
  let attempts = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/advances/preview", () =>
      HttpResponse.json(preview),
    ),
    http.post("*/api/finance/ledgers/:ledger/advances", async ({ request }) => {
      attempts++;
      const body = await request.json();
      expect(body).toMatchObject({
        previewToken: preview.previewToken,
        participantId: person.id,
        amount: { amount: "25.01", currency: "CNY" },
      });
      expect(request.headers.get("Finance-Command-Version")).toBe("1");
      expect(request.headers.get("Finance-Submission-Owner")).toBe(
        submissionTestUser.id,
      );
      server.use(
        http.get(
          "*/api/finance/ledgers/:ledger/participants/:person/obligations",
          () => HttpResponse.json([confirmedAdvance.obligation]),
        ),
      );
      return HttpResponse.json(
        createdAdvanceReceipt(request.headers.get("Idempotency-Key")!),
        { status: 201 },
      );
    }),
    http.get("*/api/finance/ledgers/:ledger/advances/:id", () =>
      HttpResponse.json(confirmedAdvance),
    ),
  );
  renderRoute(`/finance/advances?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Advance" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Confirm Advance" }),
  );
  const source = await screen.findByRole("region", {
    name: "Confirmed Advance source",
  });
  expect(
    within(source).getByText(confirmedAdvance.transactionId),
  ).toBeVisible();
  expect(within(source).getByText("Travel cash")).toBeVisible();
  expect(
    within(source).getByText(confirmedAdvance.obligation.receivableAccountId),
  ).toBeVisible();
  const composition = await screen.findByRole("table", {
    name: "Participant receivable composition",
  });
  expect(within(composition).getAllByText("25.01 CNY")).toHaveLength(2);
  expect(within(composition).getAllByText("0.00 CNY")).toHaveLength(3);
  expect(attempts).toBe(1);
  expect(
    screen.queryByRole("button", { name: /delete Advance|correct|repay/i }),
  ).not.toBeInTheDocument();
});
