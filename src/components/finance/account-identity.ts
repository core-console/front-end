import type { AccountResponse } from "@/api/generated/schemas";
import { locale, messages } from "@/lib/i18n";

export function buildAccountWorkflowLabels(
  accounts: ReadonlyArray<AccountResponse>,
  language?: typeof locale,
) {
  const nameCounts = new Map<string, number>();
  const namePositions = new Map<string, number>();
  const labels = new Map<string, string>();

  for (const account of accounts) {
    nameCounts.set(account.name, (nameCounts.get(account.name) ?? 0) + 1);
  }
  for (const account of accounts) {
    const count = nameCounts.get(account.name)!;
    if (count === 1) {
      labels.set(account.id, account.name);
      continue;
    }
    const position = (namePositions.get(account.name) ?? 0) + 1;
    namePositions.set(account.name, position);
    labels.set(
      account.id,
      language === locale
        ? messages.finance.quickEntry.accountIdentity(
            account.name,
            account.status,
            account.nature,
            account.currency,
            position,
            count,
          )
        : `${account.name}, ${account.status} ${account.nature} in ${account.currency}, ${position} of ${count}`,
    );
  }

  return labels;
}
