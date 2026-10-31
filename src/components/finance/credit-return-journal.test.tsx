import { expect, it } from "vitest";
import { returnBody, returnReceipt } from "@/test/credit-return-fixtures";
import {
  prepareSubmission,
  readSubmission,
  readSubmissions,
  resolveSubmission,
  submissionDescription,
} from "./submission-journal";

it("prepares, reopens and resolves the original v8 return without crossing owner namespaces", async () => {
  const namespace = {
    apiBaseUrl: "https://console.example/api",
    ownerId: crypto.randomUUID(),
  };
  const body = {
    ...returnBody,
    amount: { amount: "9007199254740993.01", currency: "CNY" as const },
    note: "\u0085" + "😀".repeat(500) + "\u0085",
  };
  const original = structuredClone(body);
  const record = await prepareSubmission(namespace, {
    operation: "createFinanceSettlement",
    workflow: "settlement",
    targetLedgerId: returnReceipt(crypto.randomUUID()).targetLedgerId,
    body,
  });
  body.amount.amount = "1";
  expect(await readSubmission(record)).toMatchObject({
    commandVersion: "8",
    state: "unresolved",
    body: original,
  });
  expect(submissionDescription(record)).toContain(
    "Credit return 9007199254740993.01 CNY",
  );
  expect(submissionDescription(record)).toContain(returnBody.payingAccountId);
  expect(
    await readSubmissions({ ...namespace, ownerId: crypto.randomUUID() }),
  ).toEqual([]);
  await expect(
    resolveSubmission(record, {
      kind: "receipt",
      receipt: { ...returnReceipt(record.submissionId), commandVersion: "7" },
    }),
  ).rejects.toThrow(/does not match/);
  expect(await readSubmission(record)).toMatchObject({
    state: "unresolved",
    body: original,
  });
  await resolveSubmission(record, {
    kind: "receipt",
    receipt: returnReceipt(record.submissionId),
  });
  expect(await readSubmission(record)).toMatchObject({
    state: "resolved",
    body: original,
  });
});

it.each(["9".repeat(131072), "000009007199254740993.01"])(
  "reopens producer-valid Money boundaries and original normalized-text inputs (%#. case)",
  async (amount) => {
    const namespace = {
      apiBaseUrl: "https://console.example/api",
      ownerId: crypto.randomUUID(),
    };
    const body = {
      ...returnBody,
      amount: { amount, currency: "CNY" as const },
      note: "\uFEFF" + "😀".repeat(499),
    };
    const record = await prepareSubmission(namespace, {
      operation: "createFinanceSettlement",
      workflow: "settlement",
      targetLedgerId: returnReceipt(crypto.randomUUID()).targetLedgerId,
      body,
    });
    expect(await readSubmission(record)).toMatchObject({
      commandVersion: "8",
      body,
    });
  },
);
