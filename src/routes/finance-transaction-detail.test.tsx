import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { getGetFinanceTransactionQueryKey } from "@/api/generated/core-console";
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
