import type { QueryClient } from "@tanstack/react-query";

import {
  getListFinanceLedgersQueryKey,
  type listFinanceLedgers,
} from "@/api/generated/core-console";
import { LedgerResponse } from "@/api/generated/schemas";
import { compareLedgerNamesByBackendOrder } from "@/components/finance/ledger-name-order";

type LedgerListQueryData = Awaited<ReturnType<typeof listFinanceLedgers>>;

export function reconcileLedgerList(
  queryClient: QueryClient,
  confirmedLedger: LedgerResponse,
) {
  queryClient.setQueryData<LedgerListQueryData>(
    getListFinanceLedgersQueryKey(),
    (current) => {
      if (!current) return current;
      const ledgers = LedgerResponse.array().parse(current.data);
      const existingIndex = ledgers.findIndex(
        (ledger) => ledger.id === confirmedLedger.id,
      );
      const reconciled = [...ledgers];
      if (existingIndex === -1) {
        reconciled.push(confirmedLedger);
      } else {
        reconciled[existingIndex] = confirmedLedger;
      }
      reconciled.sort(compareLedgerNamesByBackendOrder);
      return { ...current, data: reconciled };
    },
  );
}

export function removeLedgerFromList(
  queryClient: QueryClient,
  ledgerId: string,
) {
  queryClient.setQueryData<LedgerListQueryData>(
    getListFinanceLedgersQueryKey(),
    (current) => {
      if (!current) return current;
      const ledgers = LedgerResponse.array().parse(current.data);
      return {
        ...current,
        data: ledgers.filter((ledger) => ledger.id !== ledgerId),
      };
    },
  );
}
