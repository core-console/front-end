import type { QueryClient } from "@tanstack/react-query";

import {
  getListFinanceCategoriesQueryKey,
  type listFinanceCategories,
} from "@/api/generated/core-console";
import { CategoryResponse } from "@/api/generated/schemas";
import { compareLedgerNamesByBackendOrder } from "@/components/finance/ledger-name-order";

type CategoryListQueryData = Awaited<ReturnType<typeof listFinanceCategories>>;

function compareCategoriesByBackendOrder(
  left: CategoryResponse,
  right: CategoryResponse,
) {
  const lifecycleOrder =
    Number(left.status === "archived") - Number(right.status === "archived");
  return lifecycleOrder !== 0
    ? lifecycleOrder
    : compareLedgerNamesByBackendOrder(left, right);
}

export function reconcileCategoryList(
  queryClient: QueryClient,
  ledgerId: string,
  confirmedCategory: CategoryResponse,
) {
  queryClient.setQueryData<CategoryListQueryData>(
    getListFinanceCategoriesQueryKey(ledgerId),
    (current) => {
      if (!current) return current;
      const categories = CategoryResponse.array().parse(current.data);
      const reconciled = categories.filter(
        (category) => category.id !== confirmedCategory.id,
      );
      reconciled.push(confirmedCategory);
      reconciled.sort(compareCategoriesByBackendOrder);
      return { ...current, data: reconciled };
    },
  );
}

export function removeCategoryFromList(
  queryClient: QueryClient,
  ledgerId: string,
  categoryId: string,
) {
  queryClient.setQueryData<CategoryListQueryData>(
    getListFinanceCategoriesQueryKey(ledgerId),
    (current) => {
      if (!current) return current;
      const categories = CategoryResponse.array().parse(current.data);
      return {
        ...current,
        data: categories.filter((category) => category.id !== categoryId),
      };
    },
  );
}
