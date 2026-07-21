import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import { AppProviders } from "@/app/providers";
import { reportRouterError, router } from "@/app/router";
import { env } from "@/config/env";

import "./index.css";

const enableApiMocking = async () => {
  if (!import.meta.env.DEV || !env.VITE_ENABLE_API_MOCKING) {
    return;
  }

  const { startBrowserMocking } = await import("@/mocks/browser");
  await startBrowserMocking();
};

const renderApplication = () => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppProviders>
        <RouterProvider onError={reportRouterError} router={router} />
      </AppProviders>
    </StrictMode>,
  );
};

void enableApiMocking().then(renderApplication);
