import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import {
  useGetFinanceParticipantPositions,
  usePreviewFinanceSettlement,
} from "@/api/generated/core-console";
import {
  CreditReturnPreview,
  FinanceRequestDate,
  ParticipantPositionResponse,
  PreviewFinanceSettlementBody,
  type AccountResponse,
  type CurrencyResponse,
  type ParticipantResponse,
} from "@/api/generated/schemas";
import { useFinanceCreate } from "./use-finance-create";
import { useFinanceSubmissions } from "./finance-submission-context";
import { validCreditReturnPreview } from "./credit-return";
import { CreditApplicationOrigins } from "./credit-application-origins";
import { formatFinanceMoney } from "./finance-money";
import { buildAccountWorkflowLabels } from "./account-identity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Field,
  FieldGroup,
  FieldSet,
  FieldLegend,
  FieldLabel,
  FieldError,
} from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertTitle } from "@/components/ui/alert";

type Draft = Extract<PreviewFinanceSettlementBody, { kind: "creditReturn" }>;
export function CreditReturnFormDialog({
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
  const [participantId, setParticipant] = useState(initialParticipantId ?? "");
  const [accountId, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [storedReview, setReview] = useState<{
    draft: Draft;
    preview: CreditReturnPreview;
  } | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const journal = useFinanceSubmissions();
  const paying = accounts.find((item) => item.id === accountId);
  const labels = buildAccountWorkflowLabels(accounts);
  const positions = useGetFinanceParticipantPositions(ledgerId, participantId, {
    query: {
      enabled: !!participantId,
      select: (response) =>
        ParticipantPositionResponse.array()
          .refine(
            (rows) =>
              new Set(rows.map((row) => row.currency)).size === rows.length &&
              rows.every(
                (row) =>
                  row.availableCredits.currency === row.currency &&
                  /^\d+(?:\.\d+)?$/.test(row.availableCredits.amount),
              ),
          )
          .parse(response.data),
    },
  });
  const available = positions.data?.find(
    (row) => row.currency === paying?.currency,
  )?.availableCredits;
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
    const unit = currencies.find((row) => row.code === paying?.currency);
    if (
      !participants.some(
        (row) => row.id === participantId && row.ledgerId === ledgerId,
      )
    )
      invalid.participant =
        "Choose a Participant in this Ledger. Archived Participants may resolve existing credit.";
    if (!paying || paying.status !== "active" || !unit)
      invalid.account = "Choose an active paying Account in this Ledger.";
    if (
      !FinanceRequestDate.safeParse(date).success ||
      (paying && date < paying.trackingStartDate)
    )
      invalid.date =
        "Enter a valid return date on or after the paying Account Tracking Start Date.";
    if (
      !/^\d+(?:\.\d+)?$/.test(amount) ||
      !/[1-9]/.test(amount) ||
      (amount.split(".")[1]?.length ?? 0) > (unit?.minorUnit ?? 0) ||
      amount.split(".")[0]!.replace(/^0+/, "").length > 131072
    )
      invalid.amount =
        "Enter a positive exact amount within the currency precision. Amounts are never rounded.";
    // P strips Python whitespace before counting Unicode code points. Preserve
    // the original text in the draft and durable command, including U+FEFF.
    const normalizedNote = note.replace(
      /^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu,
      "",
    );
    if ([...normalizedNote].length > 500)
      invalid.note = "Enter a note of at most 500 characters.";
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      document.getElementById(`return-${Object.keys(invalid)[0]}`)?.focus();
      return;
    }
    const parsed = PreviewFinanceSettlementBody.safeParse({
      kind: "creditReturn",
      participantId,
      payingAccountId: accountId,
      transactionDate: date,
      amount: { amount, currency: paying!.currency },
      note: note || null,
    });
    if (
      !parsed.success ||
      !("kind" in parsed.data) ||
      parsed.data.kind !== "creditReturn"
    )
      return;
    const draft = parsed.data;
    setError("");
    try {
      const response = await preview.mutateAsync({ ledgerId, data: draft });
      const result = CreditReturnPreview.refine((item) =>
        validCreditReturnPreview(item, draft.amount, paying!),
      ).parse(response.data);
      if (journal.isCurrentNamespace()) setReview({ draft, preview: result });
    } catch {
      if (journal.isCurrentNamespace())
        setError(
          "Preview could not be loaded. Your return details are preserved. Refresh dependencies and check available credit, paying Account eligibility and credit Account Tracking Start Dates. Managed Accounts cannot pay returns. Nothing was confirmed.",
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
          id="return-participant"
          value={participantId}
          onChange={(e) => {
            edit();
            setParticipant(e.target.value);
          }}
          aria-invalid={!!errors.participant}
          aria-describedby={
            errors.participant ? "return-participant-error" : undefined
          }
        >
          <NativeSelectOption value="">Choose Participant</NativeSelectOption>
          {participants
            .filter((row) => row.ledgerId === ledgerId)
            .map((row) => (
              <NativeSelectOption key={row.id} value={row.id}>
                {row.name} ({row.status}) · {row.id}
              </NativeSelectOption>
            ))}
        </NativeSelect>
      ),
    },
    {
      id: "account",
      label: "Paying Account",
      control: (
        <NativeSelect
          id="return-account"
          value={accountId}
          onChange={(e) => {
            edit();
            setAccount(e.target.value);
          }}
          aria-invalid={!!errors.account}
          aria-describedby={errors.account ? "return-account-error" : undefined}
        >
          <NativeSelectOption value="">
            Choose paying Account
          </NativeSelectOption>
          {accounts.map((row) => (
            <NativeSelectOption
              key={row.id}
              value={row.id}
              disabled={row.status !== "active"}
            >
              {labels.get(row.id)} · {row.nature} · {row.currency} ·{" "}
              {row.status}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ),
    },
    {
      id: "date",
      label: "Return date",
      control: (
        <Input
          id="return-date"
          type="date"
          value={date}
          onChange={(e) => {
            edit();
            setDate(e.target.value);
          }}
          aria-invalid={!!errors.date}
          aria-describedby={errors.date ? "return-date-error" : undefined}
        />
      ),
    },
    {
      id: "amount",
      label: "Return amount",
      control: (
        <Input
          id="return-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            edit();
            setAmount(e.target.value);
          }}
          aria-invalid={!!errors.amount}
          aria-describedby={errors.amount ? "return-amount-error" : undefined}
        />
      ),
    },
    {
      id: "note",
      label: "Note",
      control: (
        <Textarea
          id="return-note"
          value={note}
          onChange={(e) => {
            edit();
            setNote(e.target.value);
          }}
          aria-invalid={!!errors.note}
          aria-describedby={errors.note ? "return-note-error" : undefined}
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
          <DialogTitle>Return credit</DialogTitle>
          <DialogDescription>
            Record actual money returned to the Participant from the paying
            Account. Asset balance decreases or paying Liability increases, and
            credit Liability decreases equally. No Income, Expense or receivable
            change. Oldest receipt confirmation origins are consumed first.
            Recorded future-dated effects apply immediately.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void showPreview(event)}
          className="flex min-w-0 flex-col gap-4"
        >
          <FieldSet disabled={busy}>
            <FieldLegend className="sr-only">Credit return details</FieldLegend>
            <FieldGroup>
              {fields.map((field) => (
                <Field key={field.id} data-invalid={!!errors[field.id]}>
                  <FieldLabel htmlFor={`return-${field.id}`}>
                    {field.label}
                  </FieldLabel>
                  {field.control}
                  {errors[field.id] ? (
                    <FieldError id={`return-${field.id}-error`}>
                      {errors[field.id]}
                    </FieldError>
                  ) : null}
                </Field>
              ))}
            </FieldGroup>
          </FieldSet>
          {paying ? (
            <p role="status">
              Currency: {paying.currency} · Available credit:{" "}
              {positions.isSuccess
                ? available
                  ? formatFinanceMoney(available)
                  : `0 ${paying.currency}`
                : "unavailable"}
              . Preview checks authoritative availability.
            </p>
          ) : null}
          {participantId && positions.isError ? (
            <p role="status">
              Credit availability could not load. Refresh dependencies or
              request an authoritative preview.
            </p>
          ) : null}
          {error || create.error ? (
            <Alert variant="destructive">
              <AlertTitle>{error || create.error}</AlertTitle>
            </Alert>
          ) : null}
          {create.rejected ? (
            <p role="status">
              The original credit return was rejected. Refresh preview and
              deliberately confirm a new action. Your amount, Account and date
              are preserved.
            </p>
          ) : null}
          {create.unresolved ? (
            <p role="status">
              The original credit return is retained in Finance recovery. Check
              its outcome or retry the original submission. Do not return this
              money again.
            </p>
          ) : null}
          {review ? (
            <section
              aria-label="Credit return preview"
              className="flex min-w-0 flex-col gap-3"
            >
              <h2 className="font-semibold">Review credit return</h2>
              <p>
                Return {formatFinanceMoney(review.preview.amount)} on{" "}
                {review.draft.transactionDate} from{" "}
                {labels.get(review.draft.payingAccountId)} to the Participant.
                Credit Liability decreases by the same amount. No Income,
                Expense or receivable change.
              </p>
              <dl className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["Paying balance before", review.preview.payingBalance],
                    ["Paying balance after", review.preview.payingBalanceAfter],
                    [
                      "Available credit before",
                      review.preview.availableCreditBefore,
                    ],
                    [
                      "Available credit after",
                      review.preview.availableCreditAfter,
                    ],
                  ] as const
                ).map(([label, money]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd className="[overflow-wrap:anywhere]">
                      {formatFinanceMoney(money)}
                    </dd>
                  </div>
                ))}
              </dl>
              <CreditApplicationOrigins
                action="return"
                origins={review.preview.origins}
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
                  ...(participantId ? [positions.refetch()] : []),
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
                  : "Preview credit return"}
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
                {create.pending ? "Confirming…" : "Confirm credit return"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
