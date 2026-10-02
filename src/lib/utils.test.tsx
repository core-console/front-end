import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { cn } from "@/lib/utils";

describe("class composition", () => {
  it("joins nested arrays and conditional objects before resolving conflicts", () => {
    expect(
      cn(
        "px-4",
        ["py-2", [false, null, undefined, "px-2"]],
        { "bg-accent": true, "hover:bg-muted/40": false },
        "",
      ),
    ).toBe("py-2 px-2 bg-accent");
  });

  it.each([
    ["px-4 py-2", "p-3", "p-3"],
    ["p-3", "px-4", "p-3 px-4"],
    ["sm:max-w-sm", "sm:max-w-md", "sm:max-w-md"],
    [
      "[&_svg]:shrink-0 [&_svg]:size-4",
      "[&_svg]:size-3",
      "[&_svg]:shrink-0 [&_svg]:size-3",
    ],
  ])("preserves override order for %s and %s", (base, override, expected) => {
    expect(cn(base, override)).toBe(expected);
  });

  it("lets caller classes override Button variants without losing state modifiers", () => {
    render(
      <Button variant="outline" size="sm" className="h-8 px-4 text-sm">
        Save changes
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save changes" });
    expect(button).toHaveClass(
      "h-8",
      "px-4",
      "text-sm",
      "border-border",
      "bg-background",
      "hover:bg-muted",
      "aria-invalid:border-destructive",
      "[&_svg:not([class*='size-'])]:size-3.5",
    );
    expect(button).not.toHaveClass("h-7");
    expect(button).not.toHaveClass("px-2.5");
    expect(button).not.toHaveClass("text-[0.8rem]");
  });

  it.each(["vertical", "horizontal", "responsive"] as const)(
    "preserves %s Field variants while merging caller spacing",
    (orientation) => {
      render(
        <Field
          aria-label="Account details"
          orientation={orientation}
          className="gap-3"
          data-invalid
        />,
      );

      const field = screen.getByRole("group", { name: "Account details" });
      expect(field).toHaveClass(
        "gap-3",
        "data-[invalid=true]:text-destructive",
        orientation === "horizontal" ? "flex-row" : "flex-col",
      );
      expect(field).not.toHaveClass("gap-2");
      if (orientation === "responsive") {
        expect(field).toHaveClass("@md/field-group:flex-row");
      }
    },
  );

  it("preserves the Finance dialog width override alongside base and state classes", async () => {
    render(
      <Dialog open>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogTitle>Create account</DialogTitle>
          <DialogDescription>Record the opening balance.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Create account",
    });
    expect(dialog).toHaveClass(
      "max-w-[calc(100%-2rem)]",
      "sm:max-w-md",
      "max-h-[calc(100svh-2rem)]",
      "overflow-y-auto",
      "data-open:animate-in",
      "data-closed:animate-out",
    );
    expect(dialog).not.toHaveClass("sm:max-w-sm");
  });
});
