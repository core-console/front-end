import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { configDefaults } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", ".agent/**"],
    // Limit simultaneous jsdom route suites so short interaction waits remain reliable.
    maxWorkers: 2,
    // Full-route interactions can exceed Vitest's five-second default on Windows.
    testTimeout: 10_000,
    env: {
      VITE_API_BASE_URL: "http://localhost/api",
    },
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
