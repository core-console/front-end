# Finance v2 T11 credit return consumer

Producer: `e57e5a66ae2fbcac02741d227da1e2181492b0ec`. Canonical scope:
[front-end Issue #46](https://github.com/core-console/front-end/issues/46),
AC22 and the return branch of AC46 in the
[frozen specification](https://github.com/core-console/back-end/blob/e206bdd5af48a3f6b3b9b525c27fa6178220bdc7/docs/finance-v2-personal-receivable-settlement-spec.md).
The [producer note](https://github.com/core-console/back-end/blob/e57e5a66ae2fbcac02741d227da1e2181492b0ec/docs/finance-v2-credit-return-t11.md)
owns financial and wire semantics.

The Repayments destination offers **Return credit**. Choose a Participant
(including archived Participants resolving existing credit), an active paying
Account, actual date and positive exact amount. Currency follows the Account.
Available credit is read from Participant positions. Preview authoritatively
checks current availability, managed Account restrictions, currency, ownership
and all affected Tracking Start Dates. It shows paying balances, credit before
and after, and each consumed origin with receipt, transfer, Liability Account,
immutable confirmation order and frozen amounts. The consumer preserves the
producer's order; it never selects or redistributes origins locally.

Deliberate confirmation sends `creditReturn` through the existing generated
Settlement operation with command version `8`. Paying Asset decreases or paying
Liability increases; the credit Liability decreases equally. No Income, Expense,
debt Allocation or receivable change is introduced. Confirmed history explicitly
labels actual returns, paying Account, amount/date/note and linked Internal
Transfers. Receipt-backed origins retain their original amount and current
availability separately from frozen consumption history. Linked Transaction and
managed Account protections remain enforced by P through existing Finance APIs.
Corrections and cancellation remain later slices.

The existing IndexedDB journal and Web Locks retain the owner, Ledger, key,
version and complete original payload before submission. Unknown outcomes block
conflicting Settlement entry. Reopening reads only the original namespace.
Lookup never executes; explicit retry sends the same original command. Missing
or unfinished lookup cannot authorize a replacement. Correlated stale rejection
preserves draft intent, removes confirmation and requires a fresh preview and
deliberate new confirmation with a new identity. Resource refresh failure leaves
a confirmed terminal receipt confirmed. Versions 1–7 remain supported.

Producer-valid plain-decimal Money stays a string, including values beyond JS
safe integers, insignificant leading zeros and the 131,072 significant integer
digit limit. Currency precision is enforced without rounding. Note validation
counts Unicode code points after Python-compatible whitespace stripping, while
the original text remains unchanged in preview and durable preparation/reopening.
Generated schemas and the OpenAPI snapshot are regenerated, never hand-edited.

Focused routed tests and production-preview Chromium fixtures cover entry,
preview, confirmation/history, pending protection, stale reconfirmation,
Unicode/Money boundaries, keyboard focus and axe. The opt-in real backend tests
also observe committed PostgreSQL fragments, movements and terminal evidence
before withholding the browser's receipt, then verify reload, lookup/original-key
retry, unchanged debt, gross positions and zero Income/Expense. This qualifies an
uncommitted consumer candidate; it does not establish delivered P+C acceptance.

For reproducible real-browser validation, run these processes serially against
the dedicated guarded test target:

```powershell
# In back-end, with explicit TEST_DATABASE_URL and the repository's pinned uv:
uv run --frozen python ../front-end/e2e/support/credit-return-backend.py
# In front-end, while that server is running:
$env:FINANCE_T11_TEST_BACKEND = 'http://127.0.0.1:8298'
pnpm exec playwright test credit-return-integrated.spec.ts --workers=1
```

The helper refuses the application database via the backend's existing guard
and resets/upgrades only the dedicated test database. Stop other processes that
share that `TEST_DATABASE_URL` before starting it; stop the server before another
schema-resetting suite. Evidence and review bindings for this candidate live in
`.agent/t11/`. Consumer delivery, exact-C CI and matching delivered P+C acceptance
remain separate gates. Issue #46 stays open.
