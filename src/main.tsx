import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import { AppProviders } from "@/app/providers";
import { reportRouterError, router } from "@/app/router";
import "@/config/env";

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider onError={reportRouterError} router={router} />
    </AppProviders>
  </StrictMode>,
);
