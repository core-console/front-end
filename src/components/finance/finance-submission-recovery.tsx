import {
  submissionLabel,
  submissionDescription,
  rejectionMessage,
} from "./submission-journal";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFinanceSubmissions } from "./finance-submission-context";
import type { LedgerResponse } from "@/api/generated/schemas";
export function FinanceSubmissionRecovery({
  ledgers,
}: {
  ledgers: LedgerResponse[];
}) {
  const journal = useFinanceSubmissions();
  return (
    <section
      aria-label="Finance submission recovery"
      className="flex flex-col gap-3"
    >
      {!journal.ready && !journal.storageError ? (
        <p role="status" className="text-sm text-muted-foreground">
          Current User is unavailable or loading. Finance creation and recovery
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
        <h2 className="text-base font-semibold">Finance submissions</h2>
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
        const label = submissionLabel(record);
        const description = submissionDescription(record);
        const originalLedger = ledgers.find(
          (ledger) => ledger.id === record.targetLedgerId,
        );
        const title =
          resolution?.kind === "notAdmitted"
            ? "Command not admitted"
            : outcome?.kind === "created"
              ? `${label} created`
              : outcome?.kind === "noChange"
                ? "Balance Adjustment requires no change"
                : outcome?.kind === "rejected"
                  ? `${label} create rejected`
                  : `${label} outcome unknown`;
        return (
          <Alert
            key={record.submissionId}
            role="status"
            aria-label={`${title}: ${description}`}
          >
            <AlertTitle>
              {title}:{" "}
              <span className="[overflow-wrap:anywhere]">{description}</span>
            </AlertTitle>
            <AlertDescription>
              <p>
                {journal.messages[record.submissionId] ??
                  (record.integrityBlocked
                    ? "Submission identity conflict. Recovery is blocked; do not create a replacement."
                    : resolution
                      ? outcome?.kind === "rejected"
                        ? `${rejectionMessage(record)} Corrected content needs a new submission.`
                        : "The outcome is saved. Acknowledge it to remove this browser recovery record."
                      : `The original command is saved in this browser. Checking its outcome does not create a ${label}.`)}
              </p>
              {record.operation === "createFinanceAccount" ? (
                <p className="[overflow-wrap:anywhere]">
                  Opening balance: {record.body.openingBalance.amount}{" "}
                  {record.body.openingBalance.currency}; {record.body.nature};
                  tracking from {record.body.trackingStartDate}.
                </p>
              ) : null}
              {record.operation === "createBalanceAdjustment" ? (
                <p className="[overflow-wrap:anywhere]">
                  Original Account: {record.body.accountId}; expected balance:{" "}
                  {record.body.expectedDerivedBalance.amount}{" "}
                  {record.body.expectedDerivedBalance.currency}; expected
                  nature: {record.body.expectedAccountNature}.
                </p>
              ) : null}
              {record.targetLedgerId ? (
                <p className="[overflow-wrap:anywhere]">
                  Original Ledger:{" "}
                  {originalLedger?.name ?? record.targetLedgerId}
                </p>
              ) : null}
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
                          to={
                            record.operation === "createFinanceLedger"
                              ? `/finance/overview?ledger=${outcome.resource.id}`
                              : `/finance/${record.operation === "createFinanceAccount" ? "accounts" : record.operation === "createFinanceCategory" ? "categories" : "transactions"}?ledger=${record.targetLedgerId}`
                          }
                        >
                          Open{" "}
                          {record.operation === "createFinanceLedger"
                            ? "Ledger"
                            : record.operation === "createFinanceAccount"
                              ? "Accounts"
                              : record.operation === "createFinanceCategory"
                                ? "Categories"
                                : "Transactions"}
                        </Link>
                      </>
                    ) : null}
                    {outcome?.kind === "created" ||
                    outcome?.kind === "noChange" ? (
                      <Button
                        disabled={pending}
                        onClick={() => void journal.refreshResourceList(record)}
                        size="sm"
                        variant="outline"
                      >
                        {record.operation === "createBalanceAdjustment"
                          ? "Refresh Finance resources"
                          : `Refresh ${label} list`}
                      </Button>
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
