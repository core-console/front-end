# Repository modernization baseline

Reviewed on October 2, 2026. Version targets below describe this candidate;
recheck publisher metadata and compatibility before future upgrades.

## Toolchain ownership

- `.node-version` pins Node.js 24.21.0 for local development and both CI jobs.
  Node 24 remains the active LTS line; Node 26 is still Current.
- `package.json` owns the exact pnpm 12.8.1 pin through `packageManager`.
  CI reads that field without a second version declaration.
- `engines.node` records the supported Node 24 range. `pnpm toolchain:check`
  verifies the actual runtime and pnpm against their authoritative pins, and
  runs first in the complete validation pipeline.
- pnpm 12 keeps lockfile format version 9 and records the managed pnpm release
  alongside the application graph. Those generated resolutions follow the
  manifest pin. The reviewed `allowBuilds` policy remains in place; dependency
  scripts remain denied except for esbuild.

## Dependency refresh and cleanup

Vitest is upgraded to 5.0.3, Orval to 8.39.0, Redocly CLI to 2.57.0,
Prettier to 3.9.9, and Node 24 typings to 24.19.1. Transitive dependencies
are refreshed within their parents' declared ranges, including the patched
`qs` 6.16.0 used by development tooling. No new override is needed for `qs`.

Application libraries were already on their current stable releases. Node
typings stay on the runtime's major version rather than following Node 26.

Vite's official `resolve.tsconfigPaths` replaces the duplicated `@/` alias
declaration; `tsconfig.app.json` now owns that mapping for the compiler,
build, and Vitest. Vitest 5's `.vitest` artifact directory is ignored. The
obsolete Lucide release-age exception is removed; the reviewed new Node
typings release has its own version-specific age exception.

## Compatibility decisions and removal criteria

| Boundary                                      | Decision and condition for revisiting                                                                                                                                                                                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MSW 2.15.0                                    | Retain: Vitest 5.0.3's `@vitest/mocker` still declares the optional peer `msw: ^2.4.9`. Upgrade to MSW 3 when the installed tooling officially accepts it, then migrate `onUnhandledRequest` to `onUnhandledFrame`, refresh the worker explicitly, and validate browser and Node interception. |
| TypeScript aliases                            | Retain TS7 for the CLI and TS6 for the programming API. Current generator/tooling packages still consume the TS6 API; remove the compatibility alias only when their published versions support the TS7 API and generation/type-checking pass.                                                 |
| Orval Fetch patch                             | Carry the case-insensitive header merge fix to 8.39.0. Its unpatched generator still spreads case-sensitive header keys. Retire the patch when upstream handles equivalent `Headers`, tuples, and records correctly and the request-header regressions pass.                                   |
| Scalar Undici override                        | Retain the narrow `@scalar/json-magic@0.15.3>undici` 7.29.1 override because the latest Scalar package still pins 7.29.0. Remove when its published parent resolves a patched compatible version.                                                                                              |
| Required-only `anyOf` transformer             | Retain the backend-contract compatibility transformation. Orval 8.39's unrelated `anyOf` fixes do not establish equivalent handling of these schemas. Retire only after untransformed generation passes the existing contract regressions.                                                     |
| Generated response parsing and mock overrides | Retain generated Zod parsing and deterministic Money/currency/month fixtures. No equivalent generator change has been established for the complete contract.                                                                                                                                   |
| Test isolation and production guards          | Retain the two-worker limit, explicit test cleanup, strict unhandled requests, production worker removal, and artifact inspection. They enforce observed reliability and build requirements.                                                                                                   |
| Finance lifecycle and focus mechanisms        | Retain cache freshness authority, replacement ownership, terminal deletion, focus handling, and Unicode ordering. These implement application behavior and accessibility.                                                                                                                      |

The synchronized backend OpenAPI snapshot and generated Fetch, Query, Zod,
MSW, and Faker files remain unchanged after regeneration with the updated
generator and formatter. Normal development and builds still use checked-in
generated files; the drift gate generates only into a temporary directory.

## Verification gates

Run the pinned toolchain's frozen install, `pnpm peers check`, `pnpm dedupe
--check`, and `pnpm audit` to check installation and graph consistency.
`pnpm check` covers toolchain identity, API lint and deterministic generation,
formatting, linting, type-checking, all unit/integration tests, and production
build/artifact validation. `pnpm e2e` independently builds and exercises the
production preview, including keyboard/focus behavior and axe checks.

For this candidate, the frozen install, peer check, deduplication check, and
audit passed with no reported vulnerabilities. `pnpm check` passed all 580
tests across 16 files and validated the production artifact. The complete
Chromium E2E suite passed all 28 tests with CI settings. Existing OpenAPI and
Finance lint warnings remain; application and backend-contract source are
unchanged.

## Official references

- [Node release status](https://nodejs.org/en/about/previous-releases)
- [pnpm 12 release and migration changes](https://github.com/pnpm/pnpm/releases/tag/v12.0.0)
- [Vitest 5 migration guide](https://vitest.dev/guide/migration/)
- [Vitest 5.0.3 mocker peer declaration](https://github.com/vitest-dev/vitest/blob/v5.0.3/packages/mocker/package.json)
- [MSW 3 migration changes](https://github.com/mswjs/msw/releases/tag/v3.0.0)
- [Orval 8.39.0 release](https://github.com/orval-labs/orval/releases/tag/v8.39.0)
- [Vite TypeScript path resolution](https://vite.dev/config/shared-options.html#resolve-tsconfigpaths)
- [qs 6.16.0 security fixes](https://github.com/ljharb/qs/releases/tag/v6.16.0)
