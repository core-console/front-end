import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import {
  getGetBalanceAdjustmentContextQueryKey,
  getGetFinanceTransactionQueryKey,
  getListFinanceTransactionsQueryKey,
} from "@/api/generated/core-console";
import {
  getDeleteFinanceTransactionMockHandler404,
  getGetFinanceTransactionMockHandler,
  getGetFinanceTransactionMockHandler404,
  getListFinanceAccountsMockHandler,
  getListFinanceCategoriesMockHandler,
  getListFinanceCurrenciesMockHandler,
  getListFinanceLedgersMockHandler,
  getListFinanceTransactionsMockHandler,
} from "@/api/generated/core-console.msw";
import type { FinanceTransactionResponse } from "@/api/generated/schemas";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

const ledgerId = "11111111-1111-4111-8111-111111111111";
const otherLedgerId = "55555555-5555-4555-8555-555555555555";
const transactionId = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const duplicateTransactionId = "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const account = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Cash",
  status: "archived",
} as const;
const otherAccount = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Cash",
  status: "active",
} as const;
const base = {
  id: transactionId,
  ledgerId,
  note: "Exact note",
  transactionDate: "2026-08-16",
} as const;
const money = { amount: "9007199254740993.25", currency: "USD" } as const;
const transactions = [
  {
    ...base,
    account,
    categoryAllocations: [{ amount: money, category: null }],
    economicAmount: money,
    kind: "income",
  },
  {
    ...base,
    account,
    categoryAllocations: [
      {
        amount: money,
        category: {
          id: "44444444-4444-4444-8444-444444444444",
          name: "Food",
          status: "archived",
        },
      },
    ],
    economicAmount: money,
    kind: "expense",
  },
  {
    ...base,
    destinationAccount: otherAccount,
    destinationAmount: money,
    kind: "internalTransfer",
    sourceAccount: account,
    sourceAmount: money,
  },
  {
    ...base,
    account,
    correctionDelta: { amount: "-27.00", currency: "USD" },
    kind: "balanceAdjustment",
  },
] satisfies FinanceTransactionResponse[];

function mockLedger() {
  server.use(
    getListFinanceLedgersMockHandler([{ id: ledgerId, name: "Personal" }]),
  );
}

function fullAccount(reference: typeof account | typeof otherAccount) {
  return {
    ...reference,
    currency: "USD" as const,
    currentBalance: { amount: "0.00", currency: "USD" as const },
    openingBalance: { amount: "0.00", currency: "USD" as const },
    nature: "asset" as const,
    trackingStartDate: "2026-01-01",
  };
}

function mockEditReferences() {
  server.use(
    getListFinanceAccountsMockHandler([
      fullAccount(account),
      fullAccount(otherAccount),
    ]),
    getListFinanceCategoriesMockHandler([
      {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Food",
        status: "archived",
      },
    ]),
    getListFinanceCurrenciesMockHandler([{ code: "USD", minorUnit: 2 }]),
  );
}

describe("Finance Transaction detail", () => {
  it.each(
    (["id", "ledger", "kind"] as const).flatMap((mismatch) =>
      (["detail", "history"] as const).flatMap((entry) =>
        (["updated", "removed", "failed"] as const).map((outcome) => ({
          mismatch,
          entry,
          outcome,
        })),
      ),
    ),
  )(
    "owns a pending nonmatching $mismatch response from $entry through $outcome settlement",
    async ({ mismatch, entry, outcome }) => {
      const user = userEvent.setup();
      const adjustment = transactions[3]!;
      const updated = { ...adjustment, note: "Confirmed replacement" };
      const nonmatching =
        mismatch === "id"
          ? { ...adjustment, id: duplicateTransactionId }
          : mismatch === "ledger"
            ? { ...adjustment, ledgerId: otherLedgerId }
            : transactions[0]!;
      let detailResponse: FinanceTransactionResponse = adjustment;
      let puts = 0;
      let releasePut!: () => void;
      let releaseAccounts!: () => void;
      let holdAccounts = false;
      let heldAccountReads = 0;
      const putGate = new Promise<void>((resolve) => {
        releasePut = resolve;
      });
      const accountGate = new Promise<void>((resolve) => {
        releaseAccounts = resolve;
      });
      mockLedger();
      mockEditReferences();
      server.use(
        http.get("*/api/finance/ledgers/:ledgerId/accounts", async () => {
          if (holdAccounts) {
            heldAccountReads++;
            await accountGate;
          }
          return HttpResponse.json([
            fullAccount(account),
            fullAccount(otherAccount),
          ]);
        }),
        getListFinanceTransactionsMockHandler({
          items: [adjustment],
          nextCursor: null,
        }),
        http.get(
          "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
          () => HttpResponse.json(detailResponse),
        ),
        http.get(
          "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
          () =>
            HttpResponse.json({
              account,
              accountNature: "asset",
              derivedComparisonBalance: { amount: "25.00", currency: "USD" },
              transactionDate: adjustment.transactionDate,
            }),
        ),
        http.put(
          "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
          async ({ params }) => {
            expect(params.ledgerId).toBe(ledgerId);
            expect(params.transactionId).toBe(transactionId);
            puts++;
            await putGate;
            if (outcome === "failed" && puts === 1)
              return HttpResponse.json(
                {
                  code: "database_unavailable",
                  detail: "Unavailable",
                  status: 503,
                  title: "Unavailable",
                  type: "about:blank",
                },
                { status: 503 },
              );
            return HttpResponse.json(
              outcome === "removed"
                ? { outcome, transaction: null }
                : { outcome: "updated", transaction: updated },
            );
          },
        ),
      );
      const { queryClient } = renderRoute(
        `/finance/transactions?ledger=${ledgerId}`,
      );
      const historyEdit = await screen.findByRole(
        "button",
        { name: new RegExp(`Edit Balance Adjustment.*${transactionId}`) },
        { timeout: 5_000 },
      );
      if (entry === "detail") {
        await user.click(
          screen.getByRole("link", {
            name: new RegExp(
              `View details for Balance Adjustment.*${transactionId}`,
            ),
          }),
        );
        await user.click(
          await screen.findByRole("button", {
            name: "Edit Balance Adjustment",
          }),
        );
      } else await user.click(historyEdit);
      const dialog = await screen.findByRole("dialog", {
        name: "Edit Balance Adjustment",
      });
      const labelledBy = dialog.getAttribute("aria-labelledby");
      const describedBy = dialog.getAttribute("aria-describedby");
      const expectAccessibleDialog = () => {
        expect(dialog).toHaveAccessibleName("Edit Balance Adjustment");
        expect(dialog).toHaveAccessibleDescription(
          "Review the balance excluding this Adjustment and the Account nature. Set a known actual end-of-day target balance.",
        );
        expect(dialog).toHaveAttribute("aria-labelledby", labelledBy);
        expect(dialog).toHaveAttribute("aria-describedby", describedBy);
        for (const ids of [labelledBy, describedBy]) {
          expect(ids).toBeTruthy();
          for (const id of ids!.split(/\s+/))
            expect(document.getElementById(id)).toBeVisible();
        }
      };
      const target = within(dialog).getByRole("textbox", {
        name: "Target balance",
      });
      await waitFor(() => expect(target).toBeEnabled());
      expectAccessibleDialog();
      await user.type(target, "30.00");
      const note = within(dialog).getByRole("textbox", { name: "Note" });
      await user.clear(note);
      await user.type(note, "Keep the pinned draft");
      holdAccounts = true;
      await user.click(
        within(dialog).getByRole("button", { name: "Save adjustment" }),
      );
      await waitFor(() => expect(puts).toBe(1));
      const detailKey = getGetFinanceTransactionQueryKey(
        ledgerId,
        transactionId,
      );
      try {
        detailResponse = nonmatching;
        await act(async () => {
          await queryClient.refetchQueries({
            queryKey: detailKey,
            exact: true,
          });
        });
        expect(
          queryClient.getQueryData<{ data: FinanceTransactionResponse }>(
            detailKey,
          )?.data,
        ).toEqual(nonmatching);
        expect(target).toBeInTheDocument();
        expect(target).toHaveValue("30.00");
        expect(note).toHaveValue("Keep the pinned draft");
        expect(dialog).toHaveAttribute("aria-busy", "true");
        expect(
          within(dialog).getByRole("button", { name: "Cancel" }),
        ).toBeDisabled();
        expect(
          within(dialog).getByRole("button", { name: "Saving adjustment…" }),
        ).toBeDisabled();
        await user.keyboard("{Escape}");
        expect(dialog).toBeInTheDocument();
        expect(target).toBeVisible();
        expect(target).toHaveValue("30.00");
        expect(puts).toBe(1);
        releasePut();
        if (outcome === "failed") {
          // The mismatching read may drive recovery only after authority is released.
          await waitFor(() =>
            expect(dialog).toHaveAttribute("aria-busy", "false"),
          );
          expect(
            within(dialog).getByRole("button", { name: "Cancel" }),
          ).toBeEnabled();
          expect(
            screen.queryByText("Balance Adjustment updated."),
          ).not.toBeInTheDocument();
          expect(
            screen.queryByText("Balance Adjustment removed."),
          ).not.toBeInTheDocument();
          expectAccessibleDialog();
          detailResponse = adjustment;
          await user.click(
            within(dialog).getByRole("button", { name: "Retry" }),
          );
          const recoveredTarget = await within(dialog).findByRole("textbox", {
            name: "Target balance",
          });
          await waitFor(() => expect(recoveredTarget).toBeEnabled());
          expectAccessibleDialog();
          expect(recoveredTarget).toHaveValue("30.00");
          expect(
            within(dialog).getByRole("textbox", { name: "Note" }),
          ).toHaveValue("Keep the pinned draft");
          await user.click(
            within(dialog).getByRole("button", { name: "Save adjustment" }),
          );
        }
        // Mutation settlement is not the end of authority: reconciliation still
        // has a held Account refresh, and another detail response must not exit.
        await waitFor(() => expect(heldAccountReads).toBeGreaterThan(0));
        detailResponse = nonmatching;
        await act(async () => {
          await queryClient.refetchQueries({
            queryKey: detailKey,
            exact: true,
          });
        });
        await user.keyboard("{Escape}");
        expect(target).toBeVisible();
        expect(dialog).toHaveAttribute("aria-busy", "true");
        expect(
          within(dialog).getByRole("button", { name: "Cancel" }),
        ).toBeDisabled();
        detailResponse = updated;
        releaseAccounts();
        const message =
          outcome === "removed"
            ? "Balance Adjustment removed."
            : "Balance Adjustment updated.";
        await waitFor(() => {
          expect(
            screen.queryByRole("dialog", { name: "Edit Balance Adjustment" }),
          ).not.toBeInTheDocument();
          expect(screen.getByRole("status")).toHaveTextContent(message);
        });
        expect(screen.getAllByText(message)).toHaveLength(1);
        expect(puts).toBe(outcome === "failed" ? 2 : 1);
        const history = queryClient
          .getQueriesData<{ pages: { items: FinanceTransactionResponse[] }[] }>(
            {
              queryKey: getListFinanceTransactionsQueryKey(ledgerId),
            },
          )
          .flatMap(
            ([, data]) => data?.pages.flatMap((page) => page.items) ?? [],
          );
        if (outcome === "removed") {
          expect(history).not.toContainEqual(
            expect.objectContaining({ id: transactionId }),
          );
        } else {
          expect(
            queryClient.getQueryData<{ data: FinanceTransactionResponse }>(
              detailKey,
            )?.data,
          ).toEqual(updated);
          expect(history).toContainEqual(updated);
          await user.click(
            screen.getByRole("button", {
              name:
                entry === "detail"
                  ? "Edit Balance Adjustment"
                  : new RegExp(`Edit Balance Adjustment.*${transactionId}`),
            }),
          );
          const nextDialog = await screen.findByRole("dialog", {
            name: "Edit Balance Adjustment",
          });
          await waitFor(() =>
            expect(
              within(nextDialog).getByRole("textbox", {
                name: "Target balance",
              }),
            ).toBeEnabled(),
          );
          await user.click(
            within(nextDialog).getByRole("button", { name: "Cancel" }),
          );
          await waitFor(() => expect(nextDialog).not.toBeInTheDocument());
        }
      } finally {
        releasePut();
        releaseAccounts();
      }
    },
  );

  it("settles missing-Transaction cleanup before releasing a failed session during conflict recovery", async () => {
    const user = userEvent.setup();
    const adjustment = transactions[3]!;
    let puts = 0;
    let recoveryReads = 0;
    let releaseRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(adjustment),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        async () => {
          if (puts) {
            recoveryReads++;
            await recoveryGate;
            return HttpResponse.json(
              {
                code: "finance_transaction_not_found",
                detail: "Missing",
                status: 404,
                title: "Not found",
                type: "about:blank",
              },
              { status: 404 },
            );
          }
          return HttpResponse.json({
            account,
            accountNature: "asset",
            derivedComparisonBalance: { amount: "25.00", currency: "USD" },
            transactionDate: adjustment.transactionDate,
          });
        },
      ),
      http.put(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
        () => {
          puts++;
          return HttpResponse.json(
            {
              code: "account_balance_changed",
              detail: "Balance changed",
              status: 409,
              title: "Conflict",
              type: "about:blank",
            },
            { status: 409 },
          );
        },
      ),
    );
    const { queryClient } = renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
    );
    const historyKey = getListFinanceTransactionsQueryKey(ledgerId);
    queryClient.setQueryData(historyKey, {
      pages: [{ items: [adjustment], nextCursor: null }],
      pageParams: [undefined],
    });
    await user.click(
      await screen.findByRole("button", { name: "Edit Balance Adjustment" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Balance Adjustment",
    });
    const target = within(dialog).getByRole("textbox", {
      name: "Target balance",
    });
    await waitFor(() => expect(target).toBeEnabled());
    await user.type(target, "30.00");
    await user.click(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    );
    try {
      await waitFor(() => expect(recoveryReads).toBe(1));
      server.use(
        getGetFinanceTransactionMockHandler({
          ...adjustment,
          id: duplicateTransactionId,
        }),
      );
      await act(async () => {
        await queryClient.refetchQueries({
          queryKey: getGetFinanceTransactionQueryKey(ledgerId, transactionId),
          exact: true,
        });
      });
      await user.keyboard("{Escape}");
      expect(target).toBeVisible();
      expect(target).toHaveValue("30.00");
      expect(dialog).toHaveAttribute("aria-busy", "true");
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toBeDisabled();
      // Record the cache at the observable authority-release boundary, rather
      // than allowing a later child effect or history refetch to repair it.
      const historyAtRelease: unknown[] = [];
      const observer = new MutationObserver(() => {
        if (!dialog.isConnected || dialog.getAttribute("aria-busy") === "false")
          historyAtRelease.push(queryClient.getQueryData(historyKey));
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["aria-busy"],
      });
      try {
        releaseRecovery();
        await waitFor(() => {
          expect(
            screen.queryByRole("dialog", { name: "Edit Balance Adjustment" }),
          ).not.toBeInTheDocument();
          expect(screen.getByRole("status")).toHaveTextContent(
            "Transaction unavailable. It was already removed.",
          );
        });
        expect(historyAtRelease.length).toBeGreaterThan(0);
        for (const history of historyAtRelease)
          expect(history).toMatchObject({ pages: [{ items: [] }] });
        expect(puts).toBe(1);
      } finally {
        observer.disconnect();
      }
    } finally {
      releaseRecovery();
    }
  });

  it("replaces an archived Account Adjustment from authoritative context with exact Money", async () => {
    const user = userEvent.setup();
    const adjustment = transactions[3]!;
    const requests: unknown[] = [];
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(adjustment),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        ({ request, params }) => {
          const url = new URL(request.url);
          expect(params.accountId).toBe(account.id);
          expect(url.searchParams.get("replacingTransactionId")).toBe(
            transactionId,
          );
          return HttpResponse.json({
            account,
            accountNature: "asset",
            derivedComparisonBalance: money,
            transactionDate: "2026-08-16",
          });
        },
      ),
      http.put(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
        async ({ request }) => {
          requests.push(await request.json());
          return HttpResponse.json({
            outcome: "updated",
            transaction: {
              ...adjustment,
              correctionDelta: { amount: "1.00", currency: "USD" },
            },
          });
        },
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Edit Balance Adjustment" },
        { timeout: 5_000 },
      ),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Balance Adjustment",
    });
    expect(
      within(dialog).getByRole("combobox", { name: "Account" }),
    ).toHaveValue(account.id);
    expect(
      within(dialog).getByRole("option", { name: /Cash.*\(archived\)/ }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("textbox", { name: "Target balance" }),
      ).toBeEnabled(),
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Target balance" }),
      "9007199254740994.25",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({
      accountId: account.id,
      expectedAccountNature: "asset",
      expectedDerivedBalance: money,
      note: "Exact note",
      targetBalance: { amount: "9007199254740994.25", currency: "USD" },
      transactionDate: "2026-08-16",
    });
    await waitFor(
      () => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(
          "Balance Adjustment updated.",
        );
      },
      { timeout: 10_000 },
    );
  }, 15_000);

  it.each([
    {
      code: "account_balance_changed",
      title: "Account balance changed",
      amount: "9007199254740995.25",
      nature: "asset",
    },
    {
      code: "finance_account_semantics_changed",
      title: "Account nature changed",
      amount: money.amount,
      nature: "liability",
    },
  ] as const)(
    "requires review and a new submit after $code",
    async ({ code, title, amount, nature }) => {
      const user = userEvent.setup();
      const adjustment = transactions[3]!;
      const bodies: unknown[] = [];
      let contextReads = 0;
      mockLedger();
      mockEditReferences();
      server.use(
        getGetFinanceTransactionMockHandler(adjustment),
        http.get(
          "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
          ({ request }) => {
            contextReads++;
            const url = new URL(request.url);
            return HttpResponse.json({
              account,
              accountNature: contextReads === 1 ? "asset" : nature,
              derivedComparisonBalance: {
                amount: contextReads === 1 ? money.amount : amount,
                currency: "USD",
              },
              transactionDate: url.searchParams.get("transactionDate"),
            });
          },
        ),
        http.put(
          "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
          async ({ request }) => {
            bodies.push(await request.json());
            if (bodies.length === 1)
              return HttpResponse.json(
                {
                  code,
                  detail: "Changed",
                  status: 409,
                  title: "Conflict",
                  type: "about:blank",
                },
                { status: 409 },
              );
            return HttpResponse.json({
              outcome: "updated",
              transaction: adjustment,
            });
          },
        ),
      );
      renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
      await user.click(
        await screen.findByRole(
          "button",
          { name: "Edit Balance Adjustment" },
          { timeout: 5_000 },
        ),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Edit Balance Adjustment",
      });
      const target = within(dialog).getByRole("textbox", {
        name: "Target balance",
      });
      await waitFor(() => expect(target).toBeEnabled());
      await user.type(target, "9007199254740994.25");
      await user.click(
        within(dialog).getByRole("button", { name: "Save adjustment" }),
      );
      expect(await within(dialog).findByText(title)).toBeVisible();
      expect(target).toHaveValue("9007199254740994.25");
      expect(within(dialog).getByRole("textbox", { name: "Note" })).toHaveValue(
        "Exact note",
      );
      expect(bodies).toHaveLength(1);
      expect(
        within(dialog).getByText(
          /submit again only if the target remains correct/i,
        ),
      ).toBeVisible();
      await user.click(
        within(dialog).getByRole("button", { name: "Save adjustment" }),
      );
      await waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies[1]).toMatchObject({
        accountId: account.id,
        expectedAccountNature: nature,
        expectedDerivedBalance: { amount, currency: "USD" },
        targetBalance: { amount: "9007199254740994.25", currency: "USD" },
      });
    },
  );

  it("removes a zero-delta replacement and shows distinct accessible feedback", async () => {
    const user = userEvent.setup();
    const adjustment = transactions[3]!;
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(adjustment),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        () =>
          HttpResponse.json({
            account,
            accountNature: "asset",
            derivedComparisonBalance: { amount: "25.00", currency: "USD" },
            transactionDate: adjustment.transactionDate,
          }),
      ),
      http.put(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
        () => HttpResponse.json({ outcome: "removed", transaction: null }),
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Edit Balance Adjustment" },
        { timeout: 5_000 },
      ),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Balance Adjustment",
    });
    const target = within(dialog).getByRole("textbox", {
      name: "Target balance",
    });
    await waitFor(() => expect(target).toBeEnabled());
    await user.type(target, "25.00");
    await user.click(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Transaction unavailable" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Balance Adjustment removed.",
    );
    expect(screen.queryByText("Exact note")).not.toBeInTheDocument();
  });

  it("keeps a pending zero-delta replacement authoritative after a concurrent detail 404", async () => {
    const user = userEvent.setup();
    const adjustment = transactions[3]!;
    let detailMissing = false;
    let detail404s = 0;
    let puts = 0;
    let releasePut!: () => void;
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    mockLedger();
    mockEditReferences();
    server.use(
      http.get(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => {
          if (!detailMissing) return HttpResponse.json(adjustment);
          detail404s++;
          return HttpResponse.json(
            {
              code: "finance_transaction_not_found",
              detail: "Missing",
              status: 404,
              title: "Not found",
              type: "about:blank",
            },
            { status: 404 },
          );
        },
      ),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        () =>
          HttpResponse.json({
            account,
            accountNature: "asset",
            derivedComparisonBalance: { amount: "25.00", currency: "USD" },
            transactionDate: adjustment.transactionDate,
          }),
      ),
      http.put(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
        async () => {
          puts++;
          await putGate;
          return HttpResponse.json({ outcome: "removed", transaction: null });
        },
      ),
    );
    const { queryClient } = renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
    );
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Edit Balance Adjustment" },
        { timeout: 5_000 },
      ),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Balance Adjustment",
    });
    const target = within(dialog).getByRole("textbox", {
      name: "Target balance",
    });
    await waitFor(() => expect(target).toBeEnabled());
    await user.type(target, "25.00");
    await user.click(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    );
    await waitFor(() => expect(puts).toBe(1));

    detailMissing = true;
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: getGetFinanceTransactionQueryKey(ledgerId, transactionId),
        exact: true,
      });
    });
    expect(detail404s).toBe(1);
    expect(
      queryClient.getQueryState(
        getGetFinanceTransactionQueryKey(ledgerId, transactionId),
      )?.error,
    ).toMatchObject({ status: 404 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole("dialog", { name: "Edit Balance Adjustment" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("textbox", { name: "Target balance" }),
    ).toHaveValue("25.00");
    expect(
      screen.queryByText("Transaction unavailable. It was already removed."),
    ).not.toBeInTheDocument();
    expect(puts).toBe(1);

    releasePut();
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Edit Balance Adjustment" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Transaction unavailable" }),
      ).toBeVisible();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Balance Adjustment removed.",
      );
    });
    expect(screen.getAllByText("Balance Adjustment removed.")).toHaveLength(1);
    expect(
      screen.queryByText("Transaction unavailable. It was already removed."),
    ).not.toBeInTheDocument();
    expect(puts).toBe(1);
  });

  it.each(["removed", "failed"] as const)(
    "keeps a pending replacement authoritative after a concurrent context 404: %s",
    async (outcome) => {
      const user = userEvent.setup();
      const adjustment = transactions[3]!;
      let contextMissing = false;
      let context404s = 0;
      let puts = 0;
      let releasePut!: () => void;
      const putGate = new Promise<void>((resolve) => {
        releasePut = resolve;
      });
      mockLedger();
      mockEditReferences();
      server.use(
        getGetFinanceTransactionMockHandler(adjustment),
        http.get(
          "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
          () => {
            if (!contextMissing)
              return HttpResponse.json({
                account,
                accountNature: "asset",
                derivedComparisonBalance: { amount: "25.00", currency: "USD" },
                transactionDate: adjustment.transactionDate,
              });
            context404s++;
            return HttpResponse.json(
              {
                code: "finance_transaction_not_found",
                detail: "Missing",
                status: 404,
                title: "Not found",
                type: "about:blank",
              },
              { status: 404 },
            );
          },
        ),
        http.put(
          "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
          async () => {
            puts++;
            await putGate;
            return outcome === "removed"
              ? HttpResponse.json({ outcome: "removed", transaction: null })
              : HttpResponse.json(
                  {
                    code: "database_unavailable",
                    detail: "Unavailable",
                    status: 503,
                    title: "Unavailable",
                    type: "about:blank",
                  },
                  { status: 503 },
                );
          },
        ),
      );
      const { queryClient } = renderRoute(
        `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
      );
      await user.click(
        await screen.findByRole(
          "button",
          { name: "Edit Balance Adjustment" },
          { timeout: 5_000 },
        ),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Edit Balance Adjustment",
      });
      const target = within(dialog).getByRole("textbox", {
        name: "Target balance",
      });
      await waitFor(() => expect(target).toBeEnabled());
      await user.type(target, "25.00");
      await user.click(
        within(dialog).getByRole("button", { name: "Save adjustment" }),
      );
      await waitFor(() => expect(puts).toBe(1));

      const contextKey = getGetBalanceAdjustmentContextQueryKey(
        ledgerId,
        account.id,
        {
          transactionDate: adjustment.transactionDate,
          replacingTransactionId: transactionId,
        },
      );
      contextMissing = true;
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: contextKey, exact: true });
      });
      expect(context404s).toBe(1);
      expect(queryClient.getQueryState(contextKey)?.error).toMatchObject({
        status: 404,
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        screen.getByRole("dialog", { name: "Edit Balance Adjustment" }),
      ).toBeVisible();
      expect(
        within(dialog).getByRole("textbox", { name: "Target balance" }),
      ).toHaveValue("25.00");
      expect(
        screen.queryByText("Transaction unavailable. It was already removed."),
      ).not.toBeInTheDocument();
      expect(puts).toBe(1);

      releasePut();
      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: "Edit Balance Adjustment" }),
        ).not.toBeInTheDocument();
        expect(
          screen.getByRole("heading", { name: "Transaction unavailable" }),
        ).toBeVisible();
        expect(screen.getByRole("status")).toHaveTextContent(
          outcome === "removed"
            ? "Balance Adjustment removed."
            : "Transaction unavailable. It was already removed.",
        );
      });
      if (outcome === "removed") {
        expect(screen.getAllByText("Balance Adjustment removed.")).toHaveLength(
          1,
        );
        expect(
          screen.queryByText(
            "Transaction unavailable. It was already removed.",
          ),
        ).not.toBeInTheDocument();
      } else {
        expect(
          screen.queryByText("Balance Adjustment removed."),
        ).not.toBeInTheDocument();
      }
      expect(puts).toBe(1);
    },
  );

  it.each([
    { source: "detail", history: "held", order: "before" },
    { source: "context", history: "failed", order: "before" },
    { source: "detail", history: "failed", order: "after" },
    { source: "context", history: "held", order: "after" },
  ] as const)(
    "cleans stale history when $source 404 arrives $order a failed PUT with $history history refresh",
    async ({ source, history, order }) => {
      const user = userEvent.setup();
      const adjustment = transactions[3]!;
      let detailMissing = false;
      let contextMissing = false;
      let historyReads = 0;
      let puts = 0;
      let releasePut!: () => void;
      let releaseHistory!: () => void;
      const putGate = new Promise<void>((resolve) => {
        releasePut = resolve;
      });
      const historyGate = new Promise<void>((resolve) => {
        releaseHistory = resolve;
      });
      const missing = {
        code: "finance_transaction_not_found",
        detail: "Missing",
        status: 404,
        title: "Not found",
        type: "about:blank",
      };
      mockLedger();
      mockEditReferences();
      server.use(
        getListFinanceTransactionsMockHandler({
          items: [adjustment],
          nextCursor: null,
        }),
        http.get(
          "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
          () =>
            detailMissing
              ? HttpResponse.json(missing, { status: 404 })
              : HttpResponse.json(adjustment),
        ),
        http.get(
          "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
          () =>
            contextMissing
              ? HttpResponse.json(missing, { status: 404 })
              : HttpResponse.json({
                  account,
                  accountNature: "asset",
                  derivedComparisonBalance: {
                    amount: "25.00",
                    currency: "USD",
                  },
                  transactionDate: adjustment.transactionDate,
                }),
        ),
        http.put(
          "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
          async () => {
            puts++;
            await putGate;
            return HttpResponse.json(
              {
                code: "database_unavailable",
                detail: "Unavailable",
                status: 503,
                title: "Unavailable",
                type: "about:blank",
              },
              { status: 503 },
            );
          },
        ),
      );
      const { queryClient } = renderRoute(
        `/finance/transactions?ledger=${ledgerId}`,
      );
      await screen.findByRole(
        "button",
        { name: new RegExp(`Edit Balance Adjustment.*${transactionId}`) },
        { timeout: 5_000 },
      );
      server.use(
        http.get("*/api/finance/ledgers/:ledgerId/transactions", async () => {
          historyReads++;
          if (history === "held") await historyGate;
          return history === "held"
            ? HttpResponse.json({ items: [], nextCursor: null })
            : HttpResponse.json(
                {
                  code: "database_unavailable",
                  detail: "Unavailable",
                  status: 503,
                  title: "Unavailable",
                  type: "about:blank",
                },
                { status: 503 },
              );
        }),
      );
      await user.click(
        screen.getByRole("link", {
          name: new RegExp(
            `View details for Balance Adjustment.*${transactionId}`,
          ),
        }),
      );
      await user.click(
        await screen.findByRole("button", { name: "Edit Balance Adjustment" }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Edit Balance Adjustment",
      });
      const target = within(dialog).getByRole("textbox", {
        name: "Target balance",
      });
      await waitFor(() => expect(target).toBeEnabled());
      await user.type(target, "25.00");
      await user.click(
        within(dialog).getByRole("button", { name: "Save adjustment" }),
      );
      await waitFor(() => expect(puts).toBe(1));
      if (order === "after") {
        releasePut();
        expect(
          await within(dialog).findByText(
            "Adjustment could not be replaced. Try again.",
          ),
        ).toBeVisible();
      }
      if (source === "detail") detailMissing = true;
      else contextMissing = true;
      await act(async () => {
        await queryClient.refetchQueries({
          queryKey:
            source === "detail"
              ? getGetFinanceTransactionQueryKey(ledgerId, transactionId)
              : getGetBalanceAdjustmentContextQueryKey(ledgerId, account.id, {
                  transactionDate: adjustment.transactionDate,
                  replacingTransactionId: transactionId,
                }),
          exact: true,
        });
        await Promise.resolve();
      });
      if (order === "before") {
        expect(
          screen.getByRole("dialog", { name: "Edit Balance Adjustment" }),
        ).toBeVisible();
        releasePut();
      }
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "Transaction unavailable. It was already removed.",
        ),
      );
      const cachedHistory = queryClient.getQueriesData<{
        pages: { items: { id: string }[] }[];
      }>({
        queryKey: getListFinanceTransactionsQueryKey(ledgerId),
      });
      expect(cachedHistory.length).toBeGreaterThan(0);
      expect(
        cachedHistory.flatMap(
          ([, data]) => data?.pages.flatMap((page) => page.items) ?? [],
        ),
      ).not.toContainEqual(expect.objectContaining({ id: transactionId }));
      const unavailable = screen.getByRole("heading", {
        name: "Transaction unavailable",
      }).parentElement;
      await user.click(
        within(unavailable!).getByRole("link", { name: "Transactions" }),
      );
      await waitFor(() => expect(historyReads).toBeGreaterThan(0));
      expect(
        screen.queryByRole("article", { name: /Balance Adjustment on/ }),
      ).not.toBeInTheDocument();
      releaseHistory();
      expect(puts).toBe(1);
    },
  );

  it.each([
    { source: "detail", outcome: "updated" },
    { source: "context", outcome: "removed" },
  ] as const)(
    "lets a confirmed $outcome supersede a $source 404 after the PUT response",
    async ({ source, outcome }) => {
      const user = userEvent.setup();
      const adjustment = transactions[3]!;
      const updated = {
        ...adjustment,
        correctionDelta: { amount: "5.00", currency: "USD" },
      };
      let holdAccounts = false;
      let heldAccountReads = 0;
      let releaseAccounts!: () => void;
      const accountGate = new Promise<void>((resolve) => {
        releaseAccounts = resolve;
      });
      let detailMissing = false;
      let contextMissing = false;
      let missingReads = 0;
      let puts = 0;
      mockLedger();
      server.use(
        http.get("*/api/finance/ledgers/:ledgerId/accounts", async () => {
          if (holdAccounts) {
            heldAccountReads++;
            await accountGate;
          }
          return HttpResponse.json([
            fullAccount(account),
            fullAccount(otherAccount),
          ]);
        }),
        getListFinanceCurrenciesMockHandler([{ code: "USD", minorUnit: 2 }]),
        http.get(
          "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
          () => {
            if (detailMissing) {
              missingReads++;
              return HttpResponse.json(
                {
                  code: "finance_transaction_not_found",
                  detail: "Missing",
                  status: 404,
                  title: "Not found",
                  type: "about:blank",
                },
                { status: 404 },
              );
            }
            return HttpResponse.json(adjustment);
          },
        ),
        http.get(
          "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
          () => {
            if (contextMissing) {
              missingReads++;
              return HttpResponse.json(
                {
                  code: "finance_transaction_not_found",
                  detail: "Missing",
                  status: 404,
                  title: "Not found",
                  type: "about:blank",
                },
                { status: 404 },
              );
            }
            return HttpResponse.json({
              account,
              accountNature: "asset",
              derivedComparisonBalance: { amount: "25.00", currency: "USD" },
              transactionDate: adjustment.transactionDate,
            });
          },
        ),
        http.put(
          "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
          () => {
            puts++;
            return HttpResponse.json(
              outcome === "updated"
                ? { outcome, transaction: updated }
                : { outcome, transaction: null },
            );
          },
        ),
      );
      const { queryClient } = renderRoute(
        `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
      );
      await user.click(
        await screen.findByRole(
          "button",
          { name: "Edit Balance Adjustment" },
          { timeout: 5_000 },
        ),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Edit Balance Adjustment",
      });
      const target = within(dialog).getByRole("textbox", {
        name: "Target balance",
      });
      await waitFor(() => expect(target).toBeEnabled());
      await user.type(target, outcome === "updated" ? "30.00" : "25.00");
      holdAccounts = true;
      await user.click(
        within(dialog).getByRole("button", { name: "Save adjustment" }),
      );
      await waitFor(() => expect(heldAccountReads).toBeGreaterThan(0));
      expect(puts).toBe(1);

      if (source === "detail") detailMissing = true;
      else contextMissing = true;
      const queryKey =
        source === "detail"
          ? getGetFinanceTransactionQueryKey(ledgerId, transactionId)
          : getGetBalanceAdjustmentContextQueryKey(ledgerId, account.id, {
              transactionDate: adjustment.transactionDate,
              replacingTransactionId: transactionId,
            });
      await act(async () => {
        await queryClient.refetchQueries({ queryKey, exact: true });
        await Promise.resolve();
      });
      expect(missingReads).toBeGreaterThan(0);
      expect(
        screen.getByRole("dialog", { name: "Edit Balance Adjustment" }),
      ).toBeVisible();
      releaseAccounts();
      if (outcome === "updated") {
        await waitFor(() => {
          expect(screen.getByRole("status")).toHaveTextContent(
            "Balance Adjustment updated.",
          );
          expect(
            screen.queryByRole("dialog", { name: "Edit Balance Adjustment" }),
          ).not.toBeInTheDocument();
        });
        expect(
          queryClient.getQueryState(
            getGetFinanceTransactionQueryKey(ledgerId, transactionId),
          )?.status,
        ).toBe("success");
        expect(
          queryClient.getQueryData<{
            data: { correctionDelta: { amount: string } };
          }>(getGetFinanceTransactionQueryKey(ledgerId, transactionId))?.data
            .correctionDelta.amount,
        ).toBe("5.00");
        expect(
          screen.queryByRole("heading", { name: "Transaction unavailable" }),
        ).not.toBeInTheDocument();
      } else {
        await waitFor(() => {
          expect(screen.getByRole("status")).toHaveTextContent(
            "Balance Adjustment removed.",
          );
          expect(
            screen.getByRole("heading", { name: "Transaction unavailable" }),
          ).toBeVisible();
        });
        expect(screen.getAllByText("Balance Adjustment removed.")).toHaveLength(
          1,
        );
      }
      expect(puts).toBe(1);
    },
  );

  it("keeps the replacement session mounted while detail reloads during a pending PUT", async () => {
    const user = userEvent.setup();
    const adjustment = transactions[3]!;
    let puts = 0;
    let releasePut!: () => void;
    let releaseRead!: () => void;
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(adjustment),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        () =>
          HttpResponse.json({
            account,
            accountNature: "asset",
            derivedComparisonBalance: { amount: "25.00", currency: "USD" },
            transactionDate: adjustment.transactionDate,
          }),
      ),
      http.put(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
        async () => {
          puts++;
          await putGate;
          return HttpResponse.json({ outcome: "removed", transaction: null });
        },
      ),
    );
    const { queryClient } = renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
    );
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Edit Balance Adjustment" },
        { timeout: 5_000 },
      ),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Balance Adjustment",
    });
    const target = within(dialog).getByRole("textbox", {
      name: "Target balance",
    });
    await waitFor(() => expect(target).toBeEnabled());
    await user.type(target, "25.00");
    await user.click(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    );
    await waitFor(() => expect(puts).toBe(1));

    let readStarted = false;
    server.use(
      http.get(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        async () => {
          readStarted = true;
          await readGate;
          return HttpResponse.json(
            {
              code: "finance_transaction_not_found",
              detail: "Missing",
              status: 404,
              title: "Not found",
              type: "about:blank",
            },
            { status: 404 },
          );
        },
      ),
    );
    act(() => {
      void queryClient.resetQueries({
        queryKey: getGetFinanceTransactionQueryKey(ledgerId, transactionId),
        exact: true,
      });
    });
    await waitFor(() => expect(readStarted).toBe(true));
    expect(
      screen.getByRole("status", { name: "Loading Transaction detail" }),
    ).toBeVisible();
    expect(
      screen.getByRole("dialog", { name: "Edit Balance Adjustment" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("textbox", { name: "Target balance" }),
    ).toHaveValue("25.00");
    releasePut();
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Edit Balance Adjustment" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Balance Adjustment removed.",
      );
    });
    releaseRead();
    expect(screen.getAllByText("Balance Adjustment removed.")).toHaveLength(1);
    expect(puts).toBe(1);
  });

  it("fails closed after a conflict refresh error despite cached context", async () => {
    const user = userEvent.setup();
    const adjustment = transactions[3]!;
    let contextReads = 0;
    let puts = 0;
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(adjustment),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        () => {
          contextReads++;
          if (contextReads === 2)
            return HttpResponse.json(
              {
                code: "database_unavailable",
                detail: "Unavailable",
                status: 503,
                title: "Unavailable",
                type: "about:blank",
              },
              { status: 503 },
            );
          return HttpResponse.json({
            account,
            accountNature: "asset",
            derivedComparisonBalance: {
              amount: contextReads === 1 ? "20.00" : "30.00",
              currency: "USD",
            },
            transactionDate: adjustment.transactionDate,
          });
        },
      ),
      http.put(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
        () => {
          puts++;
          return HttpResponse.json(
            {
              code: "account_balance_changed",
              detail: "Changed",
              status: 409,
              title: "Conflict",
              type: "about:blank",
            },
            { status: 409 },
          );
        },
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Edit Balance Adjustment" },
        { timeout: 5_000 },
      ),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Balance Adjustment",
    });
    const target = within(dialog).getByRole("textbox", {
      name: "Target balance",
    });
    await waitFor(() => expect(target).toBeEnabled());
    await user.type(target, "25.00");
    await user.click(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    );
    expect(
      await within(dialog).findByText("Authoritative context refresh failed"),
    ).toBeVisible();
    expect(target).toHaveValue("25.00");
    expect(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    ).toBeDisabled();
    expect(puts).toBe(1);
    await user.click(
      within(dialog).getByRole("button", { name: "Retry context refresh" }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Save adjustment" }),
      ).toBeEnabled(),
    );
    expect(puts).toBe(1);
  });

  it("opens replacement from history and refreshes context after Account and date changes", async () => {
    const user = userEvent.setup();
    const adjustment = transactions[3]!;
    const requests: unknown[] = [];
    const contexts: string[] = [];
    let updated = false;
    const replacement = {
      ...adjustment,
      account: otherAccount,
      transactionDate: "2026-08-17",
    };
    mockLedger();
    mockEditReferences();
    server.use(
      getListFinanceTransactionsMockHandler(() => ({
        items: [updated ? replacement : adjustment],
        nextCursor: null,
      })),
      getGetFinanceTransactionMockHandler(adjustment),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        ({ request, params }) => {
          const url = new URL(request.url);
          contexts.push(
            `${params.accountId}:${url.searchParams.get("transactionDate")}`,
          );
          return HttpResponse.json({
            account:
              params.accountId === otherAccount.id ? otherAccount : account,
            accountNature: "asset",
            derivedComparisonBalance: {
              amount: params.accountId === otherAccount.id ? "50.00" : "20.00",
              currency: "USD",
            },
            transactionDate: url.searchParams.get("transactionDate"),
          });
        },
      ),
      http.put(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
        async ({ request }) => {
          requests.push(await request.json());
          updated = true;
          return HttpResponse.json({
            outcome: "updated",
            transaction: replacement,
          });
        },
      ),
    );
    renderRoute(`/finance/transactions?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: new RegExp(`Edit Balance Adjustment.*${transactionId}`) },
        { timeout: 5_000 },
      ),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Balance Adjustment",
    });
    const target = within(dialog).getByRole("textbox", {
      name: "Target balance",
    });
    await waitFor(() => expect(target).toBeEnabled());
    await user.type(target, "60.00");
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Account" }),
      otherAccount.id,
    );
    await user.clear(within(dialog).getByLabelText("Transaction date"));
    await user.type(
      within(dialog).getByLabelText("Transaction date"),
      "2026-08-17",
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Save adjustment" }),
      ).toBeEnabled(),
    );
    expect(target).toHaveValue("60.00");
    await user.click(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(contexts).toContain(`${otherAccount.id}:2026-08-17`);
    expect(requests[0]).toMatchObject({
      accountId: otherAccount.id,
      expectedDerivedBalance: { amount: "50.00", currency: "USD" },
      transactionDate: "2026-08-17",
      targetBalance: { amount: "60.00", currency: "USD" },
    });
    expect(
      await screen.findByText("Balance Adjustment updated."),
    ).toBeVisible();
  });

  it("keeps a pending replacement locked across navigation and remount", async () => {
    const user = userEvent.setup();
    const adjustment = transactions[3]!;
    let releasePut!: () => void;
    const gate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    let puts = 0;
    let updated = false;
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(() =>
        updated
          ? {
              ...adjustment,
              correctionDelta: { amount: "5.00", currency: "USD" },
            }
          : adjustment,
      ),
      getListFinanceTransactionsMockHandler(() => ({
        items: [adjustment],
        nextCursor: null,
      })),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        () =>
          HttpResponse.json({
            account,
            accountNature: "asset",
            derivedComparisonBalance: { amount: "20.00", currency: "USD" },
            transactionDate: adjustment.transactionDate,
          }),
      ),
      http.put(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
        async () => {
          puts++;
          await gate;
          updated = true;
          return HttpResponse.json({
            outcome: "updated",
            transaction: {
              ...adjustment,
              correctionDelta: { amount: "5.00", currency: "USD" },
            },
          });
        },
      ),
    );
    const { router } = renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
    );
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Edit Balance Adjustment" },
        { timeout: 5_000 },
      ),
    );
    let dialog = await screen.findByRole("dialog", {
      name: "Edit Balance Adjustment",
    });
    const target = within(dialog).getByRole("textbox", {
      name: "Target balance",
    });
    await waitFor(() => expect(target).toBeEnabled());
    await user.type(target, "25.00");
    await user.click(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    );
    await waitFor(() => expect(puts).toBe(1));
    await act(async () => {
      await router.navigate(`/finance/transactions?ledger=${ledgerId}`);
    });
    await act(async () => {
      await router.navigate(
        `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
      );
    });
    await user.click(
      await screen.findByRole("button", { name: "Edit Balance Adjustment" }),
    );
    dialog = await screen.findByRole("dialog", {
      name: "Edit Balance Adjustment",
    });
    expect(within(dialog).getByText(/Replacement in progress/)).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "Save adjustment" }),
    ).not.toBeInTheDocument();
    expect(puts).toBe(1);
    releasePut();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("textbox", { name: "Target balance" }),
      ).toBeEnabled(),
    );
    expect(puts).toBe(1);
  });

  it("exits an obsolete edit when the context reports a missing Transaction", async () => {
    const user = userEvent.setup();
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(transactions[3]!),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        () =>
          HttpResponse.json(
            {
              code: "finance_transaction_not_found",
              detail: "Missing",
              status: 404,
              title: "Not found",
              type: "about:blank",
            },
            { status: 404 },
          ),
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Edit Balance Adjustment" },
        { timeout: 5_000 },
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Transaction unavailable" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Edit Balance Adjustment" }),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link", { name: "Transactions" })
        .some(
          (link) =>
            link.getAttribute("href") ===
            `/finance/transactions?ledger=${ledgerId}`,
        ),
    ).toBe(true);
  });

  it("keeps the selected Account identity when its context is not found", async () => {
    const user = userEvent.setup();
    let puts = 0;
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(transactions[3]!),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        ({ params }) =>
          params.accountId === account.id
            ? HttpResponse.json(
                {
                  code: "finance_account_not_found",
                  detail: "Missing",
                  status: 404,
                  title: "Not found",
                  type: "about:blank",
                },
                { status: 404 },
              )
            : HttpResponse.json({
                account: otherAccount,
                accountNature: "asset",
                derivedComparisonBalance: { amount: "15.00", currency: "USD" },
                transactionDate: "2026-08-16",
              }),
      ),
      http.put(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
        () => {
          puts++;
          return HttpResponse.json({
            outcome: "updated",
            transaction: transactions[3]!,
          });
        },
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Edit Balance Adjustment" },
        { timeout: 5_000 },
      ),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Balance Adjustment",
    });
    expect(
      await within(dialog).findByText(
        "The selected Account is unavailable. Choose an active Account.",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("combobox", { name: "Account" }),
    ).toHaveValue(account.id);
    expect(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    ).toBeDisabled();
    expect(puts).toBe(0);
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Account" }),
      otherAccount.id,
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("textbox", { name: "Target balance" }),
      ).toBeEnabled(),
    );
    expect(
      within(dialog).getByRole("combobox", { name: "Account" }),
    ).toHaveValue(otherAccount.id);
    expect(puts).toBe(0);
  });

  it("keeps a missing original Account blocked after Accounts refresh returns stale identity", async () => {
    const user = userEvent.setup();
    const adjustment = transactions[3]!;
    let accountReads = 0;
    let puts = 0;
    mockLedger();
    server.use(
      getGetFinanceTransactionMockHandler(adjustment),
      getListFinanceAccountsMockHandler(() => {
        accountReads++;
        return [fullAccount(account), fullAccount(otherAccount)];
      }),
      getListFinanceCurrenciesMockHandler([{ code: "USD", minorUnit: 2 }]),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        ({ params }) =>
          HttpResponse.json({
            account:
              params.accountId === otherAccount.id ? otherAccount : account,
            accountNature: "asset",
            derivedComparisonBalance: { amount: "20.00", currency: "USD" },
            transactionDate: adjustment.transactionDate,
          }),
      ),
      http.put(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
        () => {
          puts++;
          return HttpResponse.json(
            {
              code: "finance_account_not_found",
              detail: "Missing",
              status: 404,
              title: "Not found",
              type: "about:blank",
            },
            { status: 404 },
          );
        },
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Edit Balance Adjustment" },
        { timeout: 5_000 },
      ),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Balance Adjustment",
    });
    const target = within(dialog).getByRole("textbox", {
      name: "Target balance",
    });
    await waitFor(() => expect(target).toBeEnabled());
    await user.type(target, "25.00");
    await user.clear(within(dialog).getByRole("textbox", { name: "Note" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "Note" }),
      "Keep this draft",
    );
    expect(within(dialog).getByText("+5.00 USD")).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    );
    await waitFor(() => expect(accountReads).toBeGreaterThan(1));
    expect(puts).toBe(1);
    expect(
      within(dialog).getByRole("combobox", { name: "Account" }),
    ).toHaveValue(account.id);
    expect(target).toHaveValue("25.00");
    expect(within(dialog).getByRole("textbox", { name: "Note" })).toHaveValue(
      "Keep this draft",
    );
    expect(within(dialog).queryByText("+5.00 USD")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("option", { name: /unavailable/ }),
    ).toBeDisabled();
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Account" }),
      otherAccount.id,
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Save adjustment" }),
      ).toBeEnabled(),
    );
    expect(puts).toBe(1);
  });

  it("removes a stale history Adjustment when initial edit detail is not found", async () => {
    const user = userEvent.setup();
    const adjustment = transactions[3]!;
    let missing = false;
    mockLedger();
    mockEditReferences();
    server.use(
      getListFinanceTransactionsMockHandler(() => ({
        items: missing ? [] : [adjustment],
        nextCursor: null,
      })),
      http.get(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => {
          missing = true;
          return HttpResponse.json(
            {
              code: "finance_transaction_not_found",
              detail: "Missing",
              status: 404,
              title: "Not found",
              type: "about:blank",
            },
            { status: 404 },
          );
        },
      ),
    );
    renderRoute(`/finance/transactions?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: new RegExp(`Edit Balance Adjustment.*${transactionId}`) },
        { timeout: 5_000 },
      ),
    );
    expect(
      await screen.findByText(
        "Transaction unavailable. It was already removed.",
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole("article", { name: /Balance Adjustment on/ }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", {
        name: new RegExp(`Edit Balance Adjustment.*${transactionId}`),
      }),
    ).not.toBeInTheDocument();
  });

  it.each(["success", "error"] as const)(
    "preserves an initialized Adjustment draft through a background detail refetch: %s",
    async (outcome) => {
      const user = userEvent.setup();
      const adjustment = transactions[3]!;
      mockLedger();
      mockEditReferences();
      server.use(
        getGetFinanceTransactionMockHandler(adjustment),
        http.get(
          "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
          () =>
            HttpResponse.json({
              account,
              accountNature: "asset",
              derivedComparisonBalance: { amount: "20.00", currency: "USD" },
              transactionDate: adjustment.transactionDate,
            }),
        ),
      );
      const { queryClient } = renderRoute(
        `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
      );
      await user.click(
        await screen.findByRole(
          "button",
          { name: "Edit Balance Adjustment" },
          { timeout: 5_000 },
        ),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Edit Balance Adjustment",
      });
      const target = within(dialog).getByRole("textbox", {
        name: "Target balance",
      });
      await waitFor(() => expect(target).toBeEnabled());
      await user.type(target, "25.00");
      const note = within(dialog).getByRole("textbox", { name: "Note" });
      await user.clear(note);
      await user.type(note, "Keep this draft");

      let releaseFetch!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseFetch = resolve;
      });
      let started = false;
      server.use(
        http.get(
          "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
          async () => {
            started = true;
            await gate;
            return outcome === "success"
              ? HttpResponse.json(adjustment)
              : HttpResponse.json(
                  {
                    type: "about:blank",
                    title: "Unavailable",
                    status: 503,
                    detail: "Try again",
                  },
                  { status: 503 },
                );
          },
        ),
      );
      act(() => {
        void queryClient.refetchQueries({
          queryKey: getGetFinanceTransactionQueryKey(ledgerId, transactionId),
          exact: true,
        });
      });
      await waitFor(() => expect(started).toBe(true));
      expect(
        within(dialog).getByRole("textbox", { name: "Target balance" }),
      ).toHaveValue("25.00");
      expect(within(dialog).getByRole("textbox", { name: "Note" })).toHaveValue(
        "Keep this draft",
      );
      releaseFetch();
      await waitFor(
        () =>
          expect(
            queryClient.isFetching({
              queryKey: getGetFinanceTransactionQueryKey(
                ledgerId,
                transactionId,
              ),
            }),
          ).toBe(0),
        { timeout: 10_000 },
      );
      expect(
        within(dialog).getByRole("textbox", { name: "Target balance" }),
      ).toHaveValue("25.00");
      expect(within(dialog).getByRole("textbox", { name: "Note" })).toHaveValue(
        "Keep this draft",
      );
    },
    15_000,
  );

  it("completes a pending Adjustment replacement during background detail refetch", async () => {
    const user = userEvent.setup();
    const adjustment = transactions[3]!;
    let updated = false;
    let puts = 0;
    let releasePut!: () => void;
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(() =>
        updated
          ? {
              ...adjustment,
              correctionDelta: { amount: "5.00", currency: "USD" },
            }
          : adjustment,
      ),
      http.get(
        "*/api/finance/ledgers/:ledgerId/accounts/:accountId/balance-adjustment-context",
        () =>
          HttpResponse.json({
            account,
            accountNature: "asset",
            derivedComparisonBalance: { amount: "20.00", currency: "USD" },
            transactionDate: adjustment.transactionDate,
          }),
      ),
      http.put(
        "*/api/finance/ledgers/:ledgerId/balance-adjustments/:transactionId",
        async () => {
          puts++;
          await putGate;
          updated = true;
          return HttpResponse.json({
            outcome: "updated",
            transaction: {
              ...adjustment,
              correctionDelta: { amount: "5.00", currency: "USD" },
            },
          });
        },
      ),
    );
    const { queryClient } = renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
    );
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Edit Balance Adjustment" },
        { timeout: 5_000 },
      ),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Balance Adjustment",
    });
    const target = within(dialog).getByRole("textbox", {
      name: "Target balance",
    });
    await waitFor(() => expect(target).toBeEnabled());
    await user.type(target, "25.00");
    await user.click(
      within(dialog).getByRole("button", { name: "Save adjustment" }),
    );
    await waitFor(() => expect(puts).toBe(1));

    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let started = false;
    server.use(
      http.get(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        async () => {
          started = true;
          await fetchGate;
          return HttpResponse.json(adjustment);
        },
      ),
    );
    act(() => {
      void queryClient.refetchQueries({
        queryKey: getGetFinanceTransactionQueryKey(ledgerId, transactionId),
        exact: true,
      });
    });
    await waitFor(() => expect(started).toBe(true));
    expect(
      within(dialog).getByRole("textbox", { name: "Target balance" }),
    ).toHaveValue("25.00");
    releaseFetch();
    await waitFor(() =>
      expect(
        queryClient.isFetching({
          queryKey: getGetFinanceTransactionQueryKey(ledgerId, transactionId),
        }),
      ).toBe(0),
    );
    releasePut();
    await waitFor(
      () => {
        expect(
          screen.queryByRole("dialog", { name: "Edit Balance Adjustment" }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(
          "Balance Adjustment updated.",
        );
      },
      { timeout: 10_000 },
    );
    expect(puts).toBe(1);
  }, 15_000);
  it("opens a fixed-kind edit dialog from an ordinary detail", async () => {
    const user = userEvent.setup();
    mockLedger();
    mockEditReferences();
    server.use(getGetFinanceTransactionMockHandler(transactions[1]!));
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);

    await user.click(
      await screen.findByRole("button", { name: "Edit Expense" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Edit Expense" }),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue(
      money.amount,
    );
    expect(
      screen.getByText(/Expense is fixed for this Transaction/),
    ).toBeVisible();
  });

  it("replaces an Expense exactly while retaining its archived Account and choosing Uncategorized", async () => {
    const user = userEvent.setup();
    const original = transactions[1]!;
    if (original.kind !== "expense")
      throw new Error("Expected Expense fixture");
    let submitted: unknown;
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(original),
      http.put(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        async ({ request }) => {
          submitted = await request.json();
          return HttpResponse.json({
            ...original,
            categoryAllocations: [{ amount: money, category: null }],
            note: "changed",
          });
        },
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole("button", { name: "Edit Expense" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Expense" });
    expect(
      within(dialog).getByRole("combobox", { name: "Account" }),
    ).toHaveValue(account.id);
    expect(
      within(dialog).getByRole("option", { name: /Cash.*archived/ }),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("combobox", { name: "Category" }),
      ).toBeEnabled(),
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Category" }),
      "",
    );
    expect(
      within(dialog).getByRole("combobox", { name: "Category" }),
    ).toHaveValue("");
    await user.clear(within(dialog).getByRole("textbox", { name: "Note" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "Note" }),
      "changed",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    await waitFor(() =>
      expect(submitted).toEqual({
        accountId: account.id,
        categoryAllocations: [{ amount: money, categoryId: null }],
        economicAmount: money,
        kind: "expense",
        note: "changed",
        transactionDate: "2026-08-16",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Expense updated.",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit Expense" }),
      ).toHaveFocus(),
    );
    expect(screen.getByText("changed")).toBeVisible();
  });

  it.each(["income", "internalTransfer"] as const)(
    "keeps the $kind archived reference in its original role",
    async (kind) => {
      const user = userEvent.setup();
      const original =
        kind === "income"
          ? {
              ...transactions[0]!,
              categoryAllocations:
                transactions[1]!.kind === "expense"
                  ? transactions[1]!.categoryAllocations
                  : [],
            }
          : transactions[2]!;
      let submitted: unknown;
      mockLedger();
      mockEditReferences();
      server.use(
        getGetFinanceTransactionMockHandler(original),
        http.put(
          "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
          async ({ request }) => {
            submitted = await request.json();
            return HttpResponse.json(original);
          },
        ),
      );
      renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
      await user.click(
        await screen.findByRole("button", {
          name: kind === "income" ? "Edit Income" : "Edit Internal Transfer",
        }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: kind === "income" ? "Edit Income" : "Edit Internal Transfer",
      });
      await waitFor(() =>
        expect(
          within(dialog).getByRole("button", { name: "Save changes" }),
        ).toBeEnabled(),
      );
      if (kind === "income") {
        expect(
          within(dialog).getByRole("combobox", { name: "Category" }),
        ).toHaveValue("44444444-4444-4444-8444-444444444444");
      } else {
        expect(
          within(dialog).getByRole("combobox", { name: "Source Account" }),
        ).toHaveValue(account.id);
        expect(
          within(dialog).getByRole("combobox", { name: "Destination Account" }),
        ).toHaveValue(otherAccount.id);
      }
      await user.click(
        within(dialog).getByRole("button", { name: "Save changes" }),
      );
      await waitFor(() =>
        expect(submitted).toEqual(
          kind === "income"
            ? {
                accountId: account.id,
                categoryAllocations: [
                  {
                    amount: money,
                    categoryId: "44444444-4444-4444-8444-444444444444",
                  },
                ],
                economicAmount: money,
                kind: "income",
                note: "Exact note",
                transactionDate: "2026-08-16",
              }
            : {
                amount: money,
                destinationAccountId: otherAccount.id,
                kind: "internalTransfer",
                note: "Exact note",
                sourceAccountId: account.id,
                transactionDate: "2026-08-16",
              },
        ),
      );
    },
  );

  it("keeps the edit draft for a missing Account response and blocks a duplicate pending replacement", async () => {
    const user = userEvent.setup();
    const original = transactions[1]!;
    let requests = 0;
    let finish: (() => void) | undefined;
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(original),
      http.put(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        async () => {
          requests++;
          if (requests === 1)
            return HttpResponse.json(
              {
                type: "about:blank",
                title: "Not Found",
                status: 404,
                code: "finance_account_not_found",
                detail: "Account not found.",
              },
              { status: 404 },
            );
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return HttpResponse.json(original);
        },
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole("button", { name: "Edit Expense" }),
    );
    let dialog = await screen.findByRole("dialog", { name: "Edit Expense" });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Save changes" }),
      ).toBeEnabled(),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(
      await within(dialog).findByText(/selected Account.*no longer available/i),
    ).toBeVisible();
    expect(within(dialog).getByRole("textbox", { name: "Amount" })).toHaveValue(
      money.amount,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    dialog = screen.getByRole("dialog", { name: "Edit Expense" });
    await waitFor(() => expect(requests).toBe(2));
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Edit Expense" })).toBeVisible();
    finish?.();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit Expense" }),
      ).not.toBeInTheDocument(),
    );
    expect(requests).toBe(2);
  });

  it("keeps a pending PUT locked after route Back/Forward and permits another Transaction", async () => {
    const user = userEvent.setup();
    const original = transactions[0]!;
    const requests: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(({ params }) => ({
        ...original,
        id: String(params.transactionId),
      })),
      http.put(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        async ({ params }) => {
          const id = String(params.transactionId);
          requests.push(id);
          if (id === transactionId) await held;
          return HttpResponse.json({ ...original, id });
        },
      ),
    );
    const { router } = renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
    );
    try {
      await user.click(
        await screen.findByRole("button", { name: "Edit Income" }),
      );
      let dialog = await screen.findByRole("dialog", { name: "Edit Income" });
      await waitFor(() =>
        expect(
          within(dialog).getByRole("button", { name: "Save changes" }),
        ).toBeEnabled(),
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Save changes" }),
      );
      await waitFor(() => expect(requests).toEqual([transactionId]));

      await act(async () => {
        await router.navigate(
          `/finance/transactions/${duplicateTransactionId}?ledger=${ledgerId}`,
        );
      });
      await user.click(
        await screen.findByRole("button", { name: "Edit Income" }),
      );
      dialog = await screen.findByRole("dialog", { name: "Edit Income" });
      await waitFor(() =>
        expect(
          within(dialog).getByRole("button", { name: "Save changes" }),
        ).toBeEnabled(),
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Save changes" }),
      );
      await waitFor(() =>
        expect(requests).toEqual([transactionId, duplicateTransactionId]),
      );

      await act(async () => {
        await router.navigate(-1);
      });
      await user.click(
        await screen.findByRole("button", { name: "Edit Income" }),
      );
      dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(/replacement in progress/i);
      expect(
        within(dialog).queryByRole("button", { name: "Save changes" }),
      ).not.toBeInTheDocument();
      await act(async () => {
        await router.navigate(1);
      });
      await act(async () => {
        await router.navigate(-1);
      });
      await user.click(
        await screen.findByRole("button", { name: "Edit Income" }),
      );
      expect(await screen.findByRole("dialog")).toHaveTextContent(
        /replacement in progress/i,
      );
      expect(requests).toEqual([transactionId, duplicateTransactionId]);

      releaseFirst?.();
      await waitFor(() =>
        expect(
          within(screen.getByRole("dialog", { name: "Edit Income" })).getByRole(
            "button",
            { name: "Save changes" },
          ),
        ).toBeEnabled(),
      );
      expect(requests).toEqual([transactionId, duplicateTransactionId]);
    } finally {
      releaseFirst?.();
    }
  });

  it("scopes a pending replacement to its Ledger when Transaction IDs match", async () => {
    const user = userEvent.setup();
    const original = transactions[0]!;
    const requests: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    server.use(
      getListFinanceLedgersMockHandler([
        { id: ledgerId, name: "Personal" },
        { id: otherLedgerId, name: "Shared" },
      ]),
    );
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(({ params }) => ({
        ...original,
        ledgerId: String(params.ledgerId),
      })),
      http.put(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        async ({ params }) => {
          const id = String(params.ledgerId);
          requests.push(id);
          if (id === ledgerId) await held;
          return HttpResponse.json({ ...original, ledgerId: id });
        },
      ),
    );
    const { router } = renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
    );
    try {
      await user.click(
        await screen.findByRole("button", { name: "Edit Income" }),
      );
      let dialog = await screen.findByRole("dialog", { name: "Edit Income" });
      await waitFor(() =>
        expect(
          within(dialog).getByRole("button", { name: "Save changes" }),
        ).toBeEnabled(),
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Save changes" }),
      );
      await waitFor(() => expect(requests).toEqual([ledgerId]));

      await act(async () => {
        await router.navigate(
          `/finance/transactions/${transactionId}?ledger=${otherLedgerId}`,
        );
      });
      await user.click(
        await screen.findByRole("button", { name: "Edit Income" }),
      );
      dialog = await screen.findByRole("dialog", { name: "Edit Income" });
      await waitFor(() =>
        expect(
          within(dialog).getByRole("button", { name: "Save changes" }),
        ).toBeEnabled(),
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Save changes" }),
      );
      await waitFor(() => expect(requests).toEqual([ledgerId, otherLedgerId]));
    } finally {
      releaseFirst?.();
    }
  });

  it.each([
    ["finance_account_archived", 409, "Account"],
    ["finance_account_not_found", 404, "Account"],
    ["finance_category_archived", 409, "Category"],
    ["finance_category_not_found", 404, "Category"],
  ] as const)(
    "marks %s on the %s field and preserves the draft",
    async (code, responseStatus, fieldName) => {
      const user = userEvent.setup();
      mockLedger();
      mockEditReferences();
      server.use(
        getGetFinanceTransactionMockHandler(transactions[1]!),
        http.put(
          "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
          () =>
            HttpResponse.json(
              {
                type: "about:blank",
                title: responseStatus === 404 ? "Not Found" : "Conflict",
                status: responseStatus,
                code,
                detail: "Reference changed.",
              },
              { status: responseStatus },
            ),
        ),
      );
      renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
      await user.click(
        await screen.findByRole("button", { name: "Edit Expense" }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Edit Expense",
      });
      await waitFor(() =>
        expect(
          within(dialog).getByRole("button", { name: "Save changes" }),
        ).toBeEnabled(),
      );
      await user.clear(within(dialog).getByRole("textbox", { name: "Note" }));
      await user.type(
        within(dialog).getByRole("textbox", { name: "Note" }),
        "keep draft",
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Save changes" }),
      );
      const field = within(dialog).getByRole("combobox", { name: fieldName });
      await waitFor(() =>
        expect(field).toHaveAttribute("aria-invalid", "true"),
      );
      expect(field).toHaveAttribute(
        "aria-errormessage",
        fieldName === "Account"
          ? "edit-accountId-error"
          : "edit-category-error",
      );
      expect(field).toHaveFocus();
      expect(within(dialog).getByRole("textbox", { name: "Note" })).toHaveValue(
        "keep draft",
      );
      expect(
        screen.getByRole("dialog", { name: "Edit Expense" }),
      ).toBeVisible();
    },
  );

  it("keeps an ambiguous Internal Transfer Account conflict on the form", async () => {
    const user = userEvent.setup();
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(transactions[2]!),
      http.put(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () =>
          HttpResponse.json(
            {
              type: "about:blank",
              title: "Conflict",
              status: 409,
              code: "finance_account_archived",
              detail: "A selected Account is archived.",
            },
            { status: 409 },
          ),
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole("button", { name: "Edit Internal Transfer" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Internal Transfer",
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Save changes" }),
      ).toBeEnabled(),
    );
    await user.clear(within(dialog).getByRole("textbox", { name: "Note" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "Note" }),
      "keep transfer draft",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /selected Account changed/i,
    );
    expect(
      within(dialog).getByRole("combobox", { name: "Source Account" }),
    ).not.toHaveAttribute("aria-invalid", "true");
    expect(
      within(dialog).getByRole("combobox", { name: "Destination Account" }),
    ).not.toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByRole("textbox", { name: "Note" })).toHaveValue(
      "keep transfer draft",
    );
  });

  it("exits obsolete edit state on replacement 404 without recreating the Transaction", async () => {
    const user = userEvent.setup();
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(transactions[0]!),
      http.put(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () =>
          HttpResponse.json(
            {
              type: "about:blank",
              title: "Not Found",
              status: 404,
              code: "finance_transaction_not_found",
              detail: "Transaction not found.",
            },
            { status: 404 },
          ),
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole("button", { name: "Edit Income" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Income" });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Save changes" }),
      ).toBeEnabled(),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Transaction unavailable" }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Transactions" }).at(-1),
    ).toHaveAttribute("href", `/finance/transactions?ledger=${ledgerId}`);
  });

  it("preserves entered values after a kind-immutable conflict", async () => {
    const user = userEvent.setup();
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(transactions[0]!),
      http.put(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () =>
          HttpResponse.json(
            {
              type: "about:blank",
              title: "Conflict",
              status: 409,
              code: "finance_transaction_kind_immutable",
              detail: "Kind is immutable.",
            },
            { status: 409 },
          ),
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole("button", { name: "Edit Income" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Income" });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Save changes" }),
      ).toBeEnabled(),
    );
    await user.clear(within(dialog).getByRole("textbox", { name: "Note" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "Note" }),
      "keep this draft",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /kind changed/i,
    );
    expect(within(dialog).getByRole("textbox", { name: "Note" })).toHaveValue(
      "keep this draft",
    );
    expect(screen.getByRole("dialog", { name: "Edit Income" })).toBeVisible();
  });

  it("opens Edit directly from filtered history and removes an item that no longer matches", async () => {
    const user = userEvent.setup();
    const original = transactions[1]!;
    if (original.kind !== "expense")
      throw new Error("Expected Expense fixture");
    let replaced = false;
    mockLedger();
    mockEditReferences();
    server.use(
      getListFinanceTransactionsMockHandler(() => ({
        items: replaced ? [] : [original],
        nextCursor: null,
      })),
      getGetFinanceTransactionMockHandler(original),
      http.put(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => {
          replaced = true;
          return HttpResponse.json({
            ...original,
            categoryAllocations: [{ amount: money, category: null }],
          });
        },
      ),
    );
    renderRoute(
      `/finance/transactions?ledger=${ledgerId}&category_id=${original.categoryAllocations[0]!.category!.id}`,
    );
    await user.click(
      await screen.findByRole("button", {
        name: new RegExp(`Edit Expense.*${transactionId}`),
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Expense" });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("combobox", { name: "Category" }),
      ).toBeEnabled(),
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Category" }),
      "",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(
      await screen.findByRole("heading", { name: "No matching transactions" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("article", { name: /Expense on/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Expense updated.");
  });

  it("rejects an Account that archives during preflight without changing the draft or sending PUT", async () => {
    const user = userEvent.setup();
    let reads = 0;
    let puts = 0;
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(transactions[0]!),
      getListFinanceAccountsMockHandler(() => {
        reads++;
        return [
          fullAccount(account),
          {
            ...fullAccount(otherAccount),
            status: reads > 1 ? "archived" : "active",
          },
        ];
      }),
      http.put(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => {
          puts++;
          return HttpResponse.json(transactions[0]!);
        },
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole("button", { name: "Edit Income" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Income" });
    const accountChoice = within(dialog).getByRole("combobox", {
      name: "Account",
    });
    await waitFor(() => expect(accountChoice).toBeEnabled());
    await user.selectOptions(accountChoice, otherAccount.id);
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(
      await within(dialog).findByText(
        /Choose the existing Account or an active Account/,
      ),
    ).toBeVisible();
    expect(accountChoice).toHaveValue(otherAccount.id);
    expect(within(dialog).getByRole("textbox", { name: "Amount" })).toHaveValue(
      money.amount,
    );
    expect(puts).toBe(0);
  });

  it("blocks a corrected Account currency instead of retargeting exact Money", async () => {
    const user = userEvent.setup();
    let reads = 0;
    let puts = 0;
    mockLedger();
    mockEditReferences();
    server.use(
      getGetFinanceTransactionMockHandler(transactions[0]!),
      getListFinanceAccountsMockHandler(() => {
        reads++;
        return [
          fullAccount(account),
          reads > 1
            ? {
                ...fullAccount(otherAccount),
                currency: "CNY" as const,
                currentBalance: { amount: "0.00", currency: "CNY" as const },
                openingBalance: { amount: "0.00", currency: "CNY" as const },
              }
            : fullAccount(otherAccount),
        ];
      }),
      getListFinanceCurrenciesMockHandler([
        { code: "USD", minorUnit: 2 },
        { code: "CNY", minorUnit: 2 },
      ]),
      http.put(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => {
          puts++;
          return HttpResponse.json(transactions[0]!);
        },
      ),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);
    await user.click(
      await screen.findByRole("button", { name: "Edit Income" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Income" });
    const accountChoice = within(dialog).getByRole("combobox", {
      name: "Account",
    });
    await waitFor(() => expect(accountChoice).toBeEnabled());
    await user.selectOptions(accountChoice, otherAccount.id);
    expect(within(dialog).getByText("Amount currency: USD.")).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(
      await within(dialog).findByText(/Account currency changed/),
    ).toBeVisible();
    expect(accountChoice).toHaveValue(otherAccount.id);
    expect(within(dialog).getByRole("textbox", { name: "Amount" })).toHaveValue(
      money.amount,
    );
    expect(puts).toBe(0);
  });

  it.each(transactions)(
    "renders the complete $kind projection at a direct URL",
    async (transaction) => {
      mockLedger();
      server.use(getGetFinanceTransactionMockHandler(transaction));
      renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);

      expect(
        await screen.findByRole(
          "heading",
          { name: "Transaction detail" },
          { timeout: 5_000 },
        ),
      ).toBeVisible();
      expect(screen.getByText("16 August 2026")).toBeVisible();
      expect(screen.getByText("Exact note")).toBeVisible();
      expect(
        screen.getByRole("link", { name: "Back to Transactions" }),
      ).toHaveAttribute("href", `/finance/transactions?ledger=${ledgerId}`);
      if (transaction.kind === "internalTransfer") {
        expect(screen.getByText("Source Account")).toBeVisible();
        expect(screen.getByText("Destination Account")).toBeVisible();
        expect(screen.getByText(account.id)).toBeVisible();
        expect(screen.getByText(otherAccount.id)).toBeVisible();
      } else if (transaction.kind === "balanceAdjustment") {
        expect(screen.getByText("Correction delta")).toBeVisible();
        expect(screen.getByText("-27.00 USD")).toBeVisible();
      } else {
        expect(screen.getByText("Economic amount")).toBeVisible();
        expect(
          screen.getAllByText("9,007,199,254,740,993.25 USD")[0],
        ).toBeVisible();
        expect(
          screen.getByText(
            transaction.kind === "income" ? "Uncategorized" : "Food (archived)",
          ),
        ).toBeVisible();
      }
    },
  );

  it("shows a positive Adjustment as a signed correction", async () => {
    mockLedger();
    const adjustment = transactions[3]!;
    if (adjustment.kind !== "balanceAdjustment")
      throw new Error("Expected Adjustment fixture");
    server.use(
      getGetFinanceTransactionMockHandler({
        ...adjustment,
        correctionDelta: { amount: "27.00", currency: "USD" },
      }),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);

    expect(
      await screen.findByText("+27.00 USD", {}, { timeout: 5_000 }),
    ).toBeVisible();
    expect(screen.getByText(/does not store a target balance/)).toBeVisible();
  });

  it("resolves a direct URL to the remembered Ledger without losing the Transaction id", async () => {
    localStorage.setItem("core-console.finance.last-ledger-id", ledgerId);
    mockLedger();
    server.use(getGetFinanceTransactionMockHandler(transactions[0]!));
    const { router } = renderRoute(
      `/finance/transactions/${transactionId}?kind=income`,
    );

    expect(
      await screen.findByRole(
        "heading",
        { name: "Transaction detail" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(
      `/finance/transactions/${transactionId}`,
    );
    expect(router.state.location.search).toBe(
      `?ledger=${ledgerId}&kind=income`,
    );
  });

  it("retains a validated Overview month and date as the return path", async () => {
    mockLedger();
    server.use(getGetFinanceTransactionMockHandler(transactions[0]!));
    renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}&month=2026-08&date=2026-08-16&return=overview`,
    );

    expect(
      await screen.findByRole(
        "link",
        { name: "Back to Overview" },
        { timeout: 5_000 },
      ),
    ).toHaveAttribute(
      "href",
      `/finance/overview?ledger=${ledgerId}&month=2026-08&date=2026-08-16`,
    );
  });

  it("opens from filtered history and returns to those filters", async () => {
    const user = userEvent.setup();
    mockLedger();
    server.use(
      getListFinanceTransactionsMockHandler({
        items: [transactions[0]!],
        nextCursor: null,
      }),
      getGetFinanceTransactionMockHandler(transactions[0]!),
    );
    const { router } = renderRoute(
      `/finance/transactions?ledger=${ledgerId}&kind=income`,
    );

    await user.click(
      await screen.findByRole(
        "link",
        { name: /View details for Income/ },
        { timeout: 5_000 },
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Transaction detail" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(
      `/finance/transactions/${transactionId}`,
    );
    await user.click(
      screen.getByRole("link", { name: "Back to Transactions" }),
    );
    await waitFor(() =>
      expect(router.state.location.search).toBe(
        `?ledger=${ledgerId}&kind=income`,
      ),
    );
  });

  it("distinguishes identical history rows and confirms the selected Transaction ID", async () => {
    const user = userEvent.setup();
    const duplicate = { ...transactions[0]!, id: duplicateTransactionId };
    let deletedId = "";
    mockLedger();
    server.use(
      getListFinanceTransactionsMockHandler({
        items: [transactions[0]!, duplicate],
        nextCursor: null,
      }),
      http.delete(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        ({ params }) => {
          deletedId = String(params.transactionId);
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    renderRoute(`/finance/transactions?ledger=${ledgerId}`);

    const rows = await screen.findAllByRole(
      "article",
      {
        name: "Income on August 16, 2026",
      },
      { timeout: 5_000 },
    );
    expect(rows).toHaveLength(2);
    for (const [row, id] of [
      [rows[0]!, transactionId],
      [rows[1]!, duplicateTransactionId],
    ] as const) {
      expect(within(row).getByText(`Transaction ID ${id}`)).toBeVisible();
      expect(
        within(row).getByRole("link", {
          name: `View details for Income on August 16, 2026, Transaction ID ${id}`,
        }),
      ).toHaveAttribute(
        "href",
        `/finance/transactions/${id}?ledger=${ledgerId}`,
      );
      expect(
        within(row).getByRole("button", {
          name: `Delete Income on August 16, 2026, Transaction ID ${id}`,
        }),
      ).toBeVisible();
    }

    await user.click(
      within(rows[1]!).getByRole("button", {
        name: `Delete Income on August 16, 2026, Transaction ID ${duplicateTransactionId}`,
      }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete transaction?",
    });
    expect(
      within(dialog).getByText(`Transaction ID ${duplicateTransactionId}`),
    ).toBeVisible();
    expect(
      within(dialog).queryByText(`Transaction ID ${transactionId}`),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Delete transaction" }),
    );
    await waitFor(() => expect(deletedId).toBe(duplicateTransactionId));
  });

  it("requires a separate confirmation with Cancel focused and removes stale detail after deletion", async () => {
    const user = userEvent.setup();
    mockLedger();
    server.use(
      getGetFinanceTransactionMockHandler(transactions[0]!),
      http.delete(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const { router, queryClient } = renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}`,
    );

    await screen.findByRole("button", { name: "Delete transaction" });
    expect(
      queryClient.getQueryData(
        getGetFinanceTransactionQueryKey(ledgerId, transactionId),
      ),
    ).toBeDefined();

    await user.click(
      screen.getByRole("button", { name: "Delete transaction" }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete transaction?",
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus(),
    );
    expect(within(dialog).getByText(/cannot be undone/)).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "Delete transaction" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/finance/transactions"),
    );
    expect(
      queryClient.getQueryData(
        getGetFinanceTransactionQueryKey(ledgerId, transactionId),
      ),
    ).toBeUndefined();
  });

  it("deletes directly from history and announces the reconciled result", async () => {
    const user = userEvent.setup();
    let deleted = false;
    mockLedger();
    server.use(
      getListFinanceTransactionsMockHandler(() => ({
        items: deleted ? [] : [transactions[0]!],
        nextCursor: null,
      })),
      http.delete(
        "*/api/finance/ledgers/:ledgerId/transactions/:transactionId",
        () => {
          deleted = true;
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    renderRoute(`/finance/transactions?ledger=${ledgerId}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: /Delete Income on/ },
        { timeout: 5_000 },
      ),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete transaction?",
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus(),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Delete transaction" }),
    );
    expect(await screen.findByText("Income deleted.")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("article", { name: /Income on/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows an unavailable detail for an absent Transaction without exposing another Ledger", async () => {
    mockLedger();
    server.use(getGetFinanceTransactionMockHandler404());
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);

    expect(
      await screen.findByRole(
        "heading",
        { name: "Transaction unavailable" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Transactions", current: false }),
    ).toHaveAttribute("href", `/finance/transactions?ledger=${ledgerId}`);
    expect(screen.queryByText("Exact note")).not.toBeInTheDocument();
  });

  it("stops stale deletion and removes the obsolete detail presentation", async () => {
    const user = userEvent.setup();
    mockLedger();
    server.use(
      getGetFinanceTransactionMockHandler(transactions[0]!),
      getDeleteFinanceTransactionMockHandler404(),
    );
    renderRoute(`/finance/transactions/${transactionId}?ledger=${ledgerId}`);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Delete transaction" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete transaction",
      }),
    );
    expect(
      await screen.findByRole(
        "heading",
        { name: "Transaction unavailable" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Transaction unavailable. It was already removed."),
    ).toBeVisible();
    expect(screen.queryByText("Exact note")).not.toBeInTheDocument();
  });

  it("clears Transaction identity when switching Ledgers", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceLedgersMockHandler([
        { id: ledgerId, name: "Personal" },
        { id: "55555555-5555-4555-8555-555555555555", name: "Team fund" },
      ]),
      getGetFinanceTransactionMockHandler(transactions[0]!),
      getListFinanceTransactionsMockHandler({ items: [], nextCursor: null }),
    );
    const { router } = renderRoute(
      `/finance/transactions/${transactionId}?ledger=${ledgerId}&kind=income`,
    );

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Personal" },
        { timeout: 5_000 },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Team fund" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/finance/transactions"),
    );
    expect(router.state.location.search).toBe(
      "?ledger=55555555-5555-4555-8555-555555555555&kind=income",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Transaction detail" }),
      ).not.toBeInTheDocument(),
    );
  });
});
