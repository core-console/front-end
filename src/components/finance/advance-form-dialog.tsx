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
  SharedAdvancePreview,
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

// Compare integer minor units: binary floating point must never decide share totals.
function exactUnits(value: string, precision: number, allowZero = false) {
  if (
    !/^\d+(?:\.\d+)?$/.test(value) ||
    value.split(".")[0]!.replace(/^0+/, "").length > 131072 ||
    (value.split(".")[1]?.length ?? 0) > precision ||
    (!allowZero && !/[1-9]/.test(value))
  )
    return null;
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer! + fraction.padEnd(precision, "0"));
}

export function AdvanceFormDialog({
  shared = false,
  ledgerId,
  accounts,
  participants,
  currencies,
  onClose,
  onConfirmed,
  finalFocus,
  refreshDependencies,
}: {
  shared?: boolean;
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
  const [ownerShare, setOwnerShare] = useState("");
  const [shares, setShares] = useState([
    { key: 0, participantId: "", amount: "" },
  ]);
  const nextShare = useRef(1);
  const [fundingAccountId, setFundingAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [review, setReview] = useState<{
    draft: PreviewFinanceAdvanceBody;
    preview: AdvancePreview | SharedAdvancePreview;
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
          shared ? shares[0]!.participantId : participantId,
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
    (item) => item.status === "active" && (shared || item.nature === "asset"),
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
    if (!shared && !person)
      invalid.participant = "Choose an active Participant.";
    if (!account || !currency)
      invalid.funding =
        "Choose an eligible active funding Account with an available currency.";
    const precision = currency?.minorUnit ?? 0;
    const total = exactUnits(amount, precision);
    if (total === null)
      invalid.amount =
        "Enter a positive exact amount within the currency precision. Amounts are never rounded.";
    if (shared) {
      const owner = exactUnits(ownerShare, precision, true);
      if (owner === null)
        invalid.owner =
          "Enter an exact non-negative owner share. Amounts are never rounded.";
      const seen = new Set<string>();
      let sum = owner ?? 0n;
      shares.forEach((share) => {
        if (
          !eligiblePeople.some((item) => item.id === share.participantId) ||
          seen.has(share.participantId)
        )
          invalid[`participant-${share.key}`] =
            "Choose a distinct active Participant.";
        seen.add(share.participantId);
        const value = exactUnits(share.amount, precision);
        if (value === null)
          invalid[`share-${share.key}`] =
            "Enter a positive exact Participant share within the currency precision.";
        else sum += value;
      });
      if (!Object.keys(invalid).length && sum !== total)
        invalid.amount =
          "Owner and Participant shares must equal the total funding exactly. Nothing is rounded or allocated automatically.";
    }
    if (
      !FinanceRequestDate.safeParse(date).success ||
      (account && date < account.trackingStartDate)
    )
      invalid.date =
        "Enter a valid date on or after the Account Tracking Start Date.";
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      const firstInvalid = fields.find((field) => invalid[field.id]);
      document.getElementById(`advance-${firstInvalid?.id}`)?.focus();
      return;
    }
    if (!account) return;
    const money = { amount, currency: account.currency };
    const draft = PreviewFinanceAdvanceBody.parse({
      fundingAccountId,
      ...(!shared
        ? { participantId, participantShare: money }
        : {
            participantShares: shares.map((share) => ({
              participantId: share.participantId,
              amount: { amount: share.amount, currency: account.currency },
            })),
          }),
      transactionDate: date,
      amount: money,
      ownerShare: {
        amount: shared ? ownerShare : "0",
        currency: account.currency,
      },
      note: note || null,
    });
    setReview(null);
    setError("");
    try {
      const response = await preview.mutateAsync({ ledgerId, data: draft });
      setReview({
        draft,
        preview: shared
          ? SharedAdvancePreview.parse(response.data)
          : AdvancePreview.parse(response.data),
      });
    } catch {
      setError(
        "Preview could not be loaded. Check the Account, Participant, date and amount, then refresh dependencies and try again. Nothing was confirmed.",
      );
    }
  }
  const fields = [
    ...(shared
      ? shares.flatMap((share, index) => [
          {
            id: `participant-${share.key}`,
            label: `Participant ${index + 1}`,
            control: (
              <NativeSelect
                ref={index === 0 ? first : undefined}
                id={`advance-participant-${share.key}`}
                value={share.participantId}
                aria-invalid={!!errors[`participant-${share.key}`]}
                aria-describedby={
                  errors[`participant-${share.key}`]
                    ? `advance-participant-${share.key}-error`
                    : undefined
                }
                onChange={(event) => {
                  edit();
                  setShares(
                    shares.map((item) =>
                      item.key === share.key
                        ? { ...item, participantId: event.target.value }
                        : item,
                    ),
                  );
                }}
              >
                <NativeSelectOption value="">
                  Choose Participant
                </NativeSelectOption>
                {eligiblePeople.map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.name} · {item.id}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ),
          },
          {
            id: `share-${share.key}`,
            label: `Participant ${index + 1} share`,
            control: (
              <>
                <Input
                  id={`advance-share-${share.key}`}
                  inputMode="decimal"
                  value={share.amount}
                  aria-invalid={!!errors[`share-${share.key}`]}
                  aria-describedby={
                    errors[`share-${share.key}`]
                      ? `advance-share-${share.key}-error`
                      : undefined
                  }
                  onChange={(event) => {
                    edit();
                    setShares(
                      shares.map((item) =>
                        item.key === share.key
                          ? { ...item, amount: event.target.value }
                          : item,
                      ),
                    );
                  }}
                />
                {shares.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      edit();
                      setShares(
                        shares.filter((item) => item.key !== share.key),
                      );
                      requestAnimationFrame(() => first.current?.focus());
                    }}
                  >
                    Remove Participant {index + 1}
                  </Button>
                ) : null}
              </>
            ),
          },
        ])
      : [
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
                <NativeSelectOption value="">
                  Choose Participant
                </NativeSelectOption>
                {eligiblePeople.map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.name} · {item.id}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ),
          },
        ]),
    ...(shared
      ? [
          {
            id: "owner",
            label: "Owner share",
            control: (
              <Input
                id="advance-owner"
                inputMode="decimal"
                value={ownerShare}
                aria-invalid={!!errors.owner}
                aria-describedby={
                  errors.owner ? "advance-owner-error" : undefined
                }
                onChange={(event) => {
                  edit();
                  setOwnerShare(event.target.value);
                }}
              />
            ),
          },
        ]
      : []),
    {
      id: "funding",
      label: shared ? "Funding Account" : "Funding Asset Account",
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
          <NativeSelectOption value="">
            Choose {shared ? "funding" : "Asset"} Account
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
          <DialogTitle>
            {shared ? "Record shared purchase" : "Record pure Advance"}
          </DialogTitle>
          <DialogDescription>
            {shared
              ? "Explicit owner and Participant shares, one Asset or Liability funding Account. Shares must equal total funding exactly. "
              : "One Participant, one Asset Account, zero owner share. "}
            Future-dated recording affects Current Balance immediately.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void showPreview(event)}
          className="flex min-w-0 flex-col gap-4"
        >
          <FieldGroup>
            <FieldSet disabled={preview.isPending || locked || refreshing}>
              <FieldLegend className="sr-only">Advance details</FieldLegend>
              <FieldGroup>
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
                {shared ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      edit();
                      const key = nextShare.current++;
                      setShares([
                        ...shares,
                        { key, participantId: "", amount: "" },
                      ]);
                      requestAnimationFrame(() =>
                        document
                          .getElementById(`advance-participant-${key}`)
                          ?.focus(),
                      );
                    }}
                  >
                    Add Participant
                  </Button>
                ) : null}
              </FieldGroup>
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
              {"participantShares" in review.draft ? null : (
                <p>
                  Participant:{" "}
                  {
                    participants.find(
                      (item) =>
                        "participantId" in review.draft &&
                        item.id === review.draft.participantId,
                    )?.name
                  }{" "}
                  · {review.draft.participantId}
                </p>
              )}
              <p>
                Funding Account: {labels.get(review.draft.fundingAccountId)} ·{" "}
                {review.draft.fundingAccountId}
              </p>
              {shared ? (
                <p>
                  {accounts.find(
                    (item) => item.id === review.draft.fundingAccountId,
                  )?.nature === "liability"
                    ? "Liability increases"
                    : "Asset decreases"}{" "}
                  by {formatFinanceMoney(review.draft.amount)}. Participant
                  principal is not personal Expense. Income is unchanged.
                </p>
              ) : null}
              {"participantReceivables" in review.preview ? (
                <ul aria-label="Participant receivables">
                  {review.preview.participantReceivables.map((share) => (
                    <li key={share.participantId}>
                      {
                        participants.find(
                          (item) => item.id === share.participantId,
                        )?.name
                      }{" "}
                      · {share.participantId}:{" "}
                      {formatFinanceMoney(share.principal)}
                    </li>
                  ))}
                </ul>
              ) : null}
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
              {"participantShare" in review.draft ? (
                <p>
                  Participant share:{" "}
                  {formatFinanceMoney(review.draft.participantShare)}. Owner
                  share: {formatFinanceMoney(review.draft.ownerShare)}.
                </p>
              ) : null}
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
