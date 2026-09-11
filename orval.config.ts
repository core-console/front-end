import { defineConfig } from "orval";

const generatedDirectory =
  process.env.ORVAL_OUTPUT_DIR ?? "./src/api/generated";
const financeCurrency = "CNY";
const financeMoneyAmount = "12.34";

export default defineConfig({
  coreConsole: {
    input: {
      target: "./openapi/openapi.json",
      override: {
        transformer: "./scripts/expand-required-only-any-of.mjs",
      },
    },
    output: {
      target: `${generatedDirectory}/core-console.ts`,
      schemas: {
        path: `${generatedDirectory}/schemas`,
        type: "zod",
      },
      client: "react-query",
      httpClient: "fetch",
      clean: true,
      formatter: "prettier",
      tsconfig: "./tsconfig.app.json",
      mock: {
        path: generatedDirectory,
        generators: [
          {
            type: "msw",
            baseUrl: "*/api",
            useExamples: true,
            generateEachHttpStatus: true,
          },
          {
            type: "faker",
            useExamples: true,
            generateEachHttpStatus: true,
          },
        ],
      },
      baseUrl: {
        runtime: "env.VITE_API_BASE_URL",
        imports: [{ name: "env", importPath: "../../config/env" }],
      },
      override: {
        // Keep contract-sensitive fixtures valid when Orval cannot infer them
        // from Zod enum objects or description/pattern-only string schemas.
        mock: {
          properties: {
            "/CurrencyCode/": financeCurrency,
            month: "2026-09",
          },
          schemas: {
            MoneyRequest: {
              properties: {
                amount: financeMoneyAmount,
              },
            },
            MoneyResponse: {
              properties: {
                amount: financeMoneyAmount,
              },
            },
          },
        },
        query: {
          version: 5,
          signal: true,
        },
        fetch: {
          forceSuccessResponse: true,
        },
        zod: {
          version: 4,
          variant: "classic",
          strict: {
            body: true,
            response: true,
          },
        },
      },
    },
  },
});
