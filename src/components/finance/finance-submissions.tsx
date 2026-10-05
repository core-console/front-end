import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useLocation } from "react-router";

import {
  createFinanceLedger,
  createFinanceAccount,
  createFinanceCategory,
  getCurrentUser,
  getFinanceSubmission,
  getGetCurrentUserQueryKey,
  getListFinanceLedgersQueryKey,
  listFinanceLedgers,
  listFinanceAccounts,
  listFinanceCategories,
  getListFinanceAccountsQueryKey,
  getListFinanceCategoriesQueryKey,
  useGetCurrentUser,
} from "@/api/generated/core-console";
import {
  FinanceSubmissionResponse,
  LedgerResponse,
  AccountResponse,
  CategoryResponse,
  MeResponse,
} from "@/api/generated/schemas";
import { env } from "@/config/env";
import {
  correlates,
  createResponseResolution,
  errorBody,
  errorResolution,
  nonterminalProblem,
  type SubmissionResolution,
} from "./submission-evidence";
import {
  acknowledgeSubmission,
  blockConflictingSubmission,
  journalChangedEvent,
  normalizedApiBaseUrl,
  prepareSubmission,
  readSubmission,
  readSubmissions,
  resolveSubmission,
  submissionDatabaseName,
  SubmissionRecoveryError,
  type FinanceSubmission,
  type SubmissionNamespace,
  submissionLabel,
  rejectionMessage,
} from "./submission-journal";

import {
  FinanceSubmissionContext,
  type SubmitResult,
  type SubmissionContext,
} from "./finance-submission-context";

const namespaceKey = (namespace: SubmissionNamespace | null) =>
  namespace ? `${namespace.apiBaseUrl}|${namespace.ownerId}` : "";
const submissionToken = (record: FinanceSubmission) =>
  JSON.stringify([record.apiBaseUrl, record.ownerId, record.submissionId]);
const messageFor = (error: unknown) =>
  error instanceof SubmissionRecoveryError
    ? error.message
    : "Recovery could not complete. Check the outcome again; the original submission is retained.";

export function FinanceSubmissionsProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const currentUser = useGetCurrentUser({
    query: { select: (response) => MeResponse.parse(response.data) },
  });
  const apiBaseUrl = normalizedApiBaseUrl(env.VITE_API_BASE_URL);
  const ownerId = currentUser.isSuccess ? currentUser.data.id : undefined;
  const namespace = useMemo(
    () => (ownerId ? { apiBaseUrl, ownerId } : null),
    [apiBaseUrl, ownerId],
  );
  const activeKey = namespaceKey(namespace);
  const active = useRef<SubmissionNamespace | null>(namespace);
  useLayoutEffect(() => {
    active.current = namespace;
    return () => {
      active.current = null;
    };
  }, [namespace]);
  const [view, setView] = useState<{
    key: string;
    records: FinanceSubmission[];
    storageError: string | null;
    messages: Record<string, string>;
  }>({ key: "", records: [], storageError: null, messages: {} });
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const running = useRef(new Map<string, Promise<void>>());
  const matches = useCallback(
    (owner: SubmissionNamespace) =>
      namespaceKey(active.current) === namespaceKey(owner) &&
      normalizedApiBaseUrl(env.VITE_API_BASE_URL) === owner.apiBaseUrl,
    [],
  );
  const showMessage = useCallback(
    (record: FinanceSubmission, message: string) => {
      if (matches(record))
        setView((previous) => {
          if (
            record.state === "unresolved" &&
            previous.records.some(
              (current) =>
                current.submissionId === record.submissionId &&
                current.state === "resolved",
            )
          )
            return previous;
          return {
            ...previous,
            key: namespaceKey(record),
            records:
              previous.key === namespaceKey(record) ? previous.records : [],
            storageError:
              previous.key === namespaceKey(record)
                ? previous.storageError
                : null,
            messages: {
              ...(previous.key === namespaceKey(record)
                ? previous.messages
                : {}),
              [record.submissionId]: message,
            },
          };
        });
    },
    [matches],
  );
  const load = useCallback(
    async (owner: SubmissionNamespace) => {
      try {
        const records = await readSubmissions(owner);
        if (matches(owner))
          setView((previous) => ({
            key: namespaceKey(owner),
            records,
            storageError: null,
            messages: Object.fromEntries(
              Object.entries(
                previous.key === namespaceKey(owner) ? previous.messages : {},
              ).filter(([id]) => {
                const current = records.find(
                  (record) => record.submissionId === id,
                );
                const prior = previous.records.find(
                  (record) => record.submissionId === id,
                );
                return current && current.state === prior?.state;
              }),
            ),
          }));
        return records;
      } catch (error) {
        if (matches(owner))
          setView({
            key: namespaceKey(owner),
            records: [],
            storageError: messageFor(error),
            messages: {},
          });
        throw error;
      }
    },
    [matches],
  );
  const assertOwner = useCallback(
    async (owner: SubmissionNamespace) => {
      if (!matches(owner))
        throw new SubmissionRecoveryError(
          "Current User or API changed. Return to the original user and API to recover this submission.",
        );
      const response = await getCurrentUser({ cache: "no-store" });
      const user = MeResponse.parse(response.data);
      if (matches(owner) && user.id !== owner.ownerId)
        queryClient.setQueryData(getGetCurrentUserQueryKey(), response);
      if (user.id !== owner.ownerId || !matches(owner))
        throw new SubmissionRecoveryError(
          "Current User changed or is unavailable. Reload to recover under the original user.",
        );
    },
    [matches, queryClient],
  );

  const refresh = useCallback(
    async (
      record: FinanceSubmission,
    ): Promise<
      Pick<SubmitResult, "ledger" | "account" | "category" | "message">
    > => {
      const label = submissionLabel(record);
      try {
        await assertOwner(record);
        let resource: Pick<SubmitResult, "ledger" | "account" | "category"> =
          {};
        const outcome =
          record.state === "resolved" && record.resolution.kind === "receipt"
            ? record.resolution.receipt.outcome
            : null;
        if (outcome?.kind !== "created") return resource;
        const id = outcome.resource.id;
        switch (record.operation) {
          case "createFinanceLedger": {
            const response = await listFinanceLedgers({ cache: "no-store" });
            const values = LedgerResponse.array().parse(response.data);
            if (!matches(record)) return {};
            queryClient.setQueryData(getListFinanceLedgersQueryKey(), response);
            resource = { ledger: values.find((value) => value.id === id) };
            break;
          }
          case "createFinanceAccount": {
            const response = await listFinanceAccounts(record.targetLedgerId, {
              cache: "no-store",
            });
            const values = AccountResponse.array().parse(response.data);
            if (!matches(record)) return {};
            queryClient.setQueryData(
              getListFinanceAccountsQueryKey(record.targetLedgerId),
              response,
            );
            resource = { account: values.find((value) => value.id === id) };
            break;
          }
          case "createFinanceCategory": {
            const response = await listFinanceCategories(
              record.targetLedgerId,
              { cache: "no-store" },
            );
            const values = CategoryResponse.array().parse(response.data);
            if (!matches(record)) return {};
            queryClient.setQueryData(
              getListFinanceCategoriesQueryKey(record.targetLedgerId),
              response,
            );
            resource = { category: values.find((value) => value.id === id) };
            break;
          }
        }
        const message = Object.values(resource).some(Boolean)
          ? `${label} creation is confirmed. Your ${label} list is current.`
          : `${label} creation is confirmed. The ${label} is currently unavailable; it will not be recreated.`;
        showMessage(record, message);
        return { ...resource, message };
      } catch {
        const message = `${label} creation is confirmed. Your ${label} list could not refresh. Retry the list refresh; do not create again.`;
        showMessage(record, message);
        return { message };
      }
    },
    [assertOwner, matches, queryClient, showMessage],
  );

  const settle = useCallback(
    async (
      record: FinanceSubmission,
      resolution: SubmissionResolution,
    ): Promise<SubmitResult> => {
      const resolved = await resolveSubmission(record, resolution);
      await load(record);
      if (!resolved) return { record };
      if (
        resolved.state === "resolved" &&
        resolved.resolution.kind === "receipt" &&
        resolved.resolution.receipt.outcome.kind === "created"
      ) {
        const refreshed = await refresh(resolved);
        return resolved.operation === "createFinanceLedger"
          ? { record: resolved, ledger: refreshed.ledger }
          : { record: resolved, ...refreshed };
      }
      return {
        record: resolved,
        message:
          resolution.kind === "notAdmitted"
            ? "This command was not admitted. Correct the draft and create a new submission."
            : rejectionMessage(resolved),
      };
    },
    [load, refresh],
  );

  const dispatch = useCallback(
    async (identity: FinanceSubmission): Promise<SubmitResult> => {
      await assertOwner(identity);
      const record = await readSubmission(identity);
      if (!record)
        throw new SubmissionRecoveryError(
          "This submission was already acknowledged. It will not be retried.",
        );
      if (record.state === "resolved") return { record };
      if (record.integrityBlocked)
        throw new SubmissionRecoveryError(
          "The submission identity conflicts with another command. Recovery is blocked; do not retry or create a replacement.",
        );
      await assertOwner(record);
      let resolution: SubmissionResolution | null;
      try {
        const headers = {
          "Idempotency-Key": record.submissionId,
          "Finance-Command-Version": record.commandVersion,
          "Finance-Submission-Owner": record.ownerId,
        };
        const response =
          record.operation === "createFinanceLedger"
            ? await createFinanceLedger(record.body, headers)
            : record.operation === "createFinanceAccount"
              ? await createFinanceAccount(
                  record.targetLedgerId,
                  record.body,
                  headers,
                )
              : await createFinanceCategory(
                  record.targetLedgerId,
                  record.body,
                  headers,
                );
        resolution = createResponseResolution(record, response.data);
        if (!resolution)
          throw new SubmissionRecoveryError(
            "The response evidence does not match this submission. Check its outcome; do not create again.",
          );
      } catch (error) {
        resolution = errorResolution(record, errorBody(error));
        if (!resolution) {
          const problem = nonterminalProblem(error);
          let message = `The ${submissionLabel(record)} outcome is unknown. Check the outcome or retry the original submission. Do not submit the draft again.`;
          if (problem.success) {
            const code = problem.data.code;
            if (
              code === "finance_submission_content_conflict" ||
              code === "finance_submission_version_mismatch"
            ) {
              await blockConflictingSubmission(record);
              message =
                "The submission identity conflicts with another command. Recovery is blocked; do not create a replacement.";
            } else if (
              code === "finance_submission_protocol_required" ||
              code === "finance_submission_protocol_invalid" ||
              code === "finance_command_version_unsupported" ||
              code === "finance_command_version_closed"
            ) {
              message =
                "Update Core Console before recovering this submission. Its original command and version are retained.";
            } else if (problem.data.status === 403) {
              message =
                "Access is unavailable. Return to the original active user to recover this submission.";
            }
          }
          showMessage(record, message);
          await load(record);
          return { record, message };
        }
      }
      return settle(record, resolution);
    },
    [assertOwner, load, settle, showMessage],
  );

  const run = useCallback(
    (record: FinanceSubmission, action: () => Promise<void>) => {
      const token = submissionToken(record);
      const existing = running.current.get(token);
      if (existing) return existing;
      const task = Promise.resolve()
        .then(action)
        .catch((error: unknown) => {
          showMessage(record, messageFor(error));
        })
        .finally(() => {
          running.current.delete(token);
          setBusy(new Set(running.current.keys()));
        });
      running.current.set(token, task);
      setBusy(new Set(running.current.keys()));
      return task;
    },
    [showMessage],
  );

  const lookup = useCallback(
    async (identity: FinanceSubmission) =>
      run(identity, async () => {
        await assertOwner(identity);
        const record = await readSubmission(identity);
        if (!record || record.state !== "unresolved") {
          await load(identity);
          return;
        }
        const response = await getFinanceSubmission(
          record.submissionId,
          { "Finance-Submission-Owner": record.ownerId },
          { cache: "no-store" },
        );
        const evidence = FinanceSubmissionResponse.parse(response.data);
        if (evidence.state === "terminal") {
          if (!correlates(record, evidence.receipt))
            throw new SubmissionRecoveryError(
              "Outcome evidence does not match the original command. Recovery is blocked.",
            );
          await settle(record, { kind: "receipt", receipt: evidence.receipt });
        } else {
          if (!correlates(record, evidence))
            throw new SubmissionRecoveryError(
              "Lookup evidence does not match the original command. Recovery is blocked.",
            );
          showMessage(
            record,
            "The original submission is unfinished. Retry it explicitly to continue.",
          );
        }
      }),
    [assertOwner, load, run, settle, showMessage],
  );

  const recover = useCallback(async () => {
    const owner = active.current;
    if (!owner) return;
    try {
      const records = await load(owner);
      await Promise.all(
        records.filter((record) => record.state === "unresolved").map(lookup),
      );
    } catch {
      /* load reports persistence failures */
    }
  }, [load, lookup]);

  useEffect(() => {
    void recover();
  }, [activeKey, location.key, recover]);
  useEffect(() => {
    const reread = () => {
      const owner = active.current;
      if (owner) void load(owner).catch(() => undefined);
    };
    const activate = () => {
      if (document.visibilityState === "visible") void recover();
    };
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(submissionDatabaseName)
        : null;
    if (channel) channel.onmessage = reread;
    window.addEventListener(journalChangedEvent, reread);
    window.addEventListener("focus", activate);
    document.addEventListener("visibilitychange", activate);
    return () => {
      channel?.close();
      window.removeEventListener(journalChangedEvent, reread);
      window.removeEventListener("focus", activate);
      document.removeEventListener("visibilitychange", activate);
    };
  }, [load, recover]);

  const visible =
    view.key === activeKey
      ? view
      : { records: [], storageError: null, messages: {} };
  const submit: SubmissionContext["submit"] = async (command, prepared) => {
    const owner = active.current;
    if (!owner)
      throw new SubmissionRecoveryError(
        "Current User is unavailable. Restore access before creating in Finance.",
      );
    await assertOwner(owner);
    // Existing corrupt/incompatible records block preparation without erasing evidence.
    await load(owner);
    const record = await prepareSubmission(owner, command);
    if (matches(owner)) prepared(record.submissionId);
    try {
      return await dispatch(record);
    } catch (error) {
      const message = messageFor(error);
      showMessage(record, message);
      return { record, message };
    }
  };
  return (
    <FinanceSubmissionContext
      value={{
        partitionKey: activeKey,
        ready: Boolean(namespace) && !visible.storageError,
        ...visible,
        busy,
        submit,
        lookup,
        retry: async (record) => {
          // Preserve an explicit click racing a recovery read. Waiting does
          // not grant execution intent to the automatic lookup itself.
          await running.current.get(submissionToken(record));
          return run(record, async () => {
            const result = await dispatch(record);
            if (result.message) showMessage(record, result.message);
          });
        },
        acknowledge: (record) =>
          run(record, async () => {
            await assertOwner(record);
            await acknowledgeSubmission(record);
            await load(record);
          }),
        refreshResourceList: (record) =>
          run(record, async () => {
            await refresh(record);
          }),
        recover,
      }}
    >
      {children}
    </FinanceSubmissionContext>
  );
}
