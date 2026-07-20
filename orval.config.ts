import { defineConfig } from "orval";

const generatedDirectory =
  process.env.ORVAL_OUTPUT_DIR ?? "./src/api/generated";

export default defineConfig({
  coreConsole: {
    input: {
      target: "./openapi/openapi.yaml",
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
