import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import {
  useListFinanceParticipantObligations,
  usePreviewFinanceSettlement,
} from "@/api/generated/core-console";
import {
  FinanceRequestDate,
  ForgivenessPreview,
  CombinedSettlementPreview,
  type AccountResponse,
  ObligationResponse,
  PreviewFinanceSettlementBody,
  type CurrencyResponse,
  type ParticipantResponse,
} from "@/api/generated/schemas";
import { buildAccountWorkflowLabels } from "./account-identity";
import { validCombinedPreview } from "./combined-settlement";
import { settlementPreviewBody } from "./settlement-command-schema";
import { formatFinanceMoney } from "./finance-money";
import { subtractExactDecimals } from "./finance-decimal";
import { SettlementAllocations } from "./settlement-allocations";
import { useFinanceCreate } from "./use-finance-create";
import { useFinanceSubmissions } from "./finance-submission-context";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  FieldGroup,
  FieldSet,
  FieldLegend,
  FieldLabel,
  FieldError,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type ForgivenessDraft = Extract<
  PreviewFinanceSettlementBody,
  { kind: "forgiveness" | "combined" }
>;
const positiveDecimal = (value: string) =>
  /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value);
const equalAmount = (left: string, right: string) =>
  /^0(?:\.0+)?$/.test(subtractExactDecimals(left, right));

export function ForgivenessFormDialog({
  ledgerId,
  combined = false,
  accounts = [],
  participants,
  currencies,
  initialParticipantId,
  onClose,
  onConfirmed,
  finalFocus,
  refreshDependencies,
}: {
  ledgerId: string;
  combined?: boolean;
  accounts?: AccountResponse[];
  participants: ParticipantResponse[];
  currencies: CurrencyResponse[];
  initialParticipantId?: string | undefined;
  onClose: () => void;
  onConfirmed: (id: string, participantId: string) => void;
  finalFocus: ComponentProps<typeof DialogContent>["finalFocus"];
  refreshDependencies: () => Promise<void>;
}) {
  const [participantId, setParticipantId] = useState(
    initialParticipantId ?? "",
  );
  const [chosenCurrency, setCurrencyCode] = useState("");
  const [receivingAccountId, setReceivingAccountId] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const receiving = accounts.find((item) => item.id === receivingAccountId);
  const currencyCode = combined ? (receiving?.currency ?? "") : chosenCurrency;
  const accountLabels = buildAccountWorkflowLabels(accounts);
  const action = combined ? "combined Settlement" : "forgiveness";
  const selectedCurrency = currencies.find(
    (item) => item.code === currencyCode,
  );
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [storedReview, setReview] = useState<{
    draft: ForgivenessDraft;
    preview: ForgivenessPreview | CombinedSettlementPreview;
  } | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
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
  const eligible = (obligations.data ?? []).filter(
    (row) =>
      row.sourceDate <= date &&
      row.remaining.currency === currencyCode &&
      positiveDecimal(row.remaining.amount),
  );
  const capacity = eligible
    .filter((row) => selectedIds.includes(row.id))
    .reduce(
      (total, row) =>
        subtractExactDecimals(
          total,
          subtractExactDecimals("0", row.remaining.amount),
        ),
      "0",
    );
  const unavailableIds = selectedIds.filter(
    (id) => !eligible.some((row) => row.id === id),
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
  const busy = locked || refreshing || preview.isPending;
  useEffect(() => {
    if (review) confirmButton.current?.focus();
  }, [review]);
  useEffect(() => {
    if (create.rejected) first.current?.focus();
  }, [create.rejected]);
  function edit() {
    create.edited();
    setReview(null);
    setError("");
    setErrors({});
  }
  async function showPreview(event: FormEvent) {
    event.preventDefault();
    if (busy || !journal.isCurrentNamespace()) return;
    setReview(null);
    if (create.rejected) create.startAnother();
    const currency = currencies.find((item) => item.code === currencyCode);
    const invalid: Record<string, string> = {};
    if (!participants.some((item) => item.id === participantId))
      invalid.participant =
        "Choose a Participant in this Ledger. Archived Participants may resolve existing debt.";
    if (combined) {
      if (!receiving || receiving.status !== "active" || !currency)
        invalid.receiving =
          "Choose an active receiving Account with an available currency.";
      if (
        !positiveDecimal(cashAmount) ||
        (cashAmount.split(".")[1]?.length ?? 0) > (currency?.minorUnit ?? 0) ||
        cashAmount.split(".")[0]!.replace(/^0+/, "").length > 131072
      )
        invalid.cash =
          "Enter a positive exact cash amount within the currency precision. Amounts are never rounded.";
    } else if (!currency) invalid.currency = "Choose an available currency.";
    if (
      !FinanceRequestDate.safeParse(date).success ||
      (combined && receiving && date < receiving.trackingStartDate)
    )
      invalid.date = combined
        ? "Enter a valid date on or after the receiving Account Tracking Start Date."
        : "Enter a valid forgiveness date.";
    if (!obligations.isSuccess || !selectedIds.length || unavailableIds.length)
      invalid.scope =
        "Select eligible outstanding Obligations. Remove unavailable selections explicitly or refresh dependencies to check current debt.";
    if (
      !positiveDecimal(amount) ||
      (amount.split(".")[1]?.length ?? 0) > (currency?.minorUnit ?? 0) ||
      amount.split(".")[0]!.replace(/^0+/, "").length > 131072
    )
      invalid.amount =
        "Enter a positive exact amount within the currency precision. Amounts are never rounded.";
    else if (
      subtractExactDecimals(
        combined && positiveDecimal(cashAmount)
          ? subtractExactDecimals(capacity, cashAmount)
          : capacity,
        amount,
      ).startsWith("-")
    )
      invalid.amount = combined
        ? "Cash and forgiveness cannot exceed selected outstanding debt. Forgiveness must fit the remaining selected capacity after cash. Adjust amounts or selection explicitly."
        : "Forgiveness cannot exceed selected outstanding debt. Adjust the amount or selection explicitly.";
    if (
      !reason.trim() ||
      (combined ? [...reason.trim()].length : reason.trim().length) > 500
    )
      invalid.reason = "Enter a reason of 1–500 characters.";
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      document
        .getElementById(`forgiveness-${Object.keys(invalid)[0]}`)
        ?.focus();
      return;
    }
    const draft = settlementPreviewBody.parse({
      kind: combined ? "combined" : "forgiveness",
      participantId,
      selectedObligationIds: selectedIds,
      transactionDate: date,
      amount: {
        amount: combined ? cashAmount : amount,
        currency: currencyCode,
      },
      ...(combined
        ? {
            receivingAccountId,
            forgivenessAmount: { amount, currency: currencyCode },
          }
        : {}),
      reason: reason.trim(),
      note: note || null,
    });
    if (
      !("kind" in draft) ||
      (draft.kind !== "forgiveness" && draft.kind !== "combined")
    )
      return;
    setError("");
    try {
      const response = await preview.mutateAsync({ ledgerId, data: draft });
      const parsed = (
        draft.kind === "combined"
          ? CombinedSettlementPreview.refine(
              (item) => validCombinedPreview(item, draft, receiving!.nature),
              "Combined preview does not match the explicit cash and forgiveness intent.",
            )
          : ForgivenessPreview.refine(
              (item) =>
                item.amount.currency === draft.amount.currency &&
                positiveDecimal(item.amount.amount) &&
                equalAmount(item.amount.amount, draft.amount.amount) &&
                item.expense.currency === draft.amount.currency &&
                positiveDecimal(item.expense.amount) &&
                equalAmount(item.expense.amount, draft.amount.amount) &&
                item.outstandingBefore.currency === draft.amount.currency &&
                item.outstandingAfter.currency === draft.amount.currency &&
                /^\d+(?:\.\d+)?$/.test(item.outstandingBefore.amount) &&
                /^\d+(?:\.\d+)?$/.test(item.outstandingAfter.amount) &&
                equalAmount(
                  subtractExactDecimals(
                    item.outstandingBefore.amount,
                    item.outstandingAfter.amount,
                  ),
                  draft.amount.amount,
                ) &&
                item.allocations.length > 0 &&
                new Set(item.allocations.map((row) => row.obligationId))
                  .size === item.allocations.length &&
                item.allocations.every(
                  (row) =>
                    draft.selectedObligationIds.includes(row.obligationId) &&
                    row.sourceDate <= draft.transactionDate &&
                    row.forgiven.currency === draft.amount.currency &&
                    row.remainingAfter.currency === draft.amount.currency &&
                    positiveDecimal(row.forgiven.amount) &&
                    /^\d+(?:\.\d+)?$/.test(row.remainingAfter.amount),
                ) &&
                equalAmount(
                  item.allocations.reduce(
                    (total, row) =>
                      subtractExactDecimals(
                        total,
                        subtractExactDecimals("0", row.forgiven.amount),
                      ),
                    "0",
                  ),
                  draft.amount.amount,
                ),
              "Forgiveness preview does not match the explicit intent or selected scope.",
            )
      ).parse(response.data);
      if (journal.isCurrentNamespace()) setReview({ draft, preview: parsed });
    } catch {
      if (journal.isCurrentNamespace())
        setError(
          `Preview could not be loaded. Your ${action} intent is preserved. Refresh dependencies and review the selected debt, date and amounts before trying again. Nothing was confirmed.`,
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
          id="forgiveness-participant"
          value={participantId}
          onChange={(event) => {
            edit();
            setParticipantId(event.target.value);
            setSelectedIds([]);
          }}
          aria-invalid={!!errors.participant}
          aria-describedby={
            errors.participant ? "forgiveness-participant-error" : undefined
          }
        >
          <NativeSelectOption value="">Choose Participant</NativeSelectOption>
          {participants.map((item) => (
            <NativeSelectOption key={item.id} value={item.id}>
              {item.name} ({item.status}) · {item.id}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ),
    },
    {
      id: combined ? "receiving" : "currency",
      label: combined ? "Receiving Account" : "Currency",
      control: combined ? (
        <NativeSelect
          id="forgiveness-receiving"
          value={receivingAccountId}
          aria-invalid={!!errors.receiving}
          aria-describedby={
            errors.receiving ? "forgiveness-receiving-error" : undefined
          }
          onChange={(event) => {
            edit();
            setReceivingAccountId(event.target.value);
          }}
        >
          <NativeSelectOption value="">
            Choose receiving Account
          </NativeSelectOption>
          {receivingAccountId &&
          !accounts.some(
            (item) =>
              item.id === receivingAccountId && item.status === "active",
          ) ? (
            <NativeSelectOption value={receivingAccountId}>
              Unavailable Account · {receivingAccountId}
            </NativeSelectOption>
          ) : null}
          {accounts
            .filter((item) => item.status === "active")
            .map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {accountLabels.get(item.id)} · {item.currency} ·{" "}
                {item.nature === "liability" ? "Liability" : "Asset"}
              </NativeSelectOption>
            ))}
        </NativeSelect>
      ) : (
        <NativeSelect
          id="forgiveness-currency"
          value={currencyCode}
          onChange={(event) => {
            edit();
            setCurrencyCode(event.target.value);
          }}
          aria-invalid={!!errors.currency}
          aria-describedby={
            errors.currency ? "forgiveness-currency-error" : undefined
          }
        >
          <NativeSelectOption value="">Choose currency</NativeSelectOption>
          {currencies.map((item) => (
            <NativeSelectOption key={item.code} value={item.code}>
              {item.code}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ),
    },
    {
      id: "date",
      label: combined ? "Settlement date" : "Forgiveness date",
      control: (
        <Input
          id="forgiveness-date"
          type="date"
          value={date}
          onChange={(event) => {
            edit();
            setDate(event.target.value);
          }}
          aria-invalid={!!errors.date}
          aria-describedby={errors.date ? "forgiveness-date-error" : undefined}
        />
      ),
    },
    ...(combined
      ? [
          {
            id: "cash",
            label: "Cash received",
            control: (
              <Input
                id="forgiveness-cash"
                inputMode="decimal"
                value={cashAmount}
                aria-invalid={!!errors.cash}
                aria-describedby={
                  errors.cash ? "forgiveness-cash-error" : undefined
                }
                onChange={(event) => {
                  edit();
                  setCashAmount(event.target.value);
                }}
              />
            ),
          },
        ]
      : []),
    {
      id: "amount",
      label: "Forgiveness amount",
      control: (
        <Input
          id="forgiveness-amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => {
            edit();
            setAmount(event.target.value);
          }}
          aria-invalid={!!errors.amount}
          aria-describedby={
            errors.amount ? "forgiveness-amount-error" : undefined
          }
        />
      ),
    },
    {
      id: "reason",
      label: "Reason",
      control: (
        <Textarea
          id="forgiveness-reason"
          value={reason}
          onChange={(event) => {
            edit();
            setReason(event.target.value);
          }}
          aria-invalid={!!errors.reason}
          aria-describedby={
            errors.reason ? "forgiveness-reason-error" : undefined
          }
        />
      ),
    },
    {
      id: "note",
      label: "Note",
      control: (
        <Textarea
          id="forgiveness-note"
          value={note}
          onChange={(event) => {
            edit();
            setNote(event.target.value);
          }}
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
          <DialogTitle>Record {action}</DialogTitle>
          <DialogDescription>
            {combined
              ? "Record actual cash and explicit forgiveness together. Cash allocates first, then forgiveness against the remaining selected debt. No surplus or existing credit is applied. "
              : "Explicitly waive selected debt in one currency. "}{" "}
            Receivables decrease and Expense increases by the forgiven amount.{" "}
            {combined
              ? "Only actual cash changes the receiving balance. Income and available credit remain unchanged."
              : "Cash and available credit remain unchanged."}{" "}
            Future-dated recording affects Current Balance immediately.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void showPreview(event)}
          className="flex min-w-0 flex-col gap-4"
        >
          <FieldSet disabled={busy}>
            <FieldLegend className="sr-only">Forgiveness details</FieldLegend>
            <FieldGroup>
              {fields.map((field) => (
                <Field key={field.id} data-invalid={!!errors[field.id]}>
                  <FieldLabel htmlFor={`forgiveness-${field.id}`}>
                    {field.label}
                  </FieldLabel>
                  {field.control}
                  {errors[field.id] ? (
                    <FieldError id={`forgiveness-${field.id}-error`}>
                      {errors[field.id]}
                    </FieldError>
                  ) : null}
                </Field>
              ))}
              <FieldSet
                id="forgiveness-scope"
                tabIndex={-1}
                aria-invalid={!!errors.scope}
                aria-describedby={
                  errors.scope ? "forgiveness-scope-error" : undefined
                }
              >
                <FieldLegend>
                  {combined
                    ? "Select debt to resolve"
                    : "Select debt to forgive"}
                </FieldLegend>
                <p className="text-sm text-muted-foreground">
                  Only checked Obligations in this Participant, currency and
                  event date are eligible. Unselected debt remains outstanding;
                  forgiveness never marks it cash-paid.
                </p>
                {selectedCurrency ? (
                  <p>
                    Selected outstanding debt:{" "}
                    {formatFinanceMoney({
                      amount: capacity,
                      currency: selectedCurrency.code,
                    })}
                  </p>
                ) : null}
                {participantId && !obligations.isSuccess ? (
                  <p role="status">
                    {obligations.isError
                      ? "Debt could not load. Refresh dependencies to retry."
                      : "Loading eligible debt…"}
                  </p>
                ) : null}
                <FieldGroup>
                  {eligible.map((row) => (
                    <Field key={row.id} orientation="horizontal">
                      <Checkbox
                        id={`forgive-${row.id}`}
                        disabled={busy}
                        checked={selectedIds.includes(row.id)}
                        onCheckedChange={(checked) => {
                          edit();
                          setSelectedIds((ids) =>
                            checked
                              ? [...ids, row.id]
                              : ids.filter((id) => id !== row.id),
                          );
                        }}
                      />
                      <FieldLabel
                        htmlFor={`forgive-${row.id}`}
                        className="[overflow-wrap:anywhere]"
                      >
                        {row.sourceDate} · {formatFinanceMoney(row.remaining)} ·{" "}
                        {row.id}
                      </FieldLabel>
                    </Field>
                  ))}
                  {unavailableIds.map((id) => (
                    <Field key={id} orientation="horizontal">
                      <Checkbox
                        id={`forgive-${id}`}
                        disabled={busy}
                        checked
                        onCheckedChange={() => {
                          edit();
                          setSelectedIds((ids) =>
                            ids.filter((item) => item !== id),
                          );
                        }}
                      />
                      <FieldLabel
                        htmlFor={`forgive-${id}`}
                        className="[overflow-wrap:anywhere]"
                      >
                        Unavailable selection · {id} · remove to continue
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
                  <FieldError id="forgiveness-scope-error">
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
          {review ? (
            <section
              aria-label={
                combined ? "Combined Settlement preview" : "Forgiveness preview"
              }
              className="flex min-w-0 flex-col gap-3"
            >
              <h2 className="font-semibold">Review {action}</h2>
              <p>
                Event date: {review.draft.transactionDate}. Reason:{" "}
                {review.draft.reason}
              </p>
              <p>
                {combined
                  ? "Actual cash is allocated first; forgiveness creates matching Expense. Income and available credit remain unchanged. Unselected debt and any remaining shortfall stay outstanding."
                  : "No cash receipt or payment is recorded. Income and available credit remain unchanged. Unselected debt remains outstanding."}
              </p>
              <p className="text-sm [overflow-wrap:anywhere]">
                Reviewed selected scope:{" "}
                {review.draft.selectedObligationIds.join(", ")}
              </p>
              <dl className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ...("forgivenessAmount" in review.preview
                      ? ([
                          ["Cash received", review.preview.amount],
                          [
                            "Receiving balance",
                            review.preview.receivingBalance,
                          ],
                          [
                            "Receiving balance after",
                            review.preview.receivingBalanceAfter,
                          ],
                        ] as const)
                      : []),
                    [
                      "Forgiven principal",
                      "forgivenessAmount" in review.preview
                        ? review.preview.forgivenessAmount
                        : review.preview.amount,
                    ],
                    ["Expense increase", review.preview.expense],
                    [
                      "Selected outstanding before",
                      review.preview.outstandingBefore,
                    ],
                    [
                      "Selected outstanding after",
                      review.preview.outstandingAfter,
                    ],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{formatFinanceMoney(value)}</dd>
                  </div>
                ))}
              </dl>
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
                  ...(participantId ? [obligations.refetch()] : []),
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
                  : `Preview ${action}`}
            </Button>
            {review ? (
              <Button
                ref={confirmButton}
                type="button"
                disabled={busy || !journal.ready}
                onClick={() =>
                  void create.submit({
                    operation: "createFinanceSettlement",
                    targetLedgerId: ledgerId,
                    workflow: "settlement",
                    body: {
                      ...review.draft,
                      previewToken: review.preview.previewToken,
                    },
                  })
                }
              >
                {create.pending ? "Confirming…" : `Confirm ${action}`}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
