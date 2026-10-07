import { expect, it, vi } from "vitest";

import openApi from "../../openapi/openapi.json";
import * as client from "@/api/generated/core-console";

type HeaderCase = {
  name: string;
  headers?: HeadersInit;
  contentType: string;
};

const headerCases: HeaderCase[] = [
  { name: "generated default", contentType: "application/json" },
  {
    name: "Headers override",
    headers: new Headers({
      "Content-Type": "application/json",
      "X-Contract-Test": "preserved",
    }),
    contentType: "application/json",
  },
  {
    name: "lowercase tuple override",
    headers: [
      ["content-type", "application/json"],
      ["X-Contract-Test", "preserved"],
    ],
    contentType: "application/json",
  },
  {
    name: "mixed-case object override",
    headers: {
      "cOnTeNt-TyPe": "application/json; charset=utf-8",
      "X-Contract-Test": "preserved",
    },
    contentType: "application/json; charset=utf-8",
  },
  {
    name: "repeated tuple casing uses the last value",
    headers: [
      ["Content-Type", "application/first"],
      ["CONTENT-TYPE", "application/json"],
      ["X-Contract-Test", "preserved"],
    ],
    contentType: "application/json",
  },
  {
    name: "repeated object casing uses the last value",
    headers: {
      "Content-Type": "application/first",
      "content-type": "application/json",
      "X-Contract-Test": "preserved",
    },
    contentType: "application/json",
  },
  ...[
    new Headers({ "X-Contract-Test": "preserved" }),
    [["X-Contract-Test", "preserved"]] as [string, string][],
    { "X-Contract-Test": "preserved" },
  ].map((headers, index) => ({
    name: `default with unrelated headers form ${index}`,
    headers,
    contentType: "application/json",
  })),
];

// Select every JSON request from the authoritative snapshot, so the regression
// exercises the shared Fetch emitter across Finance and Users mutations.
const jsonMutations = Object.entries(openApi.paths).flatMap(
  ([path, pathItem]) =>
    Object.values(pathItem).flatMap((operation) =>
      "requestBody" in operation &&
      "application/json" in operation.requestBody.content
        ? [{ operationId: operation.operationId, path }]
        : [],
    ),
);
const cases = jsonMutations.flatMap((operation) =>
  headerCases.map((headers) => ({ ...operation, ...headers })),
);
const requests = client as unknown as Record<
  string,
  (...args: unknown[]) => Promise<unknown>
>;

it.each(cases)(
  "$operationId emits one effective Content-Type: $name",
  async ({ operationId, path, headers, contentType }) => {
    // Capture RequestInit before Fetch/MSW can normalize or combine its fields.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));
    const pathArguments = [...path.matchAll(/\{[^}]+\}/g)].map(
      () => "11111111-1111-4111-8111-111111111111",
    );
    await requests[operationId]!(
      ...pathArguments,
      {},
      ...([
        "createFinanceLedger",
        "createFinanceAccount",
        "createFinanceCategory",
        "createFinanceTransaction",
        "createBalanceAdjustment",
      ].includes(operationId)
        ? [
            {
              "Idempotency-Key": "11111111-1111-4111-8111-111111111111",
              "Finance-Command-Version": "1",
              "Finance-Submission-Owner":
                "22222222-2222-4222-8222-222222222222",
            },
          ]
        : []),
      headers ? { headers } : undefined,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const options = fetchMock.mock.calls[0]![1]!;
    const emitted = new Headers(options.headers);
    const contentTypeNames: string[] = [];
    emitted.forEach((_, name) => {
      if (name.toLowerCase() === "content-type") contentTypeNames.push(name);
    });
    expect(contentTypeNames).toHaveLength(1);
    expect(emitted.get("Content-Type")).toBe(contentType);
    if (headers) expect(emitted.get("X-Contract-Test")).toBe("preserved");
  },
);
