import { z } from "zod";

import { CreateFinanceLedgerBody } from "@/api/generated/schemas";
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
  operation: z.literal("createFinanceLedger"),
  endpoint: z.literal("/finance/ledgers"),
  targetLedgerId: z.null(),
  body: CreateFinanceLedgerBody,
  preparedAt: z.iso.datetime(),
  workflow: z.enum(["onboarding", "additional"]),
  integrityBlocked: z.boolean(),
};
const recordSchema = z
  .discriminatedUnion("state", [
    z.strictObject({ ...commandShape, state: z.literal("unresolved") }),
    z.strictObject({
      ...commandShape,
      state: z.literal("resolved"),
      resolution: submissionResolutionSchema,
    }),
  ])
  .refine(
    (record) =>
      record.state === "unresolved" ||
      validResolution(record, record.resolution),
    "Submission evidence does not match its command.",
  );
export type LedgerSubmission = z.infer<typeof recordSchema>;

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
          "Browser storage is unavailable. Enable IndexedDB before creating a Ledger.",
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

function parseStored(value: unknown): LedgerSubmission {
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
): Promise<LedgerSubmission> {
  const record = recordSchema.parse({
    ...namespaceSchema.parse(namespace),
    localSchemaVersion: 1,
    submissionId: crypto.randomUUID(),
    commandVersion: "1",
    operation: "createFinanceLedger",
    endpoint: "/finance/ledgers",
    targetLedgerId: null,
    body: structuredClone(body),
    preparedAt: new Date().toISOString(),
    workflow,
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
): Promise<LedgerSubmission[]> {
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
): Promise<LedgerSubmission | null> {
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
  identity: LedgerSubmission,
  update: (current: LedgerSubmission) => LedgerSubmission | null,
): Promise<LedgerSubmission | null> {
  let failure: unknown;
  const result = await transaction<LedgerSubmission | null>(
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
            current.operation !== identity.operation
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
  record: LedgerSubmission,
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

export async function blockConflictingSubmission(record: LedgerSubmission) {
  return updateExisting(record, (current) =>
    current.state === "unresolved"
      ? { ...current, integrityBlocked: true }
      : current,
  );
}

export async function acknowledgeSubmission(record: LedgerSubmission) {
  return updateExisting(record, (current) => {
    if (current.state !== "resolved")
      throw new SubmissionRecoveryError(
        "Only a durably resolved submission can be acknowledged.",
      );
    return null;
  });
}
