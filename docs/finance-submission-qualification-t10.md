# Finance browser journal qualification (T10)

The backend [create-submission protocol](../../back-end/docs/finance-create-submission-protocol.md)
owns Finance command and evidence semantics. T10 qualifies browser storage and
workflow lifecycle against that contract; it does not qualify PostgreSQL effects
or authorize production activation.

## Shared recovery boundary

All five creates retain the same version-1 IndexedDB store, immutable command
union, evidence validation, conditional resolution and acknowledgement paths.
An older asynchronous journal read must not publish over a newer read, including
one observing terminal resolution or removal. Namespace teardown invalidates
outstanding reads. BroadcastChannel construction and delivery can be unavailable;
normal activation and explicit recovery still reread durable storage.

The store must have the expected composite API/owner/submission key and no
automatic key generation. An incompatible store, unknown operation/version,
damaged command or unrecognized field blocks the affected partition without
clearing data. Version 1 has no predecessor migration. Existing v1 command
compatibility and refusal of a future database version are qualification cases,
not evidence of a production v1-to-v2 migration.

## Browser evidence

`e2e/submission-journal.spec.ts` exercises real Chromium IndexedDB transactions.
Its five-operation matrix covers legacy command replay, notification-free
concurrent retries, late failures, failed resolution/acknowledgement commits,
and acknowledgement racing delayed receipts. Separate scenarios cover stale
read delivery, missing records, owner/API partitions, owner-switch callbacks,
draft/focus preservation, incompatible records/store structure, quota failures,
and persistent-storage denial (false, rejected promise and synchronous error).

A held connection and a real competing version-2 open exercise blocked upgrades
and versionchange closure without losing records. A controlled blocked event
also exercises the application's actionable open-failure guidance. Request
success followed by transaction abort exercises durability failure windows;
held transaction-completion callbacks and transport barriers establish races
without sleeps or test retries.

Generated schemas validate protocol fixtures. Controlled Fetch responses exercise
exact Q29 versus mismatched/generic evidence, closed/unsupported command versions,
and fresh no-store absent/inaccessible/failed/mismatched lookups. Expected error
HTTP statuses are returned at the Fetch boundary so unexpected browser console
errors remain failures. These fixtures do not establish server-side validity,
access control, version retention or database uniqueness.

The cumulative Ledger, nested-create, Transaction and Adjustment Chromium suites
remain required: they prepare through the real forms, reopen persistent profiles,
cover entry points, keyboard/axe, transient edits and reopened workflow guards.
Run `pnpm check` and `pnpm e2e --retries=0` against the production preview.

## Later integration qualification

T11 must still establish actual committed-response loss and financial effect
uniqueness using the protected PostgreSQL backend. The browser fixtures cannot
prove either. T10 introduces no backend or generated-contract changes and retains
the T08 producer snapshot. The existing guarded Ledger integration test remains
separate; a skipped fixture is not PostgreSQL evidence. T13 owns the common final
activation gate. Chromium evidence does not extend to other browsers, storage
eviction/clearing, private-profile teardown or cross-device discovery.
