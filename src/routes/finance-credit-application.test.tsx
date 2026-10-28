import { fireEvent } from "@testing-library/react";
import { env } from "@/config/env";
import {
  prepareSubmission,
  readSubmission,
} from "@/components/finance/submission-journal";
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
  creditApplication,
  creditPreview,
  creditReceipt,
} from "@/test/credit-application-fixtures";

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
      HttpResponse.json(creditApplication),
    ),
  ),
);

async function draft(currency = "CNY") {
  const user = userEvent.setup();
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  const button = await screen.findByRole(
    "button",
    { name: "Apply credit" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  const dialog = screen.getByRole("dialog", { name: "Apply credit" });
  await user.selectOptions(within(dialog).getByLabelText("Currency"), currency);
  await user.clear(within(dialog).getByLabelText("Application date"));
  await user.type(
    within(dialog).getByLabelText("Application date"),
    "2026-10-27",
  );
  await user.click(
    await within(dialog).findByRole("checkbox", {
      name: new RegExp(outstandingObligations[0]!.id),
    }),
  );
  await user.type(
    within(dialog).getByLabelText("Credit application amount"),
    "25",
  );
  return { user, dialog };
}
it("previews selected debt and immutable oldest-origin consumption without receiving cash", async () => {
  let sent: unknown;
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(creditPreview);
      },
    ),
  );
  const { user, dialog } = await draft();
  expect(
    within(dialog).queryByLabelText("Receiving Account"),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit application" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Credit application preview",
  });
  expect(review).toHaveTextContent("Available credit after25 CNY");
  expect(
    within(review).getByRole("table", { name: "Proposed Allocations" }),
  ).toHaveTextContent("Credit applied");
  const origins = within(review).getByRole("list", {
    name: "Consumed credit origins",
  });
  expect(within(origins).getAllByRole("listitem")[0]).toHaveTextContent(
    "Consumed 20 CNY",
  );
  expect(within(origins).getAllByRole("listitem")[1]).toHaveTextContent(
    "Consumed 5 CNY",
  );
  expect(sent).toEqual({
    kind: "creditApplication",
    participantId: person.id,
    selectedObligationIds: [outstandingObligations[0]!.id],
    transactionDate: "2026-10-27",
    amount: money("25"),
    note: null,
  });
  expect(
    within(dialog).getByRole("button", { name: "Confirm credit application" }),
  ).toHaveFocus();
});

it("confirms v7 and presents credit application history and frozen origin balances", async () => {
  let command: unknown;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(creditPreview),
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        command = {
          version: request.headers.get("Finance-Command-Version"),
          body: await request.json(),
        };
        return HttpResponse.json(
          creditReceipt(request.headers.get("Idempotency-Key")!),
          { status: 201 },
        );
      },
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/settlements",
      () => HttpResponse.json([creditApplication]),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit application" }),
  );
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm credit application",
    }),
  );
  const detail = await screen.findByRole("region", {
    name: "Confirmed Settlement",
  });
  await within(detail).findByRole("list", { name: "Consumed credit origins" });
  expect(detail).toHaveTextContent("Credit applied25 CNY");
  expect(detail).not.toHaveTextContent("Cash received");
  expect(
    within(detail).getAllByRole("link", {
      name: /View linked credit application Internal Transfer/,
    }),
  ).toHaveLength(2);
  expect(
    within(detail).queryByRole("link", { name: /Expense Transaction/ }),
  ).not.toBeInTheDocument();
  expect(command).toMatchObject({
    version: "7",
    body: {
      kind: "creditApplication",
      previewToken: creditPreview.previewToken,
    },
  });
  expect(
    await screen.findByRole("link", {
      name: /Credit applied 25 CNY.*Confirmation 3/,
    }),
  ).toBeVisible();
});

it("drops stale confirmation but preserves intent until a new preview and deliberate action", async () => {
  let previews = 0;
  const keys: string[] = [];
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () => {
      previews++;
      return HttpResponse.json({
        ...creditPreview,
        previewToken: (previews === 1 ? "a" : "b").repeat(64),
      });
    }),
    http.post("*/api/finance/ledgers/:ledger/settlements", ({ request }) => {
      const key = request.headers.get("Idempotency-Key")!;
      keys.push(key);
      if (keys.length > 1)
        return HttpResponse.json(creditReceipt(key), { status: 201 });
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
            ...creditReceipt(key),
            outcome: { kind: "rejected", problem },
          },
        },
        { status: 409 },
      );
    }),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit application" }),
  );
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm credit application",
    }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByRole("button", {
        name: "Confirm credit application",
      }),
    ).not.toBeInTheDocument(),
  );
  expect(
    within(dialog).getByLabelText("Credit application amount"),
  ).toHaveValue("25");
  const refresh = await within(dialog).findByRole("button", {
    name: "Refresh preview",
  });
  await waitFor(() => expect(refresh).toBeEnabled());
  await user.click(refresh);
  expect(keys).toHaveLength(1);
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm credit application",
    }),
  );
  await waitFor(() => expect(keys).toHaveLength(2));
  expect(keys[0]).not.toBe(keys[1]);
});
it("retries only the original v7 body, owner and key after an uncertain outcome", async () => {
  const posts: {
    key: string | null;
    version: string | null;
    owner: string | null;
    body: string;
  }[] = [];
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(creditPreview),
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
          : HttpResponse.json(creditReceipt(posts[0]!.key!), {
              status: 201,
            });
      },
    ),
    http.get("*/api/finance/submissions/:id", ({ params }) =>
      HttpResponse.json({
        state: "unfinished",
        submissionId: params.id,
        operation: "createFinanceSettlement",
        commandVersion: "7",
        targetLedgerId: ledger.id,
        admittedAt: creditApplication.confirmedAt,
      }),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit application" }),
  );
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm credit application",
    }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Close to recovery" }),
  );
  const retry = await screen.findByRole("button", {
    name: "Retry original submission",
  });
  await waitFor(() => expect(retry).toBeEnabled());
  expect(screen.getByRole("button", { name: "Apply credit" })).toBeDisabled();
  await user.click(retry);
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]).toEqual(posts[0]);
  expect(posts[0]).toMatchObject({
    version: "7",
    owner: submissionTestUser.id,
  });
  expect(
    await screen.findByRole("link", { name: /Open Settlement/ }),
  ).toBeVisible();
});

it.each(["0", "-1", "1.001", "41", "1e1"])(
  "blocks invalid or over-selected amount %s before preview",
  async (value) => {
    let calls = 0;
    server.use(
      http.post("*/api/finance/ledgers/:ledger/settlements/preview", () => {
        calls++;
        return HttpResponse.json(creditPreview);
      }),
    );
    const { user, dialog } = await draft();
    await user.clear(
      within(dialog).getByLabelText("Credit application amount"),
    );
    await user.type(
      within(dialog).getByLabelText("Credit application amount"),
      value,
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: "Preview credit application",
      }),
    );
    expect(
      within(dialog).getByLabelText("Credit application amount"),
    ).toHaveAttribute("aria-invalid", "true");
    expect(calls).toBe(0);
  },
);
it.each(["outsideScope", "wrongOrigin", "wrongBalance"])(
  "rejects an inconsistent authoritative preview: %s",
  async (variant) => {
    const body = structuredClone(creditPreview);
    if (variant === "outsideScope")
      body.allocations[0]!.obligationId = outstandingObligations[1]!.id;
    if (variant === "wrongOrigin") body.origins[1]!.amount = money("6");
    if (variant === "wrongBalance") body.availableCreditAfter = money("26");
    server.use(
      http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
        HttpResponse.json(body),
      ),
    );
    const { user, dialog } = await draft();
    await user.click(
      within(dialog).getByRole("button", {
        name: "Preview credit application",
      }),
    );
    await within(dialog).findByText(/Preview could not be loaded/);
    expect(
      within(dialog).queryByRole("button", {
        name: "Confirm credit application",
      }),
    ).not.toBeInTheDocument();
  },
);

it.each([
  {
    value: "2",
    currency: "CNY",
    debt: "10",
    remaining: "8",
    note: "\u0085" + "😀".repeat(500) + "\u0085",
  },
  { value: "2", currency: "CNY", debt: "10", remaining: "8" },
  { value: "0.01", currency: "CNY", debt: undefined, remaining: undefined },
  { value: "1", currency: "JPY" },
  { value: "9".repeat(131072), currency: "CNY" },
  { value: "000000.01", currency: "CNY" },
  { value: "25", currency: "CNY", note: "Ordinary note" },
  {
    value: "25",
    currency: "CNY",
    note: " \u0085汉字 e\u0301 👩‍💻\u0085inside \u0085",
  },
  { value: "25", currency: "CNY", note: "e\u0301".repeat(250) },
  { value: "25", currency: "CNY", note: "x\u0085" + "😀".repeat(498) },
  {
    value: "25",
    currency: "CNY",
    note:
      "\u001c\u001d\u001e\u001f" +
      "😀".repeat(500) +
      "\u001c\u001d\u001e\u001f",
  },
  {
    value: "25",
    currency: "CNY",
    note: " \t\u0085\u001c\u001d\u001e\u001f\u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000",
  },
])(
  "preserves producer-valid Money and original Unicode notes through form, preview and journal ($currency, case %#)",
  async ({ value, currency, debt, remaining, note }) => {
    const originalNote = note ?? "  " + "😀".repeat(500) + "  ";
    const m = (amount: string) => ({ amount, currency });
    const authoritative = {
      ...creditPreview,
      amount: m(value),
      outstandingBefore: m(debt ?? value),
      outstandingAfter: m(remaining ?? "0"),
      availableCreditBefore: m(value),
      availableCreditAfter: m("0"),
      origins: [
        {
          ...creditPreview.origins[0],
          amount: m(value),
          availableBefore: m(value),
          availableAfter: m("0"),
        },
      ],
      allocations: [
        {
          ...creditPreview.allocations[0],
          creditApplied: m(value),
          remainingAfter: m(remaining ?? "0"),
        },
      ],
    };
    let sent: unknown;
    server.use(
      http.get(
        "*/api/finance/ledgers/:ledger/participants/:person/obligations",
        () =>
          HttpResponse.json([
            { ...outstandingObligations[0], remaining: m(debt ?? value) },
          ]),
      ),
      http.post(
        "*/api/finance/ledgers/:ledger/settlements/preview",
        async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(authoritative);
        },
      ),
    );
    const { user, dialog } = await draft(currency);
    await user.selectOptions(
      within(dialog).getByLabelText("Currency"),
      currency,
    );
    fireEvent.change(
      within(dialog).getByLabelText("Credit application amount"),
      { target: { value } },
    );
    fireEvent.change(within(dialog).getByLabelText("Note"), {
      target: { value: originalNote },
    });
    await user.click(
      within(dialog).getByRole("button", {
        name: "Preview credit application",
      }),
    );
    await within(dialog).findByRole("region", {
      name: "Credit application preview",
    });
    expect(sent).toMatchObject({ amount: m(value), note: originalNote });
    const record = await prepareSubmission(
      { apiBaseUrl: env.VITE_API_BASE_URL, ownerId: submissionTestUser.id },
      {
        operation: "createFinanceSettlement",
        workflow: "settlement",
        targetLedgerId: ledger.id,
        body: {
          ...(sent as typeof import("@/test/credit-application-fixtures").creditBody),
          previewToken: creditPreview.previewToken,
        },
      },
    );
    expect(await readSubmission(record)).toMatchObject({
      commandVersion: "7",
      body: { amount: m(value), note: originalNote },
    });
  },
  20000,
);

it.each([
  {
    label: "501 emoji after Python strip",
    note: "\u0085" + "😀".repeat(501) + "\u0085",
  },
  { label: "501 ordinary characters", note: "a".repeat(501) },
  {
    label: "combining characters count separately",
    note: "e\u0301".repeat(251),
  },
  {
    label: "internal whitespace counts",
    note: "😀".repeat(250) + "\u0085" + "😀".repeat(250),
  },
  {
    label: "BOM is not producer whitespace",
    note: "\ufeff" + "😀".repeat(500) + "\ufeff",
  },
  {
    label: "zero width space is not producer whitespace",
    note: "\u200b" + "😀".repeat(500) + "\u200b",
  },
])("rejects over-limit notes before preview: $label", async ({ note }) => {
  let previews = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () => {
      previews++;
      return HttpResponse.json(creditPreview);
    }),
  );
  const { user, dialog } = await draft();
  const input = within(dialog).getByLabelText("Note");
  fireEvent.change(input, { target: { value: note } });
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit application" }),
  );
  expect(
    await within(dialog).findByText("Enter a note of at most 500 characters."),
  ).toBeVisible();
  expect(input).toHaveFocus();
  expect(input).toHaveValue(note);
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(previews).toBe(0);
  expect(
    within(dialog).queryByRole("button", {
      name: "Confirm credit application",
    }),
  ).not.toBeInTheDocument();
});

it("rejects foreign Participant debt before selection", async () => {
  server.use(
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () =>
        HttpResponse.json([
          { ...outstandingObligations[0], participantId: crypto.randomUUID() },
        ]),
    ),
  );
  const user = userEvent.setup();
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  const button = await screen.findByRole(
    "button",
    { name: "Apply credit" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  const dialog = screen.getByRole("dialog", { name: "Apply credit" });
  await user.selectOptions(within(dialog).getByLabelText("Currency"), "CNY");
  await within(dialog).findByText(
    "Debt could not load. Refresh dependencies to retry.",
  );
  expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
});
it("retains unavailable selections after dependency refresh and blocks confirmation", async () => {
  const { user, dialog } = await draft();
  server.use(
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () => HttpResponse.json([]),
    ),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Refresh dependencies" }),
  );
  const selected = await within(dialog).findByRole("checkbox", {
    name: /Unavailable selection/,
  });
  expect(selected).toBeChecked();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit application" }),
  );
  expect(
    within(dialog).getByText(/Select eligible outstanding Obligations/),
  ).toBeVisible();
  expect(
    within(dialog).getByLabelText("Credit application amount"),
  ).toHaveValue("25");
});
it("rejects over-available credit authoritatively without silently adjusting the draft", async () => {
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(
        { code: "validation_error", status: 422 },
        { status: 422 },
      ),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit application" }),
  );
  await within(dialog).findByText(/Preview could not be loaded/);
  expect(
    within(dialog).getByLabelText("Credit application amount"),
  ).toHaveValue("25");
  expect(
    within(dialog).queryByRole("button", {
      name: "Confirm credit application",
    }),
  ).not.toBeInTheDocument();
});

it("rejects newer-origin consumption while an earlier consumed origin still has credit", async () => {
  const body = structuredClone(creditPreview);
  body.origins[0]!.amount = money("19");
  body.origins[0]!.availableAfter = money("1");
  body.origins[1]!.amount = money("6");
  body.origins[1]!.availableAfter = money("24");
  body.allocations[0]!.creditApplied = money("19");
  body.allocations[0]!.remainingAfter = money("21");
  body.allocations[1]!.creditApplied = money("6");
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(body),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit application" }),
  );
  await within(dialog).findByText(/Preview could not be loaded/);
  expect(
    within(dialog).queryByRole("button", {
      name: "Confirm credit application",
    }),
  ).not.toBeInTheDocument();
});
