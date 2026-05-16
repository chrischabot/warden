# Contributing

How to work on Warden itself.

## Dev setup

```bash
git clone https://github.com/chrischabot/warden.git
cd warden
bun install --frozen-lockfile
bun run validate
```

`validate` runs lint + type-check + ~1,000 unit tests. A clean run on a 4-core laptop finishes in under a minute.

For SDK-specific dev, install the relevant toolchain:

```bash
cd sdks/python && pip install -e . && python3 -m pytest -q
cd sdks/rust && cargo test
cd sdks/go && go test ./...
cd sdks/swift && swift test
```

## Commands

```bash
bun run lint                 # biome check .
bun run lint:fix             # biome check --write .
bun run format               # biome format --write .
bun run typecheck            # tsgo --noEmit
bun run test                 # bun test --parallel --isolate
bun run test:shard 1/4       # CI shard 1 of 4
bun run validate             # all of the above
```

The web app:

```bash
cd apps/web
bun run dev                  # Vite dev server
bun run build                # production bundle into dist/
bun run preview              # preview the prod bundle
bun run e2e:ui               # Playwright journey suite
```

## Toolchain

| Tool                                | Why                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Bun 1.3.14+**                     | Runtime, package manager, test runner, bundler in the web app.                                 |
| **`tsgo` (TypeScript 7 beta)**      | The CI type-check gate. ~10× faster than `tsc`. We do not emit `.js` or `.d.ts`.               |
| **Biome v2**                        | Lint + format. No ESLint, no Prettier.                                                         |
| **Effect v4 beta**                  | Structured concurrency and error handling for hot paths. From `effect` (not `effect-smol`).    |
| **React 19.2 + Tailwind v4.3 + Vite 6** | Web app.                                                                                |
| **fast-check**                       | Property-based testing where it earns its keep.                                                |
| **Playwright**                      | UI journey tests.                                                                              |

Pin Bun in `engines.bun`; don't auto-upgrade in CI.

## Repository layout

```
warden/
├── apps/                 # runtime processes (relay, ingest, web)
├── packages/             # 29 internal packages (@sr/*)
├── sdks/                 # five SDKs (JS, Python, Rust, Go, Swift)
├── e2e/                  # end-to-end + load tests
├── infra/                # CI notes
├── specs/                # SPEC.md + SPEC-CORRECTIONS.md
├── docs/                 # this directory
└── types/                # workspace-shared type stubs
```

## Conventions

The project's voice and stance live in [`plan.md`](../plan.md) and are reproduced briefly here:

- **Hand-waving is a fireable offence.** If you don't know a number, measure it. "Probably about" / "should be fine" don't ship.
- **Course-correct loudly.** If you go down a wrong path, say so. Don't paper over.
- **Match the register.** New code reads like existing code in the same area.
- **Production readiness is the standard.** Mock data only where the spec calls for it (the UI's mock data layer).

### Code style

- No comments unless they explain a non-obvious *why*. Names already explain *what*.
- No TODOs in committed code unless they reference an issue.
- Prefer single-responsibility modules. If a file does two things, split.
- Effects are explicit. Wrap I/O in `Effect.tryPromise` (or equivalent) rather than letting promises escape.
- Tests are colocated under `test/` directories alongside source.

### Spec corrections

Every divergence from `specs/SPEC.md` is recorded in `specs/SPEC-CORRECTIONS.md` with the section number, the discrepancy, and the chosen resolution. Don't silently fix the spec — document it.

## Tests

### Bun unit tests

`bun test --parallel --isolate`. Tests live next to source in `test/` directories. Each test file is an isolated module so you can use module-level mocks without cross-test bleed.

### Property-based

`fast-check` for invariants — round-trips, sort orders, encoder/decoder symmetry. The columnar codecs, queue log, and DSN parsers are good candidates.

### End-to-end

`e2e/` contains scenarios that bring up a relay + ingest + store and post envelopes. The 20k-event load burst lives here.

### UI journeys

`apps/web/test-e2e/journeys.ts` drives Playwright over 18 scenarios covering the full route set. CI runs these against a built bundle, not the dev server.

### Cross-language

Run each SDK's native test suite in CI. Each SDK ships a `NoopTransport` so the suite can assert on the bytes that would have been sent without standing up a relay.

## CI

The expected CI matrix:

1. `bun run lint` (fast).
2. `bun run typecheck`.
3. `bun test --parallel --isolate --shard <N>/<M>` for `M` shards.
4. Per-SDK suites.
5. E2E.
6. UI journeys.

Sharding the Bun test suite keeps wall-time under a few minutes on a normal runner.

## Submitting a change

1. Branch off `main`.
2. Make the change. Run `bun run validate` locally.
3. If you change the spec contract or take a divergence, add an entry to `specs/SPEC-CORRECTIONS.md`.
4. Open a PR with a clear "what" and a clear "why".
5. Squash on merge.

## Reporting bugs

Open an issue at https://github.com/chrischabot/warden/issues with:

- What you did.
- What you expected.
- What happened.
- Bun version (`bun --version`), OS, and the relevant log slice.

For security issues, do not open a public issue. Email the maintainers.

## Where to read next

- [Internals overview](./internals/README.md) for the package-level map.
- [`plan.md`](../plan.md) — the running plan and decision log.
- [`specs/SPEC.md`](../specs/SPEC.md) — the source-of-truth spec.
