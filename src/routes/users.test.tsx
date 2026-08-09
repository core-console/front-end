import { screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  getCreateUserMockHandler,
  getCreateUserMockHandler409,
  getDeactivateUserMockHandler,
  getDeactivateUserMockHandler409,
  getGetCurrentUserMockHandler,
  getListUsersMockHandler,
  getListUsersMockHandler503,
  getReactivateUserMockHandler,
  getUpdateUserMockHandler,
} from "@/api/generated/core-console.msw";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

describe("Users", () => {
  it("renders users returned by the management API", async () => {
    server.use(
      getListUsersMockHandler([
        {
          displayName: "Alice Smith",
          email: "alice@example.com",
          id: "a40a626a-99f1-4e81-940b-66f9e0d45c90",
          identityIssuer: "local-development",
          identitySubject: "alice",
          status: "active",
          username: "asmith",
        },
        {
          displayName: null,
          email: "bob@example.com",
          id: "b9aa59ad-aa6b-49f5-9f4c-8ed071ea3f74",
          identityIssuer: "local-development",
          identitySubject: "bob",
          status: "inactive",
          username: "bjones",
        },
      ]),
    );

    renderRoute("/users/");

    expect(
      await screen.findByRole("heading", { name: "Users" }),
    ).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText("Users")).toBeVisible();
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      await screen.findByRole("cell", { name: "Alice Smith" }),
    ).toBeVisible();
    expect(screen.getByRole("cell", { name: "asmith" })).toBeVisible();
    expect(
      screen.getByRole("cell", { name: "alice@example.com" }),
    ).toBeVisible();
    expect(screen.getByRole("cell", { name: "Active" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "Inactive" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "—" })).toBeVisible();
  });

  it("shows a safe list failure in the table area", async () => {
    server.use(
      getListUsersMockHandler503({
        code: "database_unavailable",
        detail: "Database host db.internal.example refused the connection.",
        status: 503,
        title: "Service Unavailable",
        type: "about:blank",
      }),
    );

    renderRoute("/users");

    expect(
      await screen.findByRole("cell", {
        name: "Core Console cannot reach the user database. Try again later.",
      }),
    ).toBeVisible();
    expect(screen.queryByText(/db\.internal/i)).not.toBeInTheDocument();
  });

  it("adds a user and refreshes the list", async () => {
    const user = userEvent.setup();
    const createdUser = {
      displayName: "Jane Doe",
      email: null,
      id: "cbdd6949-1e70-417e-a289-151dbbaacbb5",
      identityIssuer: "https://identity.example.com",
      identitySubject: "jane",
      status: "active" as const,
      username: null,
    };
    let users = [] as (typeof createdUser)[];

    server.use(
      getListUsersMockHandler(() => users),
      getCreateUserMockHandler(async ({ request }) => {
        expect(await request.json()).toEqual({
          displayName: "Jane Doe",
          email: null,
          identityIssuer: "https://identity.example.com",
          identitySubject: "jane",
          username: null,
        });
        users = [createdUser];
        return createdUser;
      }),
    );

    renderRoute("/users");

    await user.click(await screen.findByRole("button", { name: "Add user" }));
    const dialog = await screen.findByRole("dialog", { name: "Add user" });

    await user.type(within(dialog).getByLabelText("Display name"), "Jane Doe");
    await user.type(
      within(dialog).getByLabelText(/^Identity issuer/),
      "https://identity.example.com",
    );
    await user.type(within(dialog).getByLabelText(/^Identity subject/), "jane");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(await screen.findByRole("cell", { name: "Jane Doe" })).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Add user" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a create conflict in the dialog", async () => {
    const user = userEvent.setup();

    server.use(
      getListUsersMockHandler([]),
      getCreateUserMockHandler409({
        code: "user_conflict",
        detail: "Identity mapping already exists for an internal record.",
        status: 409,
        title: "Conflict",
        type: "about:blank",
      }),
    );

    renderRoute("/users");

    await user.click(await screen.findByRole("button", { name: "Add user" }));
    const dialog = await screen.findByRole("dialog", { name: "Add user" });
    await user.type(within(dialog).getByLabelText("Username"), "jdoe");
    await user.type(
      within(dialog).getByLabelText(/^Identity issuer/),
      "local-development",
    );
    await user.type(within(dialog).getByLabelText(/^Identity subject/), "jane");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(
      await within(dialog).findByText(
        "A user with this external identity already exists.",
      ),
    ).toBeVisible();
    expect(dialog).toBeVisible();
    expect(
      within(dialog).queryByText(/internal record/i),
    ).not.toBeInTheDocument();
  });

  it("edits only changed profile fields and keeps identity read-only", async () => {
    const user = userEvent.setup();
    const managedUser = {
      displayName: "Alice Smith" as string | null,
      email: "alice@example.com" as string | null,
      id: "a40a626a-99f1-4e81-940b-66f9e0d45c90",
      identityIssuer: "local-development",
      identitySubject: "alice",
      status: "active" as const,
      username: "asmith" as string | null,
    };

    server.use(
      getGetCurrentUserMockHandler({
        displayName: "Developer",
        email: "developer@example.com",
        id: "d62b8e16-6ab9-4d80-8ef0-4ccae1a63e75",
        username: "developer",
      }),
      getListUsersMockHandler(() => [managedUser]),
      getUpdateUserMockHandler(async ({ request }) => {
        expect(await request.json()).toEqual({
          displayName: null,
          email: "alice.new@example.com",
        });
        managedUser.displayName = null;
        managedUser.email = "alice.new@example.com";
        return managedUser;
      }),
    );

    renderRoute("/users");

    await user.click(
      await screen.findByRole("button", { name: "Actions for Alice Smith" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit user" });
    const identityIssuer = within(dialog).getByLabelText(/^Identity issuer/);
    const identitySubject = within(dialog).getByLabelText(/^Identity subject/);

    expect(identityIssuer).toHaveValue("local-development");
    expect(identityIssuer).toHaveAttribute("readonly");
    expect(identityIssuer).not.toBeDisabled();
    expect(identitySubject).toHaveValue("alice");
    expect(identitySubject).toHaveAttribute("readonly");

    await user.clear(within(dialog).getByLabelText("Display name"));
    await user.clear(within(dialog).getByLabelText("Email"));
    await user.type(
      within(dialog).getByLabelText("Email"),
      "alice.new@example.com",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    expect(
      await screen.findByRole("cell", { name: "alice.new@example.com" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Edit user" }),
    ).not.toBeInTheDocument();
  });

  it("refreshes the current account after editing the matching user", async () => {
    const user = userEvent.setup();
    const currentUserId = "d62b8e16-6ab9-4d80-8ef0-4ccae1a63e75";
    const currentUser = {
      displayName: "Developer" as string | null,
      email: "developer@example.com" as string | null,
      id: currentUserId,
      username: "developer" as string | null,
    };
    const managedUser = {
      ...currentUser,
      identityIssuer: "local-development",
      identitySubject: "developer",
      status: "active" as const,
    };

    server.use(
      getGetCurrentUserMockHandler(() => currentUser),
      getListUsersMockHandler(() => [managedUser]),
      getUpdateUserMockHandler(async ({ request }) => {
        expect(await request.json()).toEqual({
          displayName: "Core Operator",
        });
        currentUser.displayName = "Core Operator";
        managedUser.displayName = "Core Operator";
        return managedUser;
      }),
    );

    renderRoute("/users");

    const currentAccount = await screen.findByRole("group", {
      name: "Current account",
    });
    expect(await within(currentAccount).findByText("Developer")).toBeVisible();

    await user.click(
      await screen.findByRole("button", { name: "Actions for Developer" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit user" });
    await user.clear(within(dialog).getByLabelText("Display name"));
    await user.type(
      within(dialog).getByLabelText("Display name"),
      "Core Operator",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    expect(
      await screen.findByRole("cell", { name: "Core Operator" }),
    ).toBeVisible();
    expect(
      await within(currentAccount).findByText("Core Operator"),
    ).toBeVisible();
    expect(
      within(currentAccount).queryByText("Developer"),
    ).not.toBeInTheDocument();
  });

  it("deactivates an active user after confirmation", async () => {
    const user = userEvent.setup();
    const managedUser = {
      displayName: "Alice Smith",
      email: "alice@example.com",
      id: "a40a626a-99f1-4e81-940b-66f9e0d45c90",
      identityIssuer: "local-development",
      identitySubject: "alice",
      status: "active" as "active" | "inactive",
      username: "asmith",
    };

    server.use(
      getGetCurrentUserMockHandler({
        displayName: "Developer",
        email: "developer@example.com",
        id: "d62b8e16-6ab9-4d80-8ef0-4ccae1a63e75",
        username: "developer",
      }),
      getListUsersMockHandler(() => [managedUser]),
      getDeactivateUserMockHandler(() => {
        managedUser.status = "inactive";
        return managedUser;
      }),
    );

    renderRoute("/users");

    await user.click(
      await screen.findByRole("button", { name: "Actions for Alice Smith" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Deactivate" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Deactivate user",
    });

    expect(within(dialog).getByRole("button", { name: "Close" })).toBeVisible();
    expect(within(dialog).getByText("Deactivate Alice Smith?")).toBeVisible();
    expect(
      within(dialog).getByText(
        "This user will no longer be able to access Core Console until they are reactivated.",
      ),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "Deactivate" }),
    );

    expect(await screen.findByRole("cell", { name: "Inactive" })).toBeVisible();
  });

  it("does not let the current user initiate self-deactivation", async () => {
    const user = userEvent.setup();
    const currentUserId = "d62b8e16-6ab9-4d80-8ef0-4ccae1a63e75";

    server.use(
      getGetCurrentUserMockHandler({
        displayName: "Developer",
        email: "developer@example.com",
        id: currentUserId,
        username: "developer",
      }),
      getListUsersMockHandler([
        {
          displayName: "Developer",
          email: "developer@example.com",
          id: currentUserId,
          identityIssuer: "local-development",
          identitySubject: "developer",
          status: "active",
          username: "developer",
        },
      ]),
    );

    renderRoute("/users");

    await user.click(
      await screen.findByRole("button", { name: "Actions for Developer" }),
    );
    const deactivateItem = await screen.findByRole("menuitem", {
      name: "Deactivate",
    });

    expect(deactivateItem).toHaveAttribute("aria-disabled", "true");
    await user.click(deactivateItem);
    expect(
      screen.queryByRole("alertdialog", { name: "Deactivate user" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a server-rejected self-deactivation in context", async () => {
    const user = userEvent.setup();

    server.use(
      getGetCurrentUserMockHandler({
        displayName: "Developer",
        email: "developer@example.com",
        id: "d62b8e16-6ab9-4d80-8ef0-4ccae1a63e75",
        username: "developer",
      }),
      getListUsersMockHandler([
        {
          displayName: "Alice Smith",
          email: "alice@example.com",
          id: "a40a626a-99f1-4e81-940b-66f9e0d45c90",
          identityIssuer: "local-development",
          identitySubject: "alice",
          status: "active",
          username: "asmith",
        },
      ]),
      getDeactivateUserMockHandler409({
        code: "cannot_deactivate_self",
        detail: "The authenticated user cannot deactivate this record.",
        status: 409,
        title: "Conflict",
        type: "about:blank",
      }),
    );

    renderRoute("/users");

    await user.click(
      await screen.findByRole("button", { name: "Actions for Alice Smith" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Deactivate" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Deactivate user",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Deactivate" }),
    );

    expect(
      await within(dialog).findByText(
        "You cannot deactivate your own account.",
      ),
    ).toBeVisible();
    expect(dialog).toBeVisible();
    expect(
      within(dialog).queryByText(/authenticated user/i),
    ).not.toBeInTheDocument();
  });

  it("reactivates an inactive user after confirmation", async () => {
    const user = userEvent.setup();
    const managedUser = {
      displayName: null,
      email: "bob@example.com",
      id: "b9aa59ad-aa6b-49f5-9f4c-8ed071ea3f74",
      identityIssuer: "local-development",
      identitySubject: "bob",
      status: "inactive" as "active" | "inactive",
      username: "bjones",
    };

    server.use(
      getListUsersMockHandler(() => [managedUser]),
      getReactivateUserMockHandler(() => {
        managedUser.status = "active";
        return managedUser;
      }),
    );

    renderRoute("/users");

    await user.click(
      await screen.findByRole("button", { name: "Actions for bjones" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Reactivate" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Reactivate user",
    });

    expect(within(dialog).getByText("Reactivate bjones?")).toBeVisible();
    expect(
      within(dialog).getByText(
        "This user will be able to access Core Console again.",
      ),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "Reactivate" }),
    );

    expect(await screen.findByRole("cell", { name: "Active" })).toBeVisible();
  });
});
