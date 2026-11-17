import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  ledger,
  person,
  funding,
  cashBefore,
  cashCorrection,
  cashCorrectionPreview,
  correctionReceipt,
} from "../src/test/advance-correction-fixtures.ts";
import { submissionTestUser } from "../src/test/submission-fixtures.ts";

test("corrects cash-settled principal and shows receipt-origin credit", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  let committed = false;
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown;
    let status = 200;
    if (path === "/api/me") body = submissionTestUser;
    else if (path === "/api/finance/ledgers") body = [ledger];
    else if (path.endsWith("/currencies"))
      body = [{ code: "CNY", minorUnit: 2 }];
    else if (path.endsWith("/accounts")) body = [funding];
    else if (path.endsWith("/participants")) body = [person];
    else if (path.endsWith("/corrections"))
      body = committed ? [cashCorrection] : [];
    else if (path.endsWith("/advance-corrections/preview"))
      body = cashCorrectionPreview;
    else if (
      path.endsWith("/advance-corrections") &&
      request.method() === "POST"
    ) {
      committed = true;
      status = 201;
      body = correctionReceipt(request.headers()["idempotency-key"]!);
    } else if (path.endsWith(`/advance-corrections/${cashCorrection.id}`))
      body = cashCorrection;
    else if (path.endsWith(`/advances/${cashBefore.id}`))
      body = committed ? cashCorrection.after : cashBefore;
    else throw new Error(`Unhandled ${request.method()} ${path}`);
    await route.fulfill({ status, json: body });
  });
  await page.goto(
    `/finance/advances?ledger=${ledger.id}&advance_id=${cashBefore.id}`,
  );
  const button = page.getByRole("button", { name: "Correct Advance" });
  await expect(button).toBeEnabled();
  await button.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Correct Advance" });
  await dialog.getByLabel("Reason").fill(cashCorrection.reason);
  await dialog.getByLabel("Owner share").fill("10.00");
  await dialog.getByLabel("Participant 1 share").fill("15.01");
  await dialog.getByRole("button", { name: "Preview Correction" }).click();
  const releases = dialog.getByRole("region", {
    name: "Released cash and credit origins",
  });
  await expect(releases.getByText(/Released.*4\.99.*as credit/)).toBeVisible();
  await expect(
    releases.getByRole("link", { name: "Open originating receipt" }),
  ).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Confirm Correction" });
  await expect(confirm).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(
    page
      .getByRole("region", { name: "Advance Correction history" })
      .getByText(/Released.*4\.99.*as credit/),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
