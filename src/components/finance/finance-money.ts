import type { MoneyResponse } from "@/api/generated/schemas";

const decimalPattern = /^(-?)(\d+)(?:\.(\d+))?$/;

function groupIntegerDigits(value: string) {
  // Producer-valid Money can contain 131,072 digits; avoid quadratic lookahead.
  const groups = [value.slice(0, value.length % 3 || 3)];
  for (let index = groups[0]!.length; index < value.length; index += 3)
    groups.push(value.slice(index, index + 3));
  return groups.join(",");
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
