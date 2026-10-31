import { screen, within, waitFor, fireEvent } from "@testing-library/react";
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
import { money, outstandingObligations } from "@/test/settlement-fixtures";
import {
  creditReturn,
  returnPreview,
  returnReceipt,
  returnBody,
} from "@/test/credit-return-fixtures";
import { parseSettlementSource } from "@/components/finance/settlement-source";

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
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/positions",
      () =>
        HttpResponse.json([
          {
            currency: "CNY",
            availableCredits: money("50"),
            outstandingReceivables: money("100"),
            netExposure: money("50"),
          },
        ]),
    ),
    http.get("*/api/finance/ledgers/:ledger/participants/:person/credits", () =>
      HttpResponse.json([]),
    ),
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json(creditReturn),
    ),
  ),
);
async function draft() {
  const user = userEvent.setup();
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  const trigger = await screen.findByRole(
    "button",
    { name: "Return credit" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Return credit" });
  await user.selectOptions(
    within(dialog).getByLabelText("Paying Account"),
    account.id,
  );
  fireEvent.change(within(dialog).getByLabelText("Return date"), {
    target: { value: "2026-10-29" },
  });
  await user.type(within(dialog).getByLabelText("Return amount"), "25");
  return { user, dialog, trigger };
}
it("previews the paying Account outflow and oldest-origin liability reduction before deliberate confirmation", async () => {
  let sent: unknown;
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(returnPreview);
      },
    ),
  );
  const { user, dialog } = await draft();
  expect(within(dialog).getByText(/Available credit: 50 CNY/)).toBeVisible();
  expect(
    within(dialog).queryByLabelText("Receiving Account"),
  ).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit return" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Credit return preview",
  });
  expect(review).toHaveTextContent("Paying balance after75 CNY");
  expect(review).toHaveTextContent("Available credit after25 CNY");
  const rows = within(
    within(review).getByRole("list", { name: "Consumed credit origins" }),
  ).getAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("Consumed 20 CNY");
  expect(rows[1]).toHaveTextContent("Consumed 5 CNY");
  const { previewToken: _token, ...expected } = returnBody;
  expect(sent).toEqual(expected);
  expect(
    within(dialog).getByRole("button", { name: "Confirm credit return" }),
  ).toHaveFocus();
});

it("confirms v8 and shows actual return history, paying Account and frozen provenance without cash-receipt labels", async () => {
  let command: unknown;
  let committed = false;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(returnPreview),
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        command = {
          version: request.headers.get("Finance-Command-Version"),
          body: await request.json(),
        };
        committed = true;
        return HttpResponse.json(
          returnReceipt(request.headers.get("Idempotency-Key")!),
          { status: 201 },
        );
      },
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/settlements",
      () => HttpResponse.json(committed ? [creditReturn] : []),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit return" }),
  );
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm credit return",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Return credit" }),
    ).not.toBeInTheDocument(),
  );
  expect(command).toEqual({ version: "8", body: returnBody });
  const detail = await screen.findByRole("region", {
    name: "Confirmed Settlement",
  });
  expect(
    await within(detail).findByText("Credit returned / Account outflow"),
  ).toBeVisible();
  expect(detail).toHaveTextContent("Paying Account");
  expect(detail).not.toHaveTextContent("Cash received");
  expect(within(detail).queryByRole("table")).not.toBeInTheDocument();
  expect(
    within(detail).getAllByRole("link", {
      name: /View linked credit return Internal Transfer/,
    }),
  ).toHaveLength(2);
  expect(
    await screen.findByRole("link", { name: /Credit returned 25 CNY/ }),
  ).toBeVisible();
});

it("preserves return intent after a correlated stale rejection and requires a fresh explicit confirmation", async () => {
  const commands: { key: string; body: unknown }[] = [];
  let previews = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json({
        ...returnPreview,
        previewToken: (++previews === 1 ? "e" : "f").repeat(64),
      }),
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        const key = request.headers.get("Idempotency-Key")!;
        commands.push({ key, body: await request.json() });
        const problem = {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "finance_settlement_preview_stale",
          detail: "Credit changed.",
        };
        return commands.length === 1
          ? HttpResponse.json(
              {
                ...problem,
                submissionReceipt: {
                  ...returnReceipt(key),
                  outcome: { kind: "rejected", problem },
                },
              },
              { status: 409 },
            )
          : HttpResponse.json(returnReceipt(key), { status: 201 });
      },
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit return" }),
  );
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm credit return",
    }),
  );
  await within(dialog).findByText(/The original credit return was rejected/);
  expect(
    within(dialog).queryByRole("button", { name: "Confirm credit return" }),
  ).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText("Return amount")).toHaveValue("25");
  expect(within(dialog).getByLabelText("Paying Account")).toHaveValue(
    account.id,
  );
  expect(within(dialog).getByLabelText("Return date")).toHaveValue(
    "2026-10-29",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Refresh preview" }),
  );
  expect(commands).toHaveLength(1);
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm credit return",
    }),
  );
  await waitFor(() => expect(commands).toHaveLength(2));
  expect(commands[1]!.key).not.toBe(commands[0]!.key);
  expect(commands[1]!.body).toEqual({
    ...returnBody,
    previewToken: "f".repeat(64),
  });
});

it("locks conflicting fields and other Settlement entry while the original return is pending", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(returnPreview),
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        posts++;
        await blocked;
        return HttpResponse.json(
          returnReceipt(request.headers.get("Idempotency-Key")!),
          { status: 201 },
        );
      },
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit return" }),
  );
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm credit return",
    }),
  );
  await waitFor(() => expect(posts).toBe(1));
  for (const name of [
    "Participant",
    "Paying Account",
    "Return amount",
    "Return date",
    "Note",
  ])
    expect(within(dialog).getByLabelText(name)).toBeDisabled();
  expect(
    within(dialog).getByRole("button", { name: "Confirming…" }),
  ).toBeDisabled();
  await user.click(
    within(dialog).getByRole("button", { name: "Close to recovery" }),
  );
  expect(
    screen.getByRole("heading", { name: "Repayments", level: 1 }),
  ).toHaveFocus();
  expect(screen.getByRole("button", { name: "Return credit" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Record repayment" }),
  ).toBeDisabled();
  release();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Return credit" })).toBeEnabled(),
  );
  expect(posts).toBe(1);
});

it.each(["0", "-1", "1e2", "1.001", "9".repeat(131073)])(
  "rejects invalid return Money without sending a preview (%#. case)",
  async (value) => {
    let previews = 0;
    server.use(
      http.post("*/api/finance/ledgers/:ledger/settlements/preview", () => {
        previews++;
        return HttpResponse.json(returnPreview);
      }),
    );
    const { user, dialog } = await draft();
    fireEvent.change(within(dialog).getByLabelText("Return amount"), {
      target: { value },
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Preview credit return" }),
    );
    expect(
      await within(dialog).findByText(/Enter a positive exact amount/),
    ).toBeVisible();
    expect(within(dialog).getByLabelText("Return amount")).toHaveFocus();
    expect(previews).toBe(0);
  },
);

it.each([
  ["9007199254740993.01", "\u0085" + "😀".repeat(500) + "\u001c"],
  ["9".repeat(131072), "\uFEFF" + "😀".repeat(499)],
  ["00000025.00", "\u001f" + "😀".repeat(500) + "\u001f"],
])(
  "preserves producer-valid Money and Unicode through form and authoritative preview (%#. case)",
  async (amount, note) => {
    let sent: unknown;
    server.use(
      http.post(
        "*/api/finance/ledgers/:ledger/settlements/preview",
        async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json({
            ...returnPreview,
            amount: money(amount),
            payingBalance: money(amount),
            payingBalanceAfter: money("0"),
            availableCreditBefore: money(amount),
            availableCreditAfter: money("0"),
            origins: [
              {
                ...returnPreview.origins[0],
                amount: money(amount),
                availableBefore: money(amount),
                availableAfter: money("0"),
              },
            ],
          });
        },
      ),
    );
    const { user, dialog } = await draft();
    fireEvent.change(within(dialog).getByLabelText("Return amount"), {
      target: { value: amount },
    });
    fireEvent.change(within(dialog).getByLabelText("Note"), {
      target: { value: note },
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Preview credit return" }),
    );
    expect(
      await within(dialog).findByRole("button", {
        name: "Confirm credit return",
      }),
    ).toHaveFocus();
    expect(sent).toMatchObject({ amount: money(amount), note });
  },
);

it.each(["😀".repeat(501), "\uFEFF" + "😀".repeat(500)])(
  "counts notes using P's stripped Unicode codepoints and keeps invalid text editable (%#. case)",
  async (note) => {
    let previews = 0;
    server.use(
      http.post("*/api/finance/ledgers/:ledger/settlements/preview", () => {
        previews++;
        return HttpResponse.json(returnPreview);
      }),
    );
    const { user, dialog } = await draft();
    fireEvent.change(within(dialog).getByLabelText("Note"), {
      target: { value: note },
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Preview credit return" }),
    );
    expect(
      await within(dialog).findByText(
        "Enter a note of at most 500 characters.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByLabelText("Note")).toHaveValue(note);
    expect(within(dialog).getByLabelText("Note")).toHaveFocus();
    expect(previews).toBe(0);
  },
);

it("drops confirmation after an edit and after malformed or inconsistent origin preview", async () => {
  let previews = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(
        ++previews === 1
          ? returnPreview
          : { ...returnPreview, origins: [...returnPreview.origins].reverse() },
      ),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit return" }),
  );
  await within(dialog).findByRole("button", { name: "Confirm credit return" });
  await user.type(within(dialog).getByLabelText("Note"), "changed");
  expect(
    within(dialog).queryByRole("button", { name: "Confirm credit return" }),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit return" }),
  );
  expect(
    await within(dialog).findByText(/Preview could not be loaded/),
  ).toBeVisible();
  expect(
    within(dialog).queryByRole("button", { name: "Confirm credit return" }),
  ).not.toBeInTheDocument();
});

it("keeps confirmed v8 terminal evidence when the source read is unavailable", async () => {
  let posts = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(returnPreview),
    ),
    http.post("*/api/finance/ledgers/:ledger/settlements", ({ request }) => {
      posts++;
      return HttpResponse.json(
        returnReceipt(request.headers.get("Idempotency-Key")!),
        { status: 201 },
      );
    }),
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json({}, { status: 503 }),
    ),
  );
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit return" }),
  );
  await user.click(
    await within(dialog).findByRole("button", {
      name: "Confirm credit return",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Return credit" }),
    ).not.toBeInTheDocument(),
  );
  const recovery = screen.getByRole("region", {
    name: "Finance submission recovery",
  });
  expect(recovery).toHaveTextContent("Settlement created");
  expect(
    within(recovery).queryByRole("button", {
      name: "Retry original submission",
    }),
  ).not.toBeInTheDocument();
  expect(posts).toBe(1);
});

it("rejects a return detail addressed across Ledger or Participant boundaries and inconsistent origin composition", () => {
  expect(() =>
    parseSettlementSource(creditReturn, crypto.randomUUID(), creditReturn.id),
  ).toThrow();
  expect(() =>
    parseSettlementSource(
      creditReturn,
      ledger.id,
      creditReturn.id,
      crypto.randomUUID(),
    ),
  ).toThrow();
  expect(() =>
    parseSettlementSource(
      { ...creditReturn, origins: [...creditReturn.origins].reverse() },
      ledger.id,
      creditReturn.id,
    ),
  ).toThrow();
  expect(() =>
    parseSettlementSource(
      {
        ...creditReturn,
        origins: [{ ...creditReturn.origins[0], amount: money("26") }],
      },
      ledger.id,
      creditReturn.id,
    ),
  ).toThrow();
});

it("uses exact integer JPY from the paying Account without fractional rounding", async () => {
  const jpy = (amount: string) => ({ amount, currency: "JPY" });
  let sent: unknown;
  server.use(
    getListFinanceAccountsMockHandler([
      {
        ...account,
        currency: "JPY",
        currentBalance: { amount: "100", currency: "JPY" },
        openingBalance: { amount: "100", currency: "JPY" },
      },
    ]),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({
          ...returnPreview,
          amount: jpy("25"),
          payingBalance: jpy("100"),
          payingBalanceAfter: jpy("75"),
          availableCreditBefore: jpy("50"),
          availableCreditAfter: jpy("25"),
          origins: returnPreview.origins.map((row) => ({
            ...row,
            amount: jpy(row.amount.amount),
            availableBefore: jpy(row.availableBefore.amount),
            availableAfter: jpy(row.availableAfter.amount),
          })),
        });
      },
    ),
  );
  const { user, dialog } = await draft();
  fireEvent.change(within(dialog).getByLabelText("Return amount"), {
    target: { value: "25.0" },
  });
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit return" }),
  );
  expect(
    await within(dialog).findByText(/Enter a positive exact amount/),
  ).toBeVisible();
  expect(sent).toBeUndefined();
  fireEvent.change(within(dialog).getByLabelText("Return amount"), {
    target: { value: "25" },
  });
  await user.click(
    within(dialog).getByRole("button", { name: "Preview credit return" }),
  );
  expect(
    await within(dialog).findByRole("button", {
      name: "Confirm credit return",
    }),
  ).toBeVisible();
  expect(sent).toMatchObject({ amount: jpy("25") });
});
