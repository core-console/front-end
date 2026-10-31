import type {
  AccountResponse,
  CreditReturnPreview,
  CreditReturnResponse,
} from "@/api/generated/schemas";
import { subtractExactDecimals } from "./finance-decimal";

const nonnegative = (value: string) => /^\d+(?:\.\d+)?$/.test(value);
const signed = (value: string) => /^-?\d+(?:\.\d+)?$/.test(value);
const positive = (value: string) => nonnegative(value) && /[1-9]/.test(value);
const equal = (left: string, right: string) =>
  /^0(?:\.0+)?$/.test(subtractExactDecimals(left, right));

// Validate returned composition without sorting origins or calculating displayed effects.
export function validCreditReturnComposition(
  item: Pick<CreditReturnResponse, "amount" | "origins">,
) {
  if (!positive(item.amount.amount) || !item.origins.length) return false;
  let consumed = "0";
  const ids = new Set<string>();
  let previous: CreditReturnResponse["origins"][number] | undefined;
  for (const [index, origin] of item.origins.entries()) {
    if (
      ids.has(origin.originSettlementId) ||
      (previous &&
        (origin.originConfirmationOrder < previous.originConfirmationOrder ||
          (origin.originConfirmationOrder ===
            previous.originConfirmationOrder &&
            origin.originSettlementId <= previous.originSettlementId))) ||
      !positive(origin.amount.amount) ||
      ![origin.amount, origin.availableBefore, origin.availableAfter].every(
        (money) =>
          money.currency === item.amount.currency && nonnegative(money.amount),
      ) ||
      !equal(
        subtractExactDecimals(
          origin.availableBefore.amount,
          origin.amount.amount,
        ),
        origin.availableAfter.amount,
      ) ||
      (index < item.origins.length - 1 &&
        !equal(origin.availableAfter.amount, "0"))
    )
      return false;
    ids.add(origin.originSettlementId);
    consumed = subtractExactDecimals(consumed, `-${origin.amount.amount}`);
    previous = origin;
  }
  return equal(consumed, item.amount.amount);
}

export function validCreditReturnPreview(
  item: CreditReturnPreview,
  amount: CreditReturnPreview["amount"],
  account: AccountResponse,
) {
  return (
    validCreditReturnComposition(item) &&
    item.amount.currency === amount.currency &&
    positive(amount.amount) &&
    equal(item.amount.amount, amount.amount) &&
    [item.availableCreditBefore, item.availableCreditAfter].every(
      (money) =>
        money.currency === amount.currency && nonnegative(money.amount),
    ) &&
    [item.payingBalance, item.payingBalanceAfter].every(
      (money) => money.currency === amount.currency && signed(money.amount),
    ) &&
    equal(
      subtractExactDecimals(
        item.availableCreditBefore.amount,
        item.amount.amount,
      ),
      item.availableCreditAfter.amount,
    ) &&
    equal(
      subtractExactDecimals(
        item.payingBalance.amount,
        account.nature === "asset"
          ? item.amount.amount
          : `-${item.amount.amount}`,
      ),
      item.payingBalanceAfter.amount,
    ) &&
    /^[0-9a-f]{64}$/.test(item.previewToken)
  );
}
