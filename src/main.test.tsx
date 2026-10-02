import { screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("renders the startup fallback when environment configuration is invalid", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubEnv("VITE_ENABLE_API_MOCKING", "invalid");
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  await expect(import("@/main")).resolves.toBeDefined();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "应用无法启动，请刷新页面重试。",
  );
  expect(screen.getByRole("alert")).toHaveAttribute("lang", "zh-CN");
});
