import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import type { SubmitResult } from "./finance-submission-context";
import type { CreateSubmissionCommand } from "./submission-journal";
import { useFinanceSubmissions } from "./finance-submission-context";
import { SubmissionRecoveryError } from "./submission-journal";

const emptyAttempt = {
  pending: false,
  submittedId: null as string | null,
  terminal: false,
  created: false,
  rejected: false,
  error: null as string | null,
};

export function useFinanceCreate(
  onCreated: (
    result: SubmitResult,
    isCurrent: () => boolean,
  ) => void | Promise<void>,
  lifetime: string,
  enabled = true,
  options?: {
    operation: CreateSubmissionCommand["operation"];
    continueAfterCreated?: boolean;
    onRejected?: (
      problem: unknown,
      isCurrent: () => boolean,
    ) => void | Promise<void>;
  },
) {
  const journal = useFinanceSubmissions();
  const mutation = useMutation({
    mutationKey: [options?.operation ?? "financeCreate"],
    mutationFn: ({
      run,
    }: {
      ledgerId: string | null;
      run: () => Promise<void>;
    }) => run(),
  });
  const attemptKey = `${journal.partitionKey}|${lifetime}|${enabled}`;
  const [attempt, setAttempt] = useState({
    key: attemptKey,
    ...emptyAttempt,
  });
  if (attempt.key !== attemptKey)
    setAttempt({ key: attemptKey, ...emptyAttempt });
  const visible = attempt.key === attemptKey ? attempt : emptyAttempt;
  const session = useRef({ mounted: true, revision: 0, pending: false });
  useLayoutEffect(() => {
    // A new namespace has a new form attempt lifetime. Old callbacks retain
    // their closed session even if the original namespace is later restored.
    const workflowSession = { mounted: enabled, revision: 0, pending: false };
    session.current = workflowSession;
    return () => {
      workflowSession.mounted = false;
      workflowSession.revision += 1;
    };
  }, [journal.partitionKey, lifetime, enabled]);
  const stored = journal.records.find(
    (record) => record.submissionId === visible.submittedId,
  );
  const unresolved =
    Boolean(visible.submittedId) &&
    !visible.terminal &&
    stored?.state !== "resolved";
  const locked =
    unresolved ||
    visible.created ||
    (stored?.state === "resolved" &&
      stored.resolution.kind === "receipt" &&
      stored.resolution.receipt.outcome.kind === "created");

  const submit = async (command: CreateSubmissionCommand) => {
    const workflowSession = session.current;
    if (!enabled || workflowSession.pending || locked || !journal.ready) return;
    const revision = workflowSession.revision;
    const isCurrent = () =>
      workflowSession.mounted && revision === workflowSession.revision;
    const key = attemptKey;
    workflowSession.pending = true;
    setAttempt({ key, ...emptyAttempt, pending: true });
    try {
      await mutation.mutateAsync({
        ledgerId: command.targetLedgerId,
        run: async () => {
          const result = await journal.submit(command, (id) => {
            if (workflowSession.mounted)
              setAttempt((previous) => ({
                ...previous,
                key,
                submittedId: id,
                terminal: false,
              }));
          });
          if (!workflowSession.mounted) {
            await result.refreshing;
            return;
          }
          setAttempt((previous) => ({
            ...previous,
            terminal: result.record.state === "resolved",
            created:
              result.record.state === "resolved" &&
              result.record.resolution.kind === "receipt" &&
              result.record.resolution.receipt.outcome.kind === "created",
            rejected:
              result.record.state === "resolved" &&
              result.record.resolution.kind === "receipt" &&
              result.record.resolution.receipt.outcome.kind === "rejected",
            error: result.message ?? null,
          }));
          if (
            (result.ledger ||
              result.account ||
              result.category ||
              result.transaction) &&
            isCurrent()
          ) {
            await onCreated(result, isCurrent);
            if (options?.continueAfterCreated && isCurrent()) {
              setAttempt({ key, ...emptyAttempt, pending: true });
              workflowSession.revision += 1;
            }
          }
          if (
            isCurrent() &&
            result.record.state === "resolved" &&
            result.record.resolution.kind === "receipt" &&
            result.record.resolution.receipt.outcome.kind === "rejected"
          )
            await options?.onRejected?.(
              result.record.resolution.receipt.outcome.problem,
              isCurrent,
            );
          if (
            command.operation === "createFinanceTransaction" &&
            command.workflow !== "quickEntry"
          )
            await result.refreshing;
        },
      });
    } catch (failure) {
      if (workflowSession.mounted)
        setAttempt((previous) => ({
          ...previous,
          error:
            failure instanceof SubmissionRecoveryError
              ? failure.message
              : "Browser preparation failed. Nothing was dispatched. Reload recovery and try again.",
        }));
    } finally {
      workflowSession.pending = false;
      if (workflowSession.mounted)
        setAttempt((previous) => ({ ...previous, pending: false }));
    }
  };
  const edited = useCallback(() => {
    session.current.revision += 1;
    setAttempt((previous) =>
      previous.terminal ? { ...previous, error: null } : previous,
    );
  }, []);
  return {
    pending: visible.pending,
    unresolved: Boolean(locked),
    integrityBlocked: stored?.integrityBlocked ?? false,
    error: visible.error,
    rejected:
      visible.rejected ||
      (stored?.state === "resolved" &&
        stored.resolution.kind === "receipt" &&
        stored.resolution.receipt.outcome.kind === "rejected"),
    ready: journal.ready && enabled,
    submit,
    edited,
    startAnother: () => {
      setAttempt({ key: attemptKey, ...emptyAttempt });
      session.current.revision += 1;
    },
  };
}
