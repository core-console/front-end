import type {
  CombinedSettlementPreview,
  CombinedSettlementResponse,
} from "@/api/generated/schemas";
import { subtractExactDecimals } from "./finance-decimal";

export const equalDecimal = (left: string, right: string) =>
  /^0(?:\.0+)?$/.test(subtractExactDecimals(left, right));
const positive = (value: string) =>
  /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value);

// Validate retained composition without deriving or redistributing Allocations.
export function validCombinedComposition(
  item: Pick<
    CombinedSettlementResponse,
    "amount" | "forgivenessAmount" | "allocations"
  >,
  selectedIds: string[],
  date: string,
) {
  const currency = item.amount.currency;
  if (
    !positive(item.amount.amount) ||
    !positive(item.forgivenessAmount.amount) ||
    item.forgivenessAmount.currency !== currency ||
    !selectedIds.length ||
    new Set(selectedIds).size !== selectedIds.length
  )
    return false;
  let cash = "0";
  let forgiven = "0";
  let forgivenessStarted = false;
  const seen = new Set<string>();
  const remaining = new Map<
    string,
    { amount: string; advanceId: string; sourceDate: string }
  >();
  for (const [index, row] of item.allocations.entries()) {
    const isForgiveness = "forgiven" in row;
    const value = isForgiveness ? row.forgiven : row.cashPaid;
    const stageKey = `${isForgiveness ? "forgiveness" : "cash"}:${row.obligationId}`;
    const earlier = remaining.get(row.obligationId);
    if (
      row.position !== index + 1 ||
      !selectedIds.includes(row.obligationId) ||
      row.sourceDate > date ||
      seen.has(stageKey) ||
      (!isForgiveness && forgivenessStarted) ||
      value.currency !== currency ||
      !positive(value.amount) ||
      row.remainingAfter.currency !== currency ||
      !/^\d+(?:\.\d+)?$/.test(row.remainingAfter.amount) ||
      (earlier &&
        (earlier.advanceId !== row.advanceId ||
          earlier.sourceDate !== row.sourceDate ||
          !equalDecimal(
            subtractExactDecimals(earlier.amount, value.amount),
            row.remainingAfter.amount,
          )))
    )
      return false;
    seen.add(stageKey);
    remaining.set(row.obligationId, {
      amount: row.remainingAfter.amount,
      advanceId: row.advanceId,
      sourceDate: row.sourceDate,
    });
    if (isForgiveness) {
      forgivenessStarted = true;
      forgiven = subtractExactDecimals(forgiven, `-${value.amount}`);
    } else cash = subtractExactDecimals(cash, `-${value.amount}`);
  }
  return (
    equalDecimal(cash, item.amount.amount) &&
    equalDecimal(forgiven, item.forgivenessAmount.amount)
  );
}

export function validCombinedPreview(
  item: CombinedSettlementPreview,
  draft: {
    amount: CombinedSettlementPreview["amount"];
    forgivenessAmount: CombinedSettlementPreview["forgivenessAmount"];
    selectedObligationIds: string[];
    transactionDate: string;
  },
  receivingNature: "asset" | "liability",
) {
  const currency = draft.amount.currency;
  return (
    positive(item.amount.amount) &&
    positive(item.forgivenessAmount.amount) &&
    item.amount.currency === currency &&
    equalDecimal(item.amount.amount, draft.amount.amount) &&
    item.forgivenessAmount.currency === currency &&
    equalDecimal(
      item.forgivenessAmount.amount,
      draft.forgivenessAmount.amount,
    ) &&
    item.expense.currency === currency &&
    /^\d+(?:\.\d+)?$/.test(item.expense.amount) &&
    equalDecimal(item.expense.amount, draft.forgivenessAmount.amount) &&
    [item.outstandingBefore, item.outstandingAfter].every(
      (value) =>
        value.currency === currency && /^\d+(?:\.\d+)?$/.test(value.amount),
    ) &&
    [item.receivingBalance, item.receivingBalanceAfter].every(
      (value) =>
        value.currency === currency && /^-?\d+(?:\.\d+)?$/.test(value.amount),
    ) &&
    equalDecimal(
      subtractExactDecimals(
        subtractExactDecimals(
          item.outstandingBefore.amount,
          item.amount.amount,
        ),
        item.forgivenessAmount.amount,
      ),
      item.outstandingAfter.amount,
    ) &&
    equalDecimal(
      subtractExactDecimals(
        item.receivingBalanceAfter.amount,
        item.receivingBalance.amount,
      ),
      receivingNature === "asset"
        ? item.amount.amount
        : `-${item.amount.amount}`,
    ) &&
    validCombinedComposition(
      item,
      draft.selectedObligationIds,
      draft.transactionDate,
    )
  );
}
