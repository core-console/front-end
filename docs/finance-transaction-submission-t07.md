# T07 ordinary Transaction browser submissions

The [backend protocol](../../back-end/docs/finance-create-submission-protocol.md)
is the sole normative authority. This note records the frontend seams for
[frontend #42](https://github.com/core-console/front-end/issues/42), alongside
the [interaction specification](finance-v1-frontend-interaction-spec.md).
The pinned cumulative producer is recorded in the
[integration status](../README.md#finance-v1-integration-status). Synchronize it
through `pnpm api:update`; never edit generated artifacts or the snapshot by hand.

## Commands and evidence

Quick Entry Income/Expense, the full Income/Expense dialogs in Transactions,
and Internal Transfer dialogs in Overview/Transactions all use
`use-finance-create`. They prepare `createFinanceTransaction` commands in the
existing `submission-journal` before dispatch through the generated client.
The original Ledger, command version, owner, UUID and body remain the retry
identity. Endpoint, workflow and Transaction kind are validated together.

The additive journal union retains IndexedDB version 1, `localSchemaVersion: 1`,
the existing namespace and conditional resolution/acknowledgement machinery.
Exact Money strings, allocation order and field presence, Category UUID,
source/destination roles, civil dates and notes survive preparation and retry.
The journal does not canonicalize commands. Generated immutable command schemas
and the backend remain the validation authority; ordinary form validation retains
its existing positive-Money, precision and code-point limits.

`submission-evidence` extends the closed receipt and Q29 unions in place.
Created evidence must identify a Transaction; `noChange` is unavailable in this
slice. Mutable terminal rejection uses the archived, missing or invalid
Transaction receipt branch. Q29 additionally requires the original owner and
exact JSON attempted body. Generic HTTP errors, absent/unfinished lookup and
wrong evidence remain unresolved. Known identity conflicts block local recovery
and the separate-create action. Only explicit retry dispatches the retained body.

## Drafts, focus and pending workflows

Post-dispatch changes remain transient. Date/kind retargeting of Quick Entry
invalidates delayed completion without abandoning its stored command. The
original mounted, unedited workflow alone may close/reset/announce/focus on
success. Quick Entry keeps Account, Category, kind and date, clears Amount/note,
and permits the next deliberate entry with a fresh UUID. Navigation, closure,
reopening and namespace switches close the earlier callback lifetime.

Unresolved attempts block ordinary resubmission. The separate-create action is
explicit intent; it never modifies the retained command. Modal workflows retain
their existing Cancel/focus behavior; after an ambiguous attempt the user may
close the dialog to use the shared Finance recovery surface. Ordinary replacement,
delete and Balance Adjustment commands retain their contracts.

The shared hook registers ordinary Transaction creates under the existing
TanStack mutation key with their target Ledger. Pending locks cover durable
preparation, dispatch, resolution and the resource read. Full dialogs complete
their original UI before awaiting ordinary resource refresh, keeping the existing
Ledger pending/focus-restoration boundary. Quick Entry preserves its existing
ability to continue while Overview activity refresh completes independently.

## Current resources and later adapters

Durable resolution precedes resource reads. `transaction-submission-refresh`
reads the current Transaction with the generated client and validates identity,
Ledger and kind before using the existing history reconciliation seam. The
historical receipt never becomes a Query resource snapshot or invents a history.
Refresh targets the original Ledger's Accounts, history, Overview root (including
selected-day/count authority) and affected Balance Adjustment contexts.

The ordinary replacement lock moved into a small shared module, preserving its
preflight-through-reconciliation lifetime. A resource read spanning a replacement
revision cannot project its earlier result; deletion markers suppress reinsertion.
Resource absence or read/refresh failure leaves creation confirmed and offers
resource refresh separately. Background refresh failure cannot reopen creation,
clear a newer draft, or focus an abandoned form.

Balance Adjustment recovery must extend the same closed unions and generated
transport boundary. Its `noChange`, expected-balance/nature and replacement
semantics still need their own adapter and acceptance proof. Do not infer an
Adjustment from an ordinary Transaction receipt, recalculate a retained target,
or reuse ordinary creation projection for Adjustment replacement.

## Qualification seams

`transaction-submissions.test.tsx` exercises the forms through HTTP and the
journal, strict evidence/Q29, storage failures, transient edits, intentional
repeated entries, namespace/navigation changes and resource/replacement/deletion
races. Existing Finance route suites retain validation, focus, count and cache
regressions using distinct POST evidence and current-resource fixtures.

`transaction-submissions.spec.ts` exercises actual Chromium IndexedDB, keyboard
and axe behavior, reload, persistent-profile restart, preparation abort and
concurrent-tab acknowledgement including a delayed replay. These controlled
transport cases also release an original create response after navigation and
verify that it cannot reset or focus a newer workflow. The controlled
transport fixtures establish browser behavior; they do not establish a real
Transaction PostgreSQL commit or qualify additional browsers. Real committed
response loss, stale-build compatibility across cumulative operation unions and
broader durability stress remain later qualification gates. The earlier builds
fail closed on unsupported retained operation records; no schema migration or
automatic data clearing is introduced here. All-five production activation
remains outside this slice.
