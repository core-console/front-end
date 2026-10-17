import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  ParticipantResponse,
  ParticipantNameRequest,
} from "../src/api/generated/schemas/index.ts";
import { submissionTestUser } from "../src/test/submission-fixtures.ts";

const ledger = { id: "11111111-1111-4111-8111-111111111111", name: "Personal" };
const other = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "Other Ledger",
};
const person = ParticipantResponse.parse({
  id: "22222222-2222-4222-8222-222222222222",
  ledgerId: ledger.id,
  name: "Alex",
  status: "active",
});

async function axe(page: Page) {
  await page.locator("body").evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

test("Participant lifecycle preserves identity with keyboard, focus and axe at desktop widths", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  let items: ParticipantResponse[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    let body: unknown;
    let status = 200;
    if (url.pathname === "/api/me") body = submissionTestUser;
    else if (url.pathname === "/api/finance/ledgers") body = [ledger, other];
    else if (url.pathname === `/api/finance/ledgers/${other.id}/participants`)
      body = [];
    else if (
      url.pathname === `/api/finance/ledgers/${ledger.id}/participants`
    ) {
      if (method === "POST") {
        const data = ParticipantNameRequest.parse(
          route.request().postDataJSON(),
        );
        expect(data).toEqual({ name: "Alex" });
        items = [{ ...person, name: data.name }];
        body = items[0];
        status = 201;
      } else body = items;
    } else if (
      url.pathname ===
      `/api/finance/ledgers/${ledger.id}/participants/${person.id}`
    ) {
      if (method === "PATCH") {
        const data = ParticipantNameRequest.parse(
          route.request().postDataJSON(),
        );
        items = items.map((item) => ({ ...item, name: data.name }));
      }
      body = items[0];
    } else if (
      url.pathname ===
      `/api/finance/ledgers/${ledger.id}/participants/${person.id}/archive`
    ) {
      expect(method).toBe("POST");
      items = items.map((item) => ({ ...item, status: "archived" }));
      body = items[0];
    } else throw new Error(`Unexpected API request: ${method} ${url.pathname}`);
    await route.fulfill({ status, json: body });
  });
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`/finance/participants?ledger=${ledger.id}`);
  await expect(page.getByText("No Participants yet")).toBeVisible();
  await axe(page);
  const create = page.getByRole("button", {
    name: "Create participant",
    exact: true,
  });
  await create.focus();
  await page.keyboard.press("Enter");
  let name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toBeFocused();
  await name.fill("  Alex  ");
  await axe(page);
  await name.press("Enter");
  await expect(page.getByText("Alex created.")).toBeVisible();
  await expect(create).toBeFocused();
  const inspect = page.getByRole("button", {
    name: "Inspect Alex",
    exact: true,
  });
  await inspect.focus();
  await page.keyboard.press("Enter");
  const detail = page.getByRole("dialog", {
    name: "Participant details",
    exact: true,
  });
  await expect(detail.getByText(person.id, { exact: true })).toBeVisible();
  await axe(page);
  await detail
    .getByRole("button", { name: "Rename participant", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toBeFocused();
  await name.fill("Alex Chen");
  await name.press("Enter");
  await expect(detail.getByRole("status")).toHaveText("Alex Chen renamed.");
  await expect(
    detail.getByRole("button", { name: "Rename participant", exact: true }),
  ).toBeFocused();
  await detail
    .getByRole("button", { name: "Archive participant", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog", {
    name: "Archive Participant?",
    exact: true,
  });
  await expect(
    confirm.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await axe(page);
  await page.keyboard.press("Tab");
  await expect(
    confirm.getByRole("button", { name: "Archive participant", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(detail.getByText("Archived", { exact: true })).toBeVisible();
  await expect(detail.getByText(person.id, { exact: true })).toBeVisible();
  await axe(page);
  // Archived identities retain the same editable display name and stable UUID.
  await detail
    .getByRole("button", { name: "Rename participant", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Alex archived");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(detail.getByRole("status")).toHaveText("Alex archived renamed.");
  await detail
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Inspect Alex archived", exact: true }),
  ).toBeFocused();
  for (const width of [1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("link", { name: "Participants", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await axe(page);
    const path = testInfo.outputPath(`participants-${width}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(`Participants ${width}`, {
      path,
      contentType: "image/png",
    });
  }
  await page.getByRole("button", { name: "Personal", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Other Ledger", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(other.id));
  await expect(page.getByText("No Participants yet")).toBeVisible();
  await expect(page.getByText("Alex archived", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("duplicate long names remain distinguishable and fit the constrained desktop", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const name = "W".repeat(100);
  const items = [
    { ...person, name },
    {
      ...person,
      id: "33333333-3333-4333-8333-333333333333",
      name,
      status: "archived",
    },
  ];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/me")
      return route.fulfill({ json: submissionTestUser });
    if (pathname === "/api/finance/ledgers")
      return route.fulfill({ json: [ledger] });
    if (pathname.endsWith(`/participants/${person.id}`))
      return route.fulfill({ json: items[0] });
    if (pathname.endsWith("/participants"))
      return route.fulfill({ json: items });
    throw new Error(`Unexpected API request ${pathname}`);
  });
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`/finance/participants?ledger=${ledger.id}`);
  await page
    .getByRole("button", {
      name: `Inspect ${name}, Participant ID ${person.id}`,
      exact: true,
    })
    .click();
  const detail = page.getByRole("dialog", {
    name: "Participant details",
    exact: true,
  });
  await detail
    .getByRole("button", { name: "Archive participant", exact: true })
    .click();
  const confirm = page.getByRole("alertdialog", {
    name: "Archive Participant?",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  expect(
    await confirm.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await axe(page);
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await detail
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("pending create cannot repeat or close and an uncertain response requires list inspection", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  let created = false;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me")
      return route.fulfill({ json: submissionTestUser });
    if (url.pathname === "/api/finance/ledgers")
      return route.fulfill({ json: [ledger] });
    if (url.pathname === `/api/finance/ledgers/${ledger.id}/participants`) {
      if (route.request().method() === "POST") {
        attempts += 1;
        await pending;
        created = true;
        // A malformed success body models a response the consumer cannot confirm.
        return route.fulfill({ status: 201, json: {} });
      }
      return route.fulfill({ json: created ? [person] : [] });
    }
    throw new Error(`Unexpected API request ${url.pathname}`);
  });
  await page.goto(`/finance/participants?ledger=${ledger.id}`);
  await page
    .getByRole("button", { name: "Create participant", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create Participant",
    exact: true,
  });
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Alex");
  await dialog
    .getByRole("button", { name: "Create participant", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await axe(page);
  release();
  await expect(dialog.getByRole("alert")).toContainText(
    "The create outcome is unknown",
  );
  await expect(
    dialog.getByRole("button", { name: "Create participant", exact: true }),
  ).toBeDisabled();
  await axe(page);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Refresh Participants", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Inspect Alex", exact: true }),
  ).toBeVisible();
  expect(attempts).toBe(1);
  expect(errors).toEqual([]);
});
