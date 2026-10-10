import {
  submissionLabel,
  submissionDescription,
  rejectionMessage,
  isQuickEntrySubmission,
} from "./submission-journal";
import { locale, messages } from "@/lib/i18n";

import { Link, useLocation } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFinanceSubmissions } from "./finance-submission-context";
import type { LedgerResponse } from "@/api/generated/schemas";

const copy = messages.finance.quickEntry.recovery;
export function FinanceSubmissionRecovery({
  ledgers,
}: {
  ledgers: LedgerResponse[];
}) {
  const journal = useFinanceSubmissions();
  const location = useLocation();
  const ledgerId = new URLSearchParams(location.search).get("ledger");
  const overview =
    location.pathname === "/finance/overview" &&
    ledgers.some((ledger) => ledger.id === ledgerId);
  const hasQuickEntry = journal.records.some(isQuickEntrySubmission);
  return (
    <section
      aria-label="Finance submission recovery"
      lang="en"
      className="flex flex-col gap-3"
    >
      {!journal.ready && !journal.storageError ? (
        <p
          role="status"
          className="text-sm text-muted-foreground"
          lang={overview ? locale : "en"}
        >
          {overview
            ? copy.userUnavailable
            : "Current User is unavailable or loading. Finance creation and recovery require an active user."}
        </p>
      ) : null}
      {journal.storageError ? (
        <Alert variant="destructive" lang={overview ? locale : "en"}>
          <AlertTitle>
            {overview ? copy.storageTitle : "Browser recovery unavailable"}
          </AlertTitle>
          <AlertDescription>
            {overview
              ? journal.storageError.localizedMessage
              : journal.storageError.message}
          </AlertDescription>
          <Button
            onClick={() => void journal.recover()}
            size="sm"
            variant="outline"
          >
            {overview ? copy.reload : "Reload recovery"}
          </Button>
        </Alert>
      ) : null}
      {journal.records.length ? (
        <h2
          className="text-base font-semibold"
          lang={hasQuickEntry ? locale : "en"}
        >
          {hasQuickEntry ? copy.heading : "Finance submissions"}
        </h2>
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
        const localized = isQuickEntrySubmission(record);
        const label = submissionLabel(record);
        const description =
          localized &&
          record.operation === "createFinanceTransaction" &&
          record.body.kind !== "internalTransfer"
            ? copy.description(
                record.body.kind,
                record.body.economicAmount.amount,
                record.body.economicAmount.currency,
                record.body.transactionDate,
              )
            : submissionDescription(record);
        const originalLedger = ledgers.find(
          (ledger) => ledger.id === record.targetLedgerId,
        );
        const title =
          resolution?.kind === "notAdmitted"
            ? localized
              ? copy.notAdmitted
              : "Command not admitted"
            : outcome?.kind === "created"
              ? localized
                ? copy.created
                : `${label} created`
              : outcome?.kind === "noChange"
                ? "Balance Adjustment requires no change"
                : outcome?.kind === "rejected"
                  ? localized
                    ? copy.rejected
                    : `${label} create rejected`
                  : localized
                    ? copy.unknown
                    : `${label} outcome unknown`;
        const accessibleTitle = localized
          ? copy.titleDescription(title, description)
          : `${title}: ${description}`;
        return (
          <Alert
            key={record.submissionId}
            lang={localized ? locale : "en"}
            role="status"
            aria-label={accessibleTitle}
          >
            <AlertTitle>
              <span className="[overflow-wrap:anywhere]">
                {accessibleTitle}
              </span>
            </AlertTitle>
            <AlertDescription>
              <p>
                {journal.messages[record.submissionId] ??
                  (record.integrityBlocked
                    ? localized
                      ? copy.conflict
                      : "Submission identity conflict. Recovery is blocked; do not create a replacement."
                    : resolution
                      ? outcome?.kind === "rejected"
                        ? localized
                          ? copy.rejectedGuidance
                          : `${rejectionMessage(record)} Corrected content needs a new submission.`
                        : localized
                          ? copy.saved
                          : "The outcome is saved. Acknowledge it to remove this browser recovery record."
                      : localized
                        ? copy.retained
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
                  {localized ? (
                    copy.originalLedger(
                      originalLedger?.name ?? record.targetLedgerId,
                    )
                  ) : (
                    <>
                      Original Ledger:{" "}
                      {originalLedger?.name ?? record.targetLedgerId}
                    </>
                  )}
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
                      {localized ? copy.check : "Check outcome"}
                    </Button>
                    <Button
                      disabled={pending || record.integrityBlocked}
                      onClick={() => void journal.retry(record)}
                      size="sm"
                    >
                      {localized ? copy.retry : "Retry original submission"}
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
                          {localized ? (
                            copy.open
                          ) : (
                            <>
                              Open{" "}
                              {record.operation === "createFinanceLedger"
                                ? "Ledger"
                                : record.operation === "createFinanceAccount"
                                  ? "Accounts"
                                  : record.operation === "createFinanceCategory"
                                    ? "Categories"
                                    : "Transactions"}
                            </>
                          )}
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
                        {localized
                          ? copy.refresh
                          : record.operation === "createBalanceAdjustment"
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
                      {localized ? copy.acknowledge : "Acknowledge outcome"}
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
