import { describe, expect, it } from "vitest";

import openApi from "../../openapi/openapi.json";
import {
  getCreateBalanceAdjustmentResponseMock as getCreateAdjustmentFixture,
  getGetFinanceOverviewResponseMock as getFinanceOverviewFixture,
  getListFinanceAccountsResponseMock as getFinanceAccountsFixture,
  getListFinanceCurrenciesResponseMock as getFinanceCurrenciesFixture,
  getListFinanceTransactionsResponseMock as getFinanceTransactionsFixture,
  getReplaceBalanceAdjustmentResponseMock as getReplaceAdjustmentFixture,
} from "@/api/generated/core-console.faker";
import { getListFinanceCurrenciesMockHandler } from "@/api/generated/core-console.msw";
import {
  getListFinanceCurrenciesQueryKey,
  listFinanceCurrencies,
  useListFinanceCurrencies,
} from "@/api/generated/core-console";
import {
  AccountReferenceResponse,
  AccountResponse,
  BalanceAdjustmentResultResponse,
  CorrectAccountSemanticsRequest,
  CreateUserRequest,
  CurrencyResponse,
  FinanceOverviewResponse,
  FinanceTransactionResponse,
  MoneyResponse,
  ProblemDetails,
  ReplaceBalanceAdjustmentResultResponse,
  TransactionHistoryPageResponse,
  UpdateFinanceAccountBody,
  UpdateUserRequest,
} from "@/api/generated/schemas";
import { server } from "@/mocks/server";

const accountId = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const ledgerId = "33333333-3333-4333-8333-333333333333";
const transactionId = "44444444-4444-4444-8444-444444444444";

const archivedAccount = {
  id: accountId,
  name: "Archived cash",
  status: "archived",
} as const;

const adjustment = {
  id: transactionId,
  ledgerId,
  kind: "balanceAdjustment",
  transactionDate: "2026-09-10",
  note: null,
  account: archivedAccount,
  correctionDelta: { amount: "-9007199254740993.01", currency: "CNY" },
} as const;

const categoryAllocation = {
  amount: { amount: "12.34", currency: "CNY" },
  category: {
    id: categoryId,
    name: "Archived category",
    status: "archived",
  },
} as const;

const commonTransaction = {
  id: transactionId,
  ledgerId,
  transactionDate: "2026-09-10",
  note: null,
} as const;

const financeOperationIds = [
  "archiveFinanceAccount",
  "archiveFinanceCategory",
  "createBalanceAdjustment",
  "createFinanceAccount",
  "createFinanceCategory",
  "createFinanceLedger",
  "createFinanceTransaction",
  "deleteFinanceTransaction",
  "getBalanceAdjustmentContext",
  "getFinanceOverview",
  "getFinanceTransaction",
  "listFinanceAccounts",
  "listFinanceCategories",
  "listFinanceCurrencies",
  "listFinanceLedgers",
  "listFinanceTransactions",
  "replaceBalanceAdjustment",
  "replaceFinanceTransaction",
  "unarchiveFinanceAccount",
  "unarchiveFinanceCategory",
  "updateFinanceAccount",
  "updateFinanceCategory",
  "updateFinanceLedger",
].sort();

const financeConflictCodes = [
  "account_balance_changed",
  "finance_account_archived",
  "finance_account_semantics_changed",
  "finance_account_semantics_locked",
  "finance_category_archived",
  "finance_category_name_conflict",
  "finance_ledger_name_conflict",
  "finance_transaction_kind_immutable",
] as const;

type OpenApiOperation = {
  operationId?: string;
  responses?: Record<
    string,
    {
      content?: Record<string, { schema?: { $ref?: string } }>;
    }
  >;
};

const financeOperations = Object.entries(openApi.paths).flatMap(
  ([path, pathItem]) =>
    path.startsWith("/finance/")
      ? Object.values(pathItem).filter(
          (operation): operation is OpenApiOperation =>
            typeof operation === "object" &&
            operation !== null &&
            "operationId" in operation,
        )
      : [],
);

const expectExactMoneyStrings = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      expectExactMoneyStrings(item);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  if ("amount" in value && "currency" in value) {
    expect(value.amount).toBeTypeOf("string");
    expect(value.amount).toMatch(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
  }

  for (const item of Object.values(value)) {
    expectExactMoneyStrings(item);
  }
};

describe("generated Finance API boundary", () => {
  it("preserves Account semantic-correction request constraints", () => {
    for (const invalidRequest of [
      {},
      { nature: "liability", name: "Cash" },
      { status: "archived" },
    ]) {
      expect(
        CorrectAccountSemanticsRequest.safeParse(invalidRequest).success,
      ).toBe(false);
    }

    for (const validRequest of [
      { nature: "liability" },
      { currency: "CNY" },
      { nature: "asset", currency: "USD" },
    ]) {
      expect(CorrectAccountSemanticsRequest.parse(validRequest)).toEqual(
        validRequest,
      );
    }
  });

  it("keeps the complete Account PATCH no-op branch authoritative", () => {
    expect(UpdateFinanceAccountBody.parse({})).toEqual({});
  });

  it("keeps unrelated request bodies valid and strict", () => {
    const createUserRequest = {
      displayName: "Ada Lovelace",
      username: "ada",
      email: "ada@example.com",
      identityIssuer: "https://identity.example.com",
      identitySubject: "user-123",
    };
    const updateUserRequest = { displayName: null };

    expect(CreateUserRequest.parse(createUserRequest)).toEqual(
      createUserRequest,
    );
    expect(UpdateUserRequest.parse(updateUserRequest)).toEqual(
      updateUserRequest,
    );
    expect(
      CreateUserRequest.safeParse({ ...createUserRequest, unexpected: true })
        .success,
    ).toBe(false);
    expect(
      UpdateUserRequest.safeParse({ ...updateUserRequest, unexpected: true })
        .success,
    ).toBe(false);
  });

  it("contains the complete Finance v1 operation surface", () => {
    expect(
      financeOperations.map(({ operationId }) => operationId).sort(),
    ).toEqual(financeOperationIds);
  });

  it("exposes generated Fetch, Query, MSW, and Faker surfaces", async () => {
    server.use(getListFinanceCurrenciesMockHandler());

    const response = await listFinanceCurrencies();

    expect(response.status).toBe(200);
    expect(response.data.length).toBeGreaterThan(0);
    for (const currency of response.data) {
      expect(CurrencyResponse.parse(currency)).toEqual(currency);
    }
    expect(getListFinanceCurrenciesQueryKey()).toEqual([
      "http://localhost/api/finance/currencies",
    ]);
    expect(useListFinanceCurrencies).toBeTypeOf("function");
    for (const fixture of getFinanceCurrenciesFixture()) {
      expect(CurrencyResponse.parse(fixture)).toEqual(fixture);
    }
  });

  it("generates Finance fixtures that satisfy their runtime schemas", () => {
    const accounts = getFinanceAccountsFixture();
    for (const account of accounts) {
      expect(AccountResponse.parse(account)).toEqual(account);
    }
    const overview = getFinanceOverviewFixture();
    const history = getFinanceTransactionsFixture();
    const createAdjustment = getCreateAdjustmentFixture();
    const replaceAdjustment = getReplaceAdjustmentFixture();

    expect(FinanceOverviewResponse.parse(overview)).toEqual(overview);
    expect(TransactionHistoryPageResponse.parse(history)).toEqual(history);
    expect(BalanceAdjustmentResultResponse.parse(createAdjustment)).toEqual(
      createAdjustment,
    );
    expect(
      ReplaceBalanceAdjustmentResultResponse.parse(replaceAdjustment),
    ).toEqual(replaceAdjustment);
    for (const fixture of [
      accounts,
      overview,
      history,
      createAdjustment,
      replaceAdjustment,
    ]) {
      expectExactMoneyStrings(fixture);
    }
  });

  it("preserves exact decimal-string Money without numeric coercion", () => {
    const money = MoneyResponse.parse({
      amount: "9007199254740993.01",
      currency: "CNY",
    });

    expect(money.amount).toBe("9007199254740993.01");
    expect(
      MoneyResponse.safeParse({ amount: 9007199254740994, currency: "CNY" })
        .success,
    ).toBe(false);
  });

  it("keeps transaction variants discriminated and archived references valid", () => {
    const transactions = [
      {
        ...commonTransaction,
        kind: "income",
        account: archivedAccount,
        economicAmount: { amount: "12.34", currency: "CNY" },
        categoryAllocations: [categoryAllocation],
      },
      {
        ...commonTransaction,
        kind: "expense",
        account: archivedAccount,
        economicAmount: { amount: "12.34", currency: "CNY" },
        categoryAllocations: [categoryAllocation],
      },
      {
        ...commonTransaction,
        kind: "internalTransfer",
        sourceAccount: archivedAccount,
        sourceAmount: { amount: "12.34", currency: "CNY" },
        destinationAccount: {
          ...archivedAccount,
          id: "55555555-5555-4555-8555-555555555555",
        },
        destinationAmount: { amount: "12.34", currency: "CNY" },
      },
      adjustment,
    ].map((transaction) => FinanceTransactionResponse.parse(transaction));

    expect(transactions.map(({ kind }) => kind)).toEqual([
      "income",
      "expense",
      "internalTransfer",
      "balanceAdjustment",
    ]);
    expect(AccountReferenceResponse.parse(archivedAccount).status).toBe(
      "archived",
    );
    expect(
      FinanceTransactionResponse.safeParse({
        ...transactions[1],
        kind: "internalTransfer",
      }).success,
    ).toBe(false);
  });

  it("keeps history cursors opaque and nullable", () => {
    const cursor = "opaque:v1/+==?filter-state";

    expect(
      TransactionHistoryPageResponse.parse({ items: [], nextCursor: cursor })
        .nextCursor,
    ).toBe(cursor);
    expect(
      TransactionHistoryPageResponse.parse({ items: [], nextCursor: null })
        .nextCursor,
    ).toBeNull();
  });

  it("keeps Balance Adjustment outcomes discriminated", () => {
    expect(
      BalanceAdjustmentResultResponse.parse({
        outcome: "created",
        transaction: adjustment,
      }).outcome,
    ).toBe("created");
    expect(
      BalanceAdjustmentResultResponse.parse({
        outcome: "noChange",
        transaction: null,
      }).outcome,
    ).toBe("noChange");
    expect(
      ReplaceBalanceAdjustmentResultResponse.parse({
        outcome: "updated",
        transaction: adjustment,
      }).outcome,
    ).toBe("updated");
    expect(
      ReplaceBalanceAdjustmentResultResponse.parse({
        outcome: "removed",
        transaction: null,
      }).outcome,
    ).toBe("removed");
  });

  it("keeps every declared Finance error on the Problem Details boundary", () => {
    const errorResponses = financeOperations.flatMap(({ responses = {} }) =>
      Object.entries(responses).filter(([status]) => !status.startsWith("2")),
    );

    expect(errorResponses.length).toBeGreaterThan(0);
    for (const [, response] of errorResponses) {
      expect(Object.keys(response.content ?? {})).toEqual([
        "application/problem+json",
      ]);
      expect(response.content?.["application/problem+json"]?.schema?.$ref).toBe(
        "#/components/schemas/ProblemDetails",
      );
    }
  });

  it("preserves stable Finance conflict codes as exact strings", () => {
    expect(
      financeConflictCodes.map(
        (code) =>
          ProblemDetails.parse({
            type: "about:blank",
            title: "Conflict",
            status: 409,
            code,
          }).code,
      ),
    ).toEqual(financeConflictCodes);
  });
});
