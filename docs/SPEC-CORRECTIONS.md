# Spec corrections

Deltas applied against `docs/SPEC.md` during construction. Each entry names a spec section, states the discrepancy with verifiable reality, and records the resolution the codebase ships.

## §1. Columnar shard count: `shards = cores`, not `shards = 16`

**Spec §2.5** says "Shards = 16 by default" and **§12.1** lists "Columnar shard | … | 16 |" for the 32-core reference box. **Spec §12.2** says `columnar_shards = C` (logical cores). These contradict above the 16-core case.

**Resolution (user steer, 2026-05-16):** shards = number of logical cores, dynamic per host. The 4/8/16/32/64-core hosts all scale appropriately. `packages/topology` is the single source of truth and every subsystem reads its shard counts from there. §2.5 of the spec should be treated as superseded by §12.2.

## §2. Effect v4 beta repository name

**Spec §0** says: "Effect v4 beta from `Effect-TS/effect-smol`."

**Verification (Perplexity, 2026-05-16):** Effect v4 beta is released from the main `Effect-TS/effect` repository. `Effect-TS/effect-smol` is the experimental work that v4 was built on; it is not where the production v4 beta is published. Install via `effect@beta` from the standard `effect` npm package.

**Resolution:** Add `effect@beta` (or newer beta) per package that needs it. Imports use `effect`, `effect/unstable/http`, `effect/unstable/schema`, `effect/unstable/sql`, `effect/unstable/rpc`, etc., per the documented v4 import surface.

## §3. Effect v4 minimum bundle size

**Spec §0** says: "~6.3 KB minimum bundle."

**Verification:** The Effect team's v4 beta announcement reports a minimal Effect + Stream + Schema program at **~20 KB**, down from ~70 KB in v3. The 6.3 KB number does not match official release notes.

**Resolution:** Treat ~20 KB as the realistic floor for our bundle budgets. Adjust §0 mental model accordingly.

## §4. TypeScript 7 native preview declaration emit

**Spec §14** says: "The TypeScript 7 native preview cannot emit `.d.ts` yet. For now we ship type checking via `tsgo` and declaration emit via `tsc`."

**Verification:** `tsgo` does emit `.d.ts`. It also supports `--build` and project references. The community pattern of using `tsc -b` for emit alongside `tsgo --noEmit` for the type-check gate is conservative practice while the preview matures, not a hard limitation. The genuine still-missing piece is a stable programmatic API (targeted for 7.1).

**Resolution:** We do not ship emitted `.js` or `.d.ts` at all — Bun runs TypeScript directly and downstream consumers do the same. `tsgo --noEmit` is the sole type-check gate. The dual-binary workaround is unnecessary for us.

## §5. §12.1 process inventory vs §12.2 formulas

**Spec §12.1** gives concrete counts for a 32-core reference box that diverge from `§12.2` formulas applied to C=32:

| Process kind        | §12.1 (32-core) | §12.2 formula at C=32 |
|---------------------|----------------:|----------------------:|
| Columnar shard      | 16              | 32                    |
| Compactor           | 8               | 8                     |
| Total CPU-bound     | ~75             | ~91                   |

**Resolution:** §12.2 formulas are authoritative. `packages/topology` implements §12.2 only. The §12.1 column "Count (32-core)" should be regenerated from the formulas; this codebase produces the correct counts at runtime via `summarize(computeTopology({ cores }))`.

---

Add a new entry every time the codebase diverges from `docs/SPEC.md`. Do not silently fix; always document.