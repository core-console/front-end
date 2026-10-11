import type { UseQueryResult } from "@tanstack/react-query";
import { useId, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { locale, messages } from "@/lib/i18n";

export function TransactionDependencyStatus({
  label,
  query,
}: {
  label: string;
  query: Pick<
    UseQueryResult,
    "isError" | "isFetching" | "isPending" | "refetch"
  >;
}) {
  // Retain the retry control after recovery so keyboard focus stays in place.
  const [retainRetryControl, setRetainRetryControl] = useState(false);
  const [manualRetryActive, setManualRetryActive] = useState(false);
  const descriptionId = useId();
  const copy = messages.finance.transactionDependencies;
  if (!query.isPending && !query.isError && !retainRetryControl) return null;

  const failed = query.isError && !query.isFetching;
  const message = query.isFetching
    ? manualRetryActive
      ? copy.retrying(label)
      : copy.loading(label)
    : failed
      ? copy.failed(label)
      : query.isPending
        ? copy.loading(label)
        : copy.recovered(label);

  return (
    <Alert lang={locale} role={failed ? "alert" : "status"}>
      <AlertDescription className="flex flex-col items-start gap-2">
        <p id={descriptionId}>{message}</p>
        {query.isError || retainRetryControl ? (
          <Button
            aria-describedby={descriptionId}
            disabled={!failed}
            focusableWhenDisabled
            onClick={() => {
              if (!failed) return;
              setRetainRetryControl(true);
              setManualRetryActive(true);
              void query
                .refetch({ cancelRefetch: false })
                .finally(() => setManualRetryActive(false));
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {copy.retry(label)}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
