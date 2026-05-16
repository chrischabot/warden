# Installation

## System requirements

- **OS**: macOS 13+, Linux (kernel 5.10+ recommended for `SO_REUSEPORT` group rebalancing). Windows requires WSL2.
- **CPU**: any x86_64 or arm64. Warden scales with cores — see [Scaling and topology](./scaling-and-topology.md).
- **RAM**: 1 GiB plus ~64 MiB per active columnar MemTable. A 32-core box with 32 shards will use ~2 GiB at steady state.
- **Disk**: NVMe SSD recommended. Queue and columnar segments are sequential workloads, but compaction reads + rewrites mean you'll want IOPS headroom.
- **Bun**: 1.3.14 or newer.
- **Network**: outbound for SDK uploads (`https`), inbound for the relay (default 9000) and the UI (default 5173 dev / your reverse proxy in prod).

## Install Bun

macOS / Linux:

```bash
curl -fsSL https://bun.sh/install | bash
exec $SHELL
bun --version          # expect 1.3.14 or newer
```

If your system has an older Bun, upgrade with `bun upgrade`.

## Clone and install

```bash
git clone https://github.com/chrischabot/warden.git
cd warden
bun install --frozen-lockfile
```

`--frozen-lockfile` ensures `bun.lock` matches `package.json` exactly. In CI, treat a lockfile drift as a failure.

## Validate the install

```bash
bun run validate
```

This runs three stages:

1. **Lint** — `biome check .` over the entire workspace.
2. **Type-check** — `tsgo --noEmit` using the TypeScript 7 native preview (~10× faster than `tsc`). `tsgo` is the gate; Warden does not emit `.js` or `.d.ts` because Bun runs TypeScript directly.
3. **Unit tests** — `bun test --parallel --isolate` against ~1,000 Bun tests across all packages.

A clean install completes the full `validate` in under a minute on a 4-core laptop.

## Optional: SDK language toolchains

The TypeScript / Bun SDK is part of the workspace and tested by `bun test`. The other four SDKs are independent toolchain projects under `sdks/`:

```bash
# Python SDK
cd sdks/python && python3 -m pytest -q

# Rust SDK
cd sdks/rust && cargo test

# Go SDK
cd sdks/go && go test ./...

# Swift SDK (Linux toolchain expected; on macOS use system Swift)
cd sdks/swift && swift test
```

Install these only if you intend to develop or run the corresponding SDK locally.

## Optional: Playwright for end-to-end UI tests

The web app's journey suite uses Playwright with Chromium:

```bash
cd apps/web
bun run e2e:ui
```

Browsers are downloaded on first run.

## Where to read next

- [Deployment](./deployment.md) for running Warden in production.
- [Scaling and topology](./scaling-and-topology.md) for host sizing.
- [Storage and data](./storage-and-data.md) for laying out the data directory.
