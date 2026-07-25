# Repository Guidelines

## Project Structure & Module Organization

This repository is a Vite-powered React 19 and TypeScript application. Application code lives in `src/`: `main.tsx` bootstraps the application, `app/` owns application composition such as providers, the Query client, and the router, `routes/` contains route modules and route-level UI, `components/ui/` contains checked-in shadcn/ui primitives, and `lib/` holds shared utilities such as `cn()`. Keep tests beside the code they cover using `*.test.tsx`; shared Vitest setup belongs in `src/test/`. Put unprocessed static files in `public/`. Treat `dist/` as generated output and do not commit it.

## Build, Test, and Development Commands

Use the exact Node.js version declared in `.node-version` for local development and CI. Treat the `engines.node` range in `package.json` as the supported Node.js range. Use the pnpm version declared by the `packageManager` field in `package.json`.

Dependency lifecycle scripts are denied by default. Approve only reviewed packages that require installation scripts, one package at a time, under `allowBuilds` in `pnpm-workspace.yaml`. Never enable all dependency build scripts as a workaround.

- `pnpm install --frozen-lockfile` installs the exact locked dependency graph.
- `pnpm dev` starts the Vite development server.
- `pnpm test` runs Vitest in watch mode; `pnpm test:run` runs once for CI.
- `pnpm lint`, `pnpm typecheck`, and `pnpm format:check` run Oxlint, TypeScript, and Prettier checks independently.
- `pnpm build` creates the Vite production bundle in `dist/`; it does not run TypeScript separately.
- `pnpm check` runs API lint and drift checks, formatting, linting, type-checking, Vitest, and the production build; use it before submitting changes.
- `pnpm e2e:install` explicitly installs Chromium; `pnpm e2e` runs the Playwright smoke suite against a production build served by Vite preview.

## Coding Style & Naming Conventions

Follow `.editorconfig`: UTF-8, LF endings, final newlines, and two-space indentation. Prettier is authoritative and automatically sorts Tailwind classes. Use PascalCase for React components, camelCase for functions and variables, and lowercase filenames for reusable UI primitives (for example, `button.tsx`). Prefer the `@/` alias for imports within `src/`.

For shadcn/ui work, reuse existing primitives before adding custom markup. Add registry components with `pnpm dlx shadcn@latest add <component>`, then review the generated source. Prefer semantic theme tokens, `gap-*` spacing, and `cn()` for conditional classes.

## Testing Guidelines

Tests use Vitest, jsdom, React Testing Library, and `user-event`. Write behavior-focused tests that query accessible roles and names. Name files `*.test.tsx` and colocate them with the component. There is no enforced coverage threshold; add tests for new behavior and regressions.

Playwright tests live in `e2e/` and run independently with `pnpm e2e` against the production preview. Use accessible locators and web-first assertions; unexpected `pageerror` or `console.error` must fail the test, and never use fixed sleeps for stability.

Playwright page smoke tests should include applicable automated axe WCAG A/AA checks. Do not hide real violations by disabling rules or excluding elements. Passing axe does not establish full WCAG conformance; keyboard interaction, focus order, and screen reader experience still require manual or interactive testing.

## Application Foundations

Read this section before implementing an application story. React Router owns URLs, page layouts, navigation, and route errors. TanStack Query is the only cache for server state; never copy Query-managed server data into a store or Context. Zod validates untrusted external data, including environment values, API responses, URL parameters, browser storage, and WebSocket messages. `VITE_API_BASE_URL` defaults to `/api` for a future same-origin APISIX route. Keycloak and APISIX authentication will be designed separately.

The versioned `openapi/openapi.yaml` snapshot is the authoritative API contract, and the backend must implement it. Change the contract first, run `pnpm api:lint`, then run `pnpm api:generate` and commit the generated result. Everything under `src/api/generated/` is owned by Orval and must never be edited by hand or mixed with handwritten code. Generated Fetch clients use the validated `VITE_API_BASE_URL` at runtime; OpenAPI paths must not repeat the `/api` server prefix. Generated Zod schemas are the runtime-validation boundary; until Orval's automatic Fetch response validation is enabled and passes the repository's strict TypeScript checks, callers must parse untrusted response bodies with the generated schema before application use. Browser API mocking is development-only and must be explicitly enabled with `VITE_ENABLE_API_MOCKING=true`; Vitest reuses the generated handlers and rejects unhandled requests. The MSW install script remains denied; after upgrading MSW, refresh the tracked worker explicitly with `pnpm exec msw init public --save`. Normal development, tests, and builds must remain offline and must not regenerate API code implicitly. Use `pnpm api:check` to verify the contract and generated output are synchronized.

The production QueryClient intentionally retains TanStack Query's official defaults for `staleTime`, `retry`, `refetchOnWindowFocus`, `gcTime`, and `networkMode`; this is not an omission. Before changing Query behavior:

1. State the observed problem.
2. Prefer a local override on the affected Query.
3. Consider a global override only after multiple real features require the same behavior.
4. Update this section whenever a global default changes.
5. Add a short nearby comment only for a non-obvious decision likely to be misunderstood later.

The following decisions are intentionally deferred, not permanently prohibited:

- Design Keycloak after Router, Query, and the generated API client are stable.
- Configure APISIX's same-origin `/api` route during deployment and authentication work.
- Add Zustand only when real cross-route client state cannot be managed by component state, the URL, forms, or Query.
- Add Query persistence only for an explicit offline or cross-refresh cache requirement.
- Combine route loaders with `queryClient.ensureQueryData` when a real screen must prefetch before entry; do not create a second data cache.
- Configure deployment so unknown frontend paths fall back to `index.html` when the SPA is deployed.

Do not use temporary workarounds to cross these responsibility boundaries. New abstractions must solve current repetition or complexity, not hypothetical requirements. Keep foundations small, type-safe, testable, and easy to remove.

## Commit & Pull Request Guidelines

Commit messages must follow the Conventional Commits rules defined by the user-level `AGENTS.md`; do not maintain a separate repository-specific message format here. Pull requests should explain the change and verification performed, link relevant issues, and include before/after screenshots for visible UI changes. Keep each PR focused and ensure `pnpm check` passes.

## Configuration & Security

Do not commit secrets. Environment files are ignored; document required variables in a tracked `.env.example` or `.env.*.example` using placeholder values.
