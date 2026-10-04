import { useLayoutEffect, useRef, useState } from "react";

import type { LedgerResponse } from "@/api/generated/schemas";
import { useLedgerSubmissions } from "./ledger-submission-context";
import { SubmissionRecoveryError } from "./submission-journal";

const emptyAttempt = {
  pending: false,
  submittedId: null as string | null,
  terminal: false,
  created: false,
  error: null as string | null,
};

export function useLedgerCreate(
  workflow: "onboarding" | "additional",
  onCreated: (ledger: LedgerResponse) => void,
) {
  const journal = useLedgerSubmissions();
  const [attempt, setAttempt] = useState({
    key: journal.partitionKey,
    ...emptyAttempt,
  });
  if (attempt.key !== journal.partitionKey)
    setAttempt({ key: journal.partitionKey, ...emptyAttempt });
  const visible = attempt.key === journal.partitionKey ? attempt : emptyAttempt;
  const session = useRef({ mounted: true, revision: 0, pending: false });
  useLayoutEffect(() => {
    // A new namespace has a new form attempt lifetime. Old callbacks retain
    // their closed session even if the original namespace is later restored.
    const workflowSession = { mounted: true, revision: 0, pending: false };
    session.current = workflowSession;
    return () => {
      workflowSession.mounted = false;
      workflowSession.revision += 1;
    };
  }, [journal.partitionKey]);
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

  const submit = async (name: string) => {
    const workflowSession = session.current;
    if (workflowSession.pending || locked || !journal.ready) return;
    const revision = workflowSession.revision;
    const key = journal.partitionKey;
    workflowSession.pending = true;
    setAttempt({ key, ...emptyAttempt, pending: true });
    try {
      const result = await journal.submit(name, workflow, (id) => {
        if (workflowSession.mounted)
          setAttempt((previous) => ({
            ...previous,
            key,
            submittedId: id,
            terminal: false,
          }));
      });
      if (!workflowSession.mounted) return;
      setAttempt((previous) => ({
        ...previous,
        terminal: result.record.state === "resolved",
        created:
          result.record.state === "resolved" &&
          result.record.resolution.kind === "receipt" &&
          result.record.resolution.receipt.outcome.kind === "created",
        error: result.message ?? null,
      }));
      if (result.ledger && revision === workflowSession.revision)
        onCreated(result.ledger);
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
  return {
    pending: visible.pending,
    unresolved: Boolean(locked),
    error: visible.error,
    ready: journal.ready,
    submit,
    edited: () => {
      session.current.revision += 1;
    },
    startAnother: () => {
      setAttempt({ key: journal.partitionKey, ...emptyAttempt });
      session.current.revision += 1;
    },
  };
}
