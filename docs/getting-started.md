# Getting started

Get a local Warden running and capture your first event in under 10 minutes.

## Prerequisites

- **Bun** 1.3.14 or newer (`curl -fsSL https://bun.sh/install | bash`)
- **macOS or Linux** — Bun supports both. Windows works via WSL2.
- **Git**
- **Optional:** the SDK language toolchain you want to test (`python3`, `cargo`, `go`, or a Swift toolchain).

Check Bun:

```bash
bun --version
# 1.3.14 or newer
```

## Install

```bash
git clone https://github.com/chrischabot/warden.git
cd warden
bun install --frozen-lockfile
```

This installs all workspace packages, the web app's React/Tailwind/Vite stack, and the dev dependencies (`@biomejs/biome`, `@typescript/native-preview`, `playwright`, `fast-check`).

Validate the install (lint + tsgo type-check + ~1,000 unit tests, typically under a minute):

```bash
bun run validate
```

## Start the platform

In three terminals.

### Terminal 1 — relay (HTTP ingest)

```bash
bun apps/relay/src/index.ts
```

This boots `Bun.serve` on port 9000 with `SO_REUSEPORT`. In production you'd spawn multiple relay processes against the same port; for local development one is enough.

### Terminal 2 — ingest workers

```bash
bun apps/ingest/src/index.ts
```

Ingest workers consume from the queue, fingerprint and group events, and write to the columnar store.

### Terminal 3 — web UI

```bash
cd apps/web
bun run dev
```

Open http://localhost:5173. The dashboard, issues list, performance overview, traces, profiles, alerts, crons, uptime, releases, source maps, saved searches, settings, and the SDK setup wizard are all reachable from the sidebar. The current build renders the UI against mock data; backend integration for the read API is on the roadmap.

## Send your first event

Pick a language. A DSN for a local relay looks like:

```
http://localpub@localhost:9000/1
```

`localpub` is a placeholder public key and `1` is the project id.

### JavaScript / TypeScript

```ts
import { init, captureException } from "@warden/sdk";

init({
  dsn: "http://localpub@localhost:9000/1",
  release: "myapp@1.0.0",
  environment: "development",
});

try {
  throw new Error("hello warden");
} catch (e) {
  captureException(e);
}
```

Run with `bun example.ts`.

### Python

```python
import sentry_replica

sentry_replica.init(
    dsn="http://localpub@localhost:9000/1",
    release="myapp@1.0.0",
    environment="development",
)

try:
    raise RuntimeError("hello warden")
except Exception:
    sentry_replica.capture_exception()
```

### Rust

```rust
use sentry_replica_core::{init, capture_message, ClientOptions, Level};

fn main() {
    init(ClientOptions {
        dsn: "http://localpub@localhost:9000/1".into(),
        release: Some("myapp@1.0.0".into()),
        environment: Some("development".into()),
        transport: None,
    }).expect("dsn");

    capture_message("hello warden", Some(Level::Info));
}
```

### Go

```go
package main

import sr "github.com/chrischabot/warden/sdks/go"

func main() {
    client, _ := sr.NewClient(sr.ClientOptions{
        DSN:         "http://localpub@localhost:9000/1",
        Release:     "myapp@1.0.0",
        Environment: "development",
    })
    client.CaptureMessage("hello warden", sr.LevelInfo)
    client.Flush(2 * time.Second)
}
```

### Swift

```swift
import SentryReplica

let client = try SentryReplica.initialize(options: ClientOptions(
    dsn: "http://localpub@localhost:9000/1",
    release: "myapp@1.0.0",
    environment: "development"
))

SentryReplica.captureMessage("hello warden", level: .info)
_ = SentryReplica.flush(timeout: 2.0)
```

## What just happened

1. The SDK parsed the DSN, built an envelope from your event, and `POST`ed it to `http://localhost:9000/api/1/envelope/`.
2. The relay parsed the envelope, authenticated the DSN, applied rate-limit + PII + sampling rules, and enqueued each item.
3. An ingest worker pulled the item off the queue, fingerprinted the exception (in-app frames or message), and wrote it to the columnar store sharded by `(project_id, hash)`.

## What to read next

- **You want to instrument an app well.** Read [Reporting guide](./reporting-guide.md) and the [SDK reference](./sdks/README.md) for your language.
- **You want to run Warden in production.** Read [Deployment](./operations/deployment.md) and [Scaling and topology](./operations/scaling-and-topology.md).
- **You want to understand how it works under the hood.** Read [Architecture](./architecture.md) then [Internals](./internals/README.md).
