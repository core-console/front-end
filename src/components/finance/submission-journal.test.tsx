import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import {
  prepareLedgerSubmission,
  prepareSubmission,
  readSubmissions,
  readSubmission,
  resolveSubmission,
  acknowledgeSubmission,
  blockConflictingSubmission,
  normalizedApiBaseUrl,
} from "./submission-journal";
import { createdLedgerReceipt } from "@/test/submission-fixtures";
import {
  combinedSettlement,
  combinedPreview,
  combinedReceipt,
} from "@/test/combined-settlement-fixtures";

it("retains the entire version 6 action and rejects older-version evidence", async () => {
  globalThis.indexedDB = new IDBFactory();
  const body = {
    kind: "combined" as const,
    participantId: combinedSettlement.participantId,
    receivingAccountId: combinedSettlement.receivingAccountId,
    selectedObligationIds: [...combinedSettlement.selectedObligationIds],
    transactionDate: combinedSettlement.transactionDate,
    amount: { ...combinedSettlement.amount },
    forgivenessAmount: { ...combinedSettlement.forgivenessAmount },
    reason: "😀".repeat(300),
    previewToken: combinedPreview.previewToken,
    note: null,
  };
  const original = structuredClone(body);
  const record = await prepareSubmission(namespace, {
    operation: "createFinanceSettlement",
    workflow: "settlement",
    targetLedgerId: combinedSettlement.ledgerId,
    body,
  });
  body.amount.amount = "1";
  body.forgivenessAmount.amount = "99";
  body.reason = "Changed";
  body.selectedObligationIds.pop();
  expect(await readSubmission(record)).toMatchObject({
    commandVersion: "6",
    body: original,
    state: "unresolved",
  });
  expect(
    await readSubmissions({ ...namespace, ownerId: crypto.randomUUID() }),
  ).toEqual([]);
  const receipt = combinedReceipt(record.submissionId);
  for (const commandVersion of ["4", "5"] as const) {
    await expect(
      resolveSubmission(record, {
        kind: "receipt",
        receipt: { ...receipt, commandVersion },
      }),
    ).rejects.toThrow(/does not match/);
  }
  expect((await readSubmission(record))?.state).toBe("unresolved");
  await resolveSubmission(record, { kind: "receipt", receipt });
  expect((await readSubmission(record))?.state).toBe("resolved");
});

const namespace = {
  apiBaseUrl: "http://localhost/api",
  ownerId: "edb4ee80-17c6-46b5-863e-2afa18e84043",
};

it("retains explicit Income intent as version 3 and only resolves matching evidence", async () => {
  const command = {
    operation: "createFinanceSettlement" as const,
    workflow: "settlement" as const,
    targetLedgerId: "11111111-1111-4111-8111-111111111111",
    body: {
      participantId: "22222222-2222-4222-8222-222222222222",
      receivingAccountId: "33333333-3333-4333-8333-333333333333",
      transactionDate: "2026-10-23",
      amount: { amount: "102", currency: "CNY" as const },
      excessDisposition: "acceptIncome" as const,
      categoryAllocations: [
        { amount: { amount: "2", currency: "CNY" as const } },
      ],
      previewToken: "a".repeat(64),
    },
  };
  const record = await prepareSubmission(namespace, command);
  expect(record.commandVersion).toBe("3");
  command.body.categoryAllocations[0]!.amount.amount = "22";
  expect(await readSubmission(record)).toMatchObject({
    commandVersion: "3",
    body: {
      excessDisposition: "acceptIncome",
      categoryAllocations: [{ amount: { amount: "2" } }],
    },
  });
  const receipt = {
    submissionId: record.submissionId,
    operation: "createFinanceSettlement" as const,
    commandVersion: "3" as const,
    targetLedgerId: command.targetLedgerId,
    admittedAt: "2026-10-23T00:00:00Z",
    resolvedAt: "2026-10-23T00:00:01Z",
    outcome: {
      kind: "created" as const,
      resource: { type: "settlement" as const, id: crypto.randomUUID() },
    },
  };
  await expect(
    resolveSubmission(record, {
      kind: "receipt",
      receipt: { ...receipt, commandVersion: "2" },
    }),
  ).rejects.toThrow(/does not match/);
  expect((await readSubmission(record))?.state).toBe("unresolved");
  await resolveSubmission(record, { kind: "receipt", receipt });
  expect((await readSubmission(record))?.state).toBe("resolved");
});

it("retains version 2 credit receipts beside original version 1 repayments and rejects mismatched evidence", async () => {
  globalThis.indexedDB = new IDBFactory();
  const body = {
    participantId: "22222222-2222-4222-8222-222222222222",
    receivingAccountId: "33333333-3333-4333-8333-333333333333",
    amount: { amount: "102", currency: "CNY" as const },
    transactionDate: "2026-10-22",
    previewToken: "a".repeat(64),
    note: null,
  };
  const command = {
    operation: "createFinanceSettlement" as const,
    targetLedgerId: "11111111-1111-4111-8111-111111111111",
    workflow: "settlement" as const,
    body,
  };
  const original = await prepareSubmission(namespace, command);
  const credit = await prepareSubmission(namespace, {
    ...command,
    body: { ...body, excessDisposition: "retainCredit" },
  });
  expect(original.commandVersion).toBe("1");
  expect(credit.commandVersion).toBe("2");
  body.amount.amount = "1";
  expect(await readSubmission(credit)).toMatchObject({
    commandVersion: "2",
    body: { amount: { amount: "102" }, excessDisposition: "retainCredit" },
  });
  const receipt = {
    submissionId: credit.submissionId,
    operation: "createFinanceSettlement" as const,
    commandVersion: "2" as const,
    targetLedgerId: command.targetLedgerId,
    admittedAt: "2026-10-22T00:00:00Z",
    resolvedAt: "2026-10-22T00:00:01Z",
    outcome: {
      kind: "created" as const,
      resource: { type: "settlement" as const, id: crypto.randomUUID() },
    },
  };
  await expect(
    resolveSubmission(credit, {
      kind: "receipt",
      receipt: { ...receipt, commandVersion: "1" },
    }),
  ).rejects.toThrow(/does not match/);
  expect((await readSubmission(credit))?.state).toBe("unresolved");
  await resolveSubmission(credit, { kind: "receipt", receipt });
  expect((await readSubmission(credit))?.state).toBe("resolved");
  expect((await readSubmission(original))?.state).toBe("unresolved");
});

describe("durable Finance submissions", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("retains the immutable Ledger command independently of the editable draft", async () => {
    const draft = { name: "Household" };
    const record = await prepareLedgerSubmission(
      namespace,
      draft,
      "onboarding",
    );
    draft.name = "Edited draft";
    const [stored] = await readSubmissions(namespace);
    expect(stored).toMatchObject({
      submissionId: record.submissionId,
      commandVersion: "1",
      endpoint: "/finance/ledgers",
      body: { name: "Household" },
      state: "unresolved",
    });
    expect(
      await readSubmissions({ ...namespace, ownerId: crypto.randomUUID() }),
    ).toEqual([]);
  });

  it("resolves monotonically across concurrent tabs and cannot resurrect acknowledged records", async () => {
    const record = await prepareLedgerSubmission(
      namespace,
      { name: "Household" },
      "additional",
    );
    const resolution = {
      kind: "receipt",
      receipt: createdLedgerReceipt(
        record.submissionId,
        "a40a626a-99f1-4e81-940b-66f9e0d45c90",
      ),
    } as const;
    await expect(acknowledgeSubmission(record)).rejects.toThrow(/resolved/);
    await Promise.all([
      resolveSubmission(record, resolution),
      resolveSubmission(record, resolution),
    ]);
    const resolved = await readSubmission(record);
    expect(resolved?.state).toBe("resolved");
    await blockConflictingSubmission(record);
    expect(await readSubmission(record)).toEqual(resolved);
    await expect(
      resolveSubmission(record, {
        ...resolution,
        receipt: { ...resolution.receipt, resolvedAt: "2026-10-03T00:00:02Z" },
      }),
    ).rejects.toThrow(/Conflicting/);
    await acknowledgeSubmission(record);
    expect(await resolveSubmission(record, resolution)).toBeNull();
    expect(await readSubmissions(namespace)).toEqual([]);
  });

  it("rejects mismatched evidence and retains known conflicting reuse across reopening", async () => {
    const record = await prepareLedgerSubmission(
      namespace,
      { name: "Household" },
      "additional",
    );
    const resolution = {
      kind: "receipt",
      receipt: createdLedgerReceipt(
        record.submissionId,
        "a40a626a-99f1-4e81-940b-66f9e0d45c90",
      ),
    } as const;
    await expect(
      resolveSubmission(record, {
        ...resolution,
        receipt: { ...resolution.receipt, submissionId: crypto.randomUUID() },
      }),
    ).rejects.toThrow(/does not match/);
    await blockConflictingSubmission(record);
    await expect(resolveSubmission(record, resolution)).rejects.toThrow(
      /does not match/,
    );
    expect((await readSubmissions(namespace))[0]).toMatchObject({
      state: "unresolved",
      integrityBlocked: true,
    });
  });

  it("uses one normalized browser-facing API namespace without proxy upstream identity", () => {
    expect(normalizedApiBaseUrl("api///", "https://console.example")).toBe(
      "https://console.example/api",
    );
    expect(normalizedApiBaseUrl("/api/", "https://console.example")).toBe(
      "https://console.example/api",
    );
    expect(normalizedApiBaseUrl("https://api.example/api/")).toBe(
      "https://api.example/api",
    );
    expect(() =>
      normalizedApiBaseUrl("https://user:secret@api.example/api"),
    ).toThrow();
  });

  it("retains exact Account Money and original Ledger scope in the shared journal", async () => {
    const body = {
      name: "Cash",
      nature: "liability" as const,
      currency: "CNY" as const,
      openingBalance: {
        amount: "-9007199254740993.01",
        currency: "CNY" as const,
      },
      trackingStartDate: "2026-10-05",
    };
    const record = await prepareSubmission(namespace, {
      operation: "createFinanceAccount",
      targetLedgerId: "11111111-1111-4111-8111-111111111111",
      body,
      workflow: "account",
    });
    body.openingBalance.amount = "0";
    expect(await readSubmission(record)).toMatchObject({
      operation: "createFinanceAccount",
      targetLedgerId: "11111111-1111-4111-8111-111111111111",
      endpoint:
        "/finance/ledgers/11111111-1111-4111-8111-111111111111/accounts",
      body: { openingBalance: { amount: "-9007199254740993.01" } },
      state: "unresolved",
    });
  });

  it("keeps existing Ledger v1 records while nested records resolve and are acknowledged", async () => {
    const ledger = await prepareLedgerSubmission(
      namespace,
      { name: "Existing" },
      "additional",
    );
    const category = await prepareSubmission(namespace, {
      operation: "createFinanceCategory",
      targetLedgerId: "11111111-1111-4111-8111-111111111111",
      body: { name: "Travel" },
      workflow: "category",
    });
    const problem = {
      type: "about:blank",
      title: "Validation Error",
      code: "validation_error" as const,
      status: 422 as const,
      errors: [],
      commandValidationRejection: {
        kind: "definitivelyNotAdmitted" as const,
        ownerId: category.ownerId,
        submissionId: category.submissionId,
        operation: "createFinanceCategory" as const,
        commandVersion: "1" as const,
        targetLedgerId: category.targetLedgerId!,
        attemptedBody: category.body,
      },
    };
    await resolveSubmission(category, { kind: "notAdmitted", problem });
    await acknowledgeSubmission(category);
    expect(await readSubmissions(namespace)).toEqual([ledger]);
  });
});
