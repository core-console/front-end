# front-end

Minimal React application baseline built with Vite, TypeScript, Tailwind CSS, and shadcn/ui. React Router manages navigation and route errors, TanStack Query manages server state, and Zod validates external data at runtime.

## Requirements

- Use the exact Node.js runtime declared in `.node-version`.
- Use the pnpm release declared by `packageManager` in `package.json`.

`.node-version` is the exact runtime source for local development and both CI
jobs; `engines.node` describes the supported LTS range rather than a second
runtime pin. CI's pnpm setup reads `packageManager` directly. Configure your
local Node version manager to read `.node-version`, and use a pnpm installation
that honors the project's `packageManager` field. `pnpm toolchain:check` verifies
the effective versions and runs first in `pnpm check` so a stale global shim
cannot silently validate with a different toolchain.

## Getting Started

```sh
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm dev
```

`VITE_API_BASE_URL` configures the browser-facing API base URL and defaults to
the same-origin `/api` path. During `pnpm dev`, Vite forwards `/api` requests
unchanged to the local FastAPI server at `http://127.0.0.1:8000`. This
development-only proxy target is not included in the production bundle.
`pnpm preview` and production deployments do not use the Vite development
proxy; production must route `/api` through APISIX. All `VITE_*` values are
included in the browser build and must never contain secrets.

## Validation

Run the complete pre-commit validation pipeline with:

```sh
pnpm check
```

It checks the effective Node/pnpm versions, OpenAPI contract and generated
client for drift, formatting, linting, TypeScript project references, Vitest,
the production bundle, and the production artifact structure and known
development-only markers. Each check
remains available as an independent script for focused local work. `pnpm build`
creates the Vite production bundle and removes the development-only
`mockServiceWorker.js` without affecting other `public/` assets. Run
`pnpm build:check` after a standalone build to validate the emitted artifact
structure and scan for known development-only markers, and run `pnpm typecheck`
separately when a standalone type check is needed.

The backend-owned OpenAPI document is checked in at `openapi/openapi.json` and
drives the generated Fetch, TanStack Query, Zod, MSW, and Faker files under
`src/api/generated/`. Commit and validate backend contract changes first, then
run `pnpm api:update` to sync the authoritative sibling
`../back-end/openapi/openapi.json` snapshot, lint it, and regenerate the client.
Pass a different source when needed with
`pnpm api:sync -- <path-to-openapi.json>`, then run `pnpm api:lint` and
`pnpm api:generate`. `pnpm api:check` verifies the checked-in snapshot and
generated output without requiring the backend repository or modifying files.

`pnpm e2e` builds the application and runs Chromium smoke and axe checks against
a real Vite production preview. Authentication remains intentionally deferred
until its integration requirements are designed.

The TypeScript CLI/compiler path used by type-checking and build validation is
TypeScript 7. The package named `typescript` currently resolves to a
TS6-compatible programming API so tools that cannot yet consume the TS7 API,
including the current documentation and API-generation toolchain, can continue
to run. This side-by-side arrangement remains necessary until those tools can
use the TS7 programming API directly.

See the [modernization compatibility notes](docs/repository-modernization.md)
for retained compatibility boundaries and their removal criteria.

## Localization

The default UI language is Simplified Chinese (`zh-CN`). The first slice covers
the shell, navigation affordances, Home, and shared loading/error feedback.
Users and Finance feature copy will be localized in later slices.

Use the typed `messages` catalog in `src/lib/i18n.ts` for user-facing copy,
including accessible names and tooltips. Add keys by surface or shared intent;
keep complete sentences and parameterized messages in the catalog rather than
assembling translated fragments in components. A single locale needs no
provider, locale state, or switcher.

Localized surfaces and shell tooltips declare the exported `locale`; fixed
English labels declare `lang="en"`. The document fallback and shell's route
content boundary remain English for deferred feature copy and portal content.
Each newly localized route should declare `lang={locale}` on its surface.

The closed `glossary` in that module preserves these English labels: Core
Console; Home, Users, Finance, Settings; Overview, Transactions, Accounts,
Categories; Ledger, Account, Category, Transaction; Balance Adjustment,
Internal Transfer. Chinese carries descriptions, help, ordinary field labels,
statuses, filters, validation, empty states, errors, confirmations, and feedback.
Actions use Chinese verbs with fixed glossary objects, such as 新建 Ledger or
删除 Transaction. Do not add bilingual labels such as `Ledger / 账本`.

Income, Expense, Asset, and Liability are 收入, 支出, 资产, and 负债. Quick Entry is
快速记账. Finance uses Account; identity and login copy uses 用户 or 登录账号.
Ledger and Transaction stay English; 账本 and 记账事件 may clarify explanatory
copy. These are UI wording rules, not changes to backend-owned domain meanings.

## Finance v1 integration status

The current backend-owned Finance v1 OpenAPI contract is synchronized into
`openapi/openapi.json`. Its 24 operations are available through the generated
Fetch clients, TanStack Query hooks, Zod schemas, MSW handlers, and Faker
fixtures under `src/api/generated/`.

The Finance v1 durable-create integration was introduced through backend T08 at
`6ed5b384ebea3c7179a19b339da1585c5a538730`. All five Finance v1 create
operations use shared durable browser preparation, correlated evidence, and
known-submission lookup. Balance Adjustment supports both created Transaction
identity and terminal noChange without a resource. This cumulative integration
is not the production activation gate. See the
[T03 integration note](docs/finance-ledger-submission-t03.md),
[T05 integration note](docs/finance-account-category-submission-t05.md),
[T07 integration note](docs/finance-transaction-submission-t07.md), and
[T09 integration note](docs/finance-adjustment-submission-t09.md)
for cumulative contract, Money, lifecycle, and browser qualification facts.

Synchronize future committed backend contract changes through the existing
`pnpm api:update` workflow described above. Do not hand-edit the snapshot or
generated files, or create a parallel handwritten Finance client or invented
contract. Finance product routes and UI remain separate implementation work.

For Finance product and design authority, start with the
[approved interaction specification](docs/finance-v1-frontend-interaction-spec.md),
the [design-authority index](docs/design/finance-v1/README.md), and the
[Finance visual authority](DESIGN.md#finance-v1-authority).

## Finance v2 Participants (T01)

The synchronized OpenAPI producer is
`e92194e9d3ac788853a25af2ae1c0b84262216f7`, adding five Participant operations.
`/finance/participants?ledger=<UUID>` integrates create, list, inspect, rename,
and archive with the selected Ledger. Names may repeat; UUIDs identify records.
Archived records remain visible, inspectable, and renameable. There is no delete
or unarchive action.

Participant operations are metadata changes, outside the Finance v1 durable
submission protocol. A repeated create assigns a new identity. An unconfirmed
create is never automatically retried: close the form and refresh the list to
inspect the outcome before deliberately starting another create. A confirmed
response updates Query data before list refresh, so refresh failure does not
turn success into a failed create.

The backend [T01 producer note](https://github.com/core-console/back-end/blob/e92194e9d3ac788853a25af2ae1c0b84262216f7/docs/finance-v2-participants-t01.md)
and [immutable product specification](https://github.com/core-console/back-end/blob/e206bdd5af48a3f6b3b9b525c27fa6178220bdc7/docs/finance-v2-personal-receivable-settlement-spec.md)
remain authoritative. Advance and Settlement workflows and their later archived
attribution checks are outside this consumer. Routed MSW and production-preview
Chromium tests cover frontend behavior; they do not establish real PostgreSQL
effects or delivered producer/consumer pair acceptance for
[Issue #27](https://github.com/core-console/back-end/issues/27).

## Finance v2 pure Advance (T02)

The synchronized producer is `8412584fe56c86a7ced239e3a76d450f8655d7cf`.
`/finance/advances?ledger=<UUID>` records one pure Advance for an active
Participant from one active Asset Account, with zero owner share. Preview shows
the exact funding balance before/after, receivable increase, and unchanged owner
Expense. Confirmation uses the existing durable submission journal and generated
Fetch/Query/Zod contract. Participant receivables link from Participants and show
source, principal, cash paid, forgiven, credit applied, and remaining debt;
confirmed sources can be bookmarked with `participant_id` and `advance_id`.

An uncertain confirmation retains the original key, version, Ledger and body.
Lookup never executes; explicit retry sends that original command. Only correlated
terminal evidence or guarded non-admission proof resolves it. A stale-preview
terminal rejection preserves draft intent, removes confirmation, and requires an
explicit refreshed preview and deliberate new confirmation with a new identity.
Resource-read failure never turns a confirmed receipt into an unknown outcome.

The [producer note](https://github.com/core-console/back-end/blob/8412584fe56c86a7ced239e3a76d450f8655d7cf/docs/finance-v2-pure-advance-t02.md)
and frozen product specification remain authoritative. Routed MSW and Chromium
keyboard/focus/axe tests establish consumer behavior; fixtures do not establish
real PostgreSQL effects or delivered P+C acceptance for
[Issue #28](https://github.com/core-console/back-end/issues/28).

## Finance v2 shared purchases (T03)

The current synchronized OpenAPI producer is
`f9d77ca7702c44c9dec8474a1857dc376b560c01`. The Advances route now offers
**Record shared purchase** for explicit owner and multiple Participant shares,
including zero owner share, funded from one active Asset or Liability Account.
Shares use the funding currency and must equal the total exactly; no amount is
rounded or assigned automatically. Preview shows total funding, Account balance
before/after, owner Expense, total receivables and each Participant's principal.
Asset funding decreases the Asset; Liability funding increases the Liability.
Only the owner share is personal Expense; Income is unchanged.

Shared commands use version `2` and one durable submission for the complete
group. Recovery preserves its original version, key, Ledger and body. T02's
pure Advance entry and retained version `1` commands remain supported. Both
versions require correlated evidence; stale rejection requires renewed preview
and deliberate confirmation. Confirmed sources show all Obligations and linked
Transactions, including archived Participant attribution. Resource refresh
failure never permits another financial submission for a confirmed action.

The [T03 producer note](https://github.com/core-console/back-end/blob/f9d77ca7702c44c9dec8474a1857dc376b560c01/docs/finance-v2-shared-advance-t03.md)
and frozen product specification own financial and contract semantics. Routed
MSW and production-preview Chromium checks cover this consumer, including
keyboard/focus, axe, pending, stale and response-loss recovery. They do not
establish PostgreSQL effects or delivered P+C acceptance for
[Issue #29](https://github.com/core-console/back-end/issues/29). Repayment,
forgiveness and correction workflows remain outside the T03 consumer.

## Finance v2 explicitly accepted surplus Income (T06)

The synchronized OpenAPI producer is
`1c849355f7c94ff6cb4b53fb5874cf8f8f392e0e`. The existing repayment form adds
**Accept surplus as Income**, an explicit version 3 Settlement with an exact
Income amount and one active Ledger Category or Uncategorized. Cash pays all
eligible debt first. The Income amount must equal the actual surplus; it is
never calculated into the draft or replaced automatically. Preview shows the
full receipt, receiving balance, retained principal Allocations, accepted Income,
Category and unchanged available credit. Confirmed detail identifies the Income
amount and links its Transaction for retained Category classification.

Version 1 principal repayments and version 2 retained-credit commands remain
supported. Income belongs to the owner; retained credit remains a Participant
Liability. This workflow never converts existing credit into Income or consumes
it automatically. Explicit Income acceptance can also classify the whole receipt
when no eligible debt exists, without inventing an Obligation.

The existing journal retains version 3 owner, Ledger, key, token and complete
body for lookup or explicit retry, including the original Income amount and
Category. Failed source refresh does not change a confirmed outcome. A stale
rejection removes confirmation and requires a new preview. If current state
prevents regeneration, the original draft stays visible until the user explicitly
adjusts it, previews again and deliberately confirms a new action.

The [T06 producer note](https://github.com/core-console/back-end/blob/1c849355f7c94ff6cb4b53fb5874cf8f8f392e0e/docs/finance-v2-accepted-surplus-t06.md)
and [immutable specification](https://github.com/core-console/back-end/blob/e206bdd5af48a3f6b3b9b525c27fa6178220bdc7/docs/finance-v2-personal-receivable-settlement-spec.md)
own financial and wire semantics. Routed fixtures and production-preview
Chromium checks cover consumer behavior. Consumer delivery, real guarded
PostgreSQL P+C acceptance and authorized [Issue #32](https://github.com/core-console/back-end/issues/32)
closure remain separate steps. Selected subsets, forgiveness, Corrections and
credit application/return remain later slices.

## Finance v2 retained surplus and receipt-backed credit (T05)

The synchronized backend producer is
`ed11927a3baccbbef7734911af492f4f474c4ea0`. The existing repayment form offers
an explicit retain-credit choice. Its version 2 Settlement applies cash to all
eligible debt first and retains the remainder as a receipt-backed Liability,
including when no eligible debt exists. The default version 1 repayment remains
available. Preview shows the full receiving Account effect, debt Allocations,
retained credit and available credit before/after; neither path applies existing
credit or creates Income or Expense.

Participant repayment inspection shows gross receivables, available credits and
net exposure separately per currency, alongside Obligations, chronological cash
history and credit origins in immutable receipt confirmation order. Origins link
to their actual Settlement and Internal Transfer and identify the receiving and
Liability Accounts. Creating another Advance does not consume credit.

Version 2 uses the existing durable submission journal, preserving the original
owner, Ledger, version, key and body for lookup/retry. A missing lookup, uncertain
response or failed source refresh cannot authorize a second receipt. Correlated
stale rejection requires a refreshed preview and deliberate new confirmation.
Existing version 1 Settlement and T01–T04 recovery remain supported.

The [T05 producer note](https://github.com/core-console/back-end/blob/ed11927a3baccbbef7734911af492f4f474c4ea0/docs/finance-v2-retained-credit-t05.md)
and [immutable product specification](https://github.com/core-console/back-end/blob/e206bdd5af48a3f6b3b9b525c27fa6178220bdc7/docs/finance-v2-personal-receivable-settlement-spec.md)
own the financial meanings. Accepting surplus as Income, applying or returning
credit, selected-Obligation settlement, forgiveness and Corrections remain
separate slices. Managed-credit reconciliation is enforced by the backend;
ordinary Account edits, manual entries, Adjustments and linked Transaction
changes cannot independently change its tracked financial position.

Frontend fixture and production-preview tests establish consumer behavior only.
Real guarded PostgreSQL and matching delivered producer/consumer acceptance,
consumer delivery and authorized [Issue #31](https://github.com/core-console/back-end/issues/31)
closure remain separate steps.

## Finance v2 accumulated and partial cash repayments (T04)

The current synchronized OpenAPI producer is
`515441bae9f2e1301563a0e41e5db6ed2ef57962`.
`/finance/repayments?ledger=<UUID>` records a Participant's accumulated or
partial cash repayment into an active Asset or Liability Account. Archived
Participants may repay existing debt. Currency follows the receiving Account;
the backend selects all eligible outstanding Obligations dated on or before the
receipt date and returns deterministic oldest-Advance-date-first Allocations.
The UI preserves the returned order, including same-date ties, and shows each
cash amount and remaining debt alongside receiving balance and eligible debt
before/after. Receiving principal increases an Asset or reduces a Liability,
without Income or Expense. An ordinary card bill transfer does not settle
Participant debt.

Confirmation extends the existing durable submission journal with version `1`
`createFinanceSettlement`. Unknown results retain the original owner, Ledger,
key, version and body; explicit retry sends that command unchanged. Lookup is
read-only. Correlated stale-preview rejection preserves draft intent, removes
confirmation and requires refreshed consequences plus a deliberate new action.
Resource refresh failure leaves the terminal receipt confirmed. Recovery links
to the retained Settlement with `participant_id` and `settlement_id`; cash
history and current Obligation composition are shown separately from historical
`remainingAfter`. Later backdated Advances never cause client-side replay.

Browser submission coordination uses Web Locks in a secure context. Each
API/user/submission key has its own claim, acquired before journal preparation
and held through the live attempt and durable resolution. Automatic or explicit
outcome checks skip an active original attempt without queuing; unrelated commands remain
executable. After the original attempt ends uncertain, outcome checks and
explicit original-key retries may overlap under shared claims, retaining
backend idempotency. Claims end when the attempt finishes or the browser
releases the page (including closure/crash); uncertain commands remain in
IndexedDB for later recovery. BroadcastChannel notifications are optional hints.
If Web Locks is unavailable, preparation and network recovery stop with guidance
to use a supported browser/secure context while retaining site data.

The [T04 producer note](https://github.com/core-console/back-end/blob/515441bae9f2e1301563a0e41e5db6ed2ef57962/docs/finance-v2-cash-repayments-t04.md),
[Issue #30](https://github.com/core-console/back-end/issues/30), and immutable
product specification own the boundary. Selected Obligation subsets, excess
dispositions, forgiveness, credit and Corrections belong to later slices.
Routed MSW and production-preview Chromium tests cover frontend behavior,
keyboard/focus and axe. They do not establish real PostgreSQL effects or
delivered P+C acceptance. T04 still requires separately authorized consumer
delivery and matching real producer/consumer verification before Issue closure.

## Finance v2 standalone forgiveness (T08)

The synchronized delivered producer is
`3bd3205e25636e21ebd3ae20dab1b083e5fb48fd`. **Record forgiveness** on the
Repayments route explicitly selects existing debt, currency, event date, exact
amount and reason. Preview shows reduced receivables, matching Expense and typed
forgiveness Allocations. It creates no cash receipt or payment and leaves Income
and available credit unchanged. Confirmed detail retains selection, reason,
historical composition and linked Expenses. Settlement history distinguishes
forgiveness from cash repayment, including archived Participant attribution.

Version 5 reuses durable original-command recovery and owner isolation; versions
1–4 and T01–T07 remain supported. See the [T08 integration note](docs/finance-v2-standalone-forgiveness-t08.md)
for contract, recovery and validation boundaries. Consumer delivery, exact-SHA CI,
real delivered P+C acceptance and authorized backend [Issue #33](https://github.com/core-console/back-end/issues/33)
closure remain separate steps.

## Finance v2 combined repayment and forgiveness (T09)

The synchronized delivered producer is
`4dcadec11d2ec679bb17fe189cdec51a1339b63e`. **Record combined Settlement**
on Repayments explicitly selects debt and records actual cash plus a positive
forgiveness amount and reason. Preview shows receiving balances, reduced debt,
matching forgiveness Expense and ordered cash-first, then forgiveness Allocations.
Cash-paid and forgiven remain separate in history and current debt composition.
Income and available credit remain unchanged; remaining shortfalls stay outstanding.

Version 6 uses the existing durable owner-isolated submission journal. Uncertain
outcomes retain the original complete command for lookup or explicit retry;
stale rejection requires refreshed preview and deliberate new confirmation.
Versions 1–5 and T01–T08 remain supported. See the
[T09 integration note](docs/finance-v2-combined-settlement-t09.md) for contract,
recovery and verification boundaries. Consumer delivery, exact-C CI, real delivered
P+C acceptance and separately authorized [Issue #34](https://github.com/core-console/back-end/issues/34)
closure remain separate dependencies. T10 and Corrections remain outside this slice.
