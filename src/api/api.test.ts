import { describe, expect, it } from "vitest";

import { getGetHelloWorldResponseMock as getHelloWorldResponseFactory } from "@/api/generated/core-console.faker";
import {
  getGetHelloWorldMockHandler500,
  getGetHelloWorldResponseMock500,
} from "@/api/generated/core-console.msw";
import { getHelloWorld } from "@/api/generated/core-console";
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
});
