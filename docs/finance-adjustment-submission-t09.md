# Balance Adjustment browser recovery (T09)

The backend [create-submission protocol](../../back-end/docs/finance-create-submission-protocol.md)
owns the contract. The [T08 implementation note](../../back-end/docs/finance-adjustment-submission-t08.md)
and backend-generated OpenAPI own Adjustment wire semantics. Synchronize through
`pnpm api:update`; never hand-edit the snapshot or generated artifacts.

## Shared command and evidence boundary

Both Overview and Transactions use `BalanceAdjustmentFormDialog` and
`useFinanceCreate`, completing the five-operation shared journal union.
Ledger onboarding/additional creates, Account/Category creates, Quick Entry,
ordinary Transaction forms and Internal Transfer retain their existing adapters.
Replacement, deletion and archive workflows retain their existing contracts.

The additive Adjustment command uses `workflow: balanceAdjustment`, the known
generated endpoint, IndexedDB version 1 and `localSchemaVersion: 1`. Preparation
copies the exact submitted Account, Ledger, date, normalized note, target Money,
expected derived Money and expected Account Nature before POST. Signed values,
zero, negative zero and large decimal strings remain strings. Generated body
validation intentionally permits immutable-invalid Money for exact Q29 recovery;
the form retains signed decimal, currency precision, durable range and Unicode
note checks. No canonicalization, rounding or expectation refresh occurs on retry.

The existing evidence union accepts Adjustment `created`, `noChange` and typed
rejection. Success has HTTP 200. `created` requires a Transaction identity;
`noChange` has no resource. Generic errors and bare mutable-state failures never
trigger context correction or retire recovery. Q29 additionally matches owner
and exact attempted JSON, including strings, types and omitted fields.

## Workflow and current-resource handling

Resolution writes finish before resource reads or success UI. `noChange` is
locked terminal success and closes only its original unedited mounted workflow.
Lookup completion does not close/reset a newer form. Acknowledgement removes only
resolved evidence; late callbacks cannot upsert a removed record.

Only a correlated terminal rejection from the original current form invokes its
existing stale-context or Account-reference recovery. A reviewed correction is a
new submission UUID; the rejected command remains unchanged. Ambiguous forms
block ordinary submission, preserve transient edits and offer explicit intent
to create another adjustment independently of the retained original command.

`transaction-submission-refresh` extends the existing current-resource seam.
Created Adjustment evidence reads the current Transaction, checks identity,
Ledger and kind, and uses existing history reconciliation. It never reconstructs
a Transaction or correction from the submitted target. The Adjustment replacement
session now exposes its existing pending state and a revision; reads spanning
replacement cannot project an earlier result. Existing deletion markers prevent
reinsertion after removal. Namespace guards prevent old callbacks from updating
another user's resources or form.
The namespace check also compares the validated current-user Query value before
React's layout effects run, preventing terminal `noChange` from completing an
old form when the refresh discovers an owner switch.

Created outcomes refresh the original Ledger's history, Accounts, Overview root
and affected adjustment contexts. `noChange` refreshes Accounts and adjustment
context without reading a Transaction, inserting history or suppressing unchanged
activity counts. Resource absence/failure preserves terminal success and exposes
resource refresh independently from create retry.

## Qualification seams

`adjustment-submissions.test.tsx` covers form entry points, immutable retry,
strict receipts/Q29, bare stale failures, terminal correction, lookup states,
storage preparation/resolution failures, owner switches and replacement/deletion races.
`finance-api.test.ts` covers the cumulative operation/resource/noChange matrix.
Existing route fixtures now distinguish POST evidence from current-resource reads;
their lifecycle/count/focus assertions remain applicable.

`adjustment-submissions.spec.ts` uses Chromium's real IndexedDB for exact command
retention, keyboard retry, navigation/reload, persistent-profile restart, terminal
lookup, preparation abort and late workflow completion. Transport responses are
controlled fixtures, not proof of a PostgreSQL commit. The cumulative recovery
suites and existing smoke suite remain the browser regression boundary.

All five frontend create adapters are covered by this slice. Broader browser and
storage stress (T10), real committed-response-loss/effect proof (T11), and the
common activation gate remain separate. Older unsupported builds fail closed on
retained operation records; do not auto-clear, migrate expectations, or reopen
unkeyed creates. This note does not authorize production activation.
