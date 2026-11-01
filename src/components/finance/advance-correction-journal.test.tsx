import { expect, it } from "vitest";
import {
  prepareSubmission,
  readSubmission,
  readSubmissions,
  resolveSubmission,
} from "./submission-journal";
import { AdvanceCorrectionCreatedReceipt } from "@/api/generated/schemas";

it("durably reopens an exact correction command with Unicode and Money, isolating owner and version evidence", async () => {
  const namespace = {
    apiBaseUrl: "https://console.example/api",
    ownerId: crypto.randomUUID(),
  };
  const ledger = crypto.randomUUID();
  const body = {
    advanceId: crypto.randomUUID(),
    fundingAccountId: crypto.randomUUID(),
    transactionDate: "2026-10-20",
    amount: { amount: "9007199254740993.01", currency: "CNY" as const },
    ownerShare: { amount: "9007199254740993.01", currency: "CNY" as const },
    participantShares: [],
    reason: "😀".repeat(500),
    note: "\uFEFF" + "😀".repeat(499),
    previewToken: "a".repeat(64),
  };
  const original = structuredClone(body);
  const record = await prepareSubmission(namespace, {
    operation: "createFinanceAdvanceCorrection",
    workflow: "advanceCorrection",
    targetLedgerId: ledger,
    body,
  });
  body.reason = "changed";
  expect(await readSubmission(record)).toMatchObject({
    state: "unresolved",
    commandVersion: "1",
    endpoint: `/finance/ledgers/${ledger}/advance-corrections`,
    body: original,
  });
  expect(
    await readSubmissions({ ...namespace, ownerId: crypto.randomUUID() }),
  ).toEqual([]);
  const receipt = AdvanceCorrectionCreatedReceipt.parse({
    submissionId: record.submissionId,
    operation: "createFinanceAdvanceCorrection",
    commandVersion: "1",
    targetLedgerId: ledger,
    admittedAt: "2026-11-01T00:00:00Z",
    resolvedAt: "2026-11-01T00:00:01Z",
    outcome: {
      kind: "created",
      resource: { type: "advanceCorrection", id: crypto.randomUUID() },
    },
  });
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
