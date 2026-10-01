import { describe, expect, it } from "vitest";
import { delay, http, HttpResponse } from "msw";

import {
  getGetHelloWorldResponseMock as getHelloWorldResponseFactory,
  getUpdateFinanceAccountResponseMock,
} from "@/api/generated/core-console.faker";
import {
  getGetHelloWorldMockHandler500,
  getGetHelloWorldResponseMock500,
} from "@/api/generated/core-console.msw";
import {
  getHelloWorld,
  getListFinanceTransactionsUrl,
  listFinanceCurrencies,
  updateFinanceAccount,
} from "@/api/generated/core-console";
import { HelloWorldResponse, ProblemDetails } from "@/api/generated/schemas";
import { server } from "@/mocks/server";

describe("generated API boundary", () => {
  it("intercepts the generated client and validates the success response", async () => {
    const response = await getHelloWorld();
    const data = HelloWorldResponse.parse(response.data);

    expect(response.status).toBe(200);
    expect(data).toEqual(getHelloWorldResponseFactory());
  });

  it("supports a test-local Problem Details response", async () => {
    server.use(getGetHelloWorldMockHandler500());

    try {
      await getHelloWorld();
      expect.unreachable(
        "Expected the generated client to reject a 500 response",
      );
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);

      if (!(error instanceof Error)) {
        expect.unreachable("Expected the generated client to throw an Error");
      }

      const problem = ProblemDetails.parse(
        "info" in error ? error.info : undefined,
      );

      expect("status" in error ? error.status : undefined).toBe(500);
      expect(problem).toEqual(getGetHelloWorldResponseMock500());
    }
  });

  it("rejects unhandled API requests instead of reaching the network", async () => {
    await expect(fetch("http://localhost/api/unhandled")).rejects.toThrow();
  });

  it("preserves unknown JSON errors and malformed error-body rejection", async () => {
    const unknownProblem = { message: "upstream unavailable" };
    server.use(
      http.get("*/api/finance/currencies", () =>
        HttpResponse.json(unknownProblem, { status: 502 }),
      ),
    );
    await expect(listFinanceCurrencies()).rejects.toMatchObject({
      status: 502,
      info: unknownProblem,
    });

    server.use(
      http.get("*/api/finance/currencies", () =>
        HttpResponse.text("upstream unavailable", { status: 502 }),
      ),
    );
    await expect(listFinanceCurrencies()).rejects.toBeInstanceOf(SyntaxError);
  });

  it("passes cancellation through the generated Fetch client", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    server.use(
      http.get("*/api/finance/currencies", async () => {
        started();
        await delay("infinite");
        return HttpResponse.json([]);
      }),
    );
    const response = listFinanceCurrencies({ signal: controller.signal });
    const rejection = expect(response).rejects.toMatchObject({
      name: "AbortError",
    });
    await requestStarted;
    controller.abort();
    await rejection;
  });

  it.each([
    { headers: undefined, contentType: "application/json" },
    {
      headers: { "X-Contract-Test": "preserved" },
      contentType: "application/json",
    },
    {
      headers: new Headers({
        "Content-Type": "application/json",
        "X-Contract-Test": "preserved",
      }),
      contentType: "application/json",
    },
    {
      headers: [
        ["content-type", "application/json"],
        ["X-Contract-Test", "preserved"],
      ] as [string, string][],
      contentType: "application/json",
    },
    {
      headers: {
        "cOnTeNt-TyPe": "application/json; charset=utf-8",
        "X-Contract-Test": "preserved",
      },
      contentType: "application/json; charset=utf-8",
    },
  ])(
    "serializes semantic correction with RequestInit headers %j",
    async ({ headers, contentType }) => {
      let receivedBody: unknown;
      let receivedHeaders: Headers | undefined;
      server.use(
        http.patch(
          "*/api/finance/ledgers/:ledgerId/accounts/:accountId",
          async ({ request }) => {
            receivedBody = await request.json();
            receivedHeaders = request.headers;
            return HttpResponse.json(getUpdateFinanceAccountResponseMock());
          },
        ),
      );
      await updateFinanceAccount(
        "ledger",
        "account",
        { nature: "liability" },
        headers ? { headers } : undefined,
      );
      expect(receivedBody).toEqual({ nature: "liability" });
      expect(receivedHeaders?.get("Content-Type")).toBe(contentType);
      if (headers) {
        expect(receivedHeaders?.get("X-Contract-Test")).toBe("preserved");
      }
    },
  );

  it("round-trips an opaque cursor through generated URL encoding", () => {
    const cursor = "opaque:v1/+==?filter-state&ledger=other";
    const url = new URL(getListFinanceTransactionsUrl("ledger", { cursor }));
    expect(url.searchParams.get("cursor")).toBe(cursor);
    expect([...url.searchParams.keys()]).toEqual(["cursor"]);
  });
});
