import type {
  CreditApplicationPreview,
  CreditApplicationResponse,
} from "@/api/generated/schemas";
import { subtractExactDecimals } from "./finance-decimal";
const nonnegative = (value: string) => /^\d+(?:\.\d+)?$/.test(value);
const positive = (value: string) => nonnegative(value) && /[1-9]/.test(value);
const equal = (left: string, right: string) =>
  /^0(?:\.0+)?$/.test(subtractExactDecimals(left, right));
const add = (left: string, right: string) =>
  subtractExactDecimals(left, `-${right}`);

// Check correspondence without sorting, deriving or redistributing server allocations.
export function validCreditApplicationComposition(
  item: Pick<CreditApplicationResponse, "amount" | "allocations" | "origins">,
  selectedIds: string[],
  date: string,
) {
  const currency = item.amount.currency;
  if (
    !positive(item.amount.amount) ||
    !selectedIds.length ||
    new Set(selectedIds).size !== selectedIds.length ||
    !item.origins.length ||
    !item.allocations.length
  )
    return false;
  const originIds = new Set<string>();
  let consumed = "0";
  let lastOrder = -1;
  for (const [originIndex, origin] of item.origins.entries()) {
    if (
      (originIndex < item.origins.length - 1 &&
        !equal(origin.availableAfter.amount, "0")) ||
      originIds.has(origin.originSettlementId) ||
      origin.originConfirmationOrder < lastOrder ||
      !positive(origin.amount.amount) ||
      ![origin.amount, origin.availableBefore, origin.availableAfter].every(
        (money) => money.currency === currency && nonnegative(money.amount),
      ) ||
      !equal(
        subtractExactDecimals(
          origin.availableBefore.amount,
          origin.amount.amount,
        ),
        origin.availableAfter.amount,
      )
    )
      return false;
    originIds.add(origin.originSettlementId);
    lastOrder = origin.originConfirmationOrder;
    consumed = add(consumed, origin.amount.amount);
  }
  let applied = "0";
  const used = new Map<string, string>();
  const remaining = new Map<
    string,
    { amount: string; advanceId: string; sourceDate: string }
  >();
  for (const [index, row] of item.allocations.entries()) {
    const earlier = remaining.get(row.obligationId);
    if (
      row.position !== index + 1 ||
      !selectedIds.includes(row.obligationId) ||
      row.sourceDate > date ||
      !originIds.has(row.originSettlementId) ||
      !positive(row.creditApplied.amount) ||
      ![row.creditApplied, row.remainingAfter].every(
        (money) => money.currency === currency && nonnegative(money.amount),
      ) ||
      (earlier &&
        (earlier.advanceId !== row.advanceId ||
          earlier.sourceDate !== row.sourceDate ||
          !equal(
            subtractExactDecimals(earlier.amount, row.creditApplied.amount),
            row.remainingAfter.amount,
          )))
    )
      return false;
    remaining.set(row.obligationId, {
      amount: row.remainingAfter.amount,
      advanceId: row.advanceId,
      sourceDate: row.sourceDate,
    });
    used.set(
      row.originSettlementId,
      add(used.get(row.originSettlementId) ?? "0", row.creditApplied.amount),
    );
    applied = add(applied, row.creditApplied.amount);
  }
  return (
    equal(consumed, item.amount.amount) &&
    equal(applied, item.amount.amount) &&
    item.origins.every((origin) =>
      equal(used.get(origin.originSettlementId) ?? "0", origin.amount.amount),
    )
  );
}
export function validCreditApplicationPreview(
  item: CreditApplicationPreview,
  draft: {
    amount: CreditApplicationPreview["amount"];
    selectedObligationIds: string[];
    transactionDate: string;
  },
) {
  return (
    item.amount.currency === draft.amount.currency &&
    equal(item.amount.amount, draft.amount.amount) &&
    [
      item.outstandingBefore,
      item.outstandingAfter,
      item.availableCreditBefore,
      item.availableCreditAfter,
    ].every(
      (money) =>
        money.currency === draft.amount.currency && nonnegative(money.amount),
    ) &&
    equal(
      subtractExactDecimals(item.outstandingBefore.amount, item.amount.amount),
      item.outstandingAfter.amount,
    ) &&
    equal(
      subtractExactDecimals(
        item.availableCreditBefore.amount,
        item.amount.amount,
      ),
      item.availableCreditAfter.amount,
    ) &&
    validCreditApplicationComposition(
      item,
      draft.selectedObligationIds,
      draft.transactionDate,
    )
  );
}
