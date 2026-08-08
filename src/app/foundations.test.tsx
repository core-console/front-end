import { useQueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

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
    expect(
      screen.queryByRole("link", { name: "Users" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Settings" }),
    ).not.toBeInTheDocument();
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
