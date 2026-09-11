import { describe, expect, it } from "vitest";

import { expandRequiredOnlyAnyOfBranches } from "./expand-required-only-any-of.mjs";

describe("expandRequiredOnlyAnyOfBranches", () => {
  it("expands required-only anyOf branches with their parent object structure", () => {
    const schema = {
      type: "object",
      properties: {
        alpha: { type: "string" },
        beta: { type: "integer" },
      },
      additionalProperties: false,
      anyOf: [{ required: ["alpha"] }, { required: ["beta"] }],
    };

    expect(expandRequiredOnlyAnyOfBranches(schema)).toEqual({
      ...schema,
      anyOf: [
        {
          type: "object",
          properties: schema.properties,
          additionalProperties: false,
          required: ["alpha"],
        },
        {
          type: "object",
          properties: schema.properties,
          additionalProperties: false,
          required: ["beta"],
        },
      ],
    });
    expect(schema.anyOf).toEqual([
      { required: ["alpha"] },
      { required: ["beta"] },
    ]);
  });

  it("keeps properties evaluated by a sibling allOf valid", () => {
    const schema = {
      type: "object",
      properties: {
        base: { type: "string" },
      },
      allOf: [
        {
          properties: {
            extension: { type: "string" },
          },
        },
      ],
      anyOf: [{ required: ["base"] }],
      unevaluatedProperties: false,
    };
    const originallyValidObject = {
      base: "root property",
      extension: "sibling allOf property",
    };

    const transformed = expandRequiredOnlyAnyOfBranches(schema);

    expect(transformed).toEqual({
      ...schema,
      anyOf: [
        {
          type: "object",
          properties: schema.properties,
          required: ["base"],
        },
      ],
    });
    expect(transformed.unevaluatedProperties).toBe(false);
    expect(transformed.anyOf[0]).not.toHaveProperty("unevaluatedProperties");

    const parentEvaluatedProperties = new Set([
      ...Object.keys(transformed.properties),
      ...transformed.allOf.flatMap(({ properties }) => Object.keys(properties)),
    ]);
    expect(
      Object.keys(originallyValidObject).every((property) =>
        parentEvaluatedProperties.has(property),
      ),
    ).toBe(true);
  });

  it.each([
    {
      label: "non-object parent",
      schema: {
        type: "string",
        anyOf: [{ required: ["alpha"] }, { required: ["beta"] }],
      },
    },
    {
      label: "branch with another constraint",
      schema: {
        type: "object",
        properties: { alpha: { type: "string" } },
        anyOf: [{ required: ["alpha"], minProperties: 1 }],
      },
    },
    {
      label: "branch without a non-empty required list",
      schema: {
        type: "object",
        properties: { alpha: { type: "string" } },
        anyOf: [{ required: [] }],
      },
    },
  ])("leaves an unrelated $label unchanged", ({ schema }) => {
    expect(expandRequiredOnlyAnyOfBranches(schema)).toEqual(schema);
  });

  it("recurses through a complete OpenAPI document", () => {
    const unrelatedSchema = {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    };
    const document = {
      openapi: "3.1.0",
      info: { title: "Example", version: "1.0.0" },
      paths: {},
      components: {
        schemas: {
          Candidate: {
            type: "object",
            properties: { alpha: { type: "string" } },
            additionalProperties: false,
            anyOf: [{ required: ["alpha"] }],
          },
          Unrelated: unrelatedSchema,
        },
      },
    };

    const transformed = expandRequiredOnlyAnyOfBranches(document);

    expect(transformed.components.schemas.Candidate.anyOf[0]).toEqual({
      type: "object",
      properties: { alpha: { type: "string" } },
      additionalProperties: false,
      required: ["alpha"],
    });
    expect(transformed.components.schemas.Unrelated).toEqual(unrelatedSchema);
    expect(document.components.schemas.Candidate.anyOf[0]).toEqual({
      required: ["alpha"],
    });
  });
});
