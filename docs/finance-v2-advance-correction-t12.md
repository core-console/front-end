# Finance v2 T12 Advance Correction consumer

Canonical approved scope is [back-end#36](https://github.com/core-console/back-end/issues/36),
including its frontend responsibility. The frontend backlog intentionally has no
mirrored T12 ticket. Product authority remains the immutable
[Finance v2 specification](https://github.com/core-console/back-end/blob/e206bdd5af48a3f6b3b9b525c27fa6178220bdc7/docs/finance-v2-personal-receivable-settlement-spec.md),
sections 4.7, 7.1–7.2 and scoped AC32, AC33, AC35, AC40. The
[producer integration note](https://github.com/core-console/back-end/blob/d87550d839d2b45a9bb8d5c804016e0936e20163/docs/finance-v2-advance-correction-t12.md)
defines the generated contract and producer eligibility.

Producer P is `d87550d839d2b45a9bb8d5c804016e0936e20163`. Synchronization uses
`pnpm api:update` against that exact sibling checkout. Existing 37 OpenAPI paths
are unchanged; four correction paths are added. The parsed producer/consumer
OpenAPI SHA-256 is
`fcbf06a627b30f187ce7fe6e5872827e56560b9562a2d689e2bf567cf987a47f`.
The backend export and formatted consumer snapshot have different byte hashes;
parsed contracts are identical. Generated Fetch/Query/Zod/MSW/Faker files remain
Orval-owned.

## Workflow

Open a confirmed source at `/finance/advances?ledger=<UUID>&advance_id=<UUID>`.
`Correct Advance` opens reason and complete corrected-fact entry. Funding stays
in the original currency; owner share is explicit and participant shares must be
unique, positive and reconcile exactly with the positive total. Removing all
participant shares supports a fully owner-funded purchase. Existing archived
attribution can be retained; adding or restoring archived debt is blocked.

Preview shows original and corrected dates, funding, owner Expense, participant
composition, retained zero-principal attribution, linked financial snapshots,
Account balances and original confirmation identity. It distinguishes changed
funding from corrected shares on truthful funding. Confirmation is a separate
explicit action and editing invalidates the displayed plan. Future-dated
restatement affects Current Balance immediately under existing date semantics.

History uses producer-owned immutable revision order and retains actor, reason,
correction confirmation time, original/intermediate facts and financial effects.
The effective source retains the Advance and Obligation identities. Historical
Transaction identities are retained as snapshots even when their old effects
were replaced or removed by coordinated correction.

Any cash Allocation, forgiveness or credit application blocks this workflow.
Current source composition disables entry and the producer rechecks actual
history and ownership at preview and confirmation. Preview responses are parsed
with generated Zod schemas and checked for command identity, exact financial
reconciliation, date, attribution and balance consistency. The client never
creates financial effects independently. Correction does not consume credit,
redistribute payment, create Income or Balance Adjustment, cancel an Advance or
implement T13–T20.

## Durable recovery and compatibility

`createFinanceAdvanceCorrection` has its own command version **1** and resource
`advanceCorrection`. It extends the existing durable journal without changing
its database/local record schema version or any T01–T11 command grammar.
Settlement v8 credit-return recovery remains v8. Unicode code-point compatibility
for reason/note is handwritten beside the generated boundary; generated files
are not patched. Preparation and reopening retain the original authored text,
Money strings, owner/API namespace, Ledger, body and key.

A correlated terminal receipt resolves the command before resource refresh.
Unknown outcomes retain the original command. Lookup is read-only; explicit retry
uses exactly the same key, body, owner, Ledger and command version. Missing or
mismatched evidence does not establish failure. Stale terminal rejection preserves
draft facts, removes confirmation and requires a refreshed complete preview plus
a deliberate new key. Confirmed outcomes stay confirmed when resource reads fail.
Correction refresh invalidates affected Ledger Query views including old/new
attribution, source/history, Account balances, linked Transactions and overview.

## Verification

Colocated financial/command tests cover exact Money, foreign Ledger/identity,
zero attribution, linked effect and Account consistency, downstream composition,
Unicode preparation/reopening and existing v8 compatibility. Routed tests cover
explicit preview/confirmation, reconciliation and downstream entry protection.
Production-preview Chromium tests cover 1024/1280/1600px, keyboard focus, axe,
stale reconfirmation and fresh-page exact-key retry.

The optional real-producer suite uses only the backend's guarded dedicated
`TEST_DATABASE_URL`, through `e2e/support/advance-correction-backend.py` launched
from the exact-P backend root. Its schema reset and all other tests sharing that
database must run serially. Run with `FINANCE_T12_TEST_BACKEND` set to the local
`http://127.0.0.1:8299` server. It observes committed Correction, movements and
terminal evidence through a separate database session before dropping a response,
then verifies fresh-page lookup/retry, no duplicates, exact balances, preserved
credit, repeated history, zero attribution and future-date effects. This is
local exact-P plus uncommitted-consumer evidence. Delivered-C CI and delivered
P+C acceptance remain separate publication gates.

The implementation stops uncommitted at READY_FOR_REVIEW. Candidate identity,
complete inventory, test logs, review reports and local acceptance evidence are
recorded under `.agent/t12/`. No issue mutation, commit, push or publication is
part of this task.
