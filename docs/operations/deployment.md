# Deployment

How to run Warden in production. The supervisor is intentionally external to Warden — systemd, supervisord, or a container orchestrator — and Warden hands you sizing via `packages/topology`.

## Process kinds

Three application binaries from `apps/`:

| App                | Entry                          | Default port | Role                                     |
| ------------------ | ------------------------------ | ------------ | ---------------------------------------- |
| `relay`            | `bun apps/relay/src/index.ts`  | 9000         | HTTP envelope ingest. Stateless.         |
| `ingest`           | `bun apps/ingest/src/index.ts` | —            | Queue consumer. Reads queue, writes store.|
| `web`              | `bun --bun apps/web/dist/index.html` (or behind any static host)| 80/443 via proxy | Static React bundle. |

Additional process kinds (`compaction`, `query`, `alert-evaluator`, `cron-leader`, `uptime-prober`, `seer`, `ws-fanout`, `api`) are run from the same monorepo packages; their entrypoints follow the same `bun <package>/src/index.ts` pattern. See [Architecture](../architecture.md) for the full inventory.

## How many of each

Run `bun -e 'import("./packages/topology/src/index.ts").then(({summarize, computeTopology}) => console.log(summarize(computeTopology({cores: 32}))))'` on your target host to get the exact counts. As a starting reference:

| Cores | Relays | Ingest | Compactors | Query | API | Total CPU-bound |
| ----: | -----: | -----: | ---------: | ----: | --: | --------------: |
| 4     | 2      | 1      | 1          | 1     | 2   | ~24             |
| 8     | 2      | 2      | 2          | 2     | 2   | ~33             |
| 16    | 2      | 4      | 4          | 4     | 2   | ~51             |
| 32    | 4      | 8      | 8          | 8     | 4   | ~91             |
| 64    | 8      | 16     | 16         | 16    | 8   | ~171            |

## Systemd template (single host)

The most reliable layout is one systemd template unit per process kind, scaled with `%i`.

`/etc/systemd/system/warden-relay@.service`:

```ini
[Unit]
Description=Warden relay #%i
After=network.target

[Service]
Type=simple
User=warden
Group=warden
WorkingDirectory=/opt/warden
Environment=WARDEN_DATA_DIR=/var/lib/warden
Environment=WARDEN_RELAY_PORT=9000
ExecStart=/usr/local/bin/bun apps/relay/src/index.ts
Restart=always
RestartSec=2
LimitNOFILE=131072

[Install]
WantedBy=multi-user.target
```

Enable N copies (e.g. on a 32-core host, 4 relays):

```bash
systemctl enable --now warden-relay@1 warden-relay@2 warden-relay@3 warden-relay@4
```

Because `Bun.serve` is started with `reusePort: true`, all four bind 9000 and the kernel load-balances. Do the same for `warden-ingest@.service`, `warden-compaction@.service`, and so on.

Bun's `bun upgrade` may move the binary; pinning `/usr/local/bin/bun` via packaging is recommended.

## Behind a reverse proxy

The relay does not terminate TLS. Front it with nginx, Caddy, or your platform's load balancer.

Nginx fragment:

```nginx
server {
    listen 443 ssl http2;
    server_name warden.example.com;
    ssl_certificate     /etc/letsencrypt/live/warden.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/warden.example.com/privkey.pem;

    client_max_body_size 100M;             # match relay's 100 MiB body limit
    proxy_request_buffering off;           # stream envelope body to relay
    proxy_read_timeout 30s;

    location /api/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }

    location / {
        root /opt/warden/apps/web/dist;
        try_files $uri /index.html;
    }
}
```

Notes:

- `client_max_body_size 100M` matches the relay's `maxRequestBodySize` default (100 MiB for minidumps).
- `proxy_request_buffering off` lets the relay stream-parse envelopes instead of waiting for nginx to buffer the full body.
- The web app is a static React bundle (`bun run build` produces `dist/`); serve it as a static site.

## Containerised

Build a thin image per app:

```dockerfile
FROM oven/bun:1.3.14-alpine AS base
WORKDIR /opt/warden
COPY . .
RUN bun install --frozen-lockfile

FROM base AS relay
EXPOSE 9000
CMD ["bun", "apps/relay/src/index.ts"]
```

Compose a process kind per service. Replica count is your `N`; bind the same port across replicas if you can in your orchestrator (Kubernetes pods with `hostNetwork` for relays is the simplest; otherwise use a service in front and lose the kernel-level load-balancing).

## Storage layout

Default data root: `WARDEN_DATA_DIR` (defaults to `./data` if unset). Lay it out on a single NVMe volume.

```
$WARDEN_DATA_DIR/
├── queue/
│   ├── 0/  ... segment-00000000000000000000.log
│   ├── 1/
│   └── ...
├── columnar/
│   ├── 0/  wal-*.log  seg-*.col
│   ├── 1/
│   └── ...
└── meta/
    ├── shard-0.sqlite
    ├── shard-1.sqlite
    └── ...
```

See [Storage and data](./storage-and-data.md) for sizing, retention, and backup.

## Health and readiness

Each process exposes:

- `GET /internal/healthz` — process alive.
- `GET /internal/readyz` — dependencies (data dir writable, shards opened) reachable.
- `GET /internal/startupz` — startup complete (segments scanned, WAL replayed).
- `GET /internal/metrics` — Prometheus text format (`sr_*` namespace).

Wire these to your orchestrator's liveness/readiness checks.

## Tips and tricks

1. **Pin Bun.** Use a fixed Bun version in `engines.bun` and your packaging; don't auto-upgrade.
2. **Disable swap.** Bun and the columnar MemTable manage their own memory; swap hurts tail latency more than it helps.
3. **Filesystem.** `ext4` or `xfs` with `noatime`. ZFS is fine but watch ARC eating your page cache.
4. **fsync batching.** The queue uses group commit; `WARDEN_QUEUE_FLUSH_MS` (default 5 ms) is the right knob if your disk is slow. Lower = more durable but more syscalls.
5. **Don't undersize relays.** Each relay process is one JS event loop; CPU-bound PII regex on a hot project can dominate it. If you see event-loop lag > 100 ms in `sr_relay_event_loop_lag_seconds`, raise the relay count.
6. **One disk per host.** Do not split queue and columnar across volumes; sequential write throughput matters more than parallelism.
7. **Reverse-proxy buffering off.** Always disable request buffering. The relay's streaming parser is the whole point of the 100 MiB body limit.
8. **Watch open files.** `LimitNOFILE=131072` in the systemd unit, or you'll trip over many open columnar segments during compaction.
9. **Plan compaction windows.** Compactors run continuously but get more aggressive when sealed segment count rises. If you see `sr_columnar_compaction_lag_seconds` climbing, add a compactor process.

## Where to read next

- [Scaling and topology](./scaling-and-topology.md) — every sizing formula.
- [Storage and data](./storage-and-data.md) — disk layout, backup, retention.
- [Observability](./observability.md) — what to alert on.
