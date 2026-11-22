import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  ObligationResponse,
  SettlementCorrectionResponse,
} from "../src/api/generated/schemas/index.ts";

const backend = process.env.FINANCE_T15B_TEST_BACKEND;
test.skip(!backend, "Requires the local T15B producer on guarded PostgreSQL.");
const money = (amount: string) => ({ amount, currency: "CNY" });

for (const combined of [false, true]) {
  test(`restates ${combined ? "selected combined Settlement with stale and lost-response recovery" : "standalone forgiveness without cash"}`, async ({
    page,
    context,
    request,
  }) => {
    expect(backend).toBe("http://127.0.0.1:8301");
    async function read(path: string) {
      const response = await request.get(`${backend}${path}`);
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    }
    const owner = (await read("/api/me")).id as string;
    async function create(path: string, data: object, version = "1") {
      const response = await request.post(`${backend}${path}`, {
        data,
        headers: {
          "Idempotency-Key": randomUUID(),
          "Finance-Command-Version": version,
          "Finance-Submission-Owner": owner,
        },
      });
      expect(response.status(), await response.text()).toBe(201);
      return (await response.json()).outcome.resource.id as string;
    }
    async function confirm(path: string, draft: object, version: string) {
      const response = await request.post(`${backend}${path}/preview`, {
        data: draft,
      });
      expect(response.status(), await response.text()).toBe(200);
      return create(
        path,
        { ...draft, previewToken: (await response.json()).previewToken },
        version,
      );
    }

    const ledger = await create("/api/finance/ledgers", {
      name: `T15B ${randomUUID()}`,
    });
    const base = `/api/finance/ledgers/${ledger}`;
    const account = await create(`${base}/accounts`, {
      name: "Receiving",
      nature: "asset",
      currency: "CNY",
      openingBalance: money("1000"),
      trackingStartDate: "2026-01-01",
    });
    const participant = await request.post(`${backend}${base}/participants`, {
      data: { name: "Alex" },
    });
    expect(participant.status(), await participant.text()).toBe(201);
    const person = (await participant.json()).id as string;
    const advances: { id: string; obligationId: string }[] = [];
    for (const [amount, transactionDate] of [
      ["40", "2026-10-20"],
      ["20", "2026-10-20"],
      ["60", "2026-10-21"],
      ["80", "2026-10-19"],
    ] as const) {
      const advance = await confirm(
        `${base}/advances`,
        {
          fundingAccountId: account,
          transactionDate,
          amount: money(amount),
          ownerShare: money("0"),
          participantId: person,
          participantShare: money(amount),
        },
        "1",
      );
      advances.push({
        id: advance,
        obligationId: (await read(`${base}/advances/${advance}`)).obligation.id,
      });
      if (!combined) break;
    }
    const selected = advances
      .slice(0, 3)
      .map((advance) => advance.obligationId);
    const transactionDate = "2026-10-22";
    const settlement = await confirm(
      `${base}/settlements`,
      {
        kind: combined ? "combined" : "forgiveness",
        participantId: person,
        transactionDate,
        selectedObligationIds: [...selected].reverse(),
        amount: money(combined ? "30" : "20"),
        reason: "Original concession",
        ...(combined && {
          receivingAccountId: account,
          forgivenessAmount: money("5"),
        }),
      },
      combined ? "6" : "5",
    );
    const historyPath = `${base}/settlements/${settlement}/corrections`;
    if (combined) {
      await confirm(
        `${base}/advance-corrections`,
        {
          advanceId: advances[1]!.id,
          fundingAccountId: account,
          transactionDate: "2026-10-23",
          amount: money("20"),
          ownerShare: money("0"),
          participantShares: [{ participantId: person, amount: money("20") }],
          reason: "Correct the date of the selected, unallocated Advance",
        },
        "1",
      );
      const excessForgiveness = await request.post(
        `${backend}${base}/settlement-corrections/preview`,
        {
          data: {
            settlementId: settlement,
            amount: money("30"),
            forgivenessAmount: money("71"),
            excessDisposition: "none",
            categoryId: null,
            reason: "Attempt to exceed eligible selected debt",
          },
        },
      );
      expect(excessForgiveness.status()).toBe(422);
      expect(await read(historyPath)).toEqual([]);
    }

    const errors: string[] = [];
    let stale = 0;
    let responseLost = false;
    const posts: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      const expectedConflict =
        stale > 0 &&
        message.text() ===
          "Failed to load resource: the server responded with a status of 409 (Conflict)" &&
        message.location().url.endsWith("/settlement-corrections");
      if (message.type() === "error" && !expectedConflict)
        errors.push(message.text());
    });
    await context.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: `${backend}${url.pathname}${url.search}`,
      });
      if (
        route.request().method() === "POST" &&
        url.pathname.endsWith("/settlement-corrections")
      ) {
        expect(route.request().headers()["finance-command-version"]).toBe("2");
        posts.push(route.request().headers()["idempotency-key"]!);
        if (response.status() === 409) stale++;
        if (combined && response.status() === 201) {
          expect(await read(historyPath)).toHaveLength(1);
          await route.fulfill({ status: 201, json: {} });
          responseLost = true;
          return;
        }
      }
      await route.fulfill({ response });
    });

    await page.goto(
      `/finance/repayments?ledger=${ledger}&participant_id=${person}&settlement_id=${settlement}`,
    );
    const title = combined
      ? "Correct combined Settlement"
      : "Correct forgiveness";
    await page.getByRole("button", { name: title, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: title });
    const reason = dialog.getByLabel("Reason", { exact: true });
    await expect(reason).toBeFocused();
    await reason.fill("Original amount was entered incorrectly");
    const forgiveness = dialog.getByLabel("Corrected forgiveness");
    await forgiveness.fill(combined ? "20.00" : "10.00");
    if (!combined)
      await expect(dialog.getByLabel("Corrected cash receipt")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Preview Correction" }).click();
    const after = dialog.getByRole("region", {
      name: "After Settlement facts",
    });
    await expect(after).toContainText(
      `Forgiveness Expense ${combined ? "20.00" : "10.00"} CNY`,
    );
    const confirmButton = dialog.getByRole("button", {
      name: "Confirm Correction",
    });
    await expect(confirmButton).toBeFocused();
    if (combined) {
      await expect(after).toContainText("Cash receipt 30.00 CNY");
      await expect(after).toContainText("Remaining 50.00 CNY");
      await confirm(
        `${base}/settlements`,
        {
          participantId: person,
          transactionDate,
          amount: money("1"),
          receivingAccountId: account,
          selectedObligationIds: [selected[0]],
        },
        "4",
      );
      const archived = await request.post(
        `${backend}${base}/accounts/${account}/archive`,
      );
      expect(archived.status(), await archived.text()).toBe(200);
      await page.keyboard.press("Enter");
      await expect(
        dialog.getByText(/The original Correction was rejected/),
      ).toBeVisible();
      await expect(forgiveness).toHaveValue("20.00");
      await expect(confirmButton).toHaveCount(0);
      await dialog.getByRole("button", { name: "Preview Correction" }).click();
      await expect(after).toContainText("Remaining 49.00 CNY");
      await expect(confirmButton).toBeFocused();
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press("Enter");
    if (combined) {
      await expect(
        dialog.getByText(/The original command is retained/),
      ).toBeVisible();
      await expect.poll(() => responseLost).toBe(true);
      await page.reload();
      await page
        .getByRole("link", { name: "Open Settlement Correction history" })
        .click();
      expect(stale).toBe(1);
      expect(new Set(posts).size).toBe(2);
    } else {
      await expect(dialog).toBeHidden();
      await expect(page.locator("#finance-title")).toBeFocused();
    }
    const history = page.getByRole("region", {
      name: "Settlement Correction history",
    });
    await expect(history).toContainText("Revision 1");
    const [correction] = SettlementCorrectionResponse.array()
      .length(1)
      .parse(await read(historyPath));
    expect(correction!.transactionDate).toBe(transactionDate);
    expect(correction!.after.forgivenessAmount).toEqual(
      money(combined ? "20.00" : "10.00"),
    );
    expect(correction!.after.amount).toEqual(
      money(combined ? "30.00" : "0.00"),
    );
    const detail = page.getByRole("region", { name: "Confirmed Settlement" });
    const allocations = detail.getByRole("table", {
      name: "Confirmed Allocations",
    });
    const forgivenessRow = allocations.getByRole("row").nth(combined ? 2 : 1);
    const remaining = forgivenessRow.getByRole("cell").last();
    await expect(remaining).toContainText(combined ? "1.00 CNY" : "30.00 CNY");
    await expect(remaining).toContainText(
      `Originally ${combined ? "5.00" : "20.00"} CNY`,
    );
    if (combined) {
      expect(correction!.selectedObligationIds).toEqual([...selected].sort());
      expect(correction!.after.allocations).toMatchObject([
        { obligationId: selected[0], cashPaid: money("30.00") },
        { obligationId: selected[0], forgiven: money("9.00") },
        { obligationId: selected[2], forgiven: money("11.00") },
      ]);
      expect(correction!.receivingAccountId).toBe(account);
      expect(
        correction!.financialEffectsAfter.filter(
          (effect) => effect.kind !== "expense",
        ),
      ).toEqual(
        correction!.financialEffectsBefore.filter(
          (effect) => effect.kind !== "expense",
        ),
      );
      const obligations = ObligationResponse.array().parse(
        await read(`${base}/participants/${person}/obligations`),
      );
      for (const [advance, remaining] of [
        [advances[1]!, "20.00"],
        [advances[3]!, "80.00"],
      ] as const) {
        expect(
          obligations.find(({ id }) => id === advance.obligationId)?.remaining,
        ).toEqual(money(remaining));
      }
      const unarchived = await request.post(
        `${backend}${base}/accounts/${account}/unarchive`,
      );
      expect(unarchived.status(), await unarchived.text()).toBe(200);
      for (const amount of ["110", "120"]) {
        await confirm(
          `${base}/settlement-corrections`,
          {
            settlementId: settlement,
            amount: money(amount),
            forgivenessAmount: money("0"),
            excessDisposition: "retainCredit",
            categoryId: null,
            reason: "Correct the recorded receipt and retain the excess",
          },
          "2",
        );
      }
      const source = await read(`${base}/settlements/${settlement}`);
      expect(source.creditOrigin.available).toEqual(money("21.00"));
      const revisions = SettlementCorrectionResponse.array()
        .length(3)
        .parse(await read(historyPath));
      const third = revisions.find((revision) => revision.revision === 3)!;
      const creditTransfer = third.financialEffectsAfter.find((effect) =>
        effect.movements.some(
          (movement) =>
            movement.accountId === source.creditOrigin.liabilityAccountId &&
            movement.amount.amount === "10.00",
        ),
      );
      expect(creditTransfer).toBeDefined();
      await page.reload();
      await expect(history).toContainText("Revision 3");
      await expect(
        detail.getByRole("link", {
          name: `View linked Credit Internal Transfer · ${source.creditOrigin.transactionId}`,
        }),
      ).toBeVisible();
      await expect(
        detail.getByRole("link", {
          name: `View linked Transaction · ${creditTransfer!.transactionId}`,
        }),
      ).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
