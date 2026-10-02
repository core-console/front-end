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
`openapi/openapi.json`. Its 23 operations are available through the generated
Fetch clients, TanStack Query hooks, Zod schemas, MSW handlers, and Faker
fixtures under `src/api/generated/`.

Synchronize future committed backend contract changes through the existing
`pnpm api:update` workflow described above. Do not hand-edit the snapshot or
generated files, or create a parallel handwritten Finance client or invented
contract. Finance product routes and UI remain separate implementation work.

For Finance product and design authority, start with the
[approved interaction specification](docs/finance-v1-frontend-interaction-spec.md),
the [visual-reference index](docs/design/finance-v1/README.md), and the
[Finance visual authority](DESIGN.md#finance-v1-authority).
