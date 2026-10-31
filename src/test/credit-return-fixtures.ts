import {
  CreditReturnPreview,
  CreditReturnResponse,
  SettlementCreatedReceipt,
} from "../api/generated/schemas/index.ts";
import { creditPreview } from "./credit-application-fixtures.ts";
import {
  advanceLedger as ledger,
  advanceParticipant as person,
  advanceFunding as account,
} from "./advance-fixtures.ts";
import { money, settlement } from "./settlement-fixtures.ts";

export const returnPreview = CreditReturnPreview.parse({
  kind: "creditReturn",
  amount: money("25"),
  payingBalance: money("100"),
  payingBalanceAfter: money("75"),
  availableCreditBefore: money("50"),
  availableCreditAfter: money("25"),
  origins: creditPreview.origins,
  previewToken: "e".repeat(64),
});
export const creditReturn = CreditReturnResponse.parse({
  kind: "creditReturn",
  id: settlement.id,
  ledgerId: ledger.id,
  participantId: person.id,
  payingAccountId: account.id,
  transactionDate: "2026-10-29",
  amount: money("25"),
  note: null,
  confirmedAt: "2026-10-29T00:00:00Z",
  confirmationOrder: 3,
  origins: returnPreview.origins,
  transactionIds: settlement.transactionIds,
});
export const returnBody = {
  kind: "creditReturn" as const,
  participantId: person.id,
  payingAccountId: account.id,
  transactionDate: creditReturn.transactionDate,
  amount: money("25"),
  note: null,
  previewToken: returnPreview.previewToken,
};
export function returnReceipt(submissionId: string) {
  return SettlementCreatedReceipt.parse({
    submissionId,
    operation: "createFinanceSettlement",
    commandVersion: "8",
    targetLedgerId: ledger.id,
    admittedAt: creditReturn.confirmedAt,
    resolvedAt: "2026-10-29T00:00:01Z",
    outcome: {
      kind: "created",
      resource: { type: "settlement", id: creditReturn.id },
    },
  });
}
