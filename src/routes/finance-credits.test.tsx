import { act, screen, waitFor, within } from "@testing-library/react";
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
import {
  creditPreview,
  creditSettlement,
  creditReceipt,
  zeroNetPositions,
  noDebtPreview,
} from "@/test/credit-fixtures";
import {
  money,
  outstandingObligations,
  repaymentPreview,
  settlement,
  settlementReceipt,
} from "@/test/settlement-fixtures";

beforeEach(() =>
  server.use(
    getGetCurrentUserMockHandler(submissionTestUser),
    getListFinanceLedgersMockHandler([ledger]),
    getListFinanceAccountsMockHandler([account]),
    getListFinanceParticipantsMockHandler([{ ...person, status: "archived" }]),
    getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
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
      HttpResponse.json(creditSettlement),
    ),
  ),
);

async function draft(amount = "102", retain = true) {
  const user = userEvent.setup();
  const trigger = await screen.findByRole(
    "button",
    { name: "Record repayment" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Record repayment" });
  await user.selectOptions(
    within(dialog).getByLabelText("Participant"),
    person.id,
  );
  await user.selectOptions(
    within(dialog).getByLabelText("Receiving Account"),
    account.id,
  );
  await user.type(within(dialog).getByLabelText("Amount"), amount);
  await user.clear(within(dialog).getByLabelText("Date"));
  await user.type(within(dialog).getByLabelText("Date"), "2027-01-02");
  const disposition = within(dialog).getByLabelText("Surplus handling");
  expect(disposition).toHaveValue("repayOnly");
  if (retain) await user.selectOptions(disposition, "retainCredit");
  return { user, dialog };
}

it("explicitly retains 2 of a full 102 receipt against 100 debt and shows the receipt-backed origin", async () => {
  let confirmed = false;
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        expect(await request.json()).toMatchObject({
          excessDisposition: "retainCredit",
          amount: money("102"),
        });
        return HttpResponse.json(creditPreview);
      },
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        expect(request.headers.get("Finance-Command-Version")).toBe("2");
        expect(request.headers.get("Finance-Submission-Owner")).toBe(
          submissionTestUser.id,
        );
        expect(await request.json()).toMatchObject({
          excessDisposition: "retainCredit",
          previewToken: creditPreview.previewToken,
        });
        confirmed = true;
        return HttpResponse.json(
          creditReceipt(request.headers.get("Idempotency-Key")!),
          { status: 201 },
        );
      },
    ),
    http.get("*/api/finance/ledgers/:ledger/participants/:person/credits", () =>
      HttpResponse.json(confirmed ? [creditSettlement.creditOrigin] : []),
    ),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Repayment preview",
  });
  expect(
    within(review).getByText("Retained credit Liability").nextElementSibling,
  ).toHaveTextContent("2.00 CNY");
  expect(
    within(review).getByText("Receiving balance after").nextElementSibling,
  ).toHaveTextContent("202.00 CNY");
  expect(review).toHaveTextContent(
    "Retained credit creates no Income or Expense",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm repayment" }),
  );
  const source = await screen.findByRole("region", {
    name: "Confirmed Settlement",
  });
  expect(
    await within(source).findByText("Retained credit Liability"),
  ).toBeVisible();
  expect(
    within(source).getByText("Retained credit Liability").nextElementSibling,
  ).toHaveTextContent("2.00 CNY");
  expect(
    within(source).getByRole("link", {
      name: /View linked Transaction.*dddddddd/,
    }),
  ).toBeVisible();
});

it("shows gross positions separately per currency at zero net and preserves immutable origin order for backdated receipts", async () => {
  const earlierConfirmed = {
    ...creditSettlement.creditOrigin,
    transactionDate: "2027-01-02",
    confirmationOrder: 1,
  };
  const laterConfirmed = {
    ...creditSettlement.creditOrigin,
    settlementId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    transactionDate: "2026-01-02",
    confirmationOrder: 2,
  };
  server.use(
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/positions",
      () => HttpResponse.json(zeroNetPositions),
    ),
    http.get("*/api/finance/ledgers/:ledger/participants/:person/credits", () =>
      HttpResponse.json([earlierConfirmed, laterConfirmed]),
    ),
  );
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
  const positions = await screen.findByRole(
    "table",
    { name: "Participant positions by currency" },
    { timeout: 5000 },
  );
  const rows = within(positions).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("CNY2.00 CNY2.00 CNY0.00 CNY");
  expect(rows[2]).toHaveTextContent("USD10.00 USD50.00 USD-40.00 USD");
  expect(
    await screen.findByRole("table", {
      name: "Participant receivable composition",
    }),
  ).toBeVisible();
  const origins = await screen.findByRole("list", {
    name: "Receipt-backed credit origins",
  });
  const items = within(origins).getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("2027-01-02");
  expect(items[1]).toHaveTextContent("2026-01-02");
  expect(
    within(items[1]!).getByRole("link", { name: /View source Settlement/ }),
  ).toHaveAttribute(
    "href",
    expect.stringContaining(laterConfirmed.settlementId),
  );
  expect(items[0]).toHaveTextContent(
    creditSettlement.creditOrigin.liabilityAccountId,
  );
  expect(
    screen.queryByRole("button", {
      name: /Accept surplus/,
    }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Apply credit" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Return credit" })).toBeEnabled();
});

it("records 50 without eligible debt into a receiving Liability without inventing an Obligation or applying credit", async () => {
  const source = {
    ...creditSettlement,
    amount: money("50.00"),
    allocations: [],
    creditOrigin: {
      ...creditSettlement.creditOrigin,
      amount: money("50.00"),
      available: money("50.00"),
    },
    transactionIds: [creditSettlement.creditOrigin.transactionId],
  };
  server.use(
    getListFinanceAccountsMockHandler([{ ...account, nature: "liability" }]),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/obligations",
      () => HttpResponse.json([]),
    ),
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json({
        ...noDebtPreview,
        receivingBalanceAfter: money("50.00"),
      }),
    ),
    http.post("*/api/finance/ledgers/:ledger/settlements", ({ request }) =>
      HttpResponse.json(
        creditReceipt(request.headers.get("Idempotency-Key")!),
        { status: 201 },
      ),
    ),
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json(source),
    ),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft("50");
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Repayment preview",
  });
  expect(review).toHaveTextContent("Receiving Liability decreases");
  expect(review).toHaveTextContent("No eligible debt is paid");
  expect(
    within(review).getByText("Retained credit Liability").nextElementSibling,
  ).toHaveTextContent("50.00 CNY");
  expect(
    within(review).getByText("Available credit after").nextElementSibling,
  ).toHaveTextContent("52.00 CNY");
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm repayment" }),
  );
  const result = await screen.findByRole("region", {
    name: "Confirmed Settlement",
  });
  expect(await within(result).findByText("Cash received")).toBeVisible();
  expect(
    within(result).getByText("Cash received").nextElementSibling,
  ).toHaveTextContent("50.00 CNY");
  expect(within(result).getAllByRole("row")).toHaveLength(1);
});

it("requires a version 2 preview for retain-credit and permits version 2 with zero remainder to use the original detail shape", async () => {
  let calls = 0;
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json(
        ++calls === 1
          ? repaymentPreview
          : {
              ...repaymentPreview,
              retainedCredit: money("0.00"),
              availableCreditBefore: money("2.00"),
              availableCreditAfter: money("2.00"),
            },
      ),
    ),
    http.post("*/api/finance/ledgers/:ledger/settlements", ({ request }) =>
      HttpResponse.json(
        creditReceipt(request.headers.get("Idempotency-Key")!),
        { status: 201 },
      ),
    ),
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json(settlement),
    ),
  );
  renderRoute(`/finance/repayments?ledger=${ledger.id}`);
  const { user, dialog } = await draft("50");
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  expect(
    await within(dialog).findByText(/Preview could not be loaded/),
  ).toBeVisible();
  expect(
    within(dialog).queryByRole("button", { name: "Confirm repayment" }),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Confirm repayment" }),
  );
  const result = await screen.findByRole("region", {
    name: "Confirmed Settlement",
  });
  expect(await within(result).findByText("Cash received")).toBeVisible();
  expect(
    within(result).queryByText("Retained credit Liability"),
  ).not.toBeInTheDocument();
});

it("requires deliberate new confirmation of changed credit after correlated stale rejection", async () => {
  let previews = 0;
  const posts: { key: string; body: unknown }[] = [];
  server.use(
    http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
      HttpResponse.json({
        ...creditPreview,
        previewToken: (++previews === 1 ? "a" : "b").repeat(64),
        retainedCredit: money(previews === 1 ? "2.00" : "22.00"),
        outstandingBefore: money(previews === 1 ? "100.00" : "80.00"),
        availableCreditAfter: money(previews === 1 ? "2.00" : "22.00"),
      }),
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
          detail: "Credit changed.",
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
  await within(dialog).findByRole("button", { name: "Refresh preview" });
  expect(within(dialog).getByLabelText("Surplus handling")).toHaveValue(
    "retainCredit",
  );
  expect(
    within(dialog).queryByRole("button", { name: "Confirm repayment" }),
  ).not.toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Refresh preview" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Repayment preview",
  });
  expect(
    within(review).getByText("Retained credit Liability").nextElementSibling,
  ).toHaveTextContent("22.00 CNY");
  expect(posts).toHaveLength(1);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm repayment" }),
  );
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[0]!.key).not.toBe(posts[1]!.key);
  expect(
    posts.map((item) => (item.body as { previewToken: string }).previewToken),
  ).toEqual(["a".repeat(64), "b".repeat(64)]);
});

it.each(["missing", "busy", "wrong version"])(
  "keeps a lost version 2 response immutable across navigation and %s lookup until explicit same-key retry",
  async (mode) => {
    const posts: { key: string; body: string; version: string | null }[] = [];
    let markLookupStarted!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve;
    });
    let releaseLookup!: () => void;
    const lookupResponse = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    server.use(
      http.post("*/api/finance/ledgers/:ledger/settlements/preview", () =>
        HttpResponse.json(creditPreview),
      ),
      http.post(
        "*/api/finance/ledgers/:ledger/settlements",
        async ({ request }) => {
          const key = request.headers.get("Idempotency-Key")!;
          posts.push({
            key,
            body: await request.text(),
            version: request.headers.get("Finance-Command-Version"),
          });
          return posts.length === 1
            ? HttpResponse.error()
            : HttpResponse.json(creditReceipt(key), { status: 201 });
        },
      ),
      http.get("*/api/finance/submissions/:id", async ({ params }) => {
        markLookupStarted();
        await lookupResponse;
        return mode === "wrong version"
          ? HttpResponse.json({
              state: "terminal",
              receipt: settlementReceipt(String(params.id)),
            })
          : HttpResponse.json(
              {
                type: "about:blank",
                title: "Unavailable",
                status: mode === "missing" ? 404 : 409,
                code:
                  mode === "missing"
                    ? "finance_submission_not_found"
                    : "finance_submission_busy",
              },
              { status: mode === "missing" ? 404 : 409 },
            );
      }),
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
    expect(within(dialog).getByLabelText("Surplus handling")).toBeDisabled();
    await user.click(
      within(dialog).getByRole("button", { name: "Close to recovery" }),
    );
    await act(() => router.navigate("/"));
    await act(() => router.navigate(`/finance/repayments?ledger=${ledger.id}`));
    expect(
      await screen.findByRole("button", { name: "Record repayment" }),
    ).toBeDisabled();
    expect(posts).toHaveLength(1);
    await lookupStarted;
    const retry = await screen.findByRole("button", {
      name: "Retry original submission",
    });
    try {
      await waitFor(() => expect(retry).toBeDisabled());
      await user.click(retry);
      expect(posts).toHaveLength(1);
    } finally {
      releaseLookup();
    }
    // A mounted retry control is not actionable until recovery lookup settles.
    await waitFor(() => expect(retry).toBeEnabled());
    expect(posts).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Record repayment" }),
    ).toBeDisabled();
    await user.click(retry);
    await screen.findByRole("status", { name: /Settlement created:/ });
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[0]!.version).toBe("2");
    expect(
      screen.queryByRole("button", { name: "Retry original submission" }),
    ).not.toBeInTheDocument();
  },
);

it("refuses foreign credit provenance and currency-mismatched positions without hiding valid debt", async () => {
  server.use(
    http.get("*/api/finance/ledgers/:ledger/participants/:person/credits", () =>
      HttpResponse.json([
        {
          ...creditSettlement.creditOrigin,
          participantId: crypto.randomUUID(),
        },
      ]),
    ),
    http.get(
      "*/api/finance/ledgers/:ledger/participants/:person/positions",
      () =>
        HttpResponse.json([
          {
            ...zeroNetPositions[0],
            netExposure: { amount: "0.00", currency: "USD" },
          },
        ]),
    ),
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json({
        ...creditSettlement,
        creditOrigin: {
          ...creditSettlement.creditOrigin,
          settlementId: crypto.randomUUID(),
        },
      }),
    ),
  );
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}&settlement_id=${settlement.id}`,
  );
  expect(
    await screen.findByText(/Credit origins could not refresh/),
  ).toBeVisible();
  expect(
    await screen.findByText(/Participant positions could not refresh/),
  ).toBeVisible();
  expect(
    await screen.findByText(/Settlement source is unavailable/),
  ).toBeVisible();
  expect(
    screen.queryByRole("list", { name: "Receipt-backed credit origins" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("table", { name: "Participant receivable composition" }),
  ).toBeVisible();
});
