import type {
  CorrectionCreditReturn,
  MoneyResponse,
} from "@/api/generated/schemas";
import { subtractExactDecimals } from "./finance-decimal";

export function validCorrectionReturns(
  returns: CorrectionCreditReturn[],
  origin: { confirmationOrder: number; transactionDate: string },
  currency: MoneyResponse["currency"],
) {
  return (
    new Set(returns.map((item) => item.transactionId)).size ===
      returns.length &&
    returns.every(
      (item) =>
        item.confirmationOrder > origin.confirmationOrder &&
        item.transactionDate >= origin.transactionDate &&
        item.position > 0 &&
        [item.originAmount, item.returnAmount].every(
          (m) =>
            m.currency === currency &&
            /^\d+(?:\.\d+)?$/.test(m.amount) &&
            /[1-9]/.test(m.amount),
        ) &&
        !subtractExactDecimals(
          item.returnAmount.amount,
          item.originAmount.amount,
        ).startsWith("-"),
    )
  );
}
