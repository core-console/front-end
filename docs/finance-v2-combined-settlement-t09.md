# Finance v2 T09 combined Settlement consumer

The canonical issue is [backend #34](https://github.com/core-console/back-end/issues/34).
The [immutable specification](https://github.com/core-console/back-end/blob/e206bdd5af48a3f6b3b9b525c27fa6178220bdc7/docs/finance-v2-personal-receivable-settlement-spec.md),
sections 5.5 and 6 and scoped AC15/AC16, owns financial semantics. The synchronized
delivered producer P is `4dcadec11d2ec679bb17fe189cdec51a1339b63e`.

**Record combined Settlement** on Repayments records actual cash and explicit
forgiveness in one command. Choose a Participant (including archived identities),
active receiving Account, event date, exact positive cash and forgiveness amounts,
reason and a non-empty selection of eligible outstanding Obligations. Currency
follows the receiving Account. Nothing is selected or forgiven automatically.
Both amounts must fit the selection: cash first, then forgiveness against the
remaining capacity. An unavailable selection stays visible until explicitly
removed. Any shortfall beyond the entered forgiveness remains outstanding.

One preview shows receiving balance before/after, selected outstanding debt
before/after, actual cash, forgiveness and its matching Expense. Ordered typed
Allocations show cash-paid and forgiven in separate columns, including successive
cash and forgiveness stages for the same Obligation. The client checks response
intent, scope, totals, currencies, stage order and receiving Account effect without
reallocating the returned history. Draft edits remove confirmation. A stale
terminal rejection retains intent and requires a fresh preview and deliberate
confirmation with a new identity, including when regeneration fails.

Confirmed detail and chronological history distinguish cash and forgiveness,
retain reason, selection, stable Participant identity and confirmation order,
and link the underlying cash/Expense Transactions. Current Obligation composition
continues to separate cash-paid, forgiven, applied credit and remaining debt.
The combined action creates no Income or credit and does not apply existing credit.
Later backdated Advances never cause client-side historical FIFO replay.

The existing durable journal selects command version 6 before selected-cash v4.
It preserves the original owner namespace, Ledger, key, version, body, amounts,
selection, reason and preview token. Lookup is read-only; explicit retry sends
the original command unchanged. Mismatched evidence cannot resolve it. A failed
resource read preserves terminal confirmation and offers source refresh. Versions
1–5 and T01–T08 keep their existing workflows and evidence meanings.

## Verification and delivery boundary

`pnpm api:update` synchronized P and regenerated Fetch/Query/Zod/MSW/Faker output.
Parsed snapshot correspondence is checked against `git show P:openapi/openapi.json`.
An Orval mock-only schema override keeps the forgiveness Allocation discriminator
narrow inside mixed variant arrays; generated artifacts are never edited by hand.
Focused generated-contract tests run before workflow integration.
The handwritten v6 request boundary extends only the generated reason check to
count Unicode code points, matching P's 500-character limit for preview and
durable command parsing; all other generated fields and strictness are retained.

Run `pnpm check`, then `pnpm e2e` serially. Routed tests cover AC15/AC16, receiving
Asset/Liability effects, explicit shortfall, exact amounts, capacity rejection,
typed composition, stale confirmation and original-command retry. Production-preview
Chromium covers keyboard/focus, 1024px layout, axe, pending guards, reload,
lookup correlation, identical-byte v6 retry, failed preview regeneration,
source-read failure and owner isolation. Unexpected browser errors fail; only
the stale case permits its exact HTTP 409 diagnostic.

These fixtures validate consumer behavior, not committed PostgreSQL effects.
Consumer delivery, exact-C CI, matching real delivered P+C Chromium/TCP/guarded
PostgreSQL acceptance, and separately authorized Issue #34 closure remain delivery
dependencies. T10, credit application/return, Corrections and production activation
are outside this consumer. No backend or approved specification changes are made.
