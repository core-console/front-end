import { expect, it } from "vitest";
import {
  prepareSubmission,
  readSubmission,
  readSubmissions,
  resolveSubmission,
} from "./submission-journal";
import { SettlementCorrectionCreatedReceipt } from "@/api/generated/schemas";
import { createResponseResolution } from "./submission-evidence";

it("durably reopens an exact correction command with Unicode and Money, isolating owner and version evidence", async () => {
  const namespace = {
    apiBaseUrl: "https://console.example/api",
    ownerId: crypto.randomUUID(),
  };
  const ledger = crypto.randomUUID();
  const body = {
    settlementId: crypto.randomUUID(),
    amount: { amount: "9007199254740993.01", currency: "CNY" as const },
    excessDisposition: "none" as const,
    categoryId: null,
    reason: "\u001c" + "😀".repeat(500) + "\u001f",
    previewToken: "a".repeat(64),
  };
  const original = structuredClone(body);
  const record = await prepareSubmission(namespace, {
    operation: "createFinanceSettlementCorrection",
    workflow: "settlementCorrection",
    targetLedgerId: ledger,
    body,
  });
  body.reason = "changed";
  expect(await readSubmission(record)).toMatchObject({
    state: "unresolved",
    commandVersion: "1",
    endpoint: `/finance/ledgers/${ledger}/settlement-corrections`,
    body: original,
  });
  expect(
    await readSubmissions({ ...namespace, ownerId: crypto.randomUUID() }),
  ).toEqual([]);
  expect(
    await readSubmissions({
      ...namespace,
      apiBaseUrl: "https://other.example/api",
    }),
  ).toEqual([]);
  const receipt = SettlementCorrectionCreatedReceipt.parse({
    submissionId: record.submissionId,
    operation: "createFinanceSettlementCorrection",
    commandVersion: "1",
    targetLedgerId: ledger,
    admittedAt: "2026-11-01T00:00:00Z",
    resolvedAt: "2026-11-01T00:00:01Z",
    outcome: {
      kind: "created",
      resource: { type: "settlementCorrection", id: crypto.randomUUID() },
    },
  });
  for (const changed of [
    { commandVersion: "2" },
    { targetLedgerId: crypto.randomUUID() },
    { operation: "createFinanceAdvanceCorrection" },
  ]) {
    expect(
      createResponseResolution(record, { ...receipt, ...changed }),
    ).toBeNull();
  }
  await expect(
    resolveSubmission(record, {
      kind: "receipt",
      receipt: { ...receipt, submissionId: crypto.randomUUID() },
    }),
  ).rejects.toThrow();
  await resolveSubmission(record, { kind: "receipt", receipt });
  expect(await readSubmission(record)).toMatchObject({
    state: "resolved",
    body: original,
  });
});
