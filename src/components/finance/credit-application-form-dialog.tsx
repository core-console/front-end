import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import {
  useListFinanceParticipantObligations,
  useListFinanceParticipantCredits,
  usePreviewFinanceSettlement,
} from "@/api/generated/core-console";
import {
  CreditApplicationPreview,
  CreditOriginResponse,
  ObligationResponse,
  PreviewFinanceSettlementBody,
  type CurrencyResponse,
  type ParticipantResponse,
  FinanceRequestDate,
} from "@/api/generated/schemas";
import { useFinanceSubmissions } from "./finance-submission-context";
import { useFinanceCreate } from "./use-finance-create";
import { subtractExactDecimals } from "./finance-decimal";
import { formatFinanceMoney } from "./finance-money";
import { SettlementAllocations } from "./settlement-allocations";
import { CreditApplicationOrigins } from "./credit-application-origins";
import { validCreditApplicationPreview } from "./credit-application";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldSet,
  FieldLegend,
  FieldError,
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

type Draft = Extract<
  PreviewFinanceSettlementBody,
  { kind: "creditApplication" }
>;
const positive = (value: string) =>
  /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value);
export function CreditApplicationFormDialog({
  ledgerId,
  participants,
  currencies,
  initialParticipantId,
  onClose,
  onConfirmed,
  finalFocus,
  refreshDependencies,
}: {
  ledgerId: string;
  participants: ParticipantResponse[];
  currencies: CurrencyResponse[];
  initialParticipantId?: string | undefined;
  onClose: () => void;
  onConfirmed: (id: string, participantId: string) => void;
  finalFocus: ComponentProps<typeof DialogContent>["finalFocus"];
  refreshDependencies: () => Promise<void>;
}) {
  const [participantId, setParticipant] = useState(initialParticipantId ?? "");
  const [currency, setCurrency] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [note, setNote] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [storedReview, setReview] = useState<{
    draft: Draft;
    preview: CreditApplicationPreview;
  } | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const journal = useFinanceSubmissions();
  const obligations = useListFinanceParticipantObligations(
    ledgerId,
    participantId,
    {
      query: {
        enabled: !!participantId,
        select: (response) =>
          ObligationResponse.array()
            .refine((rows) =>
              rows.every(
                (row) =>
                  row.ledgerId === ledgerId &&
                  row.participantId === participantId,
              ),
            )
            .parse(response.data),
      },
    },
  );
  const credits = useListFinanceParticipantCredits(ledgerId, participantId, {
    query: {
      enabled: !!participantId,
      select: (response) =>
        CreditOriginResponse.array()
          .refine((rows) =>
            rows.every(
              (row) =>
                row.ledgerId === ledgerId &&
                row.participantId === participantId &&
                row.available.currency === row.amount.currency,
            ),
          )
          .parse(response.data),
    },
  });
  const eligible = (obligations.data ?? []).filter(
    (row) =>
      row.sourceDate <= date &&
      row.remaining.currency === currency &&
      positive(row.remaining.amount),
  );
  const unavailable = ids.filter(
    (id) => !eligible.some((row) => row.id === id),
  );
  const capacity = eligible
    .filter((row) => ids.includes(row.id))
    .reduce(
      (total, row) => subtractExactDecimals(total, `-${row.remaining.amount}`),
      "0",
    );
  const available = (credits.data ?? [])
    .filter(
      (row) =>
        row.available.currency === currency &&
        /^\d+(?:\.\d+)?$/.test(row.available.amount),
    )
    .reduce(
      (total, row) => subtractExactDecimals(total, `-${row.available.amount}`),
      "0",
    );
  const preview = usePreviewFinanceSettlement({ mutation: { retry: false } });
  const create = useFinanceCreate(
    (result) => {
      if (
        result.record.state === "resolved" &&
        result.record.resolution.kind === "receipt" &&
        result.record.resolution.receipt.outcome.kind === "created"
      )
        onConfirmed(
          result.record.resolution.receipt.outcome.resource.id,
          participantId,
        );
    },
    ledgerId,
    true,
    { operation: "createFinanceSettlement" },
  );
  const review = create.rejected ? null : storedReview;
  const locked = create.pending || create.unresolved;
  const busy = locked || preview.isPending || refreshing;
  useEffect(() => {
    if (review) confirm.current?.focus();
  }, [review]);
  useEffect(() => {
    if (create.rejected) first.current?.focus();
  }, [create.rejected]);
  function edit() {
    create.edited();
    setReview(null);
    setErrors({});
    setError("");
  }
  async function showPreview(event: FormEvent) {
    event.preventDefault();
    if (busy || !journal.isCurrentNamespace()) return;
    setReview(null);
    if (create.rejected) create.startAnother();
    const invalid: Record<string, string> = {};
    const unit = currencies.find((row) => row.code === currency);
    if (!participants.some((row) => row.id === participantId))
      invalid.participant =
        "Choose a Participant in this Ledger. Archived Participants may resolve debt and credit.";
    if (!unit) invalid.currency = "Choose an available currency.";
    if (!FinanceRequestDate.safeParse(date).success)
      invalid.date = "Enter a valid application date.";
    if (!obligations.isSuccess || !ids.length || unavailable.length)
      invalid.scope =
        "Select eligible outstanding Obligations. Remove unavailable selections explicitly or refresh dependencies.";
    if (
      !positive(amount) ||
      (amount.split(".")[1]?.length ?? 0) > (unit?.minorUnit ?? 0) ||
      amount.split(".")[0]!.replace(/^0+/, "").length > 131072
    )
      invalid.amount =
        "Enter a positive exact amount within the currency precision. Amounts are never rounded.";
    else if (subtractExactDecimals(capacity, amount).startsWith("-"))
      invalid.amount =
        "Credit application cannot exceed selected outstanding debt. Adjust the amount or selection explicitly.";
    // Availability is advisory; the producer authoritatively checks current credit.
    if ([...note.trim()].length > 500)
      invalid.note = "Enter a note of at most 500 characters.";
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      document.getElementById(`credit-${Object.keys(invalid)[0]}`)?.focus();
      return;
    }
    const parsed = PreviewFinanceSettlementBody.safeParse({
      kind: "creditApplication",
      participantId,
      selectedObligationIds: ids,
      transactionDate: date,
      amount: { amount, currency },
      note: note.trim() || null,
    });
    if (
      !parsed.success ||
      !("kind" in parsed.data) ||
      parsed.data.kind !== "creditApplication"
    )
      return;
    const draft = parsed.data;
    setError("");
    try {
      const response = await preview.mutateAsync({ ledgerId, data: draft });
      const result = CreditApplicationPreview.refine((item) =>
        validCreditApplicationPreview(item, draft),
      ).parse(response.data);
      if (journal.isCurrentNamespace()) setReview({ draft, preview: result });
    } catch {
      if (journal.isCurrentNamespace())
        setError(
          "Preview could not be loaded. Your amount and selected debt are preserved. Refresh dependencies and check available credit, eligible debt and credit Account Tracking Start Dates. Nothing was confirmed.",
        );
    }
  }
  const fields = [
    {
      id: "participant",
      label: "Participant",
      control: (
        <NativeSelect
          ref={first}
          id="credit-participant"
          value={participantId}
          onChange={(e) => {
            edit();
            setParticipant(e.target.value);
            setIds([]);
          }}
          aria-invalid={!!errors.participant}
          aria-describedby={
            errors.participant ? "credit-participant-error" : undefined
          }
        >
          <NativeSelectOption value="">Choose Participant</NativeSelectOption>
          {participants.map((row) => (
            <NativeSelectOption key={row.id} value={row.id}>
              {row.name} ({row.status}) · {row.id}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ),
    },
    {
      id: "currency",
      label: "Currency",
      control: (
        <NativeSelect
          id="credit-currency"
          value={currency}
          onChange={(e) => {
            edit();
            setCurrency(e.target.value);
          }}
          aria-invalid={!!errors.currency}
          aria-describedby={
            errors.currency ? "credit-currency-error" : undefined
          }
        >
          <NativeSelectOption value="">Choose currency</NativeSelectOption>
          {currencies.map((row) => (
            <NativeSelectOption key={row.code} value={row.code}>
              {row.code}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ),
    },
    {
      id: "date",
      label: "Application date",
      control: (
        <Input
          id="credit-date"
          type="date"
          value={date}
          onChange={(e) => {
            edit();
            setDate(e.target.value);
          }}
          aria-invalid={!!errors.date}
          aria-describedby={errors.date ? "credit-date-error" : undefined}
        />
      ),
    },
    {
      id: "amount",
      label: "Credit application amount",
      control: (
        <Input
          id="credit-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            edit();
            setAmount(e.target.value);
          }}
          aria-invalid={!!errors.amount}
          aria-describedby={errors.amount ? "credit-amount-error" : undefined}
        />
      ),
    },
    {
      id: "note",
      label: "Note",
      control: (
        <Textarea
          id="credit-note"
          value={note}
          onChange={(e) => {
            edit();
            setNote(e.target.value);
          }}
          aria-invalid={!!errors.note}
          aria-describedby={errors.note ? "credit-note-error" : undefined}
        />
      ),
    },
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        initialFocus={first}
        finalFocus={finalFocus}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>Apply credit</DialogTitle>
          <DialogDescription>
            Explicitly apply retained Participant credit to selected debt in one
            currency. Receivables and credit Liability decrease equally. No new
            cash receipt, Income, Expense or forgiveness. Oldest receipt
            confirmation origins are consumed first, independently of financial
            dates. Future-dated recording affects Current Balance immediately.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void showPreview(event)}
          className="flex min-w-0 flex-col gap-4"
        >
          <FieldSet disabled={busy}>
            <FieldLegend className="sr-only">
              Credit application details
            </FieldLegend>
            <FieldGroup>
              {fields.map((field) => (
                <Field key={field.id} data-invalid={!!errors[field.id]}>
                  <FieldLabel htmlFor={`credit-${field.id}`}>
                    {field.label}
                  </FieldLabel>
                  {field.control}
                  {errors[field.id] ? (
                    <FieldError id={`credit-${field.id}-error`}>
                      {errors[field.id]}
                    </FieldError>
                  ) : null}
                </Field>
              ))}
              <FieldSet
                id="credit-scope"
                tabIndex={-1}
                aria-invalid={!!errors.scope}
                aria-describedby={
                  errors.scope ? "credit-scope-error" : undefined
                }
              >
                <FieldLegend>Select debt to apply credit</FieldLegend>
                <p>
                  Only checked eligible Obligations are affected. Unselected
                  debt remains outstanding.
                </p>
                {currency ? (
                  <p>
                    Selected outstanding debt: {capacity} {currency} · Available
                    credit:{" "}
                    {credits.isSuccess
                      ? `${available} ${currency}`
                      : "unavailable"}
                    . Preview checks authoritative availability.
                  </p>
                ) : null}
                {participantId && !obligations.isSuccess ? (
                  <p role="status">
                    {obligations.isError
                      ? "Debt could not load. Refresh dependencies to retry."
                      : "Loading eligible debt…"}
                  </p>
                ) : null}
                {participantId && credits.isError ? (
                  <p role="status">
                    Credit availability could not load. Refresh dependencies or
                    request an authoritative preview.
                  </p>
                ) : null}
                <FieldGroup>
                  {[
                    ...eligible.map((row) => ({
                      id: row.id,
                      label: `${row.sourceDate} · ${formatFinanceMoney(row.remaining)} · ${row.id}`,
                    })),
                    ...unavailable.map((id) => ({
                      id,
                      label: `Unavailable selection · ${id} · remove to continue`,
                    })),
                  ].map((row) => (
                    <Field key={row.id} orientation="horizontal">
                      <Checkbox
                        id={`credit-debt-${row.id}`}
                        checked={ids.includes(row.id)}
                        disabled={busy}
                        onCheckedChange={(checked) => {
                          edit();
                          setIds((current) =>
                            checked
                              ? [...current, row.id]
                              : current.filter((id) => id !== row.id),
                          );
                        }}
                      />
                      <FieldLabel
                        htmlFor={`credit-debt-${row.id}`}
                        className="[overflow-wrap:anywhere]"
                      >
                        {row.label}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
                {obligations.isSuccess && !eligible.length ? (
                  <p>
                    No eligible outstanding debt for this Participant, currency
                    and date.
                  </p>
                ) : null}
                {errors.scope ? (
                  <FieldError id="credit-scope-error">
                    {errors.scope}
                  </FieldError>
                ) : null}
              </FieldSet>
            </FieldGroup>
          </FieldSet>
          {error || create.error ? (
            <Alert variant="destructive">
              <AlertTitle>{error || create.error}</AlertTitle>
            </Alert>
          ) : null}
          {create.rejected ? (
            <p role="status">
              The original credit application was rejected. Refresh preview and
              deliberately confirm a new action. Your selection and amount are
              preserved.
            </p>
          ) : null}
          {create.unresolved ? (
            <p role="status">
              The original credit application is retained in Finance recovery.
              Check its outcome or retry the original submission. Do not apply
              credit again for it.
            </p>
          ) : null}
          {review ? (
            <section
              aria-label="Credit application preview"
              className="flex min-w-0 flex-col gap-3"
            >
              <h2 className="font-semibold">Review credit application</h2>
              <p>
                Apply {formatFinanceMoney(review.preview.amount)} on{" "}
                {review.draft.transactionDate}. No new cash, Income, Expense or
                forgiveness.
              </p>
              <p className="[overflow-wrap:anywhere]">
                Selected Obligations:{" "}
                {review.draft.selectedObligationIds.join(", ")}
              </p>
              <dl className="grid grid-cols-2 gap-2">
                {[
                  [
                    "Selected outstanding before",
                    review.preview.outstandingBefore,
                  ],
                  [
                    "Selected outstanding after",
                    review.preview.outstandingAfter,
                  ],
                  [
                    "Available credit before",
                    review.preview.availableCreditBefore,
                  ],
                  [
                    "Available credit after",
                    review.preview.availableCreditAfter,
                  ],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt>{label as string}</dt>
                    <dd>
                      {formatFinanceMoney(
                        value as CreditApplicationPreview["amount"],
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <CreditApplicationOrigins
                origins={review.preview.origins}
                ledgerId={ledgerId}
                participantId={participantId}
              />
              <SettlementAllocations
                allocations={review.preview.allocations}
                ledgerId={ledgerId}
                participantId={participantId}
              />
            </section>
          ) : null}
          <DialogFooter className="flex-wrap">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                edit();
                setRefreshing(true);
                void Promise.allSettled([
                  refreshDependencies(),
                  ...(participantId
                    ? [obligations.refetch(), credits.refetch()]
                    : []),
                ]).finally(() => setRefreshing(false));
              }}
            >
              {refreshing ? "Refreshing…" : "Refresh dependencies"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              {locked ? "Close to recovery" : "Discard draft"}
            </Button>
            <Button type="submit" disabled={busy}>
              {preview.isPending
                ? "Loading preview…"
                : create.rejected
                  ? "Refresh preview"
                  : "Preview credit application"}
            </Button>
            {review ? (
              <Button
                ref={confirm}
                type="button"
                disabled={busy || !journal.ready}
                onClick={() =>
                  void create.submit({
                    operation: "createFinanceSettlement",
                    workflow: "settlement",
                    targetLedgerId: ledgerId,
                    body: {
                      ...review.draft,
                      previewToken: review.preview.previewToken,
                    },
                  })
                }
              >
                {create.pending ? "Confirming…" : "Confirm credit application"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
