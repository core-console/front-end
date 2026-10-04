import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useLedgerSubmissions } from "./ledger-submission-context";
export function LedgerSubmissionRecovery() {
  const journal = useLedgerSubmissions();
  return (
    <section
      aria-label="Ledger submission recovery"
      className="flex flex-col gap-3"
    >
      {!journal.ready && !journal.storageError ? (
        <p role="status" className="text-sm text-muted-foreground">
          Current User is unavailable or loading. Ledger creation and recovery
          require an active user.
        </p>
      ) : null}
      {journal.storageError ? (
        <Alert variant="destructive">
          <AlertTitle>Browser recovery unavailable</AlertTitle>
          <AlertDescription>{journal.storageError}</AlertDescription>
          <Button
            onClick={() => void journal.recover()}
            size="sm"
            variant="outline"
          >
            Reload recovery
          </Button>
        </Alert>
      ) : null}
      {journal.records.length ? (
        <h2 className="text-base font-semibold">Ledger submissions</h2>
      ) : null}
      {journal.records.map((record) => {
        const pending = journal.busy.has(
          JSON.stringify([
            record.apiBaseUrl,
            record.ownerId,
            record.submissionId,
          ]),
        );
        const resolution =
          record.state === "resolved" ? record.resolution : null;
        const outcome =
          resolution?.kind === "receipt" ? resolution.receipt.outcome : null;
        const title =
          resolution?.kind === "notAdmitted"
            ? "Command not admitted"
            : outcome?.kind === "created"
              ? "Ledger created"
              : outcome?.kind === "rejected"
                ? "Ledger create rejected"
                : "Ledger outcome unknown";
        return (
          <Alert
            key={record.submissionId}
            role="status"
            aria-label={`${title}: ${record.body.name}`}
          >
            <AlertTitle>
              {title}:{" "}
              <span className="[overflow-wrap:anywhere]">
                {record.body.name}
              </span>
            </AlertTitle>
            <AlertDescription>
              <p>
                {journal.messages[record.submissionId] ??
                  (record.integrityBlocked
                    ? "Submission identity conflict. Recovery is blocked; do not create a replacement."
                    : resolution
                      ? outcome?.kind === "rejected"
                        ? "A Ledger with this name already exists. Corrected content needs a new submission."
                        : "The outcome is saved. Acknowledge it to remove this browser recovery record."
                      : "The original command is saved in this browser. Checking its outcome does not create a Ledger.")}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {record.state === "unresolved" ? (
                  <>
                    <Button
                      disabled={pending}
                      onClick={() => void journal.lookup(record)}
                      size="sm"
                      variant="outline"
                    >
                      Check outcome
                    </Button>
                    <Button
                      disabled={pending || record.integrityBlocked}
                      onClick={() => void journal.retry(record)}
                      size="sm"
                    >
                      Retry original submission
                    </Button>
                  </>
                ) : (
                  <>
                    {outcome?.kind === "created" ? (
                      <>
                        <Link
                          className="underline underline-offset-4"
                          to={`/finance/overview?ledger=${outcome.resource.id}`}
                        >
                          Open Ledger
                        </Link>
                        <Button
                          disabled={pending}
                          onClick={() => void journal.refreshLedgerList(record)}
                          size="sm"
                          variant="outline"
                        >
                          Refresh Ledger list
                        </Button>
                      </>
                    ) : null}
                    <Button
                      disabled={pending}
                      onClick={() => void journal.acknowledge(record)}
                      size="sm"
                      variant="outline"
                    >
                      Acknowledge outcome
                    </Button>
                  </>
                )}
              </div>
            </AlertDescription>
          </Alert>
        );
      })}
    </section>
  );
}
