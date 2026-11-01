import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import { usePreviewFinanceAdvanceCorrection } from "@/api/generated/core-console";
import {
  FinanceRequestDate,
  type AccountResponse,
  type ParticipantResponse,
  type AdvanceCorrectionPreview,
  type PreviewFinanceAdvanceCorrectionBody,
} from "@/api/generated/schemas";
import { advanceObligations, type AdvanceSource } from "./advance-source";
import {
  correctionDraftBody,
  correctionEqual,
  correctionText,
  parseCorrectionPreview,
} from "./advance-correction";
import { subtractExactDecimals } from "./finance-decimal";
import { CorrectionConsequences } from "./correction-consequences";
import { useFinanceSubmissions } from "./finance-submission-context";
import { useFinanceCreate } from "./use-finance-create";
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
export function AdvanceCorrectionFormDialog({
  source,
  accounts,
  participants,
  onClose,
  onConfirmed,
  finalFocus,
  refreshDependencies,
}: {
  source: AdvanceSource;
  accounts: AccountResponse[];
  participants: ParticipantResponse[];
  onClose: () => void;
  onConfirmed: () => void;
  finalFocus: ComponentProps<typeof DialogContent>["finalFocus"];
  refreshDependencies: () => Promise<void>;
}) {
  const ledgerId = source.ledgerId;
  const [reason, setReason] = useState("");
  const [funding, setFunding] = useState(source.fundingAccountId);
  const [date, setDate] = useState(source.transactionDate);
  const [amount, setAmount] = useState(source.amount.amount);
  const [owner, setOwner] = useState(source.ownerShare.amount);
  const [note, setNote] = useState(source.note ?? "");
  const [shares, setShares] = useState(() =>
    advanceObligations(source)
      .filter((o) => !correctionEqual(o.principal.amount, "0"))
      .map((o) => ({
        key: crypto.randomUUID(),
        participantId: o.participantId,
        amount: o.principal.amount,
      })),
  );
  const [review, setReview] = useState<{
    draft: PreviewFinanceAdvanceCorrectionBody;
    plan: AdvanceCorrectionPreview;
  } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const first = useRef<HTMLTextAreaElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const journal = useFinanceSubmissions();
  const preview = usePreviewFinanceAdvanceCorrection({
    mutation: { retry: false },
  });
  const create = useFinanceCreate(
    () => onConfirmed(),
    `${ledgerId}|${source.id}`,
    true,
    { operation: "createFinanceAdvanceCorrection" },
  );
  const shown = create.rejected ? null : review;
  const busy =
    create.pending || create.unresolved || preview.isPending || refreshing;
  useEffect(() => {
    if (shown) confirm.current?.focus();
  }, [shown]);
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
    if (create.rejected) create.startAnother();
    setReview(null);
    const invalid: Record<string, string> = {};
    const account = accounts.find((a) => a.id === funding);
    const precision = source.amount.currency === "JPY" ? 0 : 2;
    const validMoney = (value: string, allowZero = false) =>
      /^\d+(?:\.\d+)?$/.test(value) &&
      (allowZero || /[1-9]/.test(value)) &&
      (value.split(".")[1]?.length ?? 0) <= precision &&
      value.split(".")[0]!.replace(/^0+/, "").length <= 131072;
    if (!correctionText(reason) || [...correctionText(reason)].length > 500)
      invalid.reason = "Enter a reason of 1 to 500 characters.";
    if (
      !account ||
      account.status !== "active" ||
      account.currency !== source.amount.currency
    )
      invalid.funding =
        "Choose an active funding Account in the original currency.";
    if (
      !FinanceRequestDate.safeParse(date).success ||
      (account && date < account.trackingStartDate)
    )
      invalid.date =
        "Enter a valid original financial date on or after Tracking Start Date.";
    if (!validMoney(amount))
      invalid.amount =
        "Enter positive exact funding within currency precision. Amounts are never rounded.";
    if (!validMoney(owner, true))
      invalid.owner = "Enter an exact non-negative owner share.";
    const seen = new Set<string>();
    shares.forEach((s, i) => {
      const p = participants.find(
        (p) => p.id === s.participantId && p.ledgerId === ledgerId,
      );
      const existing = advanceObligations(source).some(
        (o) =>
          o.participantId === s.participantId &&
          !correctionEqual(o.principal.amount, "0"),
      );
      if (!p || seen.has(p.id) || (p.status !== "active" && !existing))
        invalid[`participant-${i}`] =
          "Choose a distinct active Participant, or retain existing archived attribution.";
      seen.add(s.participantId);
      if (!validMoney(s.amount))
        invalid[`share-${i}`] = "Enter a positive exact Participant share.";
    });
    if (!Object.keys(invalid).length) {
      let remainder = subtractExactDecimals(amount, owner);
      for (const s of shares)
        remainder = subtractExactDecimals(remainder, s.amount);
      if (!correctionEqual(remainder, "0"))
        invalid.amount =
          "Owner and Participant shares must equal total funding exactly. Nothing is rounded or redistributed.";
    }
    if ([...correctionText(note)].length > 500)
      invalid.note = "Enter a note of at most 500 characters.";
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      document.getElementById(`correction-${Object.keys(invalid)[0]}`)?.focus();
      return;
    }
    const m = (value: string) => ({
      amount: value,
      currency: source.amount.currency,
    });
    const draft = correctionDraftBody.parse({
      advanceId: source.id,
      reason,
      fundingAccountId: funding,
      transactionDate: date,
      amount: m(amount),
      ownerShare: m(owner),
      participantShares: shares.map((s) => ({
        participantId: s.participantId,
        amount: m(s.amount),
      })),
      note: note || null,
    });
    setError("");
    try {
      const response = await preview.mutateAsync({ ledgerId, data: draft });
      const plan = parseCorrectionPreview(response.data, ledgerId, draft);
      if (active.current && journal.isCurrentNamespace())
        setReview({ draft, plan });
    } catch {
      if (active.current && journal.isCurrentNamespace())
        setError(
          "Correction preview is unavailable or ineligible. Any cash Allocation, forgiveness or credit application blocks this correction. Check ownership, Account eligibility and dates, refresh dependencies and request a complete preview. Your draft is preserved. Nothing was confirmed.",
        );
    }
  }
  const fields = [
    {
      id: "reason",
      label: "Reason",
      control: (
        <Textarea
          ref={first}
          id="correction-reason"
          value={reason}
          onChange={(e) => {
            edit();
            setReason(e.target.value);
          }}
        />
      ),
    },
    {
      id: "funding",
      label: "Funding Account",
      control: (
        <NativeSelect
          id="correction-funding"
          value={funding}
          onChange={(e) => {
            edit();
            setFunding(e.target.value);
          }}
        >
          {accounts
            .filter((a) => a.currency === source.amount.currency)
            .map((a) => (
              <NativeSelectOption
                key={a.id}
                value={a.id}
                disabled={a.status !== "active"}
              >
                {buildAccountWorkflowLabels(accounts).get(a.id)} · {a.nature} ·{" "}
                {a.currency} · {a.status}
              </NativeSelectOption>
            ))}
        </NativeSelect>
      ),
    },
    {
      id: "date",
      label: "Original financial date",
      control: (
        <Input
          id="correction-date"
          type="date"
          value={date}
          onChange={(e) => {
            edit();
            setDate(e.target.value);
          }}
        />
      ),
    },
    {
      id: "amount",
      label: "Total funding",
      control: (
        <Input
          id="correction-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            edit();
            setAmount(e.target.value);
          }}
        />
      ),
    },
    {
      id: "owner",
      label: "Owner share",
      control: (
        <Input
          id="correction-owner"
          inputMode="decimal"
          value={owner}
          onChange={(e) => {
            edit();
            setOwner(e.target.value);
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
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>Correct Advance</DialogTitle>
          <DialogDescription>
            Repair incorrect original facts before settlement activity. Enter
            actual funding and every share explicitly. Truthful funding remains
            funded; a smaller participant share requires an explicitly increased
            owner or other share. Fully owner-funded purchases are allowed. This
            does not record refunds, renegotiation or cancellation.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => void showPreview(e)}
          className="flex min-w-0 flex-col gap-4"
        >
          <FieldSet disabled={busy}>
            <FieldLegend className="sr-only">
              Corrected Advance facts
            </FieldLegend>
            <FieldGroup>
              {fields.map((f) => (
                <Field key={f.id} data-invalid={!!errors[f.id]}>
                  <FieldLabel htmlFor={`correction-${f.id}`}>
                    {f.label}
                  </FieldLabel>
                  {cloneElement(f.control, {
                    "aria-invalid": !!errors[f.id],
                    "aria-describedby": errors[f.id]
                      ? `correction-${f.id}-error`
                      : undefined,
                  })}
                  {errors[f.id] ? (
                    <FieldError id={`correction-${f.id}-error`}>
                      {errors[f.id]}
                    </FieldError>
                  ) : null}
                </Field>
              ))}
              {shares.map((share, i) => (
                <FieldSet key={share.key}>
                  <FieldLegend>Participant {i + 1}</FieldLegend>
                  <FieldGroup>
                    <Field data-invalid={!!errors[`participant-${i}`]}>
                      <FieldLabel htmlFor={`correction-participant-${i}`}>
                        Participant {i + 1}
                      </FieldLabel>
                      <NativeSelect
                        id={`correction-participant-${i}`}
                        value={share.participantId}
                        aria-invalid={!!errors[`participant-${i}`]}
                        aria-describedby={
                          errors[`participant-${i}`]
                            ? `correction-participant-${i}-error`
                            : undefined
                        }
                        onChange={(e) => {
                          edit();
                          setShares((rows) =>
                            rows.map((s) =>
                              s.key === share.key
                                ? { ...s, participantId: e.target.value }
                                : s,
                            ),
                          );
                        }}
                      >
                        <NativeSelectOption value="">
                          Choose Participant
                        </NativeSelectOption>
                        {participants
                          .filter((p) => p.ledgerId === ledgerId)
                          .map((p) => (
                            <NativeSelectOption key={p.id} value={p.id}>
                              {p.name} ({p.status}) · {p.id}
                            </NativeSelectOption>
                          ))}
                      </NativeSelect>
                      {errors[`participant-${i}`] ? (
                        <FieldError id={`correction-participant-${i}-error`}>
                          {errors[`participant-${i}`]}
                        </FieldError>
                      ) : null}
                    </Field>
                    <Field data-invalid={!!errors[`share-${i}`]}>
                      <FieldLabel htmlFor={`correction-share-${i}`}>
                        Participant {i + 1} share
                      </FieldLabel>
                      <Input
                        id={`correction-share-${i}`}
                        inputMode="decimal"
                        value={share.amount}
                        aria-invalid={!!errors[`share-${i}`]}
                        aria-describedby={
                          errors[`share-${i}`]
                            ? `correction-share-${i}-error`
                            : undefined
                        }
                        onChange={(e) => {
                          edit();
                          setShares((rows) =>
                            rows.map((s) =>
                              s.key === share.key
                                ? { ...s, amount: e.target.value }
                                : s,
                            ),
                          );
                        }}
                      />
                      {errors[`share-${i}`] ? (
                        <FieldError id={`correction-share-${i}-error`}>
                          {errors[`share-${i}`]}
                        </FieldError>
                      ) : null}
                    </Field>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        edit();
                        setShares((rows) =>
                          rows.filter((s) => s.key !== share.key),
                        );
                      }}
                    >
                      Remove Participant {i + 1}
                    </Button>
                  </FieldGroup>
                </FieldSet>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  edit();
                  setShares((rows) => [
                    ...rows,
                    { key: crypto.randomUUID(), participantId: "", amount: "" },
                  ]);
                }}
              >
                Add Participant
              </Button>
              <Field data-invalid={!!errors.note}>
                <FieldLabel htmlFor="correction-note">Note</FieldLabel>
                <Textarea
                  id="correction-note"
                  value={note}
                  aria-invalid={!!errors.note}
                  aria-describedby={
                    errors.note ? "correction-note-error" : undefined
                  }
                  onChange={(e) => {
                    edit();
                    setNote(e.target.value);
                  }}
                />
                {errors.note ? (
                  <FieldError id="correction-note-error">
                    {errors.note}
                  </FieldError>
                ) : null}
              </Field>
            </FieldGroup>
          </FieldSet>
          <p>
            Currency: {source.amount.currency}. Owner share is purchase Expense.
            All affected original dates, Transactions, receivables and Account
            balances are reviewed together.
          </p>
          {error || create.error ? (
            <Alert variant="destructive">
              <AlertTitle>{error || create.error}</AlertTitle>
            </Alert>
          ) : null}
          {create.rejected ? (
            <p role="status">
              The original Correction was rejected. Refresh the complete preview
              and explicitly confirm again under a new submission identity.
            </p>
          ) : null}
          {create.unresolved ? (
            <p role="status">
              The original command is retained. Check outcome or retry it in
              Finance recovery. Do not submit another Correction.
            </p>
          ) : null}
          {shown ? (
            <section
              aria-label="Correction preview"
              className="flex flex-col gap-3"
            >
              <h3 className="font-semibold">Correction preview</h3>
              <p>Reason: {shown.plan.reason}</p>
              <CorrectionConsequences
                plan={shown.plan}
                accounts={accounts}
                participants={participants}
              />
            </section>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setRefreshing(true);
                setReview(null);
                try {
                  await refreshDependencies();
                } finally {
                  if (active.current) setRefreshing(false);
                }
              }}
            >
              Refresh dependencies
            </Button>
            <Button type="submit" disabled={busy || !create.ready}>
              Preview Correction
            </Button>
            {shown ? (
              <Button
                ref={confirm}
                type="button"
                disabled={busy || !create.ready}
                onClick={() =>
                  void create.submit({
                    operation: "createFinanceAdvanceCorrection",
                    workflow: "advanceCorrection",
                    targetLedgerId: ledgerId,
                    body: {
                      ...shown.draft,
                      previewToken: shown.plan.previewToken,
                    },
                  })
                }
              >
                Confirm Correction
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
