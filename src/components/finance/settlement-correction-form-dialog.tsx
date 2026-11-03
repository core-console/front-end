import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import {
  useListFinanceCategories,
  usePreviewFinanceSettlementCorrection,
} from "@/api/generated/core-console";
import {
  CategoryResponse,
  type SettlementCorrectionPreview,
  type PreviewFinanceSettlementCorrectionBody,
} from "@/api/generated/schemas";
import type { SettlementSource } from "./settlement-source";
import {
  parseSettlementCorrectionPreview,
  settlementCorrectionDraft,
} from "./settlement-correction";
import { correctionText } from "./advance-correction";
import { SettlementCorrectionConsequences } from "./settlement-correction-consequences";
import { useFinanceSubmissions } from "./finance-submission-context";
import { useFinanceCreate } from "./use-finance-create";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Field,
  FieldSet,
  FieldGroup,
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

export function SettlementCorrectionFormDialog({
  source,
  onClose,
  onConfirmed,
  finalFocus,
}: {
  source: SettlementSource;
  onClose: () => void;
  onConfirmed: () => void;
  finalFocus: ComponentProps<typeof DialogContent>["finalFocus"];
}) {
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(source.amount.amount);
  const [disposition, setDisposition] =
    useState<PreviewFinanceSettlementCorrectionBody["excessDisposition"]>(
      "none",
    );
  const [categoryId, setCategoryId] = useState("");
  const [review, setReview] = useState<{
    draft: PreviewFinanceSettlementCorrectionBody;
    plan: SettlementCorrectionPreview;
  } | null>(null);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const first = useRef<HTMLTextAreaElement>(null),
    confirm = useRef<HTMLButtonElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const journal = useFinanceSubmissions();
  const create = useFinanceCreate(
    onConfirmed,
    `${source.ledgerId}|${source.id}`,
    true,
    { operation: "createFinanceSettlementCorrection" },
  );
  const preview = usePreviewFinanceSettlementCorrection({
    mutation: { retry: false },
  });
  const categories = useListFinanceCategories(source.ledgerId, {
    query: {
      select: (response) => CategoryResponse.array().parse(response.data),
      enabled: disposition === "acceptIncome",
    },
  });
  const shown = create.rejected ? null : review;
  const busy = create.pending || create.unresolved || preview.isPending;
  useEffect(() => {
    if (shown) confirm.current?.focus();
  }, [shown]);
  useEffect(() => {
    if (create.rejected) first.current?.focus();
  }, [create.rejected]);
  function edit() {
    create.edited();
    setReview(null);
    setErrors({});
    setError("");
  }
  async function showPreview(e: FormEvent) {
    e.preventDefault();
    if (busy || !journal.isCurrentNamespace()) return;
    if (create.rejected) create.startAnother();
    setReview(null);
    setError("");
    const invalid: Record<string, string> = {};
    const length = [...correctionText(reason)].length;
    if (!length || length > 500)
      invalid.reason = "Enter a reason of 1 to 500 characters.";
    if (
      !/^\d+(?:\.\d+)?$/.test(amount) ||
      !/[1-9]/.test(amount) ||
      (amount.split(".")[1]?.length ?? 0) >
        (source.amount.currency === "JPY" ? 0 : 2) ||
      amount.split(".")[0]!.replace(/^0+/, "").length > 131072
    )
      invalid.amount =
        "Enter a positive exact amount in the original currency. Amounts are never rounded.";
    if (
      disposition === "acceptIncome" &&
      (!categories.isSuccess ||
        (categoryId &&
          !categories.data.some(
            (c) => c.id === categoryId && c.status === "active",
          )))
    )
      invalid.category =
        "Load and choose an active Income Category, or Uncategorized.";
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      document
        .getElementById(`cash-correction-${Object.keys(invalid)[0]}`)
        ?.focus();
      return;
    }
    const draft = settlementCorrectionDraft.parse({
      settlementId: source.id,
      amount: { amount, currency: source.amount.currency },
      reason,
      excessDisposition: disposition,
      categoryId: disposition === "acceptIncome" ? categoryId || null : null,
    });
    try {
      const response = await preview.mutateAsync({
        ledgerId: source.ledgerId,
        data: draft,
      });
      const plan = parseSettlementCorrectionPreview(
        response.data,
        source,
        draft,
      );
      if (active.current && journal.isCurrentNamespace())
        setReview({ draft, plan });
    } catch {
      if (active.current && journal.isCurrentNamespace())
        setError(
          "Correction preview is unavailable or ineligible. Request a fresh preview after checking the amount, explicit excess disposition and active Category. Forgiveness, credit application/return or consumed receipt credit requires a later workflow. Your draft is preserved; nothing was confirmed.",
        );
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        initialFocus={first}
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>Correct cash repayment</DialogTitle>
          <DialogDescription>
            Restate an incorrectly entered receipt amount. Receiving Account,
            Participant, currency, date and confirmed scope are retained. Review
            all consequences before explicitly confirming.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => void showPreview(e)}
          aria-busy={busy}
          className="flex min-w-0 flex-col gap-4"
        >
          <FieldSet disabled={busy}>
            <FieldGroup>
              <Field data-disabled={busy} data-invalid={!!errors.reason}>
                <FieldLabel htmlFor="cash-correction-reason">Reason</FieldLabel>
                <Textarea
                  ref={first}
                  id="cash-correction-reason"
                  value={reason}
                  aria-invalid={!!errors.reason}
                  aria-describedby={
                    errors.reason ? "cash-correction-reason-error" : undefined
                  }
                  onChange={(e) => {
                    edit();
                    setReason(e.target.value);
                  }}
                />
                {errors.reason ? (
                  <FieldError id="cash-correction-reason-error">
                    {errors.reason}
                  </FieldError>
                ) : null}
              </Field>
              <Field data-disabled={busy} data-invalid={!!errors.amount}>
                <FieldLabel htmlFor="cash-correction-amount">
                  Corrected cash receipt
                </FieldLabel>
                <Input
                  id="cash-correction-amount"
                  inputMode="decimal"
                  value={amount}
                  aria-invalid={!!errors.amount}
                  aria-describedby={
                    errors.amount ? "cash-correction-amount-error" : undefined
                  }
                  onChange={(e) => {
                    edit();
                    setAmount(e.target.value);
                  }}
                />
                {errors.amount ? (
                  <FieldError id="cash-correction-amount-error">
                    {errors.amount}
                  </FieldError>
                ) : null}
              </Field>
              <p>
                Currency: {source.amount.currency}. A decrease can reopen unpaid
                debt without forgiveness. An increase stays within the original
                Allocations. The server determines the complete plan.
              </p>
              <Field data-disabled={busy}>
                <FieldLabel htmlFor="cash-correction-disposition">
                  Excess disposition
                </FieldLabel>
                <NativeSelect
                  id="cash-correction-disposition"
                  value={disposition}
                  onChange={(e) => {
                    edit();
                    setDisposition(e.target.value as typeof disposition);
                  }}
                >
                  <NativeSelectOption value="none">
                    None — all corrected cash resolves retained debt
                  </NativeSelectOption>
                  <NativeSelectOption value="retainCredit">
                    Retain excess as Participant credit
                  </NativeSelectOption>
                  <NativeSelectOption value="acceptIncome">
                    Explicitly accept excess as Income
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              {disposition === "acceptIncome" ? (
                <Field data-disabled={busy} data-invalid={!!errors.category}>
                  <FieldLabel htmlFor="cash-correction-category">
                    Income Category
                  </FieldLabel>
                  <NativeSelect
                    id="cash-correction-category"
                    value={categoryId}
                    aria-invalid={!!errors.category}
                    aria-describedby={
                      errors.category
                        ? "cash-correction-category-error"
                        : undefined
                    }
                    onChange={(e) => {
                      edit();
                      setCategoryId(e.target.value);
                    }}
                  >
                    <NativeSelectOption value="">
                      Uncategorized
                    </NativeSelectOption>
                    {categories.data?.map((c) => (
                      <NativeSelectOption
                        key={c.id}
                        value={c.id}
                        disabled={c.status !== "active"}
                      >
                        {c.name} · {c.status} · {c.id}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {categories.isPending ? (
                    <p role="status">Loading Categories…</p>
                  ) : null}
                  {categories.isError ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void categories.refetch()}
                    >
                      Retry Categories
                    </Button>
                  ) : null}
                  {errors.category ? (
                    <FieldError id="cash-correction-category-error">
                      {errors.category}
                    </FieldError>
                  ) : null}
                </Field>
              ) : null}
            </FieldGroup>
          </FieldSet>
          {error || create.error ? (
            <Alert variant="destructive">
              <AlertTitle>{error || create.error}</AlertTitle>
            </Alert>
          ) : null}
          {create.rejected ? (
            <p role="status">
              The original Correction was rejected. Its preview may be stale.
              Request a fresh complete preview and explicitly confirm again
              under a new submission identity.
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
              aria-label="Cash Correction preview"
              className="flex flex-col gap-3"
            >
              <h3 className="font-semibold">Cash Correction preview</h3>
              <p>Reason: {shown.plan.reason}</p>
              <SettlementCorrectionConsequences
                plan={shown.plan}
                ledgerId={source.ledgerId}
              />
            </section>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
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
                    operation: "createFinanceSettlementCorrection",
                    workflow: "settlementCorrection",
                    targetLedgerId: source.ledgerId,
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
