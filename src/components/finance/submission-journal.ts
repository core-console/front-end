import { z } from "zod";

import {
  CreateFinanceLedgerBody,
  CreateFinanceAccountBody,
  CreateFinanceCategoryBody,
} from "@/api/generated/schemas";
import { resolveApiBaseUrl } from "@/config/env";
import {
  equalJson,
  submissionResolutionSchema,
  validResolution,
  type SubmissionResolution,
} from "./submission-evidence";

export const submissionDatabaseName = "core-console.finance.submissions";
const storeName = "submissions";
export const journalChangedEvent = "finance-submissions-changed";

// Only authored recovery guidance may be presented to users. Parser, browser,
// and transport exceptions can contain response content or internal details.
export class SubmissionRecoveryError extends Error {}

export const normalizedApiBaseUrl = resolveApiBaseUrl;

const namespaceSchema = z.strictObject({
  apiBaseUrl: z.url().refine((value) => normalizedApiBaseUrl(value) === value),
  ownerId: z.uuid(),
});
export type SubmissionNamespace = z.infer<typeof namespaceSchema>;
const commandShape = {
  ...namespaceSchema.shape,
  localSchemaVersion: z.literal(1),
  submissionId: z.uuidv4(),
  commandVersion: z.literal("1"),
  preparedAt: z.iso.datetime(),
  integrityBlocked: z.boolean(),
};
const ledgerCommand = z.strictObject({
  operation: z.literal("createFinanceLedger"),
  endpoint: z.literal("/finance/ledgers"),
  targetLedgerId: z.null(),
  body: CreateFinanceLedgerBody,
  workflow: z.enum(["onboarding", "additional"]),
});
// OpenAPI maxLength counts Unicode code points; generated JS .max counts UTF-16 units.
const nestedCreateName = z.string().refine((value) => [...value].length <= 100);
const accountCommand = z.strictObject({
  operation: z.literal("createFinanceAccount"),
  endpoint: z.string(),
  targetLedgerId: z.uuid(),
  body: CreateFinanceAccountBody.extend({
    name: nestedCreateName,
  }),
  workflow: z.literal("account"),
});
const categoryCommand = z.strictObject({
  operation: z.literal("createFinanceCategory"),
  endpoint: z.string(),
  targetLedgerId: z.uuid(),
  body: CreateFinanceCategoryBody.extend({
    name: nestedCreateName,
  }),
  workflow: z.literal("category"),
});
export type CreateSubmissionCommand =
  | Omit<z.infer<typeof ledgerCommand>, "endpoint">
  | Omit<z.infer<typeof accountCommand>, "endpoint">
  | Omit<z.infer<typeof categoryCommand>, "endpoint">;
function recordsFor<T extends z.ZodRawShape>(shape: T) {
  return z.discriminatedUnion("state", [
    z.strictObject({
      ...commandShape,
      ...shape,
      state: z.literal("unresolved"),
    }),
    z.strictObject({
      ...commandShape,
      ...shape,
      state: z.literal("resolved"),
      resolution: submissionResolutionSchema,
    }),
  ]);
}
const recordSchema = z
  .discriminatedUnion("operation", [
    recordsFor(ledgerCommand.shape),
    recordsFor(accountCommand.shape),
    recordsFor(categoryCommand.shape),
  ])
  .refine(
    (record) => record.endpoint === endpointFor(record),
    "Submission endpoint does not match its operation and scope.",
  )
  .refine(
    (record) =>
      record.state === "unresolved" ||
      validResolution(record, record.resolution),
    "Submission evidence does not match its command.",
  );
export type FinanceSubmission = z.infer<typeof recordSchema>;

export function submissionLabel(record: Pick<FinanceSubmission, "operation">) {
  switch (record.operation) {
    case "createFinanceLedger":
      return "Ledger";
    case "createFinanceAccount":
      return "Account";
    case "createFinanceCategory":
      return "Category";
  }
}

export function rejectionMessage(record: FinanceSubmission) {
  return record.operation === "createFinanceAccount"
    ? "The Account command was rejected. Review the draft before creating a new submission."
    : `A ${submissionLabel(record)} with this name already exists.`;
}

function endpointFor(command: CreateSubmissionCommand) {
  switch (command.operation) {
    case "createFinanceLedger":
      return "/finance/ledgers";
    case "createFinanceAccount":
      return `/finance/ledgers/${command.targetLedgerId}/accounts`;
    case "createFinanceCategory":
      return `/finance/ledgers/${command.targetLedgerId}/categories`;
  }
}

const key = (record: SubmissionNamespace & { submissionId: string }) => [
  record.apiBaseUrl,
  record.ownerId,
  record.submissionId,
];

async function openJournal(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(
        new SubmissionRecoveryError(
          "Browser storage is unavailable. Enable IndexedDB before creating in Finance.",
        ),
      );
      return;
    }
    const request = indexedDB.open(submissionDatabaseName, 1);
    let blocked = false;
    request.onupgradeneeded = (event) => {
      // Version 1 has no predecessor. Future migrations must preserve every command.
      if (event.oldVersion === 0) {
        request.result.createObjectStore(storeName, {
          keyPath: ["apiBaseUrl", "ownerId", "submissionId"],
        });
      }
    };
    request.onblocked = () => {
      blocked = true;
      reject(
        new SubmissionRecoveryError(
          "Browser storage upgrade is blocked. Close other Core Console tabs and reload; retained submissions must be preserved.",
        ),
      );
    };
    request.onerror = () =>
      reject(
        new SubmissionRecoveryError(
          "Browser storage could not open. Reload without clearing site data.",
        ),
      );
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        window.dispatchEvent(new Event(journalChangedEvent));
      };
      resolve(db);
    };
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  const db = await openJournal();
  return new Promise((resolve, reject) => {
    let value: T;
    let failure: unknown;
    let tx: IDBTransaction;
    try {
      tx = db.transaction(storeName, mode);
    } catch {
      db.close();
      reject(
        new SubmissionRecoveryError(
          "Browser recovery storage is incompatible. Update or reload Core Console without clearing site data.",
        ),
      );
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onabort = () => {
      db.close();
      reject(
        failure instanceof SubmissionRecoveryError
          ? failure
          : new SubmissionRecoveryError(
              "Browser storage write failed. The submitted command remains recoverable; reload without clearing site data.",
            ),
      );
    };
    tx.onerror = () => {
      /* onabort supplies the transaction result */
    };
    try {
      action(tx.objectStore(storeName), (result) => {
        value = result;
      });
    } catch (error) {
      failure = error;
      tx.abort();
    }
  });
}

function parseStored(value: unknown): FinanceSubmission {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success)
    throw new SubmissionRecoveryError(
      "A retained submission is incompatible or damaged. Recovery is blocked; do not clear site data. Update or reload Core Console.",
    );
  return parsed.data;
}

function notifyJournal() {
  window.dispatchEvent(new Event(journalChangedEvent));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(submissionDatabaseName);
      channel.postMessage("changed");
      channel.close();
    } catch {
      /* Notifications are hints; durable rereads remain authoritative. */
    }
  }
}

export async function prepareLedgerSubmission(
  namespace: SubmissionNamespace,
  body: { name: string },
  workflow: "onboarding" | "additional",
): Promise<FinanceSubmission> {
  return prepareSubmission(namespace, {
    operation: "createFinanceLedger",
    targetLedgerId: null,
    body,
    workflow,
  });
}

export async function prepareSubmission(
  namespace: SubmissionNamespace,
  command: CreateSubmissionCommand,
): Promise<FinanceSubmission> {
  const record = recordSchema.parse({
    ...namespaceSchema.parse(namespace),
    localSchemaVersion: 1,
    submissionId: crypto.randomUUID(),
    commandVersion: "1",
    ...structuredClone(command),
    endpoint: endpointFor(command),
    preparedAt: new Date().toISOString(),
    state: "unresolved",
    integrityBlocked: false,
  });
  try {
    if (navigator.storage?.persist)
      void navigator.storage.persist().catch(() => undefined);
  } catch {
    /* Persistent storage denial alone does not block preparation. */
  }
  await transaction<void>("readwrite", (store) => {
    store.add(record);
  });
  notifyJournal();
  return record;
}

export async function readSubmissions(
  namespace: SubmissionNamespace,
): Promise<FinanceSubmission[]> {
  namespaceSchema.parse({
    apiBaseUrl: namespace.apiBaseUrl,
    ownerId: namespace.ownerId,
  });
  const values = await transaction<unknown[]>("readonly", (store, result) => {
    const request = store.getAll(
      IDBKeyRange.bound(
        [namespace.apiBaseUrl, namespace.ownerId],
        [namespace.apiBaseUrl, namespace.ownerId, []],
      ),
    );
    request.onsuccess = () => result(request.result);
  });
  return values.map(parseStored);
}

export async function readSubmission(
  identity: SubmissionNamespace & { submissionId: string },
): Promise<FinanceSubmission | null> {
  namespaceSchema.parse({
    apiBaseUrl: identity.apiBaseUrl,
    ownerId: identity.ownerId,
  });
  z.uuidv4().parse(identity.submissionId);
  const value = await transaction<unknown>("readonly", (store, result) => {
    const request = store.get(key(identity));
    request.onsuccess = () => result(request.result);
  });
  return value === undefined ? null : parseStored(value);
}

async function updateExisting(
  identity: FinanceSubmission,
  update: (current: FinanceSubmission) => FinanceSubmission | null,
): Promise<FinanceSubmission | null> {
  let failure: unknown;
  const result = await transaction<FinanceSubmission | null>(
    "readwrite",
    (store, result) => {
      const request = store.get(key(identity));
      request.onsuccess = () => {
        try {
          if (request.result === undefined) {
            result(null);
            return;
          }
          const current = parseStored(request.result);
          if (
            !equalJson(current.body, identity.body) ||
            current.commandVersion !== identity.commandVersion ||
            current.operation !== identity.operation ||
            current.targetLedgerId !== identity.targetLedgerId ||
            current.endpoint !== identity.endpoint ||
            current.workflow !== identity.workflow ||
            current.preparedAt !== identity.preparedAt ||
            current.localSchemaVersion !== identity.localSchemaVersion
          )
            throw new SubmissionRecoveryError(
              "The retained command changed. Recovery is blocked.",
            );
          const next = update(current);
          if (next) store.put(recordSchema.parse(next));
          else store.delete(key(current));
          result(next);
        } catch (error) {
          failure = error;
          store.transaction.abort();
        }
      };
    },
  ).catch((error: unknown) => {
    throw failure instanceof SubmissionRecoveryError ? failure : error;
  });
  notifyJournal();
  return result;
}

export async function resolveSubmission(
  record: FinanceSubmission,
  resolution: SubmissionResolution,
) {
  return updateExisting(record, (current) => {
    if (!validResolution(current, submissionResolutionSchema.parse(resolution)))
      throw new SubmissionRecoveryError(
        "Submission evidence does not match. Recovery is blocked.",
      );
    if (current.state === "resolved") {
      if (!equalJson(current.resolution, resolution))
        throw new SubmissionRecoveryError(
          "Conflicting outcome evidence. Recovery is blocked.",
        );
      return current;
    }
    return { ...current, state: "resolved", resolution };
  });
}

export async function blockConflictingSubmission(record: FinanceSubmission) {
  return updateExisting(record, (current) =>
    current.state === "unresolved"
      ? { ...current, integrityBlocked: true }
      : current,
  );
}

export async function acknowledgeSubmission(record: FinanceSubmission) {
  return updateExisting(record, (current) => {
    if (current.state !== "resolved")
      throw new SubmissionRecoveryError(
        "Only a durably resolved submission can be acknowledged.",
      );
    return null;
  });
}
