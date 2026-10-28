import {
  creditBody,
  creditApplication,
  creditReceipt,
} from "@/test/credit-application-fixtures";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import {
  prepareSubmission,
  readSubmission,
  readSubmissions,
  submissionDescription,
  resolveSubmission,
} from "./submission-journal";

it("prepares and reopens the immutable v7 command within its owner namespace", async () => {
  globalThis.indexedDB = new IDBFactory();
  const namespace = {
    apiBaseUrl: "https://console.example/api",
    ownerId: crypto.randomUUID(),
  };
  const body = {
    kind: "creditApplication" as const,
    participantId: crypto.randomUUID(),
    selectedObligationIds: [crypto.randomUUID()],
    transactionDate: "2026-10-27",
    amount: { amount: "9007199254740993.01", currency: "CNY" as const },
    note: "\u0085" + "😀".repeat(500) + "\u0085",
    previewToken: "a".repeat(64),
  };
  const original = structuredClone(body);
  const record = await prepareSubmission(namespace, {
    operation: "createFinanceSettlement",
    workflow: "settlement",
    targetLedgerId: crypto.randomUUID(),
    body,
  });
  body.amount.amount = "1";
  expect(await readSubmission(record)).toMatchObject({
    commandVersion: "7",
    body: original,
    state: "unresolved",
  });
  expect(submissionDescription(record)).toContain(
    "Credit application 9007199254740993.01 CNY",
  );
  expect(submissionDescription(record)).not.toContain("Forgiveness");
  expect(
    await readSubmissions({ ...namespace, ownerId: crypto.randomUUID() }),
  ).toEqual([]);
});

it("retains v7 as unresolved when terminal evidence belongs to an older version", async () => {
  const namespace = {
    apiBaseUrl: "https://console.example/api",
    ownerId: crypto.randomUUID(),
  };
  const record = await prepareSubmission(namespace, {
    operation: "createFinanceSettlement",
    workflow: "settlement",
    targetLedgerId: creditApplication.ledgerId,
    body: creditBody,
  });
  await expect(
    resolveSubmission(record, {
      kind: "receipt",
      receipt: { ...creditReceipt(record.submissionId), commandVersion: "6" },
    }),
  ).rejects.toThrow(/does not match/);
  expect(await readSubmission(record)).toMatchObject({
    commandVersion: "7",
    state: "unresolved",
    body: creditBody,
  });
  expect(
    await readSubmission({ ...record, ownerId: crypto.randomUUID() }),
  ).toBeNull();
});
