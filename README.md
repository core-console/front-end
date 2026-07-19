# front-end

Minimal React application baseline built with Vite, TypeScript, Tailwind CSS, and shadcn/ui. React Router manages navigation and route errors, TanStack Query manages server state, and Zod validates external data at runtime.

## Requirements

- Node.js 24.16.0
- pnpm 11.14.0

## Getting Started

```sh
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm dev
```

`VITE_API_BASE_URL` configures the browser-facing API base URL and defaults to `/api` for a future same-origin gateway route. All `VITE_*` values are included in the browser build and must never contain secrets.

## Validation

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
```

Run the complete validation pipeline with:

```sh
pnpm check
```

OpenAPI client generation and authentication are not connected yet; both will be designed in later stages once their integration requirements are known.

The project currently stays on TypeScript 6.0.3. TypeScript 7 and Oxlint type-aware linting will be evaluated together as a separate upgrade.
