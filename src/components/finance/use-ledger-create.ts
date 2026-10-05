import type { LedgerResponse } from "@/api/generated/schemas";
import { useFinanceCreate } from "./use-finance-create";

export function useLedgerCreate(
  workflow: "onboarding" | "additional",
  onCreated: (ledger: LedgerResponse) => void,
) {
  const creation = useFinanceCreate((result) => {
    if (result.ledger) onCreated(result.ledger);
  }, workflow);
  return {
    ...creation,
    submit: (name: string) =>
      creation.submit({
        operation: "createFinanceLedger",
        targetLedgerId: null,
        body: { name },
        workflow,
      }),
  };
}
