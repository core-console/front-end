import { defineConfig } from "orval";

const generatedDirectory =
  process.env.ORVAL_OUTPUT_DIR ?? "./src/api/generated";

export default defineConfig({
  coreConsole: {
    input: {
      target: "./openapi/openapi.json",
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
            response: true,
          },
        },
      },
    },
  },
});
