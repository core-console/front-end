import {
  submissionDatabaseName,
  SubmissionRecoveryError,
  type SubmissionNamespace,
} from "./submission-journal";

// Browser-owned lifetime: closing/crashing a page releases its claim without
// leaving a durable lock on an uncertain command. Different commands never wait.
export async function withSubmissionLock<T>(
  identity: SubmissionNamespace & { submissionId: string },
  action: () => Promise<T>,
  phase: "submit" | "lookup" | "retry" = "submit",
): Promise<T | undefined> {
  if (!navigator.locks)
    throw new SubmissionRecoveryError(
      "Browser submission coordination is unavailable. Use a supported browser in a secure context, retaining site data to recover existing submissions.",
    );
  return navigator.locks.request(
    JSON.stringify([
      submissionDatabaseName,
      identity.apiBaseUrl,
      identity.ownerId,
      identity.submissionId,
    ]),
    // Only the original attempt excludes recovery. Once its outcome is
    // uncertain, lookup and explicit retries must remain able to converge.
    // Automatic lookup never queues; an explicit retry retains user intent.
    {
      ifAvailable: phase !== "retry",
      mode: phase === "submit" ? "exclusive" : "shared",
    },
    (lock) => (lock ? action() : undefined),
  );
}
