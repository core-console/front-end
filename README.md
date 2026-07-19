# front-end

Minimal React application baseline built with Vite, TypeScript, Tailwind CSS, and shadcn/ui.

## Requirements

- Node.js 24.16.0
- pnpm 11.14.0

## Getting Started

```sh
pnpm install --frozen-lockfile
pnpm dev
```

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

The project currently stays on TypeScript 6.0.3. TypeScript 7 and Oxlint type-aware linting will be evaluated together as a separate upgrade.
