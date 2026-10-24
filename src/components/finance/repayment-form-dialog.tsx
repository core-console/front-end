import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import {
  usePreviewFinanceSettlement,
  useListFinanceCategories,
} from "@/api/generated/core-console";
import {
  PreviewFinanceSettlementBody,
  SettlementPreview,
  CreditSettlementPreview,
  IncomeSettlementPreview,
  CategoryResponse,
  FinanceRequestDate,
  type AccountResponse,
  type CurrencyResponse,
  type ParticipantResponse,
  type MoneyResponse,
} from "@/api/generated/schemas";
import { buildAccountWorkflowLabels } from "./account-identity";
import { formatFinanceMoney } from "./finance-money";
import { subtractExactDecimals } from "./finance-decimal";
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
function sameMoney(left: MoneyResponse, right: MoneyResponse) {
  return (
    left.currency === right.currency &&
    /^\d+(?:\.\d+)?$/.test(left.amount) &&
    /^\d+(?:\.\d+)?$/.test(right.amount) &&
    /^0(?:\.0+)?$/.test(subtractExactDecimals(left.amount, right.amount))
  );
}
function positiveExactAmount(value: string, minorUnit: number) {
  return (
    /^\d+(?:\.\d+)?$/.test(value) &&
    /[1-9]/.test(value) &&
    (value.split(".")[1]?.length ?? 0) <= minorUnit &&
    value.split(".")[0]!.replace(/^0+/, "").length <= 131072
  );
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
  const [disposition, setDisposition] = useState("repayOnly");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const acceptIncome = disposition === "acceptIncome";
  const categories = useListFinanceCategories(ledgerId, {
    query: {
      enabled: acceptIncome,
      select: (response) => CategoryResponse.array().parse(response.data),
    },
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [storedReview, setReview] = useState<{
    draft: PreviewFinanceSettlementBody;
    preview:
      SettlementPreview | CreditSettlementPreview | IncomeSettlementPreview;
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
  const reviewedCategoryId =
    review && "categoryAllocations" in review.preview
      ? review.preview.categoryAllocations[0]?.categoryId
      : null;
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
        "Choose a Participant in this Ledger. Archived Participants may record receipts.";
    if (!account || !currency)
      invalid.receiving =
        "Choose an active receiving Account with an available currency.";
    if (!positiveExactAmount(amount, currency?.minorUnit ?? 0))
      invalid.amount =
        "Enter a positive exact amount within the currency precision. Amounts are never rounded.";
    if (
      !FinanceRequestDate.safeParse(date).success ||
      (account && date < account.trackingStartDate)
    )
      invalid.date =
        "Enter a valid date on or after the Account Tracking Start Date.";
    if (acceptIncome) {
      if (!positiveExactAmount(incomeAmount, currency?.minorUnit ?? 0))
        invalid.income =
          "Enter a positive exact Income amount within the receiving currency precision. Amounts are never rounded.";
      if (
        !categories.isSuccess ||
        (categoryId &&
          !categories.data.some(
            (item) => item.id === categoryId && item.status === "active",
          ))
      )
        invalid.category =
          "Choose an active Category in this Ledger or Uncategorized. Refresh dependencies if it is unavailable.";
    }
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
      ...(acceptIncome
        ? {
            excessDisposition: "acceptIncome",
            categoryAllocations: [
              {
                amount: { amount: incomeAmount, currency: account.currency },
                categoryId: categoryId || null,
              },
            ],
          }
        : disposition === "retainCredit"
          ? { excessDisposition: "retainCredit" }
          : {}),
    });
    setError("");
    try {
      const response = await preview.mutateAsync({ ledgerId, data: draft });
      const schema =
        "categoryAllocations" in draft
          ? IncomeSettlementPreview.refine((item) => {
              const expected = draft.categoryAllocations[0]!;
              const actual = item.categoryAllocations[0];
              return (
                sameMoney(item.amount, draft.amount) &&
                sameMoney(item.acceptedSurplus, expected.amount) &&
                item.categoryAllocations.length === 1 &&
                !!actual &&
                sameMoney(actual.amount, expected.amount) &&
                (actual.categoryId ?? null) === (expected.categoryId ?? null) &&
                sameMoney(item.availableCreditBefore, item.availableCreditAfter)
              );
            }, "Income preview does not match the explicit intent.")
          : disposition === "retainCredit"
            ? CreditSettlementPreview
            : SettlementPreview;
      if (journal.isCurrentNamespace())
        setReview({
          draft,
          preview: schema.parse(response.data),
        });
    } catch {
      setError(
        acceptIncome
          ? "Preview could not be loaded. Your Income intent is preserved. Refresh dependencies and check the receipt, eligible debt and Income Category. If current surplus no longer matches, explicitly adjust your draft before previewing and reconfirming. Nothing was confirmed."
          : "Preview could not be loaded. Check the receiving Account, currency, date and eligible outstanding debt, then refresh dependencies and try again. Nothing was confirmed.",
      );
    }
  }
  const fields = [
    {
      id: "disposition",
      label: "Surplus handling",
      control: (
        <NativeSelect
          id="repayment-disposition"
          value={disposition}
          aria-describedby="repayment-disposition-help"
          onChange={(event) => {
            edit();
            setDisposition(event.target.value);
          }}
        >
          <NativeSelectOption value="repayOnly">
            Repay debt only (no surplus)
          </NativeSelectOption>
          <NativeSelectOption value="retainCredit">
            Retain surplus as Participant credit
          </NativeSelectOption>
          <NativeSelectOption value="acceptIncome">
            Accept surplus as Income
          </NativeSelectOption>
        </NativeSelect>
      ),
    },
    ...(acceptIncome
      ? [
          {
            id: "income",
            label: "Accepted Income amount",
            control: (
              <Input
                id="repayment-income"
                inputMode="decimal"
                value={incomeAmount}
                aria-invalid={!!errors.income}
                aria-describedby={
                  errors.income
                    ? "repayment-income-help repayment-income-error"
                    : "repayment-income-help"
                }
                onChange={(event) => {
                  edit();
                  setIncomeAmount(event.target.value);
                }}
              />
            ),
          },
          {
            id: "category",
            label: "Income Category",
            control: (
              <NativeSelect
                id="repayment-category"
                value={categoryId}
                aria-invalid={!!errors.category}
                aria-describedby={
                  errors.category ? "repayment-category-error" : undefined
                }
                onChange={(event) => {
                  edit();
                  setCategoryId(event.target.value);
                }}
              >
                <NativeSelectOption value="">Uncategorized</NativeSelectOption>
                {categoryId &&
                !categories.data?.some(
                  (item) => item.id === categoryId && item.status === "active",
                ) ? (
                  <NativeSelectOption value={categoryId}>
                    Unavailable Category · {categoryId}
                  </NativeSelectOption>
                ) : null}
                {(categories.data ?? [])
                  .filter((item) => item.status === "active")
                  .map((item) => (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {item.name} · {item.id}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            ),
          },
        ]
      : []),
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
            recording affects Current Balance immediately. Choose retained
            credit explicitly to receive surplus or record a receipt without
            eligible debt. Accept surplus as Income only by explicitly entering
            its exact amount and Category intent.
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
                    {field.id === "disposition" ? (
                      <p
                        id="repayment-disposition-help"
                        className="text-sm text-muted-foreground"
                      >
                        Cash first pays all eligible debt. Retained credit is a
                        Liability owed to the Participant. Accepted surplus is
                        Income belonging to you. Choose its meaning explicitly;
                        existing credit is never applied automatically.
                      </p>
                    ) : null}
                    {field.id === "income" ? (
                      <p
                        id="repayment-income-help"
                        className="text-sm text-muted-foreground"
                      >
                        Enter the exact surplus you intend to accept as Income.
                        It must equal the receipt remaining after eligible debt.
                        Your amount is never adjusted automatically.
                      </p>
                    ) : null}
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
          {acceptIncome && !categories.isSuccess ? (
            <p role="status">
              {categories.isError
                ? "Income Categories could not load. Refresh dependencies to try again."
                : "Loading Income Categories…"}
            </p>
          ) : null}
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
              {"retainedCredit" in review.preview ? (
                <p>
                  Retained credit creates no Income or Expense. The full receipt
                  changes the receiving balance; retained surplus increases the
                  Participant credit Liability. Existing credit remains
                  unapplied.
                </p>
              ) : null}
              {"acceptedSurplus" in review.preview ? (
                <>
                  <p>
                    Accepted surplus belongs to you and increases Income. No
                    Participant credit is created; existing credit is unchanged.
                    The full receipt changes the receiving balance.
                  </p>
                  <dl className="grid grid-cols-2 gap-2">
                    <div>
                      <dt>Accepted surplus Income</dt>
                      <dd>
                        {formatFinanceMoney(review.preview.acceptedSurplus)}
                      </dd>
                    </div>
                    <div>
                      <dt>Income Category</dt>
                      <dd>
                        {reviewedCategoryId
                          ? (categories.data?.find(
                              (item) => item.id === reviewedCategoryId,
                            )?.name ?? reviewedCategoryId)
                          : "Uncategorized"}
                      </dd>
                    </div>
                    <div>
                      <dt>Available credit before</dt>
                      <dd>
                        {formatFinanceMoney(
                          review.preview.availableCreditBefore,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Available credit after</dt>
                      <dd>
                        {formatFinanceMoney(
                          review.preview.availableCreditAfter,
                        )}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : null}
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
              {"retainedCredit" in review.preview ? (
                <dl className="grid grid-cols-2 gap-2">
                  {(
                    [
                      [
                        "Retained credit Liability",
                        review.preview.retainedCredit,
                      ],
                      [
                        "Available credit before",
                        review.preview.availableCreditBefore,
                      ],
                      [
                        "Available credit after",
                        review.preview.availableCreditAfter,
                      ],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{formatFinanceMoney(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {review.preview.allocations.length === 0 ? (
                <p>
                  No eligible debt is paid. No Obligation is created and no
                  prior forgiveness is reversed.
                </p>
              ) : null}
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
                void Promise.allSettled([
                  refreshDependencies(),
                  ...(acceptIncome ? [categories.refetch()] : []),
                ]).finally(() => setRefreshing(false));
              }}
            >
              {refreshing ? "Refreshing…" : "Refresh dependencies"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              {locked ? "Close to recovery" : "Discard draft"}
            </Button>
            <Button
              type="submit"
              disabled={
                preview.isPending ||
                locked ||
                refreshing ||
                (acceptIncome && !categories.isSuccess)
              }
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
