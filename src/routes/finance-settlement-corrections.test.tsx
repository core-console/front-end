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
  ledger,
  person,
  account,
  receiptBefore,
  receiptAfter,
  receiptCorrectionDraft,
  receiptCorrectionPreview,
  receiptCorrection,
  receiptCorrectionReceipt,
} from "@/test/settlement-correction-fixtures";
let creates = 0;
beforeEach(() => {
  creates = 0;
  server.use(
    getGetCurrentUserMockHandler(submissionTestUser),
    getListFinanceLedgersMockHandler([ledger]),
    getListFinanceAccountsMockHandler([account]),
    getListFinanceParticipantsMockHandler([person]),
    getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
    getListFinanceCategoriesMockHandler([]),
    http.get("*/api/finance/ledgers/:ledger/settlements/:id", () =>
      HttpResponse.json(creates ? receiptAfter : receiptBefore),
    ),
    http.get("*/api/finance/ledgers/:ledger/settlements/:id/corrections", () =>
      HttpResponse.json(creates ? [receiptCorrection] : []),
    ),
    http.get("*/api/finance/ledgers/:ledger/settlement-corrections/:id", () =>
      HttpResponse.json(receiptCorrection),
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlement-corrections/preview",
      async ({ request }) => {
        expect(await request.json()).toEqual(receiptCorrectionDraft);
        return HttpResponse.json(receiptCorrectionPreview);
      },
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/settlement-corrections",
      async ({ request }) => {
        creates++;
        expect(request.headers.get("Finance-Command-Version")).toBe("1");
        expect(await request.json()).toEqual({
          ...receiptCorrectionDraft,
          previewToken: receiptCorrectionPreview.previewToken,
        });
        return HttpResponse.json(
          receiptCorrectionReceipt(request.headers.get("Idempotency-Key")!),
          { status: 201 },
        );
      },
    ),
  );
});
async function openCorrection() {
  const user = userEvent.setup();
  renderRoute(
    `/finance/repayments?ledger=${ledger.id}&settlement_id=${receiptBefore.id}`,
  );
  const trigger = await screen.findByRole(
    "button",
    {
      name: "Correct cash repayment",
    },
    { timeout: 5000 },
  );
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Correct cash repayment" });
  await user.type(
    within(dialog).getByLabelText("Reason"),
    receiptCorrectionDraft.reason,
  );
  await user.clear(within(dialog).getByLabelText("Corrected cash receipt"));
  await user.type(
    within(dialog).getByLabelText("Corrected cash receipt"),
    "70.00",
  );
  return { user, dialog };
}
it("reviews authoritative reverse-order release without forgiveness and confirms retained history", async () => {
  const { user, dialog } = await openCorrection();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Correction" }),
  );
  const after = await within(dialog).findByRole("region", {
    name: "After receipt facts",
  });
  expect(after).toHaveTextContent("70.00 CNY");
  expect(after).toHaveTextContent("30.00 CNY");
  expect(creates).toBe(0);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm Correction" }),
  );
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(
    await screen.findByRole("region", {
      name: "Cash repayment Correction history",
    }),
  ).toHaveTextContent("Revision 1");
  expect(creates).toBe(1);
});

it("invalidates confirmation when authored intent changes", async () => {
  const { user, dialog } = await openCorrection();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Correction" }),
  );
  expect(
    await within(dialog).findByRole("button", { name: "Confirm Correction" }),
  ).toBeEnabled();
  await user.type(within(dialog).getByLabelText("Reason"), " corrected");
  expect(
    within(dialog).queryByRole("button", { name: "Confirm Correction" }),
  ).not.toBeInTheDocument();
  expect(creates).toBe(0);
});

it.each([
  "foreign source",
  "wrong amount",
  "unreconciled balance",
  "changed Allocation identity",
])("refuses confirmation of %s in an untrusted preview", async (kind) => {
  const plan = structuredClone(receiptCorrectionPreview);
  if (kind === "foreign source") plan.settlementId = crypto.randomUUID();
  if (kind === "wrong amount") plan.after.amount.amount = "70.01";
  if (kind === "unreconciled balance")
    plan.accountEffects[0]!.balanceAfter.amount = "999.00";
  if (kind === "changed Allocation identity")
    plan.after.allocations[0]!.obligationId = crypto.randomUUID();
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlement-corrections/preview",
      () => HttpResponse.json(plan),
    ),
  );
  const { user, dialog } = await openCorrection();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Correction" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "preview is unavailable",
  );
  expect(
    within(dialog).queryByRole("button", { name: "Confirm Correction" }),
  ).not.toBeInTheDocument();
  expect(creates).toBe(0);
});

it("preserves intent after producer ineligibility without offering confirmation", async () => {
  server.use(
    http.post(
      "*/api/finance/ledgers/:ledger/settlement-corrections/preview",
      () =>
        HttpResponse.json(
          { code: "finance_settlement_correction_ineligible" },
          { status: 409 },
        ),
    ),
  );
  const { user, dialog } = await openCorrection();
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Correction" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "ineligible",
  );
  expect(within(dialog).getByLabelText("Corrected cash receipt")).toHaveValue(
    "70.00",
  );
  expect(creates).toBe(0);
});

it.each(["0", "70.001", "1e2", "-70"])(
  "rejects invalid exact receipt %s without dispatch",
  async (amount) => {
    const { user, dialog } = await openCorrection();
    await user.clear(within(dialog).getByLabelText("Corrected cash receipt"));
    await user.type(
      within(dialog).getByLabelText("Corrected cash receipt"),
      amount,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Preview Correction" }),
    );
    expect(
      within(dialog).getByLabelText("Corrected cash receipt"),
    ).toHaveAccessibleDescription(/positive exact amount/);
    expect(creates).toBe(0);
  },
);
