import {
  AdvanceCorrectionPreview,
  AdvanceCorrectionResponse,
  AdvanceCorrectionCreatedReceipt,
} from "../api/generated/schemas/index.ts";
import {
  confirmedAdvance as before,
  advanceFunding as funding,
  advanceParticipant as person,
  advanceLedger as ledger,
} from "./advance-fixtures.ts";
export const correctionMoney = (amount: string) => ({
  amount,
  currency: "CNY" as const,
});
const effect = (owner: boolean, amount: string, id: string) => ({
  transactionId: id,
  kind: owner ? "expense" : "internalTransfer",
  transactionDate: owner ? "2026-10-20" : before.transactionDate,
  note: owner ? null : before.note,
  ownerExpense: correctionMoney(owner ? amount : "0.00"),
  movements: [
    {
      accountId: funding.id,
      amount: correctionMoney(`-${amount}`),
      role: owner ? "primary" : "source",
    },
    ...(!owner
      ? [
          {
            accountId: before.obligation.receivableAccountId,
            amount: correctionMoney(amount),
            role: "destination",
          },
        ]
      : []),
  ],
});
const transfer = effect(false, "25.01", before.transactionId);
const ownerEffect = effect(true, "25.01", before.transactionId);
export const correctionPreview = AdvanceCorrectionPreview.parse({
  advanceId: before.id,
  reason: "Incorrect participant attribution",
  fundingChanged: false,
  previewToken: "f".repeat(64),
  before,
  after: {
    id: before.id,
    ledgerId: ledger.id,
    confirmedAt: before.confirmedAt,
    fundingAccountId: funding.id,
    amount: before.amount,
    ownerShare: before.amount,
    transactionDate: "2026-10-20",
    note: null,
    transactionIds: [before.transactionId],
    obligations: [
      {
        ...before.obligation,
        principal: correctionMoney("0.00"),
        remaining: correctionMoney("0.00"),
        sourceDate: "2026-10-20",
      },
    ],
  },
  financialEffectsBefore: [transfer],
  financialEffectsAfter: [ownerEffect],
  accountEffects: [
    {
      accountId: funding.id,
      nature: "asset",
      balanceBefore: correctionMoney("74.99"),
      balanceAfter: correctionMoney("74.99"),
    },
    {
      accountId: before.obligation.receivableAccountId,
      nature: "asset",
      balanceBefore: correctionMoney("25.01"),
      balanceAfter: correctionMoney("0.00"),
    },
  ],
});
export const correction = AdvanceCorrectionResponse.parse({
  ...correctionPreview,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ledgerId: ledger.id,
  actorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  confirmedAt: "2026-11-01T00:00:00Z",
  revision: 1,
});
export const correctionDraft = {
  advanceId: before.id,
  fundingAccountId: funding.id,
  amount: before.amount,
  ownerShare: before.amount,
  participantShares: [],
  transactionDate: "2026-10-20",
  note: null,
  reason: correction.reason,
};
export function correctionReceipt(submissionId: string) {
  return AdvanceCorrectionCreatedReceipt.parse({
    submissionId,
    operation: "createFinanceAdvanceCorrection",
    commandVersion: "1",
    targetLedgerId: ledger.id,
    admittedAt: correction.confirmedAt,
    resolvedAt: correction.confirmedAt,
    outcome: {
      kind: "created",
      resource: { type: "advanceCorrection", id: correction.id },
    },
  });
}
export { ledger, person, funding, before };
