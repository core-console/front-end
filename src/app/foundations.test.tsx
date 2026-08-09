import { useQueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  getGetCurrentUserMockHandler,
  getGetCurrentUserMockHandler503,
} from "@/api/generated/core-console.msw";
import { server } from "@/mocks/server";
import { renderRoute, renderWithProviders } from "@/test/render";

describe("application foundations", () => {
  it("renders the home route", async () => {
    renderRoute("/");

    expect(
      await screen.findByRole("heading", { name: "Home" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Core Console sidebar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Welcome to Core Console.")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute(
      "href",
      "/users",
    );
    expect(
      screen.queryByRole("link", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });

  it("renders the current-user identity in the app shell", async () => {
    server.use(
      getGetCurrentUserMockHandler({
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        id: "77ef6ca4-f45a-4e77-9a29-07c56191fbca",
        username: "ada",
      }),
    );

    renderRoute("/");

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada")).toBeInTheDocument();
  });

  it("keeps the app shell available when current-user loading fails", async () => {
    server.use(
      getGetCurrentUserMockHandler503({
        code: "database_unavailable",
        detail: "PostgreSQL is not available.",
        status: 503,
        title: "Service Unavailable",
        type: "about:blank",
      }),
    );

    renderRoute("/");

    expect(
      await screen.findByRole("heading", { name: "Home" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Account unavailable")).toBeInTheDocument();
  });

  it("toggles between expanded and collapsed desktop navigation", async () => {
    const user = userEvent.setup();
    renderRoute("/");

    const collapseButton = await screen.findByRole("button", {
      name: "Collapse sidebar",
    });

    await user.click(collapseButton);

    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Core Console")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Core Console")).toBeInTheDocument();
  });

  it("renders the not-found route for an unknown path", async () => {
    renderRoute("/missing-page");

    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("provides an isolated query client", () => {
    function QueryConsumer() {
      useQueryClient();
      return <p>Query client ready</p>;
    }

    renderWithProviders(<QueryConsumer />);

    expect(screen.getByText("Query client ready")).toBeInTheDocument();
  });
});
