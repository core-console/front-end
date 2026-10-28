# Finance v2 T10 consumer: explicit credit application

The generated contract is synchronized from delivered backend producer
`6dc6f2b21f99e9af8666793c817ed9f9f8d734c9`. The immutable specification at
`e206bdd5af48a3f6b3b9b525c27fa6178220bdc7` and backend Issue #35 own product scope.

On Repayments, **Apply credit** explicitly chooses a Participant, currency,
application date, positive exact amount and non-empty eligible Obligation subset.
Archived Participants may resolve existing debt and credit. No Account, cash,
Income, forgiveness or surplus input is reused for this action. Selection never
expands automatically; unavailable selections remain visible until removed.
Available credit is an advisory read; preview authoritatively checks availability,
selected debt, date and all linked Account constraints.

The preview shows selected debt and total available credit before/after, ordered
origin consumption and typed Allocation fragments. Confirmation order determines
oldest credit origin; editable financial dates do not reorder it. Each origin
retains its receipt Settlement, Internal Transfer, Liability Account, financial
date, confirmation order, consumed amount and frozen before/after availability.
Debt links and fragment order remain visible in preview and confirmed history.
Gross cash-paid, forgiven, credit-applied and remaining debt stay separate.
Credit application reduces receivables and credit Liability equally, with no new
cash, Income or Expense. Its linked financial records are Internal Transfers.

Version 7 uses the existing owner/API namespace, Web Locks, IndexedDB journal,
correlated receipts and original-command lookup/retry. Unknown outcomes lock the
draft and retain the exact version/body/owner/key, including across reload.
Committed-response-loss retry reuses that complete command. Source-refresh failure
does not undo a confirmed result. A terminal stale rejection instead invalidates
the preview, preserves intent, and requires a fresh preview, new key and deliberate
confirmation. Versions 1–6 keep their previous meanings.

Producer-valid boundary tests pass Money through form validation, preview and
journal preparation/reopening: CNY 0.01, JPY 1, leading zeros, 131,072 integer
digits, and 500-code-point non-BMP notes surrounded by producer whitespace.
Note length validation follows the producer's Python `str.strip()` whitespace
semantics (including U+0085 and U+001C–U+001F, excluding U+FEFF) and counts Unicode
code points. Only the validation copy is stripped: preview and the durable v7
command retain the original nonempty note, including surrounding and internal
whitespace. The producer owns canonical normalization. Empty input remains `null`.
No floating point conversion or
rounding is used. A linear shared Money grouping pass supports the producer's
maximum digit count without the previous quadratic regex. Generator configuration
retains a literal allocation kind in Faker callbacks; generated code is not edited.

Routed MSW tests and production-preview Chromium checks cover the consumer's
selection, preview correspondence, confirmation/history, stale/unavailable scope,
pending locking, owner isolation, original-command retry, keyboard/focus and axe.
Browser financial state and committed-response loss are simulated fixtures; they
do not prove a real PostgreSQL commit, backend atomicity or delivered P+C acceptance.
The retained screenshots and candidate validation/review report live under
`.agent/t10/` locally.

Remaining gates: independent review and READY_FOR_REVIEW handoff; separately
approved consumer commit/delivery; exact-consumer-SHA Validate and Chromium CI;
real scoped acceptance against the exact delivered producer and consumer; then
separately authorized canonical issue closure through the backend workflow.
Issue #35 stays open. T11 credit return and later correction workflows are excluded.
