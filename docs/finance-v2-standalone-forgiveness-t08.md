# Finance v2 T08 standalone forgiveness consumer

The canonical issue is [backend #33](https://github.com/core-console/back-end/issues/33).
The [immutable specification](https://github.com/core-console/back-end/blob/e206bdd5af48a3f6b3b9b525c27fa6178220bdc7/docs/finance-v2-personal-receivable-settlement-spec.md),
especially sections 5.5 and 6 and scoped AC17/AC25, owns financial semantics.
The synchronized delivered producer is
`3bd3205e25636e21ebd3ae20dab1b083e5fb48fd`.

The existing Repayments destination adds **Record forgiveness** as a separate
standalone action. Choose a Participant (including archived identities), currency,
actual event date, exact positive amount, reason, and outstanding Obligations.
Nothing is preselected. Selected debt must belong to that Participant and Ledger,
use the selected currency, and have a source date no later than the event date.
Unavailable selections remain visible until explicitly removed. Neither refresh
nor a capacity conflict silently changes the amount or expands the selection.

Preview shows selected receivables before/after, matching Expense, and ordered
typed forgiveness Allocations. Confirmation requires that preview; changing the
draft removes it. There is no receiving Account, cash receipt, payment, surplus
choice, or credit consumption. The v5 body uses `kind: forgiveness`, retained
selection and reason, and the original preview token. The backend creates the
linked ordinary uncategorized Expenses as one atomic financial group.

Confirmed sources show the event date, reason, stable Participant identity and
current archived status, retained selection, confirmation time/order, historical
forgiven amounts and remaining debt, and linked Expense Transactions. Settlement
history labels cash receipts and forgiveness distinctly. Current receivable
composition continues to show principal, cash-paid, forgiven, credit-applied and
remaining amounts separately; gross debt and available credit remain independent.
The client never replays allocation history when later Advances appear.

The existing durable browser journal chooses version 5 for forgiveness before
testing selected-cash version 4. It retains owner namespace, Ledger, body, reason,
selection, token, version and key through uncertainty and reload. Lookup executes
no financial action; explicit retry sends the original command. Mismatched evidence
cannot resolve it. A correlated stale rejection requires another preview and
deliberate confirmation with a new identity. Resource-read failure preserves the
terminal receipt and offers resource refresh. Versions 1–4 and T01–T07 remain
supported through their existing paths.

## Verification and boundaries

`pnpm api:update` regenerated the snapshot and Fetch/Query/Zod/MSW/Faker artifacts
from the clean sibling checkout at the exact producer. Parsed JSON correspondence
must also be checked against `git show P:openapi/openapi.json`. Orval's mixed
cash/forgiveness mock arrays widen an example currency to `string`; a mock-only
override for the three Settlement read/preview operations retains the example's
literal currency. Generated output is never edited by hand.

Run `pnpm check`, then `pnpm e2e`. Do not overlap their production builds.
`src/routes/finance-forgiveness.test.tsx` exercises routed form, contract rejection,
scope/order, stale confirmation, source attribution and original-command retry.
`e2e/forgiveness.spec.ts` exercises production-preview Chromium, keyboard/focus,
1024px layout, axe, pending guards, reload, lookup correlation, original-byte retry,
source-read failure, and owner isolation. Unexpected browser errors fail; only the
stale scenario expects its exact HTTP 409 console diagnostic. These HTTP fixtures
establish consumer behavior, not real committed financial effects.

Consumer commit/publication, exact-consumer CI and real delivered P+C acceptance
remain separate authorized steps. Pair acceptance must identify exact SHAs and
prove scoped receivable reduction, linked Expense, unchanged cash and credits,
history, stale/ownership rejection, and no duplicate financial effects through real
Chromium/TCP/guarded PostgreSQL observations. Issue #33 stays open until both
portions are delivered, pair verification passes and closure is separately
authorized through the backend harness. T09 combined repayment/forgiveness,
Corrections and production activation are outside this consumer.
