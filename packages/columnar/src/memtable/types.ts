/**
 * MemTable public types.
 */

import type { ColumnTypeIdValue } from '../segment/types';

/** Per-column value accepted by addRow. Type must match column.type. */
export type ColumnValue = number | bigint | string;

/** Column schema entry. */
export interface ColumnSchema {
  readonly id: number;
  readonly name: string;
  readonly type: ColumnTypeIdValue;
}

/** MemTable configuration. */
export interface MemTableConfig {
  readonly schema: readonly ColumnSchema[];
  /** Row count at which `shouldFlush()` returns true. Default 250_000. */
  readonly maxRows?: number;
  /** Approximate byte size at which `shouldFlush()` returns true. Default 64 MiB. */
  readonly maxByteSize?: number;
  /** Wall-clock age at which `shouldFlush()` returns true. Default 60 000 ms. */
  readonly maxAgeMs?: number;
  /** Rows per output page when buildSegment runs. Default 8192. */
  readonly pageRows?: number;
}
