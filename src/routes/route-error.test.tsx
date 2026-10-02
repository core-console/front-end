import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it } from "vitest";

import { RouteErrorBoundary } from "@/routes/route-error";
import { HomePage } from "@/routes/home";
import { RouteHydrateFallback } from "@/routes/root";

it.each([
  {
    error: new Response(null, { status: 403, statusText: "Forbidden" }),
    title: "403 请求失败",
    description: "无法完成此操作，请稍后重试。",
  },
  {
    error: new Error("Internal error details"),
    title: "应用出错",
    description: "应用发生意外错误，请刷新页面重试。",
  },
  {
    error: "Unknown internal error",
    title: "未知错误",
    description: "应用发生未知错误，请刷新页面重试。",
  },
])(
  "shows localized route feedback: $title",
  async ({ error, title, description }) => {
    const router = createMemoryRouter([
      {
        path: "/",
        Component: HomePage,
        HydrateFallback: RouteHydrateFallback,
        ErrorBoundary: RouteErrorBoundary,
        loader: () => {
          throw error;
        },
      },
    ]);

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByText(description)).toBeVisible();
    expect(screen.getByRole("link", { name: "返回 Home" })).toHaveAttribute(
      "href",
      "/",
    );
  },
);
