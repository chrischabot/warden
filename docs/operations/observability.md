# Observability

Warden is fully self-observable. Every process exposes health probes and Prometheus metrics. This page covers what's exposed and what's worth alerting on.

## Health probes

Each process serves these endpoints on its admin port (default `<process port>+1` or `WARDEN_ADMIN_PORT`):

| Endpoint              | Returns                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `GET /internal/healthz`   | `200 OK` if the process is alive. Use for systemd `WatchdogSec` / k8s liveness. |
| `GET /internal/readyz`    | `200 OK` if dependencies are reachable (data dir writable, shards opened, queue tailable). Use for k8s readiness. |
| `GET /internal/startupz`  | `200 OK` once startup work (segment scan, WAL replay) has finished. Use for k8s startup probe. |
| `GET /internal/metrics`   | Prometheus text format. Used by your scraper.                                    |

If a probe returns non-200, do not route traffic. The relay specifically takes itself out of the SO_REUSEPORT pool when readyz fails.

## Metrics namespace

All metrics are in the `sr_*` namespace. Standard buckets are reused everywhere so dashboards work across processes:

- `LATENCY_BUCKETS` — log-ish from 0.1 ms to 10 s.
- `SIZE_BUCKETS` — from 64 B to 64 MiB.

Every metric carries a `subsystem` label (`relay`, `ingest`, `compaction`, `query`, `api`, `alerts`, `crons`, `uptime`, `seer`). Latencies are summarized with p50/p90/p95/p99/p999.

### Relay metrics

| Metric                                                            | Type      | What                                                                                  |
| ----------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------- |
| `sr_relay_envelopes_total{project, outcome}`                      | counter   | Envelope items by outcome (`accepted`, `rate_limited`, `filtered`, `invalid`, …).     |
| `sr_relay_envelope_bytes_total{project}`                          | counter   | Bytes received per project.                                                           |
| `sr_relay_request_duration_seconds{route}`                        | histogram | End-to-end relay latency per route.                                                   |
| `sr_relay_event_loop_lag_seconds`                                 | summary   | Event-loop saturation. Watch p95.                                                     |
| `sr_relay_pii_scrub_duration_seconds`                             | histogram | PII scrub cost per item.                                                              |
| `sr_relay_sampling_decisions_total{decision}`                     | counter   | Dynamic-sample `kept` vs `dropped`.                                                   |

### Queue metrics

| Metric                                              | Type      | What                                                          |
| --------------------------------------------------- | --------- | ------------------------------------------------------------- |
| `sr_queue_append_latency_seconds{shard}`            | histogram | Append latency including group-commit wait.                   |
| `sr_queue_segment_size_bytes{shard}`                | gauge     | Active segment size; informs roll behavior.                   |
| `sr_queue_records_total{shard, type}`               | counter   | Records appended, by record type.                             |
| `sr_queue_consumer_lag_records{shard}`              | gauge     | Records between consumer offset and head. Watch this.         |
| `sr_queue_crc_failures_total{shard}`                | counter   | Records dropped on read due to bad CRC. Should be 0.          |

### Columnar metrics

| Metric                                                      | Type      | What                                                       |
| ----------------------------------------------------------- | --------- | ---------------------------------------------------------- |
| `sr_columnar_memtable_rows{shard}`                          | gauge     | Rows in active MemTable.                                   |
| `sr_columnar_memtable_seal_duration_seconds`                | histogram | Seal-to-segment write cost.                                |
| `sr_columnar_compaction_lag_seconds`                        | gauge     | How far behind compaction is. Watch this.                  |
| `sr_columnar_compaction_duration_seconds`                   | histogram | Per-compaction wall time.                                  |
| `sr_columnar_segments_total{shard, state}`                  | gauge     | `sealed` and `compacted` counts.                           |
| `sr_columnar_zonemap_prune_ratio`                           | summary   | Fraction of blocks skipped by zone-map per query.          |

### Ingest metrics

| Metric                                              | Type      | What                                                       |
| --------------------------------------------------- | --------- | ---------------------------------------------------------- |
| `sr_ingest_event_loop_lag_seconds`                  | summary   | Worker event-loop saturation.                              |
| `sr_ingest_events_total{project, type}`             | counter   | Events processed per project per item type.                |
| `sr_ingest_fingerprint_duration_seconds`            | histogram | Cost of computing the group hash.                          |
| `sr_ingest_store_write_duration_seconds`            | histogram | MemTable append cost.                                      |

### Query metrics

| Metric                                                | Type      | What                                            |
| ----------------------------------------------------- | --------- | ----------------------------------------------- |
| `sr_query_duration_seconds{op}`                       | histogram | Time-to-rows by query op.                       |
| `sr_query_scatter_fanout{op}`                         | summary   | Number of shards a query touched.               |
| `sr_query_rows_scanned`                               | summary   | Rows scanned before zone-map pruning.           |
| `sr_query_rows_returned`                              | summary   | Rows returned after pruning + filtering.        |

### Process-level

| Metric                              | Type      | What                                                  |
| ----------------------------------- | --------- | ----------------------------------------------------- |
| `sr_process_uptime_seconds`         | counter   | Seconds since start.                                  |
| `sr_process_resident_bytes`         | gauge     | RSS.                                                  |
| `sr_process_open_fds`               | gauge     | Open file descriptors.                                |
| `sr_process_bun_version_info`       | gauge     | `1` with a `version="1.3.14"` label.                  |

## What to alert on

The minimum useful alert set:

1. **Relay availability**
   - `up{job="warden-relay"} == 0` for any relay → relay process down.
   - `sr_relay_request_duration_seconds{quantile="0.95"} > 0.5` → p95 latency degraded.
   - `sr_relay_event_loop_lag_seconds{quantile="0.95"} > 0.1` → event loop saturated; scale out.

2. **Ingest health**
   - `sum(sr_queue_consumer_lag_records) > 100000` for 5m → consumer falling behind.
   - `sr_ingest_event_loop_lag_seconds{quantile="0.95"} > 0.1` → ingest saturated.

3. **Store health**
   - `sr_columnar_compaction_lag_seconds > 300` → compaction falling behind, add a compactor or check disk.
   - `sr_columnar_segments_total{state="sealed"} > 1000` per shard → seg backlog.
   - `sr_queue_crc_failures_total > 0` → disk or memory bit-flip; investigate immediately.

4. **Disk**
   - `node_filesystem_avail_bytes{mountpoint=$WARDEN_DATA_DIR} / node_filesystem_size_bytes < 0.15` → fewer than 15 % free.

5. **Drop rate**
   - `rate(sr_relay_envelopes_total{outcome="rate_limited"}[5m]) > 0` for an unexpected project → quota mis-set or attack.
   - `rate(sr_relay_envelopes_total{outcome="invalid"}[5m]) > rate(sr_relay_envelopes_total{outcome="accepted"}[5m]) * 0.01` → SDK or upstream is sending malformed envelopes.

## Logs

Warden writes structured JSON to stdout. Each line:

```json
{
  "ts": "2026-05-16T12:34:56.789Z",
  "level": "info",
  "subsystem": "relay",
  "msg": "envelope accepted",
  "project_id": "1",
  "items": 3,
  "bytes": 4096
}
```

Configure your log shipper to consume stdout. Warden does not rotate its own log files — that's your supervisor's job.

## Tracing Warden itself

Yes, Warden can be its own customer. Initialize an SDK inside Warden processes pointing at a separate Warden host or project, and you'll get traces of the relay's request handling, of the ingest pipeline, and of the columnar query path. This is what the project means by "self-observability."

## Where to read next

- [Scaling and topology](./scaling-and-topology.md) — when to scale based on the signals above.
- [Internals: columnar store](../internals/columnar-store.md) — explains the numbers behind the `sr_columnar_*` metrics.
