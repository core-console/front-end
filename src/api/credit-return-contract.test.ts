import { expect, it } from "vitest";
import openApi from "../../openapi/openapi.json";
import {
  CreateFinanceSettlementBody,
  PreviewFinanceSettlementBody,
  CreditReturnPreview,
  SettlementSource,
  FinanceSubmissionResponse,
} from "@/api/generated/schemas";
import {
  creditReturn,
  returnBody,
  returnPreview,
  returnReceipt,
} from "@/test/credit-return-fixtures";
import { creditApplication } from "@/test/credit-application-fixtures";

it("retains P's 37 paths and 46 operations with return through existing Settlement operations", () => {
  const operations = Object.values(openApi.paths).flatMap((path) =>
    Object.values(path).filter(
      (value) =>
        typeof value === "object" && value !== null && "operationId" in value,
    ),
  );
  expect(Object.keys(openApi.paths)).toHaveLength(37);
  expect(operations).toHaveLength(46);
  expect(new Set(operations.map((op) => op.operationId)).size).toBe(46);
  expect(operations.map((op) => op.operationId)).toEqual(
    expect.arrayContaining([
      "createFinanceSettlement",
      "previewFinanceSettlement",
      "getFinanceSettlement",
      "listFinanceParticipantSettlements",
      "getFinanceSubmission",
    ]),
  );
});

it("parses v8 preview, detail, nested history union and correlated receipt without debt allocations", () => {
  expect(CreateFinanceSettlementBody.parse(returnBody)).toEqual(returnBody);
  const { previewToken: _token, ...draft } = returnBody;
  expect(PreviewFinanceSettlementBody.parse(draft)).toEqual(draft);
  expect(CreditReturnPreview.parse(returnPreview)).toEqual(returnPreview);
  expect(SettlementSource.parse(creditReturn)).toEqual(creditReturn);
  expect(
    SettlementSource.array().parse([creditReturn, creditApplication]),
  ).toEqual([creditReturn, creditApplication]);
  expect(
    FinanceSubmissionResponse.parse({
      state: "terminal",
      receipt: returnReceipt(crypto.randomUUID()),
    }),
  ).toMatchObject({ receipt: { commandVersion: "8" } });
  expect(
    CreateFinanceSettlementBody.safeParse({
      ...returnBody,
      selectedObligationIds: [crypto.randomUUID()],
    }).success,
  ).toBe(false);
  expect(
    SettlementSource.safeParse({ ...creditReturn, allocations: [] }).success,
  ).toBe(false);
  expect(
    SettlementSource.safeParse({
      ...creditReturn,
      origins: [
        {
          ...creditReturn.origins[0],
          amount: { amount: "25", currency: "EUR" },
        },
      ],
    }).success,
  ).toBe(false);
});

it("preserves the three nested selected-Settlement request variants alongside v1–v8", () => {
  for (const disposition of [
    undefined,
    "retainCredit",
    "acceptIncome",
  ] as const) {
    const selected = {
      participantId: returnBody.participantId,
      receivingAccountId: returnBody.payingAccountId,
      transactionDate: returnBody.transactionDate,
      amount: returnBody.amount,
      selectedObligationIds: [crypto.randomUUID()],
      ...(disposition ? { excessDisposition: disposition } : {}),
      ...(disposition === "acceptIncome"
        ? {
            categoryAllocations: [
              { amount: { amount: "1", currency: "CNY" }, categoryId: null },
            ],
          }
        : {}),
    };
    expect(PreviewFinanceSettlementBody.parse(selected)).toEqual(selected);
    expect(
      CreateFinanceSettlementBody.parse({
        ...selected,
        previewToken: returnBody.previewToken,
      }),
    ).toEqual({ ...selected, previewToken: returnBody.previewToken });
  }
});
