import type {
  CreateFinanceTransactionBody,
  FinanceTransactionResponseOutput,
} from "../api/generated/schemas/index.ts";

export const transactionTestLedger = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Personal",
};
export const transactionTestOtherLedger = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "Team",
};
export const transactionTestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const transactionTestDate = "2026-10-05";
export const transactionTestMoney = {
  amount: "9007199254740993.01",
  currency: "USD",
} as const;
export const transactionTestAccounts = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Cash",
    nature: "asset",
    currency: "USD",
    openingBalance: { amount: "0.00", currency: "USD" },
    currentBalance: { amount: "0.00", currency: "USD" },
    status: "active",
    trackingStartDate: "2026-01-01",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Card",
    nature: "liability",
    currency: "USD",
    openingBalance: { amount: "0.00", currency: "USD" },
    currentBalance: { amount: "0.00", currency: "USD" },
    status: "active",
    trackingStartDate: "2026-01-01",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Yen",
    nature: "asset",
    currency: "JPY",
    openingBalance: { amount: "0", currency: "JPY" },
    currentBalance: { amount: "0", currency: "JPY" },
    status: "active",
    trackingStartDate: "2026-01-01",
  },
] as const;
export const transactionTestCategories = [
  {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Travel",
    status: "active",
  },
  {
    id: "55555555-5555-4555-8555-555555555556",
    name: "Travel",
    status: "active",
  },
] as const;
export const transactionTestKinds = [
  "income",
  "expense",
  "internalTransfer",
] as const;
export function transactionTestBody(
  kind: (typeof transactionTestKinds)[number],
): CreateFinanceTransactionBody {
  const common = {
    kind,
    note: "Immutable note",
    transactionDate: transactionTestDate,
  };
  return kind === "internalTransfer"
    ? {
        ...common,
        kind,
        amount: transactionTestMoney,
        sourceAccountId: transactionTestAccounts[0].id,
        destinationAccountId: transactionTestAccounts[1].id,
      }
    : {
        ...common,
        kind,
        accountId: transactionTestAccounts[0].id,
        economicAmount: transactionTestMoney,
        categoryAllocations: [
          {
            amount: transactionTestMoney,
            categoryId: transactionTestCategories[1].id,
          },
        ],
      };
}
export function transactionTestResource(
  kind: (typeof transactionTestKinds)[number],
): FinanceTransactionResponseOutput {
  const common = {
    id: transactionTestId,
    ledgerId: transactionTestLedger.id,
    note: "Current edited note",
    transactionDate: transactionTestDate,
  };
  const account = {
    id: transactionTestAccounts[0].id,
    name: "Cash",
    status: "active" as const,
  };
  return kind === "internalTransfer"
    ? {
        ...common,
        kind,
        sourceAmount: transactionTestMoney,
        destinationAmount: transactionTestMoney,
        sourceAccount: account,
        destinationAccount: {
          id: transactionTestAccounts[1].id,
          name: "Card",
          status: "active",
        },
      }
    : {
        ...common,
        kind,
        account,
        economicAmount: transactionTestMoney,
        categoryAllocations: [
          {
            amount: transactionTestMoney,
            category: transactionTestCategories[1],
          },
        ],
      };
}
export const transactionTestOverview = {
  ledger: transactionTestLedger,
  month: "2026-10",
  days: [],
  accounts: [...transactionTestAccounts],
  financialPositionByCurrency: [],
  monthSummaryByCurrency: [],
};
export const transactionTestDay = {
  date: transactionTestDate,
  activityByCurrency: [],
  transactionCount: 0,
  transactionCountByKind: {
    income: 0,
    expense: 0,
    internalTransfer: 0,
    balanceAdjustment: 0,
  },
  transactions: [],
};
