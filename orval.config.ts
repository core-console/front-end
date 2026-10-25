import { defineConfig } from "orval";

const generatedDirectory =
  process.env.ORVAL_OUTPUT_DIR ?? "./src/api/generated";
const financeCurrency = "CNY";
const financeMoneyAmount = "12.34";
// Keep example currency literals narrow inside mixed Allocation array callbacks.
const settlementMockMoney = () =>
  Object.freeze({ amount: "12.34", currency: "CNY" });
const forgivenessMockKind = () => Object.freeze({ kind: "forgiveness" }).kind;

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
      headers: true,
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
            ForgivenessAllocationResponse: {
              properties: { kind: forgivenessMockKind },
            },
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
        operations: {
          previewFinanceSettlement: {
            mock: { properties: { "/MoneyResponse/": settlementMockMoney } },
          },
          getFinanceSettlement: {
            mock: { properties: { "/MoneyResponse/": settlementMockMoney } },
          },
          listFinanceParticipantSettlements: {
            mock: { properties: { "/MoneyResponse/": settlementMockMoney } },
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
