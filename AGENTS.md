# Repository Guidelines

## Project Structure & Module Organization

This repository is a Vite-powered React 19 and TypeScript application. Application code lives in `src/`: `main.tsx` bootstraps the app, `App.tsx` is the current root component, `components/ui/` contains checked-in shadcn/ui primitives, and `lib/` holds shared utilities such as `cn()`. Keep tests beside the code they cover using `*.test.tsx`; shared Vitest setup belongs in `src/test/`. Put unprocessed static files in `public/`. Treat `dist/` as generated output and do not commit it.

## Build, Test, and Development Commands

Use Node 24.16.x and pnpm 11.14.x, as declared by `.node-version` and `package.json`.

- `pnpm install --frozen-lockfile` installs the exact locked dependency graph.
- `pnpm dev` starts the Vite development server.
- `pnpm test` runs Vitest in watch mode; `pnpm test:run` runs once for CI.
- `pnpm lint`, `pnpm typecheck`, and `pnpm format:check` run Oxlint, TypeScript, and Prettier checks independently.
- `pnpm build` type-checks and creates the production bundle in `dist/`.
- `pnpm check` runs the complete validation pipeline; use it before submitting changes.

## Coding Style & Naming Conventions

Follow `.editorconfig`: UTF-8, LF endings, final newlines, and two-space indentation. Prettier is authoritative and automatically sorts Tailwind classes. Use PascalCase for React components, camelCase for functions and variables, and lowercase filenames for reusable UI primitives (for example, `button.tsx`). Prefer the `@/` alias for imports within `src/`.

For shadcn/ui work, reuse existing primitives before adding custom markup. Add registry components with `pnpm dlx shadcn@latest add <component>`, then review the generated source. Prefer semantic theme tokens, `gap-*` spacing, and `cn()` for conditional classes.

## Testing Guidelines

Tests use Vitest, jsdom, React Testing Library, and `user-event`. Write behavior-focused tests that query accessible roles and names. Name files `*.test.tsx` and colocate them with the component. There is no enforced coverage threshold; add tests for new behavior and regressions.

## Application Foundations

Read this section before implementing an application story. React Router owns URLs, page layouts, navigation, and route errors. TanStack Query is the only cache for server state; never copy Query-managed server data into a store or Context. Zod validates untrusted external data, including environment values and, when introduced, API responses, URL parameters, browser storage, and WebSocket messages. `VITE_API_BASE_URL` defaults to `/api` for a future same-origin APISIX route. The backend will provide Swagger/OpenAPI; generating an API client from it is a separate future stage. Keycloak and APISIX authentication will also be designed separately.

The production QueryClient intentionally retains TanStack Query's official defaults for `staleTime`, `retry`, `refetchOnWindowFocus`, `gcTime`, and `networkMode`; this is not an omission. Before changing Query behavior:

1. State the observed problem.
2. Prefer a local override on the affected Query.
3. Consider a global override only after multiple real features require the same behavior.
4. Update this section whenever a global default changes.
5. Add a short nearby comment only for a non-obvious decision likely to be misunderstood later.

The following decisions are intentionally deferred, not permanently prohibited:

- Evaluate Orval or another OpenAPI generator after the OpenAPI URL, tag grouping, generated directory, and authentication injection are known.
- Design Keycloak after Router, Query, and the generated API client are stable.
- Configure APISIX's same-origin `/api` route during deployment and authentication work.
- Add Zustand only when real cross-route client state cannot be managed by component state, the URL, forms, or Query.
- Add Query persistence only for an explicit offline or cross-refresh cache requirement.
- Combine route loaders with `queryClient.ensureQueryData` when a real screen must prefetch before entry; do not create a second data cache.
- Configure deployment so unknown frontend paths fall back to `index.html` when the SPA is deployed.

Do not use temporary workarounds to cross these responsibility boundaries. New abstractions must solve current repetition or complexity, not hypothetical requirements. Keep foundations small, type-safe, testable, and easy to remove.

## Commit & Pull Request Guidelines

The repository has no commit history yet, so no local convention is established. Use short, imperative subjects; Conventional Commit prefixes such as `feat:`, `fix:`, and `test:` are encouraged. Pull requests should explain the change and verification performed, link relevant issues, and include before/after screenshots for visible UI changes. Keep each PR focused and ensure `pnpm check` passes.

## Configuration & Security

Do not commit secrets. Environment files are ignored; document required variables in a tracked `.env.example` or `.env.*.example` using placeholder values.
