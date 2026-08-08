import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import "@/index.css";

const renderStartupFailure = (root: HTMLElement, error: unknown) => {
  console.error("Failed to initialize application", error);

  root.setAttribute("role", "alert");
  root.textContent = "The application could not be started.";
};

export async function bootstrapApplication() {
  const root = document.getElementById("root")!;

  try {
    const { env } = await import("@/config/env");

    if (import.meta.env.DEV && env.VITE_ENABLE_API_MOCKING) {
      const { startBrowserMocking } = await import("@/mocks/browser");
      await startBrowserMocking();
    }

    const [{ AppProviders }, { reportRouterError, router }] = await Promise.all(
      [import("@/app/providers"), import("@/app/router")],
    );

    createRoot(root).render(
      <StrictMode>
        <AppProviders>
          <RouterProvider onError={reportRouterError} router={router} />
        </AppProviders>
      </StrictMode>,
    );
  } catch (error) {
    renderStartupFailure(root, error);
  }
}
