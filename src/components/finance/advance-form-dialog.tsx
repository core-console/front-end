import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import { usePreviewFinanceAdvance } from "@/api/generated/core-console";
import {
  AdvancePreview,
  PreviewFinanceAdvanceBody,
  FinanceRequestDate,
  type AccountResponse,
  type ParticipantResponse,
  type CurrencyResponse,
} from "@/api/generated/schemas";
import { buildAccountWorkflowLabels } from "./account-identity";
import { formatFinanceMoney } from "./finance-money";
import { useFinanceCreate } from "./use-finance-create";
import { useFinanceSubmissions } from "./finance-submission-context";
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

export function AdvanceFormDialog({
  ledgerId,
  accounts,
  participants,
  currencies,
  onClose,
  onConfirmed,
  finalFocus,
  refreshDependencies,
}: {
  ledgerId: string;
  accounts: AccountResponse[];
  participants: ParticipantResponse[];
  currencies: CurrencyResponse[];
  onClose: () => void;
  onConfirmed: (id: string, participantId: string) => void;
  finalFocus: ComponentProps<typeof DialogContent>["finalFocus"];
  refreshDependencies: () => Promise<void>;
}) {
  const [participantId, setParticipantId] = useState("");
  const [fundingAccountId, setFundingAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [review, setReview] = useState<{
    draft: PreviewFinanceAdvanceBody;
    preview: AdvancePreview;
  } | null>(null);
  const preview = usePreviewFinanceAdvance({ mutation: { retry: false } });
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
    { operation: "createFinanceAdvance" },
  );
  useEffect(() => {
    if (create.rejected) {
      setReview(null);
      first.current?.focus();
    }
  }, [create.rejected]);
  useEffect(() => {
    if (review) confirmButton.current?.focus();
  }, [review]);
  const locked = create.pending || create.unresolved;
  const labels = buildAccountWorkflowLabels(accounts);
  const eligibleAccounts = accounts.filter(
    (item) => item.status === "active" && item.nature === "asset",
  );
  const eligiblePeople = participants.filter(
    (item) => item.status === "active",
  );
  const edit = () => {
    create.edited();
    setReview(null);
    setError("");
    setErrors({});
  };
  async function showPreview(event: FormEvent) {
    event.preventDefault();
    if (
      preview.isPending ||
      locked ||
      refreshing ||
      !journal.isCurrentNamespace()
    )
      return;
    if (create.rejected) create.startAnother();
    const account = eligibleAccounts.find(
      (item) => item.id === fundingAccountId,
    );
    const person = eligiblePeople.find((item) => item.id === participantId);
    const currency = currencies.find((item) => item.code === account?.currency);
    const invalid: Record<string, string> = {};
    if (!person) invalid.participant = "Choose an active Participant.";
    if (!account || !currency)
      invalid.funding =
        "Choose an active Asset Account with an available currency.";
    if (
      !/^\d+(?:\.\d+)?$/.test(amount) ||
      !/[1-9]/.test(amount) ||
      amount.split(".")[0]!.replace(/^0+/, "").length > 131072 ||
      (amount.split(".")[1]?.length ?? 0) > (currency?.minorUnit ?? 0)
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
      document.getElementById(`advance-${Object.keys(invalid)[0]}`)?.focus();
      return;
    }
    if (!account) return;
    const money = { amount, currency: account.currency };
    const draft = PreviewFinanceAdvanceBody.parse({
      fundingAccountId,
      participantId,
      transactionDate: date,
      amount: money,
      ownerShare: { amount: "0", currency: account.currency },
      participantShare: money,
      note: note || null,
    });
    setReview(null);
    setError("");
    try {
      const response = await preview.mutateAsync({ ledgerId, data: draft });
      setReview({ draft, preview: AdvancePreview.parse(response.data) });
    } catch {
      setError(
        "Preview could not be loaded. Check the Account, Participant, date and amount, then refresh dependencies and try again. Nothing was confirmed.",
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
          id="advance-participant"
          value={participantId}
          aria-invalid={!!errors.participant}
          aria-describedby={
            errors.participant ? "advance-participant-error" : undefined
          }
          onChange={(event) => {
            edit();
            setParticipantId(event.target.value);
          }}
        >
          <NativeSelectOption value="">Choose Participant</NativeSelectOption>
          {eligiblePeople.map((item) => (
            <NativeSelectOption key={item.id} value={item.id}>
              {item.name} · {item.id}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ),
    },
    {
      id: "funding",
      label: "Funding Asset Account",
      control: (
        <NativeSelect
          id="advance-funding"
          value={fundingAccountId}
          aria-invalid={!!errors.funding}
          aria-describedby={
            errors.funding ? "advance-funding-error" : undefined
          }
          onChange={(event) => {
            edit();
            setFundingAccountId(event.target.value);
          }}
        >
          <NativeSelectOption value="">Choose Asset Account</NativeSelectOption>
          {eligibleAccounts.map((item) => (
            <NativeSelectOption key={item.id} value={item.id}>
              {labels.get(item.id)} · {item.currency}
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
          id="advance-amount"
          inputMode="decimal"
          value={amount}
          aria-invalid={!!errors.amount}
          aria-describedby={errors.amount ? "advance-amount-error" : undefined}
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
          id="advance-date"
          type="date"
          value={date}
          aria-invalid={!!errors.date}
          aria-describedby={errors.date ? "advance-date-error" : undefined}
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
          id="advance-note"
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
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>Record pure Advance</DialogTitle>
          <DialogDescription>
            One Participant, one Asset Account, zero owner share. Future-dated
            recording affects Current Balance immediately.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void showPreview(event)}
          className="flex min-w-0 flex-col gap-4"
        >
          <FieldGroup>
            <FieldSet disabled={preview.isPending || locked || refreshing}>
              {fields.map((field) => (
                <Field key={field.id} data-invalid={!!errors[field.id]}>
                  <FieldLabel htmlFor={`advance-${field.id}`}>
                    {field.label}
                  </FieldLabel>
                  {field.control}
                  {errors[field.id] ? (
                    <FieldError id={`advance-${field.id}-error`}>
                      {errors[field.id]}
                    </FieldError>
                  ) : null}
                </Field>
              ))}
            </FieldSet>
          </FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          ) : null}
          {create.error ? (
            <Alert variant="destructive">
              <AlertTitle>{create.error}</AlertTitle>
            </Alert>
          ) : null}
          {create.rejected ? (
            <p role="status">
              The original action was rejected. Refresh the preview, review the
              current effects, and deliberately confirm a new action.
            </p>
          ) : null}
          {create.succeeded ? (
            <p role="status">
              Advance is confirmed. Close and open its source from Finance
              recovery.
            </p>
          ) : create.unresolved ? (
            <p role="status">
              This action is retained. Close to check its outcome or retry the
              original submission in Finance recovery.
            </p>
          ) : null}
          {review ? (
            <section
              aria-label="Advance preview"
              className="flex flex-col gap-2 [overflow-wrap:anywhere]"
            >
              <h2 className="font-semibold">Financial preview</h2>
              <p>
                Participant:{" "}
                {
                  participants.find(
                    (item) => item.id === review.draft.participantId,
                  )?.name
                }{" "}
                · {review.draft.participantId}
              </p>
              <p>
                Funding Account: {labels.get(review.draft.fundingAccountId)} ·{" "}
                {review.draft.fundingAccountId}
              </p>
              <p>
                Date: {review.draft.transactionDate}. Note:{" "}
                {review.draft.note || "—"}
              </p>
              <dl className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["Funding balance", review.preview.fundingBalance],
                    [
                      "Funding balance after",
                      review.preview.fundingBalanceAfter,
                    ],
                    ["Receivable increase", review.preview.receivableIncrease],
                    ["Owner purchase Expense", review.preview.ownerExpense],
                  ] as const
                ).map(([label, money]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{formatFinanceMoney(money)}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Participant share:{" "}
                {formatFinanceMoney(review.draft.participantShare)}. Owner
                share: {formatFinanceMoney(review.draft.ownerShare)}.
              </p>
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
            <Button type="submit" disabled={preview.isPending || locked}>
              {preview.isPending
                ? "Loading preview…"
                : create.rejected
                  ? "Refresh preview"
                  : "Preview Advance"}
            </Button>
            {review ? (
              <Button
                ref={confirmButton}
                type="button"
                disabled={locked || !journal.ready}
                onClick={() =>
                  void create.submit({
                    operation: "createFinanceAdvance",
                    targetLedgerId: ledgerId,
                    workflow: "advance",
                    body: {
                      ...review.draft,
                      previewToken: review.preview.previewToken,
                    },
                  })
                }
              >
                {create.pending ? "Confirming…" : "Confirm Advance"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
