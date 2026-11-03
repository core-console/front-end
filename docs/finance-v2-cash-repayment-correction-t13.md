# Finance v2 T13 cash repayment Correction consumer

Approved scope is [back-end#37](https://github.com/core-console/back-end/issues/37),
bounded by the immutable Finance v2 specification, sections 7.3, 7.5–7.6 and scoped
AC31, AC40 and AC45. The [producer note](https://github.com/core-console/back-end/blob/26290aeb2fbc125896c3687e284e8f055330f15f/docs/finance-v2-cash-repayment-correction-t13.md)
owns contract semantics. This document describes consumer integration.

Producer P is `26290aeb2fbc125896c3687e284e8f055330f15f`. Its committed
`openapi/openapi.json` was synchronized with `pnpm api:update`, using the verified
exact-P sibling checkout. Fetch, Query, Zod, MSW and Faker artifacts are generated
by Orval. Parsed parity and the complete file inventory are retained in
`.agent/t13/contract-parity.json` and `.agent/t13/candidate.json`.

## Workflow

Open `/finance/repayments?ledger=<UUID>&settlement_id=<UUID>` and choose
**Correct cash repayment** on a cash-only source. Enter the corrected positive
receipt and reason. Choose `none` when all corrected cash resolves retained debt,
or explicitly retain excess as Participant credit or accept it as Income with an
active Category or Uncategorized. The producer determines whether the selected
disposition is valid; the consumer never selects it automatically.

Preview retains receiving Account, Participant, currency, receipt date, original
confirmation identity/order and selected scope. It shows before/after receipt
facts, original/effective Allocation cash in retained order, complete affected
Obligation composition, linked financial snapshots and Account balances. Client
checks correlate the preview to the command and validate exact reconciliation;
they do not calculate Allocation order or financial effects. Editing invalidates
confirmation. Confirmation sends only the reviewed command and producer token.

Decreases first remove unallocated value, then release in reverse original
Allocation order. Debt can reopen without forgiveness. Increases stay within
original Allocation identities, including previously released zero-effective
ones. No new debt is selected, unrelated Settlements are not replayed, and credit
is not consumed. Correction transfers restate false original facts at the original
receipt date; they are not actual cash returns. Future-dated restatements affect
Current Balance immediately under existing date semantics.

History uses immutable producer revision order and retains actor, reason,
correction confirmation time and full before/after consequences. Effective source
cash and remaining projections may change; original cash/order remain visible in
Correction history. A history or source read failure never reverses a confirmed
receipt. Ledger Query views are invalidated after confirmation.

Forgiveness-containing, credit-application and credit-return Settlements have no
T13 entry action. The producer also rejects cash origins whose credit was applied
or returned. Account/date/attribution changes, cancellation and T14–T21 are outside
this consumer. Existing Finance v1 and T01–T12 workflows retain their meanings.

## Durable recovery

`createFinanceSettlementCorrection` has its own closed command version **1** and
`settlementCorrection` receipt resource. It extends the existing journal without
changing the local database/schema version, Settlement v1–v8 or Advance Correction
v1. Original API/owner namespace, Ledger, key, Money strings, Unicode reason, token
and complete body survive reopening. Python-compatible trimming and Unicode
code-point validation live beside generated schemas; generated files are never
patched.

Correlated terminal evidence is persisted before resource refresh. Unknown errors,
missing lookup and mismatched evidence retain the command. Check outcome is
read-only; explicit retry sends the original command unchanged. A stale terminal
rejection removes confirmation, preserves draft intent, and requires a fresh
complete preview and deliberate confirmation under a new key. Browser Web Locks
and owner/API isolation continue to govern execution and recovery.

## Verification and handoff

The agreed seams are routed UI with MSW, public durable-journal interfaces, and
production-preview Chromium with keyboard/focus and axe checks. Optional real-P
browser checks run with `FINANCE_T13_TEST_BACKEND=http://127.0.0.1:8301` and the
frontend-owned `e2e/support/settlement-correction-backend.py` server launched from
the exact-P backend root. It invokes the producer's guard for `TEST_DATABASE_URL`
and observes committed effects through an independent database session before
withholding a response. Tests sharing that database must run serially.

Candidate identity, complete inventory, parity, validation, independent Standards
and Spec review reports and handoff are local artifacts under `.agent/t13/`.
Implementation stops uncommitted at `READY_FOR_REVIEW`. Consumer delivery, exact-C
CI, delivered P+C acceptance and Issue #37 closure remain separate gates.
