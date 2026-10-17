import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getGetCurrentUserMockHandler,
  getListFinanceLedgersMockHandler,
  getListFinanceParticipantsMockHandler,
  getCreateFinanceParticipantMockHandler,
  getGetFinanceParticipantMockHandler,
  getRenameFinanceParticipantMockHandler,
  getRenameFinanceParticipantMockHandler422,
  getArchiveFinanceParticipantMockHandler,
  getListFinanceParticipantsMockHandler503,
  getGetFinanceParticipantMockHandler404,
} from "@/api/generated/core-console.msw";
import type { ParticipantResponse } from "@/api/generated/schemas";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import { submissionTestUser } from "@/test/submission-fixtures";

const ledger = { id: "11111111-1111-4111-8111-111111111111", name: "Personal" };
const participant: ParticipantResponse = {
  id: "22222222-2222-4222-8222-222222222222",
  ledgerId: ledger.id,
  name: "Alex",
  status: "active",
};
const archived: ParticipantResponse = {
  ...participant,
  id: "33333333-3333-4333-8333-333333333333",
  status: "archived",
};

beforeEach(() =>
  server.use(
    getGetCurrentUserMockHandler(submissionTestUser),
    getListFinanceLedgersMockHandler([ledger]),
  ),
);

describe("Finance Participants", () => {
  it("focuses a rejected rename field and permits correction without replacing identity", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceParticipantsMockHandler([archived]),
      getGetFinanceParticipantMockHandler(archived),
      getRenameFinanceParticipantMockHandler422({
        type: "about:blank",
        title: "Validation error",
        status: 422,
        code: "validation_error",
      }),
    );
    renderRoute(`/finance/participants?ledger=${ledger.id}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Inspect Alex" },
        { timeout: 5000 },
      ),
    );
    await user.click(
      await screen.findByRole("button", { name: "Rename participant" }),
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    await user.clear(input);
    await user.type(input, "Rejected");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(
      await screen.findByText("Enter a Participant name of 1–100 characters."),
    ).toBeVisible();
    expect(input).toHaveFocus();
    server.use(
      getRenameFinanceParticipantMockHandler({
        ...archived,
        name: "Corrected",
      }),
    );
    await user.clear(input);
    await user.type(input, "Corrected");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    const detail = await screen.findByRole("dialog", {
      name: "Participant details",
    });
    expect(await within(detail).findByText("Corrected renamed.")).toBeVisible();
    expect(within(detail).getByText(archived.id)).toBeVisible();
    expect(within(detail).getByText("Archived")).toBeVisible();
  });
  it("blocks a second create after navigating away and back while the first is pending", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    server.use(
      getListFinanceParticipantsMockHandler([]),
      getCreateFinanceParticipantMockHandler(async () => {
        started = true;
        await pending;
        return participant;
      }),
    );
    const { router } = renderRoute(`/finance/participants?ledger=${ledger.id}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create participant" },
        { timeout: 5000 },
      ),
    );
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Alex");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Create participant",
      }),
    );
    await waitFor(() => expect(started).toBe(true));
    await act(() => router.navigate("/"));
    await act(() =>
      router.navigate(`/finance/participants?ledger=${ledger.id}`),
    );
    expect(
      await screen.findByRole("button", { name: "Create participant" }),
    ).toBeDisabled();
    await act(async () => {
      release();
      await pending;
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create participant" }),
      ).toBeEnabled(),
    );
  });
  it("does not replay an uncertain create and refreshes to inspect the possibly created identity", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    server.use(
      getListFinanceParticipantsMockHandler([]),
      http.post("*/api/finance/ledgers/:ledgerId/participants", () => {
        attempts += 1;
        server.use(getListFinanceParticipantsMockHandler([participant]));
        return HttpResponse.error();
      }),
    );
    renderRoute(`/finance/participants?ledger=${ledger.id}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create participant" },
        { timeout: 5000 },
      ),
    );
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Alex");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Create participant",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The create outcome is unknown",
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Create participant",
      }),
    ).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(attempts).toBe(1);
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Refresh Participants" }),
    );
    expect(
      await screen.findByRole("button", { name: "Inspect Alex" }),
    ).toBeVisible();
    expect(attempts).toBe(1);
  });

  it("keeps a confirmed create visible when the list refresh fails", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceParticipantsMockHandler([]),
      getCreateFinanceParticipantMockHandler(() => {
        server.use(getListFinanceParticipantsMockHandler503());
        return participant;
      }),
    );
    renderRoute(`/finance/participants?ledger=${ledger.id}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create participant" },
        { timeout: 5000 },
      ),
    );
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Alex");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Create participant",
      }),
    );
    expect(await screen.findByText("Alex created.")).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Participants could not be loaded",
    );
    expect(screen.getByRole("button", { name: "Inspect Alex" })).toBeVisible();
  });

  it("rejects blank and oversized names before sending and keeps the field focused", async () => {
    const user = userEvent.setup();
    server.use(getListFinanceParticipantsMockHandler([]));
    renderRoute(`/finance/participants?ledger=${ledger.id}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create participant" },
        { timeout: 5000 },
      ),
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    const submit = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Create participant",
    });
    await user.type(input, "   ");
    await user.click(submit);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-invalid", "true");
    await user.clear(input);
    await user.type(input, "x".repeat(101));
    await user.click(submit);
    expect(input).toHaveFocus();
    expect(
      await screen.findByText("Enter a Participant name of 1–100 characters."),
    ).toBeVisible();
  });

  it("does not expose actions for a Participant that is unavailable in the addressed Ledger", async () => {
    const user = userEvent.setup();
    server.use(
      getListFinanceParticipantsMockHandler([participant]),
      getGetFinanceParticipantMockHandler404({
        type: "about:blank",
        title: "Not found",
        status: 404,
        code: "finance_participant_not_found",
        detail: "Not found",
      }),
    );
    renderRoute(`/finance/participants?ledger=${ledger.id}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Inspect Alex" },
        { timeout: 5000 },
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This Participant is no longer available in this Ledger",
    );
    expect(
      screen.queryByRole("button", { name: "Rename participant" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive participant" }),
    ).not.toBeInTheDocument();
  });

  it("closes the old workflow on Ledger navigation and never leaks old records into the new Ledger", async () => {
    const user = userEvent.setup();
    const other = { id: "66666666-6666-4666-8666-666666666666", name: "Other" };
    server.use(
      getListFinanceLedgersMockHandler([ledger, other]),
      getListFinanceParticipantsMockHandler(({ params }) =>
        params.ledgerId === ledger.id ? [participant] : [],
      ),
    );
    const { router } = renderRoute(`/finance/participants?ledger=${ledger.id}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create participant" },
        { timeout: 5000 },
      ),
    );
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Draft");
    await act(() =>
      router.navigate(`/finance/participants?ledger=${other.id}`),
    );
    expect(await screen.findByText("No Participants yet")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Create participant" }),
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
  });
  it("inspects, renames and archives the same UUID and can still inspect and rename it", async () => {
    const user = userEvent.setup();
    let current = participant;
    const publish = () =>
      server.use(
        getListFinanceParticipantsMockHandler([current]),
        getGetFinanceParticipantMockHandler(current),
      );
    publish();
    server.use(
      getRenameFinanceParticipantMockHandler(async ({ request, params }) => {
        expect(params.participantId).toBe(participant.id);
        const data = (await request.json()) as { name: string };
        current = { ...current, name: data.name };
        publish();
        return current;
      }),
      getArchiveFinanceParticipantMockHandler(({ params }) => {
        expect(params.participantId).toBe(participant.id);
        current = { ...current, status: "archived" };
        publish();
        return current;
      }),
    );
    renderRoute(`/finance/participants?ledger=${ledger.id}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Inspect Alex" },
        { timeout: 5000 },
      ),
    );
    let detail = await screen.findByRole("dialog", {
      name: "Participant details",
    });
    expect(await within(detail).findByText(participant.id)).toBeVisible();
    await user.click(
      within(detail).getByRole("button", { name: "Rename participant" }),
    );
    const nameInput = screen.getByRole("textbox", { name: "Name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Alex Chen");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(await within(detail).findByText("Alex Chen renamed.")).toBeVisible();
    detail = await screen.findByRole("dialog", { name: "Participant details" });
    await user.click(
      within(detail).getByRole("button", { name: "Archive participant" }),
    );
    const confirmation = screen.getByRole("alertdialog", {
      name: "Archive Participant?",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "Archive participant" }),
    );
    expect(await within(detail).findByText("Archived")).toBeVisible();
    expect(within(detail).getByText(participant.id)).toBeVisible();
    expect(
      within(detail).queryByRole("button", { name: "Archive participant" }),
    ).not.toBeInTheDocument();
    expect(
      within(detail).getByRole("button", { name: "Rename participant" }),
    ).toBeEnabled();
    await user.click(
      within(detail).getByRole("button", { name: "Close details" }),
    );
    expect(
      await screen.findByRole("button", { name: "Inspect Alex Chen" }),
    ).toHaveFocus();
  });
  it("creates a trimmed name through the selected Ledger and shows the confirmed identity", async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      getListFinanceParticipantsMockHandler([]),
      getCreateFinanceParticipantMockHandler(async ({ request, params }) => {
        expect(params.ledgerId).toBe(ledger.id);
        body = await request.json();
        server.use(getListFinanceParticipantsMockHandler([participant]));
        return participant;
      }),
    );
    renderRoute(`/finance/participants?ledger=${ledger.id}`);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Create participant" },
        { timeout: 5000 },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Create Participant" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "  Alex  ",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create participant" }),
    );
    expect(await screen.findByText("Alex created.")).toBeVisible();
    expect(body).toEqual({ name: "Alex" });
    expect(
      await screen.findByRole("button", { name: "Inspect Alex" }),
    ).toBeVisible();
  });
  it("integrates Ledger-local Participants and preserves archived and duplicate identities", async () => {
    server.use(getListFinanceParticipantsMockHandler([participant, archived]));
    renderRoute(`/finance/participants?ledger=${ledger.id}`);
    expect(
      await screen.findByRole(
        "heading",
        { name: "Participants", level: 1 },
        { timeout: 5000 },
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Participants" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const table = await screen.findByRole("table", { name: "Participants" });
    expect(within(table).getByText("Active")).toBeVisible();
    expect(within(table).getByText("Archived")).toBeVisible();
    expect(
      within(table).getByRole("button", {
        name: `Inspect Alex, Participant ID ${participant.id}`,
      }),
    ).toBeVisible();
    expect(
      within(table).getByRole("button", {
        name: `Inspect Alex, Participant ID ${archived.id}`,
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /delete|unarchive/i }),
    ).not.toBeInTheDocument();
  });
});
