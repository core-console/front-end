import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import { usePreviewFinanceSettlement } from "@/api/generated/core-console";
import {
  PreviewFinanceSettlementBody,
  SettlementPreview,
  FinanceRequestDate,
  type AccountResponse,
  type CurrencyResponse,
  type ParticipantResponse,
} from "@/api/generated/schemas";
import { buildAccountWorkflowLabels } from "./account-identity";
import { formatFinanceMoney } from "./finance-money";
import { useFinanceCreate } from "./use-finance-create";
import { useFinanceSubmissions } from "./finance-submission-context";
import { SettlementAllocations } from "./settlement-allocations";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function RepaymentFormDialog({
  ledgerId,
  accounts,
  participants,
  currencies,
  initialParticipantId,
  onClose,
  onConfirmed,
  finalFocus,
  refreshDependencies,
}: {
  ledgerId: string;
  accounts: AccountResponse[];
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
  const [receivingAccountId, setReceivingAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [storedReview, setReview] = useState<{
    draft: PreviewFinanceSettlementBody;
    preview: SettlementPreview;
  } | null>(null);
  const preview = usePreviewFinanceSettlement({ mutation: { retry: false } });
  const first = useRef<HTMLSelectElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const journal = useFinanceSubmissions();
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
  useEffect(() => {
    if (create.rejected) {
      first.current?.focus();
    }
  }, [create.rejected]);
  useEffect(() => {
    if (review) confirmButton.current?.focus();
  }, [review]);
  const locked = create.pending || create.unresolved;
  const labels = buildAccountWorkflowLabels(accounts);
  const eligibleAccounts = accounts.filter((item) => item.status === "active");
  function edit() {
    create.edited();
    setReview(null);
    setError("");
    setErrors({});
  }
  async function showPreview(event: FormEvent) {
    event.preventDefault();
    if (
      preview.isPending ||
      locked ||
      refreshing ||
      !journal.isCurrentNamespace()
    )
      return;
    // A failed refresh must never make a rejected token confirmable again.
    setReview(null);
    if (create.rejected) create.startAnother();
    const account = eligibleAccounts.find(
      (item) => item.id === receivingAccountId,
    );
    const currency = currencies.find((item) => item.code === account?.currency);
    const invalid: Record<string, string> = {};
    if (!participants.some((item) => item.id === participantId))
      invalid.participant =
        "Choose a Participant in this Ledger. Archived Participants may repay existing debt.";
    if (!account || !currency)
      invalid.receiving =
        "Choose an active receiving Account with an available currency.";
    if (
      !/^\d+(?:\.\d+)?$/.test(amount) ||
      !/[1-9]/.test(amount) ||
      (amount.split(".")[1]?.length ?? 0) > (currency?.minorUnit ?? 0) ||
      amount.split(".")[0]!.replace(/^0+/, "").length > 131072
    )
      invalid.amount =
        "Enter a positive exact amount within the currency precision. Amounts are never rounded.";
    if (
      !FinanceRequestDate.safeParse(date).success ||
      (account && date < account.trackingStartDate)
    )
      invalid.date =
        "Enter a valid date on or after the Account Tracking Start Date.";
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      document.getElementById(`repayment-${Object.keys(invalid)[0]}`)?.focus();
      return;
    }
    if (!account) return;
    const draft = PreviewFinanceSettlementBody.parse({
      participantId,
      receivingAccountId,
      transactionDate: date,
      amount: { amount, currency: account.currency },
      note: note || null,
    });
    setError("");
    try {
      const response = await preview.mutateAsync({ ledgerId, data: draft });
      if (journal.isCurrentNamespace())
        setReview({ draft, preview: SettlementPreview.parse(response.data) });
    } catch {
      setError(
        "Preview could not be loaded. Check the receiving Account, currency, date and eligible outstanding debt, then refresh dependencies and try again. Nothing was confirmed.",
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
          id="repayment-participant"
          value={participantId}
          aria-invalid={!!errors.participant}
          aria-describedby={
            errors.participant ? "repayment-participant-error" : undefined
          }
          onChange={(event) => {
            edit();
            setParticipantId(event.target.value);
          }}
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
      id: "receiving",
      label: "Receiving Account",
      control: (
        <NativeSelect
          id="repayment-receiving"
          value={receivingAccountId}
          aria-invalid={!!errors.receiving}
          aria-describedby={
            errors.receiving ? "repayment-receiving-error" : undefined
          }
          onChange={(event) => {
            edit();
            setReceivingAccountId(event.target.value);
          }}
        >
          <NativeSelectOption value="">
            Choose receiving Account
          </NativeSelectOption>
          {eligibleAccounts.map((item) => (
            <NativeSelectOption key={item.id} value={item.id}>
              {labels.get(item.id)} · {item.currency} ·{" "}
              {item.nature === "liability" ? "Liability" : "Asset"}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ),
    },
    {
      id: "amount",
      label: "Amount",
      control: (
        <Input
          id="repayment-amount"
          inputMode="decimal"
          value={amount}
          aria-invalid={!!errors.amount}
          aria-describedby={
            errors.amount ? "repayment-amount-error" : undefined
          }
          onChange={(event) => {
            edit();
            setAmount(event.target.value);
          }}
        />
      ),
    },
    {
      id: "date",
      label: "Date",
      control: (
        <Input
          id="repayment-date"
          type="date"
          value={date}
          aria-invalid={!!errors.date}
          aria-describedby={errors.date ? "repayment-date-error" : undefined}
          onChange={(event) => {
            edit();
            setDate(event.target.value);
          }}
        />
      ),
    },
    {
      id: "note",
      label: "Note",
      control: (
        <Textarea
          id="repayment-note"
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
          <DialogTitle>Record repayment</DialogTitle>
          <DialogDescription>
            One Participant and currency. Cash applies to all eligible
            outstanding Obligations, oldest Advance date first. Future-dated
            recording affects Current Balance immediately.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void showPreview(event)}
          className="flex min-w-0 flex-col gap-4"
        >
          <FieldGroup>
            <FieldSet disabled={preview.isPending || locked || refreshing}>
              <FieldLegend className="sr-only">Repayment details</FieldLegend>
              <FieldGroup>
                {fields.map((field) => (
                  <Field key={field.id} data-invalid={!!errors[field.id]}>
                    <FieldLabel htmlFor={`repayment-${field.id}`}>
                      {field.label}
                    </FieldLabel>
                    {field.control}
                    {errors[field.id] ? (
                      <FieldError id={`repayment-${field.id}-error`}>
                        {errors[field.id]}
                      </FieldError>
                    ) : null}
                  </Field>
                ))}
              </FieldGroup>
            </FieldSet>
          </FieldGroup>
          {error || create.error ? (
            <Alert variant="destructive">
              <AlertTitle>{error || create.error}</AlertTitle>
            </Alert>
          ) : null}
          {create.rejected ? (
            <p role="status">
              The original action was rejected. Refresh the preview, review
              current Allocations, and deliberately confirm a new action.
            </p>
          ) : null}
          {create.succeeded ? (
            <p role="status">
              Settlement is confirmed. Open its retained Allocations from
              Finance recovery.
            </p>
          ) : create.unresolved ? (
            <p role="status">
              The original repayment is retained in Finance recovery. Check its
              outcome or retry the original submission. Do not record another
              repayment for it.
            </p>
          ) : null}
          {review ? (
            <section
              aria-label="Repayment preview"
              className="flex min-w-0 flex-col gap-3"
            >
              <h2 className="font-semibold">Review repayment</h2>
              <p>
                Receipt: {formatFinanceMoney(review.preview.amount)} ·{" "}
                {review.draft.transactionDate}.{" "}
                {accounts.find((item) => item.id === receivingAccountId)
                  ?.nature === "liability"
                  ? "Receiving Liability decreases"
                  : "Receiving Asset increases"}
                . Principal receipt creates no Income or Expense. No forgiveness
                or credit is applied.
              </p>
              <p>
                Only Advances dated on or before {review.draft.transactionDate}{" "}
                in {review.draft.amount.currency} are eligible. Same-date ties
                use the retained backend order.
              </p>
              <dl className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["Receiving balance", review.preview.receivingBalance],
                    [
                      "Receiving balance after",
                      review.preview.receivingBalanceAfter,
                    ],
                    [
                      "Eligible outstanding before",
                      review.preview.outstandingBefore,
                    ],
                    [
                      "Eligible outstanding after",
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
              disabled={locked || preview.isPending || refreshing}
              onClick={() => {
                edit();
                setRefreshing(true);
                void refreshDependencies().finally(() => setRefreshing(false));
              }}
            >
              {refreshing ? "Refreshing…" : "Refresh dependencies"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              {locked ? "Close to recovery" : "Discard draft"}
            </Button>
            <Button
              type="submit"
              disabled={preview.isPending || locked || refreshing}
            >
              {preview.isPending
                ? "Loading preview…"
                : create.rejected
                  ? "Refresh preview"
                  : "Preview repayment"}
            </Button>
            {review ? (
              <Button
                ref={confirmButton}
                type="button"
                disabled={locked || !journal.ready}
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
                {create.pending ? "Confirming…" : "Confirm repayment"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
