/**
 * Zonemap construction helpers for numeric columns.
 *
 * Returns `undefined` for empty input — callers omit the zonemap
 * in that case so the segment footer doesn't carry meaningless
 * sentinel values.
 */

import type { Zonemap } from './types';

export function zonemapForInt32(values: ArrayLike<number>): Zonemap | undefined {
  if (values.length === 0) return undefined;
  let min = values[0] as number;
  let max = min;
  for (let i = 1; i < values.length; i++) {
    const v = values[i] as number;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Object.freeze({ min, max });
}

export function zonemapForUint32(values: ArrayLike<number>): Zonemap | undefined {
  return zonemapForInt32(values);
}

export function zonemapForFloat64(values: ArrayLike<number>): Zonemap | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let any = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    // Skip NaN — including it would force min/max to NaN and defeat
    // the zonemap's purpose. Producers can still write NaN values
    // into a page; the zonemap just reports the non-NaN range.
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    any = true;
  }
  if (!any) return undefined;
  return Object.freeze({ min, max });
}

/**
 * Zonemap for an Int64 (BigInt) column. We store min/max as f64 in
 * the segment footer; integer values whose magnitude exceeds 2^53
 * lose precision in the zonemap (they'd be rounded to the nearest
 * representable f64). The page itself stores the exact int64 values.
 * For Sentry-style millisecond timestamps this is non-blocking
 * (millisecond values fit comfortably in 2^53).
 */
export function zonemapForInt64(values: ArrayLike<bigint>): Zonemap | undefined {
  if (values.length === 0) return undefined;
  let min = values[0] as bigint;
  let max = min;
  for (let i = 1; i < values.length; i++) {
    const v = values[i] as bigint;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Object.freeze({ min: Number(min), max: Number(max) });
}
