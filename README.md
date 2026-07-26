# front-end

Minimal React application baseline built with Vite, TypeScript, Tailwind CSS, and shadcn/ui. React Router manages navigation and route errors, TanStack Query manages server state, and Zod validates external data at runtime.

## Requirements

- Node.js 24.18.0
- pnpm 11.14.0

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
linting, TypeScript project references, Vitest, and the production bundle.
Each check remains available as an independent script for focused local work.
`pnpm build` only creates the Vite production bundle; run `pnpm typecheck`
separately when a standalone type check is needed.

The backend-owned OpenAPI document is checked in at `openapi/openapi.json` and
drives the generated Fetch, TanStack Query, Zod, MSW, and Faker files under
`src/api/generated/`. When the backend contract changes, run `pnpm api:update`
to sync the sibling `../back-end/openapi/openapi.json` snapshot, lint it, and
regenerate the client. Pass a different source when needed with
`pnpm api:sync -- <path-to-openapi.json>`, then run `pnpm api:lint` and
`pnpm api:generate`. `pnpm api:check` verifies the checked-in snapshot and
generated output without requiring the backend repository or modifying files.

`pnpm e2e` builds the application and runs Chromium smoke and axe checks against
a real Vite production preview. Authentication remains intentionally deferred
until its integration requirements are designed.

The project currently stays on TypeScript 6.0.3 while tools that import the
TypeScript programming API complete their TypeScript 7 migration.
