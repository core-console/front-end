import type { TransactionHistoryPageResponseOutput } from "@/api/generated/schemas";
import { formatFinanceMoney } from "@/components/finance/finance-money";

type Transaction = TransactionHistoryPageResponseOutput["items"][number];
type Reference = { id: string; name: string; status: string };

function referenceLabels(
  references: readonly Reference[],
  resource: "Account" | "Category",
) {
  const nameWithStatus = (reference: Reference) =>
    `${reference.name.trim() || resource}${reference.status === "archived" ? " (archived)" : ""}`;
  const identitiesByName = new Map<string, Set<string>>();
  for (const reference of references) {
    for (const name of [reference.name.trim(), nameWithStatus(reference)]) {
      const key = name.toLowerCase();
      const identities = identitiesByName.get(key) ?? new Set<string>();
      identities.add(reference.id);
      identitiesByName.set(key, identities);
    }
  }
  return (reference: Reference) => {
    const name = reference.name.trim();
    const ambiguous =
      !name ||
      (resource === "Category" && name.toLowerCase() === "uncategorized") ||
      (identitiesByName.get(name.toLowerCase())?.size ?? 0) > 1 ||
      (identitiesByName.get(nameWithStatus(reference).toLowerCase())?.size ??
        0) > 1;
    return `${nameWithStatus(reference)}${ambiguous ? ` (${resource} ID ${reference.id})` : ""}`;
  };
}

function financialContext(transaction: Transaction) {
  const context = [transaction.transactionDate, transaction.kind];
  if (transaction.kind === "internalTransfer") {
    context.push(
      transaction.sourceAccount.id,
      transaction.destinationAccount.id,
      formatFinanceMoney(transaction.sourceAmount),
      formatFinanceMoney(transaction.destinationAmount),
    );
  } else if (transaction.kind === "balanceAdjustment") {
    context.push(
      transaction.account.id,
      formatFinanceMoney(transaction.correctionDelta),
    );
  } else {
    context.push(
      transaction.account.id,
      formatFinanceMoney(transaction.economicAmount),
      ...transaction.categoryAllocations.map((allocation) =>
        JSON.stringify([
          allocation.category?.id ?? null,
          formatFinanceMoney(allocation.amount),
        ]),
      ),
    );
  }
  // Notes may be clipped in history, so they cannot safely distinguish similar records.
  return JSON.stringify(context);
}

export function buildTransactionListIdentity(
  transactions: readonly Transaction[],
  accounts: readonly Reference[] = [],
  categories: readonly Reference[] = [],
) {
  const accountReferences = [...accounts];
  const categoryReferences = [...categories];
  const contexts = new Map<string, string[]>();
  for (const transaction of transactions) {
    if (transaction.kind === "internalTransfer") {
      accountReferences.push(
        transaction.sourceAccount,
        transaction.destinationAccount,
      );
    } else {
      accountReferences.push(transaction.account);
      if (transaction.kind === "income" || transaction.kind === "expense") {
        for (const allocation of transaction.categoryAllocations) {
          if (allocation.category) categoryReferences.push(allocation.category);
        }
      }
    }
    const context = financialContext(transaction);
    const ids = contexts.get(context) ?? [];
    ids.push(transaction.id);
    contexts.set(context, ids);
  }
  return {
    account: referenceLabels(accountReferences, "Account"),
    category: referenceLabels(categoryReferences, "Category"),
    ambiguousTransactions: new Set(
      [...contexts.values()].filter((ids) => ids.length > 1).flat(),
    ),
  };
}

export type TransactionListIdentity = ReturnType<
  typeof buildTransactionListIdentity
>;
