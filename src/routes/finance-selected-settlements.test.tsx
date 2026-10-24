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
  incomeSettlement,
} from "@/test/income-settlement-fixtures";
import {
  outstandingObligations,
  money,
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

it("pays only the deliberately selected second debt and retains its scope", async () => {
  const second = outstandingObligations[1]!;
  const preview = {
    ...repaymentPreview,
    amount: money("60.00"),
    receivingBalanceAfter: money("160.00"),
    outstandingBefore: money("60.00"),
    outstandingAfter: money("0.00"),
    allocations: [
      {
        ...repaymentPreview.allocations[1]!,
        position: 1,
        cashPaid: money("60.00"),
        remainingAfter: money("0.00"),
      },
    ],
  };
  let posted = false;
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlements/preview",
      async ({ request }) => {
        expect(await request.json()).toMatchObject({
          selectedObligationIds: [second.id],
          amount: money("60"),
        });
        return HttpResponse.json(preview);
      },
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlements",
      async ({ request }) => {
        expect(request.headers.get("Finance-Command-Version")).toBe("4");
        expect(await request.json()).toMatchObject({
          selectedObligationIds: [second.id],
          previewToken: preview.previewToken,
        });
        posted = true;
        return HttpResponse.json(
          {
            ...settlementReceipt(request.headers.get("Idempotency-Key")!),
            commandVersion: "4",
          },
          { status: 201 },
        );
      },
    ),
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json({
        ...settlement,
        amount: money("60.00"),
        allocations: preview.allocations,
        selectedObligationIds: [second.id],
      }),
    ),
  );
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&participant_id=${person.id}`,
  );
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
    within(dialog).getByLabelText("Receiving Account"),
    account.id,
  );
  await user.type(
    within(dialog).getByLabelText("Amount", { exact: true }),
    "60",
  );
  await user.selectOptions(
    within(dialog).getByLabelText("Repayment scope"),
    "selected",
  );
  await user.click(
    await within(dialog).findByRole("checkbox", {
      name: new RegExp(second.id),
    }),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Preview repayment" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Repayment preview",
  });
  expect(
    within(review).getByText(/Unselected debt remains unpaid/),
  ).toBeVisible();
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm repayment" }),
  );
  await screen.findByRole("heading", { name: "Confirmed Settlement" });
  expect(posted).toBe(true);
  expect(await screen.findByText("Confirmed selected scope")).toBeVisible();
});
