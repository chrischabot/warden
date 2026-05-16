# TypeScript native-preview migration log

Reference for the TS-6 → TS-7 (`tsgo`) migration. Updated as the preview matures and our usage broadens.

## Current state (2026-05-16)

- **Type-check**: `bunx tsgo --noEmit` in CI and locally. ~10× faster than `tsc --noEmit`.
- **Emit**: not used. Bun runs TypeScript directly; we do not ship compiled `.js` or `.d.ts` for the replica's internal packages. The spec §14 concern about `tsgo` lacking declaration emit is moot for us; see SPEC-CORRECTIONS.md §4 for the broader correction.
- **Programmatic API**: not depended on. We do not call into the TypeScript compiler API from any tool in this repo. When we do (build-time plugins for Vite/webpack/esbuild in Ring 3's SDK plugins), we will use the TS 6 API explicitly via the `typescript@npm:@typescript/typescript6` alias until the TS 7 API stabilises at 7.1.

## Cutover criteria for dropping `typescript@6`

We drop the `typescript` devDependency from the root entirely when all of these hold:

1. `tsgo` reaches stable programmatic API parity (TS 7.1 or later).
2. Any SDK build-time plugin (Ring 3) is verified working under `tsgo`'s API.
3. Three months of CI without `tsgo` reporting type-checks that pass on `tsc` but fail on `tsgo` (or vice versa).

## Verification commands

```bash
# Type-check the entire monorepo with tsgo.
bunx tsgo --noEmit

# Compare against tsc to spot divergences during the migration window.
bunx tsc --noEmit
```

If the two diverge on a real check, file an issue against `microsoft/typescript-go` with a minimal repro.