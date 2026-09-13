import type { MoneyResponse } from "@/api/generated/schemas";

const decimalPattern = /^(-?)(\d+)(?:\.(\d+))?$/;

function groupIntegerDigits(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatFinanceMoney(money: MoneyResponse) {
  const match = decimalPattern.exec(money.amount);

  if (!match) {
    return `${money.amount} ${money.currency}`;
  }

  const [, sign, integer, fraction = ""] = match;
  const formattedFraction = fraction ? `.${fraction}` : "";

  return `${sign}${groupIntegerDigits(integer!)}${formattedFraction} ${money.currency}`;
}
