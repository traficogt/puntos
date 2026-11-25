# TypeScript Adoption (Phased)

The codebase is JavaScript-first and type-checked with `tsc` over JSDoc (`allowJs` +
`checkJs`). Runtime is unchanged: there is no build step for the server. Verified against the
tree on 2026-11-23; see [ARCHITECTURE.md](ARCHITECTURE.md) section 8 for the testing map.

## Configuration as it exists

- `tsconfig.json` is the configuration `tsc` uses. `strict` is **off**, but these strictness
  flags are on with zero errors: `strictFunctionTypes`, `strictBindCallApply`,
  `noImplicitThis`, `alwaysStrict`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`,
  `noImplicitReturns` and `noImplicitOverride` (`919d3dc`). It includes `src/**`, `tests/**` and
  an explicit allowlist of browser files under `public/` (`admin.js`, `customer/*`, `staff/*`,
  `super/*`, `session-epoch.js`, `types.ts`); `paths` maps
  `/lib.js` and `/idb.js` to `src/types/public-*.d.ts`.
- `tsconfig.strict.json` extends the base configuration and adds `strictNullChecks` and
  `strictPropertyInitialization`; it excludes `tests/**` (`ce8dac0`).
- `jsconfig.json` at the repository root is a leftover from the first phase. No script reads
  it and `tsc` prefers `tsconfig.json` when both exist; it can be removed.
- The merchant app (`web/merchant`) has its own `tsconfig.json` and `tsconfig.strict.json`
  (`npm --prefix web/merchant run typecheck` runs both).

## Commands

| Command | Configuration | State |
| --- | --- | --- |
| `npm run typecheck` | `tsconfig.json` | CI gate, zero errors |
| `npm run typecheck:strict` | `tsconfig.strict.json` | application layer clean: `src/app/services`, `src/app/routes`, `src/app/db`, `src/app/repositories` (364 errors fixed in `ce8dac0`); about 372 errors remain in the infrastructure half (`src/utils`, `src/middleware`, `src/config`, `src/scripts`) and the allowlisted browser files, so the base script stays non-strict until those are clean |
| `npm run typecheck:focused` | `tsconfig.json` | alias of `typecheck`; the earlier per-file list is gone |

Catch blocks narrow the caught value through `src/utils/error-shape.js` (`errorMessage`,
`errorCode`, `errorStatus`, `asError`) or `instanceof` checks in browser modules; no `any`
casts and no `ts-ignore` were used for the flag rollout.

## Phases

1. **Done.** Editor and CI static checks for `.js` files via `tsconfig.json`; typedefs for the
   request context (`req.staff`, `req.customerAuth`, `req.superAdmin`), DTOs in
   `src/types/http-dto.js` and repository return shapes.
2. **Done.** Strictness flags listed above enabled at zero errors; `strictNullChecks` clean for
   the application layer under `tsconfig.strict.json`.
3. **Next.** Make the infrastructure half and the browser allowlist `strictNullChecks`-clean,
   then move `strictNullChecks` + `strictPropertyInitialization` into `tsconfig.json` and retire
   `tsconfig.strict.json`.
4. **Open.** `noImplicitAny` (about 13 000 errors measured on the 2026-11-23 tree) and any
   conversion of modules to `.ts`. Neither is scheduled; `public/` stays JavaScript.
