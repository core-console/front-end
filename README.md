# front-end

Minimal React application baseline built with Vite, TypeScript, Tailwind CSS, and shadcn/ui. React Router manages navigation and route errors, TanStack Query manages server state, and Zod validates external data at runtime.

## Requirements

- Use the exact Node.js runtime declared in `.node-version`.
- Use the pnpm release declared by `packageManager` in `package.json`.

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

It checks the OpenAPI contract and generated client for drift, formatting,
linting, TypeScript project references, Vitest, the production bundle, and the
production artifact structure and known development-only markers. Each check
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

## Finance v1 integration status

The Finance backend implementation and its backend-owned OpenAPI contract
exist. The authoritative backend contract currently includes the Finance v1
operations, but this frontend repository's synchronized
`openapi/openapi.json` snapshot has not yet been updated to include
`/finance/...` paths. Consequently, the checked-in generated artifacts under
`src/api/generated/` do not yet provide Finance clients, Query hooks, schemas,
handlers, or fixtures.

Future Finance integration must first synchronize the committed backend
contract through the existing `pnpm api:update` workflow described above. It
must not hand-edit the snapshot or generated files, or create a parallel
handwritten Finance client or invented contract.

For Finance product and design authority, start with the
[approved interaction specification](docs/finance-v1-frontend-interaction-spec.md),
the [visual-reference index](docs/design/finance-v1/README.md), and the
[Finance visual authority](DESIGN.md#finance-v1-authority).
