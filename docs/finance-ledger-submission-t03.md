# T03 Ledger browser submission integration

The [backend protocol](../../back-end/docs/finance-create-submission-protocol.md)
is the sole normative authority. This note describes frontend implementation
and verification seams for [frontend #40](https://github.com/core-console/front-end/issues/40).
The implementation currently integrates Ledger creates only. Follow the
[README contract synchronization and generation workflow](../README.md#validation)
for backend contract changes.

## Browser ownership

`submission-journal.ts` owns the Finance IndexedDB database. T03 introduced
database version 1 and record `localSchemaVersion: 1`; these storage versions
are separate from the immutable backend `commandVersion`. Future migrations
must preserve retained commands and evidence without upgrading submitted
command versions.

Compound keys contain the normalized browser-facing API URL, Local User UUID,
and submission UUID. Relative API URLs resolve against the browser origin, not
the development proxy upstream. Stored commands are validated against known
operation, endpoint, scope, and body schemas before use.

Preparation copies the command, inserts with `add`, and awaits successful
transaction completion before dispatching from the persisted command. An
IndexedDB request's success event is insufficient. Preparation failure sends
nothing; failure to store a later resolution leaves the submission unresolved
for recovery. Persistent-storage permission is requested where supported, and
denial alone does not block dispatch.

Blocked upgrades, version-change closure, unsupported local versions, invalid
stored endpoints, and storage errors fail closed without clearing the database.
A malformed record currently blocks its namespace rather than providing
per-record repair.

## Evidence and workflow ownership

`submission-evidence.ts` parses generated receipt/error schemas and correlates
the captured immutable command. `ledger-submissions.tsx` handles Current User,
fresh lookup, explicit original-command retry, durable resolution, and separate
Ledger-list refresh. Lookup never dispatches a create; retry rereads the durable
command and confirms its original user/API namespace. Only correlated terminal
receipt or Q29 evidence resolves it. Generic errors, lookup absence, and malformed
evidence retain uncertainty. Known identity/content or version conflicts remain
durable unresolved evidence that blocks receipt/Q29 association.

Resolution and acknowledgement reread the current record inside read/write
transactions; neither can upsert a removed record. Resolution is monotonic, and
acknowledgement requires a durably resolved record. Cross-tab notifications only
prompt durable rereads; navigation and activation also recover without relying
on notification delivery. Concurrent retries rely on backend uniqueness, not a
tab lease. A delayed response cannot recreate an acknowledged record.

Resource models remain in Query. Durable resolution precedes resource refresh;
refresh failure or an unavailable Ledger cannot reopen creation. Receipts do not
seed historical resource snapshots into Query. Forms retain temporary drafts and
guard their namespace, mounted workflow lifetime, and edit revision; recovery
never navigates an abandoned workflow, clears later edits, or steals its focus.

Both Ledger entry points share the journal. The Finance recovery region remains
available during onboarding and across Finance destinations. Reload and browser
restart recover through lookup, with explicit intent required for retry. User/API
switches hide prior records and prevent old callbacks from updating the current
UI or resource cache while retaining evidence in its original partition.

## Verification seams

- `submission-journal.test.tsx`: partitioning, immutable commands, concurrent
  resolution, conflicting evidence, acknowledgement and stale callbacks.
- `ledger-submissions.test.tsx`: generated HTTP/MSW boundaries, generic errors,
  Q29 correlation, immutable retry after edits/navigation, rejection lookup,
  identity changes, preparation/resolution failures, and refresh failure.
- `ledger-submissions.spec.ts`: real Chromium IndexedDB completion/abort,
  reload, persistent-profile restart, keyboard/axe, corrupt storage, and two-tab
  acknowledgement with a delayed transport response.
- `src/routes/finance.test.tsx` and `e2e/smoke.spec.ts`: normal Ledger create,
  rename, selection, and downstream lifecycle coverage.

The optional `e2e/ledger-submissions-integrated.spec.ts` test requires backend
commit `64667936120d47c6c7635812628f5c4667834ade`: the helper rejects other
revisions. This pin belongs to that isolated test fixture. Its existing dedicated
database guard resets/migrates **only** `TEST_DATABASE_URL`; never run it against
a development or production database. From the backend directory:

```powershell
uv run --frozen python ../front-end/e2e/support/ledger-submission-backend.py
```

Then from the frontend directory:

```powershell
$env:FINANCE_SUBMISSION_TEST_BACKEND = 'http://127.0.0.1:8290'
pnpm exec playwright test e2e/ledger-submissions-integrated.spec.ts --workers=1
```

The test waits for a real backend HTTP 201, discards the receipt bytes at the
test transport boundary, retries the exact command, and compares original/replay
receipts plus PostgreSQL Ledger/submission counts. Its isolated app's count
diagnostic is test infrastructure and is never a production endpoint.

## T05/T10 extension constraints

Generated Q29 attempted-body values may be `unknown` when OpenAPI exports
`JsonValue` as `{}`. `submission-evidence.ts` supplements the generated schema
with JSON-value validation and exact structural comparison before accepting
Q29 proof, including correlation with the captured owner, key, version,
operation, and scope. Later adapters must preserve object-versus-array identity,
field presence, array order, and exact Money strings without hand-editing
generated artifacts.

The journal currently admits only Ledger v1. Later adapters must extend the
validated operation/endpoint/scope/body and evidence unions together, preserving
the common compound namespace and conditional transition mechanisms. Extend
migration, old-tab, storage-failure, lifecycle, and multi-tab coverage with those
adapters. Real Chromium storage tests and the real-commit lost-response test
serve distinct verification boundaries. Scope, browser qualification, and
production activation requirements remain defined by the backend protocol.
