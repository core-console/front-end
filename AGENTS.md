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

## Commit & Pull Request Guidelines

The repository has no commit history yet, so no local convention is established. Use short, imperative subjects; Conventional Commit prefixes such as `feat:`, `fix:`, and `test:` are encouraged. Pull requests should explain the change and verification performed, link relevant issues, and include before/after screenshots for visible UI changes. Keep each PR focused and ensure `pnpm check` passes.

## Configuration & Security

Do not commit secrets. Environment files are ignored; document required variables in a tracked `.env.example` or `.env.*.example` using placeholder values.
