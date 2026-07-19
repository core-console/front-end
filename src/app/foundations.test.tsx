import { useQueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderRoute, renderWithProviders } from "@/test/render";

describe("application foundations", () => {
  it("renders the home route", async () => {
    renderRoute("/");

    expect(
      await screen.findByRole("heading", { name: "Application foundation" }),
    ).toBeInTheDocument();
  });

  it("renders the not-found route for an unknown path", async () => {
    renderRoute("/missing-page");

    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
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
