import { it, expect } from "vitest";
import type { RequestHandler } from "msw";
import type { ZodType } from "zod";

import openApi from "../../openapi/openapi.json";
import * as fakerFixtures from "@/api/generated/core-console.faker";
import * as mswFixtures from "@/api/generated/core-console.msw";
import * as schemas from "@/api/generated/schemas";
import { server } from "@/mocks/server";
import { seedMockData } from "@/mocks/seed";

type ResponseSchema = {
  $ref?: string;
  type?: string;
  items?: { $ref: string };
};
type Operation = {
  operationId: string;
  responses: Record<
    string,
    { content?: Record<string, { schema: ResponseSchema }> }
  >;
};

const cases = Object.entries(openApi.paths).flatMap(([path, pathItem]) =>
  Object.entries(pathItem).flatMap(([method, value]) => {
    const operation = value as Operation;
    return Object.entries(operation.responses).map(([status, response]) => ({
      path,
      method,
      operationId: operation.operationId,
      status: Number(status),
      media: Object.entries(response.content ?? {})[0],
    }));
  }),
);

// Names are derived from the unchanged snapshot and Orval's public exports.
const factories = fakerFixtures as unknown as Record<string, () => unknown>;
const handlers = mswFixtures as unknown as Record<string, () => RequestHandler>;
const responseSchemas = schemas as unknown as Record<string, ZodType>;

it.each(cases)(
  "keeps $operationId $status fixtures deterministic, schema-valid, and correctly served",
  async ({ path, method, operationId, status, media }) => {
    const name = operationId[0]!.toUpperCase() + operationId.slice(1);
    const factory = factories[`get${name}ResponseMock${status}`];
    const handler = handlers[`get${name}MockHandler${status}`];
    expect(handler).toBeTypeOf("function");

    let fixture: unknown;
    if (media) {
      expect(factory).toBeTypeOf("function");
      seedMockData();
      fixture = factory!();
      seedMockData();
      expect(factory!()).toEqual(fixture);
      const schema = media[1].schema;
      const reference =
        schema.type === "array" ? schema.items!.$ref : schema.$ref!;
      const validator = responseSchemas[reference.split("/").at(-1)!]!;
      if (schema.type === "array") {
        expect(Array.isArray(fixture)).toBe(true);
        for (const item of fixture as unknown[]) {
          expect(validator.parse(item)).toEqual(item);
        }
      } else {
        expect(validator.parse(fixture)).toEqual(fixture);
      }
    }

    server.use(handler!());
    seedMockData();
    const response = await fetch(
      `http://localhost/api${path.replace(/\{[^}]+\}/g, "11111111-1111-4111-8111-111111111111")}`,
      { method: method.toUpperCase() },
    );
    expect(response.status).toBe(status);
    if (media) {
      expect(response.headers.get("Content-Type")).toBe(media[0]);
      expect(await response.json()).toEqual(fixture);
    } else {
      expect(await response.text()).toBe("");
    }
  },
);
