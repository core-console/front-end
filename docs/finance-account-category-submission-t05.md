# T05 Account and Category browser submissions

The [backend protocol](../../back-end/docs/finance-create-submission-protocol.md)
remains the sole normative authority. This note records frontend implementation
and verification seams for [frontend #41](https://github.com/core-console/front-end/issues/41).
T05 adds Account and Category form recovery to the shared Ledger machinery.
Transaction and Balance Adjustment recovery and production activation are outside
this slice.

## Cumulative contract

Consume the cumulative T04 backend contract through the repository's
`pnpm api:update` workflow. The synchronization script formats the exported
OpenAPI document before deterministic Orval generation. Generated files and the
synchronized snapshot must not be edited manually.

The cumulative contract covers Ledger, Account, and Category create receipts,
required protocol headers, errors, and lookup. Account HTTP 422 has ordinary
nonterminal, Q29, and terminal business-rejection branches. Category HTTP 409
can be nonterminal or a terminal name rejection. The evidence parser consumes
generated closed schemas and correlates operation, submission UUID, command
version, target Ledger, timestamps, and operation-specific outcome/resource type.
Q29 additionally requires the original owner and exact JSON attempted body.
HTTP status never supplies a local resolution. A response carrying both receipt
and Q29 proof fails parsing.

## Shared browser machinery

T05 extends T03's `submission-journal.ts` and `submission-evidence.ts` in place.
The provider, context, and recovery surface now use `finance-submissions`,
`finance-submission-context`, and `finance-submission-recovery` names. Both Ledger
entry points continue using `use-ledger-create`, which adapts the shared
`use-finance-create` lifecycle hook. Account create and Category create use that
same hook; Account edit and Category rename retain their previous mutations.

The IndexedDB database, compound namespace/key, database version 1, and
`localSchemaVersion: 1` remain unchanged. The record union adds Account and
Category commands without rewriting existing Ledger records or command versions.
Operation, endpoint, scope, body, and workflow are validated together. Conditional
resolution/acknowledgement also compare retained scope and immutable metadata;
they cannot recreate a removed record. Cross-tab notifications remain reread
hints. Only explicit retries execute the original durable command.

The earlier Ledger-only build cannot read nested-operation records. Its existing
parser fails closed for that namespace and directs users to reload/update without
clearing data. This additive slice does not claim full stale-build interoperability
or cross-browser qualification; those remain later qualification work.

## Money, drafts, and resource reconciliation

Opening Balance stays an exact string with its currency, Account Nature, and civil
Tracking Start Date. Preparation/retry never parse it as a Number, round it,
normalize negative zero, truncate it, or shorten the backend Money range. Frozen
v1 Money validation/canonicalization remains backend-owned. The journal retains
the exact attempted body so typed Q29 can resolve the frontend/backend validation
gap, including amounts outside the durable range. Generated attempted-body values
remain `unknown`; JSON-value validation and exact structural equality supplement
them before evidence is accepted.

Generated JavaScript name `.max` counts UTF-16 units, while the backend/OpenAPI
limit counts Unicode code points. The handwritten Account/Category command
schemas extend only the generated name member to preserve the existing 100-code-
point form behavior. Generated Money and other members remain unchanged.

Submitted commands and later draft edits are separate. Unresolved attempts lock
ordinary resubmission; a separate-create action requires explicit intent and a
fresh key. Known conflicting reuse blocks that action in the affected form.
Account names are not deduplication keys: intentionally identical Accounts remain
possible. Terminal business rejection or fully correlated Q29 permits correction
with a new submission. Never-submitted and post-dispatch drafts remain transient.

Durable resolution precedes ordinary resource reads. Receipts are never resource
snapshots and never seed Query. The original target Ledger's Account/Category list
is refreshed through generated clients and existing Query keys even after Ledger
navigation; the current destination is not substituted. The original mounted,
unedited form completes only when the current created resource is available.
Refresh failure or an unavailable resource keeps creation confirmed and offers
list refresh separately. Edited, closed, reopened, or prior-user workflows cannot
be closed, cleared, navigated, or focused by delayed completion.

## Verification and later work

- `nested-submissions.test.tsx` exercises both forms through HTTP/MSW and the
  journal: immutable retry, strict evidence/Q29, ordinary 422, terminal rejection,
  namespace/lifetime changes, exact Money, and storage failure.
- Existing Account/Category route tests return cumulative receipts and read
  current resources separately, preserving ordinary edit/rename, lifecycle,
  validation, Unicode, ordering, and focus coverage.
- `nested-submissions.spec.ts` uses real Chromium IndexedDB for transaction
  completion/abort, reload, persistent-profile restart, Ledger navigation,
  keyboard/axe, and concurrent-tab acknowledgement with delayed responses.
- Existing Ledger recovery and Finance smoke coverage remains applicable.

The browser transport fixtures establish browser behavior; they do not claim a
real Account Opening Balance PostgreSQL commit. T04 owns that protected backend
proof. T03's optional real-backend Ledger fixture targets the original T02
producer and a dedicated test database. Real committed-response-loss qualification
belongs to the later integrated acceptance work.
Later Transaction adapters must extend the same closed command/evidence unions
and preserve exact array order, field presence, Money strings, scope, and lifecycle
guards. No Transaction recovery, adjustment recovery, global Query defaults,
generic persistence framework, or production activation is added here.
