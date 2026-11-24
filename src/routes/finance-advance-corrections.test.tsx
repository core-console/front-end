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
  ledger,
  person,
  funding,
  before,
  correction,
  correctionDraft,
  correctionPreview,
  correctionReceipt,
  cashBefore,
  cashCorrection,
  cashCorrectionDraft,
  cashCorrectionPreview,
  correctionMoney,
} from "@/test/advance-correction-fixtures";
let creates = 0;
beforeEach(() => {
  creates = 0;
  server.use(
    getGetCurrentUserMockHandler(submissionTestUser),
    getListFinanceLedgersMockHandler([ledger]),
    getListFinanceAccountsMockHandler([funding]),
    getListFinanceParticipantsMockHandler([person]),
    getListFinanceCurrenciesMockHandler([{ code: "CNY", minorUnit: 2 }]),
    http.get("*/api/finance/ledgers/:ledger/advances/:id", () =>
      HttpResponse.json(creates ? correction.after : before),
    ),
    http.get("*/api/finance/ledgers/:ledger/advances/:id/corrections", () =>
      HttpResponse.json(creates ? [correction] : []),
    ),
    http.get("*/api/finance/ledgers/:ledger/advance-corrections/:id", () =>
      HttpResponse.json(correction),
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/advance-corrections/preview",
      async ({ request }) => {
        expect(await request.json()).toEqual(correctionDraft);
        return HttpResponse.json(correctionPreview);
      },
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/advance-corrections",
      async ({ request }) => {
        creates++;
        expect(request.headers.get("Finance-Command-Version")).toBe("1");
        expect(await request.json()).toEqual({
          ...correctionDraft,
          previewToken: correctionPreview.previewToken,
        });
        return HttpResponse.json(
          correctionReceipt(request.headers.get("Idempotency-Key")!),
          { status: 201 },
        );
      },
    ),
  );
});
async function open() {
  const user = userEvent.setup();
  renderRoute(`/finance/advances?ledger=${ledger.id}&advance_id=${before.id}`);
  const button = await screen.findByRole(
    "button",
    { name: "Correct Advance" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  return {
    user,
    dialog: screen.getByRole("dialog", { name: "Correct Advance" }),
  };
}
it("previews an explicit fully owner-funded attribution repair and confirms one retained history", async () => {
  const { user, dialog } = await open();
  await user.type(within(dialog).getByLabelText("Reason"), correction.reason);
  await user.clear(within(dialog).getByLabelText("Owner share"));
  await user.type(within(dialog).getByLabelText("Owner share"), "25.01");
  await user.click(
    within(dialog).getByRole("button", { name: "Remove Participant 1" }),
  );
  await user.clear(within(dialog).getByLabelText("Original financial date"));
  await user.type(
    within(dialog).getByLabelText("Original financial date"),
    "2026-10-20",
  );
  await user.clear(within(dialog).getByLabelText("Note"));
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Correction" }),
  );
  const review = await within(dialog).findByRole("region", {
    name: "Correction preview",
  });
  expect(within(review).getByText(/Funding unchanged/)).toBeVisible();
  expect(within(review).getByText(/Original confirmation/)).toBeVisible();
  const confirm = within(dialog).getByRole("button", {
    name: "Confirm Correction",
  });
  expect(confirm).toHaveFocus();
  expect(creates).toBe(0);
  await user.click(confirm);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const history = await screen.findByRole("region", {
    name: "Advance Correction history",
  });
  expect(await within(history).findByText(/Revision 1/)).toBeVisible();
  expect(within(history).getByText(correction.reason)).toBeVisible();
  expect(creates).toBe(1);
});
it("blocks inexact shares without rounding or requesting preview", async () => {
  const { user, dialog } = await open();
  await user.type(within(dialog).getByLabelText("Reason"), "Wrong share");
  await user.clear(within(dialog).getByLabelText("Owner share"));
  await user.type(within(dialog).getByLabelText("Owner share"), "0.01");
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Correction" }),
  );
  expect(
    await within(dialog).findByText(/must equal total funding exactly/),
  ).toBeVisible();
  expect(creates).toBe(0);
});

it("opens correction for an Advance with applied Credit and locks its date and attribution", async () => {
  const source = {
    ...before,
    obligation: {
      ...before.obligation,
      creditApplied: { amount: "1.00", currency: "CNY" },
      remaining: { amount: "24.01", currency: "CNY" },
    },
  };
  server.use(
    http.get("*/api/finance/ledgers/:ledger/advances/:id", () =>
      HttpResponse.json(source),
    ),
  );
  renderRoute(`/finance/advances?ledger=${ledger.id}&advance_id=${before.id}`);
  const button = await screen.findByRole(
    "button",
    { name: "Correct Advance" },
    { timeout: 5000 },
  );
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.setup().click(button);
  const dialog = await screen.findByRole("dialog", { name: "Correct Advance" });
  expect(
    within(dialog).getByLabelText("Original financial date"),
  ).toHaveAttribute("readonly");
  expect(
    within(dialog).getByLabelText("Participant 1", { exact: true }),
  ).toBeDisabled();
  expect(creates).toBe(0);
});
it("keeps date and attribution locked after effective forgiveness reaches zero", async () => {
  const forgiven = correctionMoney("5.01");
  const zero = correctionMoney("0.00");
  const past = {
    ...cashCorrection,
    before: {
      ...cashBefore,
      obligation: {
        ...cashBefore.obligation,
        forgiven,
        remaining: zero,
      },
    },
    accountEffects: cashCorrection.accountEffects.map((effect) =>
      effect.accountId === cashBefore.obligation.receivableAccountId
        ? { ...effect, balanceBefore: zero }
        : effect,
    ),
    forgivenessRestatements: [
      {
        settlementId: "01234567-890a-4bcd-8def-0123456789ab",
        confirmationOrder: 8,
        position: 1,
        obligationId: cashBefore.obligation.id,
        transactionDate: cashBefore.transactionDate,
        expenseTransactionId: "12345678-90ab-4cde-8f00-1234567890ab",
        originalForgiven: forgiven,
        forgivenBefore: forgiven,
        forgivenAfter: zero,
      },
    ],
  };
  server.use(
    http.get("*/api/finance/ledgers/:ledger/advances/:id", () =>
      HttpResponse.json(past.after),
    ),
    http.get("*/api/finance/ledgers/:ledger/advances/:id/corrections", () =>
      HttpResponse.json([past]),
    ),
  );
  const { dialog } = await open();
  await waitFor(() =>
    expect(
      within(dialog).getByLabelText("Original financial date"),
    ).toHaveAttribute("readonly"),
  );
  expect(
    within(dialog).getByRole("button", { name: "Add Participant" }),
  ).toBeDisabled();
  expect(within(dialog).getByLabelText("Participant 1")).toBeDisabled();
  expect(within(dialog).getByLabelText("Participant 1 share")).toBeEnabled();
});

it("previews and confirms a cash release with receipt-origin credit", async () => {
  server.use(
    http.get("*/api/finance/ledgers/:ledger/advances/:id", () =>
      HttpResponse.json(creates ? cashCorrection.after : cashBefore),
    ),
    http.get("*/api/finance/ledgers/:ledger/advances/:id/corrections", () =>
      HttpResponse.json(creates ? [cashCorrection] : []),
    ),
    http.get("*/api/finance/ledgers/:ledger/advance-corrections/:id", () =>
      HttpResponse.json(cashCorrection),
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/advance-corrections/preview",
      async ({ request }) => {
        expect(await request.json()).toEqual(cashCorrectionDraft);
        return HttpResponse.json(cashCorrectionPreview);
      },
    ),
    http.post(
      "*/api/finance/ledgers/:ledger/advance-corrections",
      ({ request }) => {
        creates++;
        return HttpResponse.json(
          correctionReceipt(request.headers.get("Idempotency-Key")!),
          { status: 201 },
        );
      },
    ),
  );
  const { user, dialog } = await open();
  await user.type(
    within(dialog).getByLabelText("Reason"),
    cashCorrectionDraft.reason,
  );
  await user.clear(within(dialog).getByLabelText("Owner share"));
  await user.type(within(dialog).getByLabelText("Owner share"), "10.00");
  await user.clear(within(dialog).getByLabelText("Participant 1 share"));
  await user.type(
    within(dialog).getByLabelText("Participant 1 share"),
    "15.01",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Preview Correction" }),
  );
  const release = await within(dialog).findByRole("region", {
    name: "Released cash and credit origins",
  });
  expect(within(release).getByText(/Released.*4\.99.*as credit/)).toBeVisible();
  expect(
    within(release).getByRole("link", { name: "Open originating receipt" }),
  ).toHaveAttribute(
    "href",
    expect.stringContaining(
      cashCorrectionPreview.cashReleases![0]!.settlementId,
    ),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm Correction" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const history = await screen.findByRole("region", {
    name: "Advance Correction history",
  });
  expect(
    await within(history).findByText(/Released.*4\.99.*as credit/),
  ).toBeVisible();
});
it("rejects a foreign-Ledger source before offering correction", async () => {
  server.use(
    http.get("*/api/finance/ledgers/:ledger/advances/:id", () =>
      HttpResponse.json({ ...before, ledgerId: crypto.randomUUID() }),
    ),
  );
  renderRoute(`/finance/advances?ledger=${ledger.id}&advance_id=${before.id}`);
  expect(
    await screen.findByText(
      /Advance source is unavailable/,
      {},
      { timeout: 5000 },
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Correct Advance" }),
  ).not.toBeInTheDocument();
});
