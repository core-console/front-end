import { createBrowserRouter, type RouteObject } from "react-router";

import { Root, RouteHydrateFallback } from "@/routes/root";
import { RouteErrorBoundary } from "@/routes/route-error";

export const routes = [
  {
    path: "/",
    Component: Root,
    ErrorBoundary: RouteErrorBoundary,
    HydrateFallback: RouteHydrateFallback,
    children: [
      {
        index: true,
        lazy: () => import("@/routes/home"),
      },
      {
        path: "users",
        lazy: () => import("@/routes/users"),
      },
      {
        path: "*",
        lazy: () => import("@/routes/not-found"),
      },
    ],
  },
] satisfies RouteObject[];

export const router = createBrowserRouter(routes);

export function reportRouterError(error: unknown) {
  console.error("Unhandled route error", error);
}
