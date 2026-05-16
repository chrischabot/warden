/**
 * Metadata-shard types per spec §8.
 *
 * Topology: a fixed number of bun:sqlite databases. Every shard is
 * a separate file (or ":memory:" in tests). Shard membership is
 * derived from a hash of a sharding key (typically `project_id` or
 * `organization_id`) modulo the shard count.
 *
 * Resizing the shard count requires a rebalance pass — we don't
 * attempt online rebalance here.
 */

export interface ShardConfig {
  /** Total number of shards. Must be a positive integer. */
  readonly count: number;
  /**
   * Map shard index → on-disk path. ":memory:" is permitted for
   * tests. The array's length must equal `count`.
   */
  readonly paths: readonly string[];
}

export interface Migration {
  /** Stable, monotonically increasing version id. */
  readonly version: number;
  /** Human-readable label, recorded in the migrations table. */
  readonly description: string;
  /**
   * SQL executed inside a per-shard transaction. May be multiple
   * statements separated by `;` — they are split and executed
   * sequentially.
   */
  readonly sql: string;
}

export interface MigrationStatus {
  readonly shardIndex: number;
  readonly applied: readonly number[];
  readonly pending: readonly number[];
}
