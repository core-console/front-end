import type { QueryClient } from "@tanstack/react-query";

import {
  getListFinanceAccountsQueryKey,
  type listFinanceAccounts,
} from "@/api/generated/core-console";
import { AccountResponse } from "@/api/generated/schemas";
import { compareLedgerNamesByBackendOrder } from "@/components/finance/ledger-name-order";

type AccountListQueryData = Awaited<ReturnType<typeof listFinanceAccounts>>;

function compareAccountsByBackendOrder(
  left: AccountResponse,
  right: AccountResponse,
) {
  const lifecycleOrder =
    Number(left.status === "archived") - Number(right.status === "archived");
  return lifecycleOrder !== 0
    ? lifecycleOrder
    : compareLedgerNamesByBackendOrder(left, right);
}

export function reconcileAccountList(
  queryClient: QueryClient,
  ledgerId: string,
  confirmedAccount: AccountResponse,
) {
  queryClient.setQueryData<AccountListQueryData>(
    getListFinanceAccountsQueryKey(ledgerId),
    (current) => {
      if (!current) return current;
      const accounts = AccountResponse.array().parse(current.data);
      const reconciled = accounts.filter(
        (account) => account.id !== confirmedAccount.id,
      );
      reconciled.push(confirmedAccount);
      reconciled.sort(compareAccountsByBackendOrder);
      return { ...current, data: reconciled };
    },
  );
}

export function removeAccountFromList(
  queryClient: QueryClient,
  ledgerId: string,
  accountId: string,
) {
  queryClient.setQueryData<AccountListQueryData>(
    getListFinanceAccountsQueryKey(ledgerId),
    (current) => {
      if (!current) return current;
      const accounts = AccountResponse.array().parse(current.data);
      return {
        ...current,
        data: accounts.filter((account) => account.id !== accountId),
      };
    },
  );
}
