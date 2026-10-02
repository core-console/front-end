import {
  QueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { getListFinanceTransactionsQueryKey } from "@/api/generated/core-console";
import type {
  FinanceTransactionResponseOutput,
  ListFinanceTransactionsParams,
  TransactionHistoryPageResponseOutput,
} from "@/api/generated/schemas";
import {
  captureBalanceAdjustmentHistoryMembership,
  reconcileBalanceAdjustmentReplacementHistories,
  reconcileLedgerTransactionHistories,
  reconcileOrdinaryReplacementHistories,
} from "@/components/finance/transaction-history-cache";

const ledgerId = "11111111-1111-4111-8111-111111111111";
const otherLedgerId = "55555555-5555-4555-8555-555555555555";
const transactionId = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const account = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Cash",
  status: "archived",
} as const;
const otherAccount = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Savings",
  status: "active",
} as const;
const category = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Food",
  status: "archived",
} as const;
const money = { amount: "9007199254740993.25", currency: "USD" } as const;
const expense = {
  id: transactionId,
  ledgerId,
  note: "Confirmed exact note",
  transactionDate: "2026-08-16",
  account,
  categoryAllocations: [{ amount: money, category }],
  economicAmount: money,
  kind: "expense",
} satisfies FinanceTransactionResponseOutput;
const adjustment = {
  id: transactionId,
  ledgerId,
  note: "Confirmed correction",
  transactionDate: "2026-08-16",
  account,
  correctionDelta: { amount: "-9007199254740993.25", currency: "USD" },
  kind: "balanceAdjustment",
} satisfies FinanceTransactionResponseOutput;
const income = {
  ...expense,
  kind: "income",
  categoryAllocations: [{ amount: money, category: null }],
} satisfies FinanceTransactionResponseOutput;
const transfer = {
  id: transactionId,
  ledgerId,
  note: "Exact transfer",
  transactionDate: "2026-08-16",
  sourceAccount: account,
  destinationAccount: otherAccount,
  sourceAmount: money,
  destinationAmount: money,
  kind: "internalTransfer",
} satisfies FinanceTransactionResponseOutput;
type History = InfiniteData<
  TransactionHistoryPageResponseOutput,
  string | undefined
>;
const clients: QueryClient[] = [];
function client() {
  const queryClient = new QueryClient();
  clients.push(queryClient);
  return queryClient;
}
afterEach(() => {
  for (const queryClient of clients) queryClient.clear();
  clients.length = 0;
});
function key(params: unknown = {}, ledger = ledgerId): QueryKey {
  return [...getListFinanceTransactionsQueryKey(ledger), params, "infinite"];
}
function history(...pages: FinanceTransactionResponseOutput[][]): History {
  return {
    pages: pages.map((items) => ({ items, nextCursor: null })),
    pageParams: pages.map(() => undefined),
  };
}
function items(queryClient: QueryClient, queryKey: QueryKey) {
  return queryClient
    .getQueryData<History>(queryKey)
    ?.pages.flatMap((page) => page.items);
}

describe("Finance transaction history projection", () => {
  it("creates a matching absent target, replaces every existing occurrence, and removes nonmatching targets", () => {
    const queryClient = client();
    const absent = key();
    const repeated = key({ accountId: account.id });
    const nonmatching = key({ kind: "income" });
    const untouched = key({ accountId: otherAccount.id });
    const old = { ...expense, note: "Old" };
    queryClient.setQueryData(absent, history([]));
    queryClient.setQueryData(repeated, history([old], [old, old]));
    queryClient.setQueryData(nonmatching, history([old]));
    queryClient.setQueryData(untouched, history([]));

    expect(
      reconcileLedgerTransactionHistories(queryClient, ledgerId, expense),
    ).toBeUndefined();

    expect(items(queryClient, absent)).toEqual([expense]);
    expect(items(queryClient, repeated)).toEqual([expense]);
    expect(items(queryClient, nonmatching)).toEqual([]);
    expect(items(queryClient, untouched)).toEqual([]);
  });

  it("reapplies an Adjustment from captured membership after an intermediate history loses the target", () => {
    const queryClient = client();
    const present = key({ kind: "balanceAdjustment" });
    queryClient.setQueryData(
      present,
      history([{ ...adjustment, note: "Old" }]),
    );
    const snapshot = captureBalanceAdjustmentHistoryMembership(
      queryClient,
      ledgerId,
      transactionId,
    );
    const result = { outcome: "updated", transaction: adjustment } as const;

    expect(
      reconcileBalanceAdjustmentReplacementHistories(snapshot, result),
    ).toBeUndefined();
    expect(items(queryClient, present)).toEqual([adjustment]);
    queryClient.setQueryData(present, history([]));
    reconcileBalanceAdjustmentReplacementHistories(snapshot, result);

    expect(items(queryClient, present)).toEqual([adjustment]);
  });

  it("updates only histories containing the ordinary target and removes it when filters change", () => {
    const queryClient = client();
    const present = key();
    const absent = key({ accountId: account.id });
    const departed = key({ toDate: "2026-08-15" });
    const old = { ...expense, transactionDate: "2026-08-15", note: "Old" };
    queryClient.setQueryData(present, history([old, old]));
    queryClient.setQueryData(absent, history([]));
    queryClient.setQueryData(departed, history([old]));

    expect(
      reconcileOrdinaryReplacementHistories(
        queryClient,
        ledgerId,
        transactionId,
        expense,
      ),
    ).toBeUndefined();

    expect(items(queryClient, present)).toEqual([expense]);
    expect(items(queryClient, absent)).toEqual([]);
    expect(items(queryClient, departed)).toEqual([]);
    queryClient.setQueryData(present, history([]));
    reconcileOrdinaryReplacementHistories(
      queryClient,
      ledgerId,
      transactionId,
      expense,
    );
    expect(items(queryClient, present)).toEqual([]);
  });

  it("combines current and captured Adjustment membership without inserting into uncaptured empty histories", () => {
    const queryClient = client();
    const captured = key({ kind: "balanceAdjustment" });
    const latePresent = key({ accountId: account.id });
    const lateEmpty = key();
    const nonmatching = key({ toDate: "2026-08-15" });
    queryClient.setQueryData(captured, history([adjustment]));
    queryClient.setQueryData(nonmatching, history([adjustment]));
    const snapshot = captureBalanceAdjustmentHistoryMembership(
      queryClient,
      ledgerId,
      transactionId,
    );
    queryClient.setQueryData(captured, history([]));
    queryClient.setQueryData(nonmatching, history([]));
    queryClient.setQueryData(latePresent, history([adjustment, adjustment]));
    queryClient.setQueryData(lateEmpty, history([]));

    reconcileBalanceAdjustmentReplacementHistories(snapshot, {
      outcome: "updated",
      transaction: adjustment,
    });

    expect(items(queryClient, captured)).toEqual([adjustment]);
    expect(items(queryClient, latePresent)).toEqual([adjustment]);
    expect(items(queryClient, lateEmpty)).toEqual([]);
    expect(items(queryClient, nonmatching)).toEqual([]);
  });

  it("captures read-only membership and keeps earlier and later snapshots independent", () => {
    const queryClient = client();
    const originallyEmpty = key();
    const originallyPresent = key({ kind: "balanceAdjustment" });
    queryClient.setQueryData(originallyEmpty, history([]));
    queryClient.setQueryData(originallyPresent, history([adjustment]));
    const before = queryClient.getQueriesData({
      queryKey: getListFinanceTransactionsQueryKey(ledgerId),
    });
    const states = before.map(([queryKey]) =>
      queryClient.getQueryState(queryKey),
    );
    const earlier = captureBalanceAdjustmentHistoryMembership(
      queryClient,
      ledgerId,
      transactionId,
    );
    expect(
      queryClient.getQueriesData({
        queryKey: getListFinanceTransactionsQueryKey(ledgerId),
      }),
    ).toEqual(before);
    expect(
      before.map(([queryKey]) => queryClient.getQueryState(queryKey)),
    ).toEqual(states);
    queryClient.setQueryData(originallyEmpty, history([adjustment]));
    queryClient.setQueryData(originallyPresent, history([]));
    const later = captureBalanceAdjustmentHistoryMembership(
      queryClient,
      ledgerId,
      transactionId,
    );
    queryClient.setQueryData(originallyEmpty, history([]));
    reconcileBalanceAdjustmentReplacementHistories(later, {
      outcome: "updated",
      transaction: adjustment,
    });
    expect(items(queryClient, originallyEmpty)).toEqual([adjustment]);
    expect(items(queryClient, originallyPresent)).toEqual([]);
    queryClient.setQueryData(originallyEmpty, history([]));
    reconcileBalanceAdjustmentReplacementHistories(earlier, {
      outcome: "updated",
      transaction: adjustment,
    });
    expect(items(queryClient, originallyEmpty)).toEqual([]);
    expect(items(queryClient, originallyPresent)).toEqual([adjustment]);
    queryClient.setQueryData(originallyEmpty, history([]));
    queryClient.setQueryData(originallyPresent, history([]));
    reconcileBalanceAdjustmentReplacementHistories(earlier, {
      outcome: "updated",
      transaction: adjustment,
    });
    expect(items(queryClient, originallyEmpty)).toEqual([]);
    expect(items(queryClient, originallyPresent)).toEqual([adjustment]);
  });

  it("removes every Adjustment occurrence even with invalid parameters and on repeated application", () => {
    const queryClient = client();
    const valid = key();
    const invalid = key({ pageSize: 0 });
    const other = { ...expense, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    queryClient.setQueryData(
      valid,
      history([adjustment, adjustment], [other, adjustment]),
    );
    const snapshot = captureBalanceAdjustmentHistoryMembership(
      queryClient,
      ledgerId,
      transactionId,
    );
    queryClient.setQueryData(invalid, history([adjustment, adjustment]));
    reconcileBalanceAdjustmentReplacementHistories(snapshot, {
      outcome: "removed",
      transaction: null,
    });
    expect(items(queryClient, valid)).toEqual([other]);
    expect(items(queryClient, invalid)).toEqual([]);
    queryClient.setQueryData(valid, history([adjustment, other]));
    reconcileBalanceAdjustmentReplacementHistories(snapshot, {
      outcome: "removed",
      transaction: null,
    });
    expect(items(queryClient, valid)).toEqual([other]);
    expect(items(queryClient, invalid)).toEqual([]);
  });

  it.each([
    ["missing", undefined, true, true],
    ["null", null, true, true],
    ["string", "not-params", true, false],
    ["number", 7, true, false],
    ["array", [], false, false],
    ["invalid page size", { pageSize: 0 }, false, false],
    ["invalid date", { fromDate: "not-a-date" }, false, false],
    ["unknown field", { unexpected: true }, false, false],
    [
      "opaque cursor and page size",
      { cursor: "opaque/==?", pageSize: 1 },
      true,
      true,
    ],
  ])(
    "preserves parameter recognition for %s",
    (_name, params, creationMatches, replacementMatches) => {
      const queryKey: QueryKey = [
        ...getListFinanceTransactionsQueryKey(ledgerId),
        params,
        "infinite",
      ];
      const creationClient = client();
      const ordinaryClient = client();
      const adjustmentClient = client();
      const old = { ...expense, note: "Old" };
      const oldAdjustment = { ...adjustment, note: "Old" };
      creationClient.setQueryData(queryKey, history([old]));
      ordinaryClient.setQueryData(queryKey, history([old]));
      adjustmentClient.setQueryData(queryKey, history([oldAdjustment]));
      const snapshot = captureBalanceAdjustmentHistoryMembership(
        adjustmentClient,
        ledgerId,
        transactionId,
      );
      reconcileLedgerTransactionHistories(creationClient, ledgerId, expense);
      reconcileOrdinaryReplacementHistories(
        ordinaryClient,
        ledgerId,
        transactionId,
        expense,
      );
      reconcileBalanceAdjustmentReplacementHistories(snapshot, {
        outcome: "updated",
        transaction: adjustment,
      });
      expect(items(creationClient, queryKey)).toEqual(
        creationMatches ? [expense] : [old],
      );
      expect(items(ordinaryClient, queryKey)).toEqual(
        replacementMatches ? [expense] : [],
      );
      expect(items(adjustmentClient, queryKey)).toEqual(
        replacementMatches ? [adjustment] : [],
      );
      if (!replacementMatches) {
        // Captured membership cannot override invalid parameters on reapplication.
        reconcileBalanceAdjustmentReplacementHistories(snapshot, {
          outcome: "updated",
          transaction: adjustment,
        });
        expect(items(adjustmentClient, queryKey)).toEqual([]);
      }
    },
  );

  it("requires the infinite suffix only for creation and leaves unrelated response envelopes alone", () => {
    const queryClient = client();
    const nonInfinite = getListFinanceTransactionsQueryKey(ledgerId, {
      kind: "expense",
    });
    const envelopeKey = getListFinanceTransactionsQueryKey(ledgerId, {
      pageSize: 1,
    });
    const envelope = {
      data: { items: [expense], nextCursor: null },
      status: 200,
    };
    const old = { ...expense, note: "Old" };
    queryClient.setQueryData(nonInfinite, history([old]));
    queryClient.setQueryData(envelopeKey, envelope);
    reconcileLedgerTransactionHistories(queryClient, ledgerId, expense);
    expect(items(queryClient, nonInfinite)).toEqual([old]);
    reconcileOrdinaryReplacementHistories(
      queryClient,
      ledgerId,
      transactionId,
      expense,
    );
    expect(items(queryClient, nonInfinite)).toEqual([expense]);
    queryClient.setQueryData(nonInfinite, history([adjustment]));
    const snapshot = captureBalanceAdjustmentHistoryMembership(
      queryClient,
      ledgerId,
      transactionId,
    );
    reconcileBalanceAdjustmentReplacementHistories(snapshot, {
      outcome: "removed",
      transaction: null,
    });
    expect(items(queryClient, nonInfinite)).toEqual([]);
    expect(queryClient.getQueryData(envelopeKey)).toEqual(envelope);
  });

  const filterCases: {
    name: string;
    transaction: FinanceTransactionResponseOutput;
    params: ListFinanceTransactionsParams;
    matches: boolean;
  }[] = [
    {
      name: "inclusive from date",
      transaction: expense,
      params: { fromDate: "2026-08-16" },
      matches: true,
    },
    {
      name: "inclusive to date",
      transaction: expense,
      params: { toDate: "2026-08-16" },
      matches: true,
    },
    {
      name: "before from date",
      transaction: expense,
      params: { fromDate: "2026-08-17" },
      matches: false,
    },
    {
      name: "after to date",
      transaction: expense,
      params: { toDate: "2026-08-15" },
      matches: false,
    },
    {
      name: "matching kind",
      transaction: income,
      params: { kind: "income" },
      matches: true,
    },
    {
      name: "different kind",
      transaction: expense,
      params: { kind: "income" },
      matches: false,
    },
    {
      name: "Expense Account",
      transaction: expense,
      params: { accountId: account.id },
      matches: true,
    },
    {
      name: "different Expense Account",
      transaction: expense,
      params: { accountId: otherAccount.id },
      matches: false,
    },
    {
      name: "Income Account",
      transaction: income,
      params: { accountId: account.id },
      matches: true,
    },
    {
      name: "Transfer source Account",
      transaction: transfer,
      params: { accountId: account.id },
      matches: true,
    },
    {
      name: "Transfer destination Account",
      transaction: transfer,
      params: { accountId: otherAccount.id },
      matches: true,
    },
    {
      name: "uninvolved Transfer Account",
      transaction: transfer,
      params: { accountId: otherLedgerId },
      matches: false,
    },
    {
      name: "Expense Category",
      transaction: expense,
      params: { categoryId: category.id },
      matches: true,
    },
    {
      name: "different Expense Category",
      transaction: expense,
      params: { categoryId: otherLedgerId },
      matches: false,
    },
    {
      name: "classified Income Category",
      transaction: { ...expense, kind: "income" },
      params: { categoryId: category.id },
      matches: true,
    },
    {
      name: "Uncategorized Income",
      transaction: income,
      params: { uncategorized: true },
      matches: true,
    },
    {
      name: "Uncategorized Expense",
      transaction: { ...income, kind: "expense" },
      params: { uncategorized: true },
      matches: true,
    },
    {
      name: "classified Expense is not Uncategorized",
      transaction: expense,
      params: { uncategorized: true },
      matches: false,
    },
    {
      name: "Uncategorized Income has no Category",
      transaction: income,
      params: { categoryId: category.id },
      matches: false,
    },
    {
      name: "Transfer has no Category",
      transaction: transfer,
      params: { categoryId: category.id },
      matches: false,
    },
    {
      name: "Transfer is not Uncategorized",
      transaction: transfer,
      params: { uncategorized: true },
      matches: false,
    },
    {
      name: "Adjustment Account and inclusive dates",
      transaction: adjustment,
      params: {
        accountId: account.id,
        kind: "balanceAdjustment",
        fromDate: "2026-08-16",
        toDate: "2026-08-16",
      },
      matches: true,
    },
    {
      name: "different Adjustment Account",
      transaction: adjustment,
      params: { accountId: otherAccount.id },
      matches: false,
    },
    {
      name: "different Adjustment kind",
      transaction: adjustment,
      params: { kind: "expense" },
      matches: false,
    },
    {
      name: "Adjustment before from date",
      transaction: adjustment,
      params: { fromDate: "2026-08-17" },
      matches: false,
    },
    {
      name: "Adjustment after to date",
      transaction: adjustment,
      params: { toDate: "2026-08-15" },
      matches: false,
    },
    {
      name: "Adjustment has no Category",
      transaction: adjustment,
      params: { categoryId: category.id },
      matches: false,
    },
    {
      name: "Adjustment is not Uncategorized",
      transaction: adjustment,
      params: { uncategorized: true },
      matches: false,
    },
    {
      name: "cursor and page size do not filter",
      transaction: expense,
      params: { cursor: "opaque_==/next", pageSize: 1 },
      matches: true,
    },
    {
      name: "null filters and generated defaults",
      transaction: expense,
      params: {
        accountId: null,
        categoryId: null,
        fromDate: null,
        toDate: null,
        kind: null,
        uncategorized: null,
      },
      matches: true,
    },
  ];
  it.each(filterCases)(
    "matches $name in creation and applicable replacement",
    ({ transaction, params, matches }) => {
      const creationClient = client();
      const replacementClient = client();
      const queryKey = key(params);
      creationClient.setQueryData(queryKey, history([]));
      replacementClient.setQueryData(
        queryKey,
        history([{ ...transaction, note: "Old" }]),
      );
      reconcileLedgerTransactionHistories(
        creationClient,
        ledgerId,
        transaction,
      );
      if (transaction.kind === "balanceAdjustment") {
        const snapshot = captureBalanceAdjustmentHistoryMembership(
          replacementClient,
          ledgerId,
          transactionId,
        );
        reconcileBalanceAdjustmentReplacementHistories(snapshot, {
          outcome: "updated",
          transaction,
        });
      } else {
        reconcileOrdinaryReplacementHistories(
          replacementClient,
          ledgerId,
          transactionId,
          transaction,
        );
      }
      expect(items(creationClient, queryKey)).toEqual(
        matches ? [transaction] : [],
      );
      expect(items(replacementClient, queryKey)).toEqual(
        matches ? [transaction] : [],
      );
    },
  );

  it("inserts in descending date and ID order while the final page absorbs growth and all metadata survives", () => {
    const queryClient = client();
    const queryKey = key();
    const older = {
      ...expense,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      transactionDate: "2026-08-15",
    };
    const higherId = { ...expense, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
    const lowerId = { ...expense, id: "00000000-0000-4000-8000-000000000000" };
    const seeded = {
      pages: [
        {
          items: [older, lowerId],
          nextCursor: "opaque==/first?",
          marker: "first",
        },
        { items: [higherId], nextCursor: "opaque==/last?", marker: "last" },
      ],
      pageParams: [undefined, "opaque-input=/second"],
      marker: "outer",
    };
    queryClient.setQueryData(queryKey, seeded);
    reconcileLedgerTransactionHistories(queryClient, ledgerId, expense);
    expect(queryClient.getQueryData(queryKey)).toEqual({
      ...seeded,
      pages: [
        { ...seeded.pages[0], items: [higherId, expense] },
        { ...seeded.pages[1], items: [lowerId, older] },
      ],
    });
  });

  it.each(["creation", "ordinary", "adjustment"] as const)(
    "preserves %s redistribution after date movement and shrink below earlier page lengths",
    (operation) => {
      const queryClient = client();
      const queryKey = key();
      const confirmed = { ...expense, transactionDate: "2026-08-14" };
      const updatedAdjustment = {
        ...adjustment,
        transactionDate: "2026-08-14",
      };
      const old = operation === "adjustment" ? adjustment : expense;
      const higher = {
        ...expense,
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        transactionDate: "2026-08-17",
      };
      const repeatedOther = {
        ...expense,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      };
      const seeded = {
        pages: [
          {
            items: [old, old, repeatedOther],
            nextCursor: "opaque/A==",
            marker: "first",
          },
          { items: [old, higher], nextCursor: "opaque/B==", marker: "second" },
          { items: [old, repeatedOther], nextCursor: null, marker: "last" },
        ],
        pageParams: [undefined, "opaque/A==", "opaque/B=="],
        marker: "outer",
      };
      queryClient.setQueryData(queryKey, seeded);
      if (operation === "creation")
        reconcileLedgerTransactionHistories(queryClient, ledgerId, confirmed);
      else if (operation === "ordinary")
        reconcileOrdinaryReplacementHistories(
          queryClient,
          ledgerId,
          transactionId,
          confirmed,
        );
      else {
        const snapshot = captureBalanceAdjustmentHistoryMembership(
          queryClient,
          ledgerId,
          transactionId,
        );
        reconcileBalanceAdjustmentReplacementHistories(snapshot, {
          outcome: "updated",
          transaction: updatedAdjustment,
        });
      }
      expect(queryClient.getQueryData(queryKey)).toEqual({
        ...seeded,
        pages: [
          { ...seeded.pages[0], items: [higher, repeatedOther, repeatedOther] },
          {
            ...seeded.pages[1],
            items: [operation === "adjustment" ? updatedAdjustment : confirmed],
          },
          { ...seeded.pages[2], items: [] },
        ],
      });
    },
  );

  it("retains metadata when removal leaves fewer items than the first page length", () => {
    const queryClient = client();
    const queryKey = key();
    const remaining = {
      ...expense,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    const seeded = {
      pages: [
        {
          items: [adjustment, adjustment, adjustment],
          nextCursor: "opaque-first",
          marker: 1,
        },
        {
          items: [remaining, adjustment],
          nextCursor: "opaque-last",
          marker: 2,
        },
      ],
      pageParams: [undefined, "opaque-first"],
      marker: "outer",
    };
    queryClient.setQueryData(queryKey, seeded);
    const snapshot = captureBalanceAdjustmentHistoryMembership(
      queryClient,
      ledgerId,
      transactionId,
    );
    reconcileBalanceAdjustmentReplacementHistories(snapshot, {
      outcome: "removed",
      transaction: null,
    });
    expect(queryClient.getQueryData(queryKey)).toEqual({
      ...seeded,
      pages: [
        { ...seeded.pages[0], items: [remaining] },
        { ...seeded.pages[1], items: [] },
      ],
    });
  });

  it.each(["creation", "ordinary", "adjustment"] as const)(
    "isolates %s by Ledger and QueryClient, including the snapshot's original scope",
    (operation) => {
      const queryClient = client();
      const otherClient = client();
      const queryKey = key();
      const otherLedgerKey = key({}, otherLedgerId);
      const old =
        operation === "adjustment"
          ? { ...adjustment, note: "Old" }
          : { ...expense, note: "Old" };
      const otherLedgerTransaction = { ...old, ledgerId: otherLedgerId };
      queryClient.setQueryData(queryKey, history([old]));
      queryClient.setQueryData(
        otherLedgerKey,
        history([otherLedgerTransaction]),
      );
      otherClient.setQueryData(queryKey, history([old]));
      if (operation === "creation")
        reconcileLedgerTransactionHistories(queryClient, ledgerId, expense);
      else if (operation === "ordinary")
        reconcileOrdinaryReplacementHistories(
          queryClient,
          ledgerId,
          transactionId,
          expense,
        );
      else {
        const snapshot = captureBalanceAdjustmentHistoryMembership(
          queryClient,
          ledgerId,
          transactionId,
        );
        const differentTarget = {
          ...adjustment,
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        };
        queryClient.setQueryData(queryKey, history([old, differentTarget]));
        captureBalanceAdjustmentHistoryMembership(
          otherClient,
          otherLedgerId,
          differentTarget.id,
        );
        reconcileBalanceAdjustmentReplacementHistories(snapshot, {
          outcome: "updated",
          transaction: adjustment,
        });
        expect(items(queryClient, queryKey)).toEqual([
          differentTarget,
          adjustment,
        ]);
      }
      if (operation !== "adjustment")
        expect(items(queryClient, queryKey)).toEqual([expense]);
      expect(items(queryClient, otherLedgerKey)).toEqual([
        otherLedgerTransaction,
      ]);
      expect(items(otherClient, queryKey)).toEqual([old]);
    },
  );

  it("does not create histories or pages and never recreates a removed captured history", () => {
    const queryClient = client();
    const queryKey = key();
    const emptyPagesKey = key({ kind: "balanceAdjustment" });
    const root = getListFinanceTransactionsQueryKey(ledgerId);
    const emptySnapshot = captureBalanceAdjustmentHistoryMembership(
      queryClient,
      ledgerId,
      transactionId,
    );
    reconcileLedgerTransactionHistories(queryClient, ledgerId, expense);
    reconcileOrdinaryReplacementHistories(
      queryClient,
      ledgerId,
      transactionId,
      expense,
    );
    reconcileBalanceAdjustmentReplacementHistories(emptySnapshot, {
      outcome: "updated",
      transaction: adjustment,
    });
    expect(queryClient.getQueriesData({ queryKey: root })).toEqual([]);
    queryClient.setQueryData(queryKey, history([adjustment]));
    const snapshot = captureBalanceAdjustmentHistoryMembership(
      queryClient,
      ledgerId,
      transactionId,
    );
    queryClient.removeQueries({ queryKey, exact: true });
    queryClient.setQueryData(emptyPagesKey, history());
    // An existing Query with no cached data must also remain absent.
    queryClient.getQueryCache().build(queryClient, { queryKey });
    const keysBefore = queryClient
      .getQueriesData({ queryKey: root })
      .map(([cachedKey]) => cachedKey);
    reconcileLedgerTransactionHistories(queryClient, ledgerId, adjustment);
    reconcileOrdinaryReplacementHistories(
      queryClient,
      ledgerId,
      transactionId,
      expense,
    );
    reconcileBalanceAdjustmentReplacementHistories(snapshot, {
      outcome: "updated",
      transaction: adjustment,
    });
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    expect(queryClient.getQueryData(emptyPagesKey)).toEqual({
      pages: [],
      pageParams: [],
    });
    expect(
      queryClient
        .getQueriesData({ queryKey: root })
        .map(([cachedKey]) => cachedKey),
    ).toEqual(keysBefore);
    queryClient.removeQueries({ queryKey, exact: true });
    reconcileBalanceAdjustmentReplacementHistories(snapshot, {
      outcome: "updated",
      transaction: adjustment,
    });
    expect(queryClient.getQueriesData({ queryKey: root })).toEqual([
      [emptyPagesKey, { pages: [], pageParams: [] }],
    ]);
  });

  it("retains serialized query-key membership identity instead of normalizing reordered parameters", () => {
    const queryClient = client();
    const capturedKey = key({
      kind: "balanceAdjustment",
      accountId: account.id,
    });
    const reorderedKey = key({
      accountId: account.id,
      kind: "balanceAdjustment",
    });
    queryClient.setQueryData(capturedKey, history([adjustment]));
    const snapshot = captureBalanceAdjustmentHistoryMembership(
      queryClient,
      ledgerId,
      transactionId,
    );
    queryClient.removeQueries({ queryKey: capturedKey, exact: true });
    queryClient.setQueryData(reorderedKey, history([]));
    reconcileBalanceAdjustmentReplacementHistories(snapshot, {
      outcome: "updated",
      transaction: adjustment,
    });
    expect(items(queryClient, reorderedKey)).toEqual([]);
  });
});
