/**
 * Predicate evaluation and zonemap-based page-skip.
 *
 * `evaluatePredicate(p, batch)` produces a Uint8Array mask aligned
 * with the batch's rows: 1 = matches, 0 = does not. Operators
 * combine masks with bitwise AND/OR.
 *
 * `canSkipPage(p, columnMetas, pageIdx)` returns true when the
 * page's zonemap proves no row in the page can satisfy the
 * predicate — the page is skipped without decoding.
 */

import type { ColumnMetadata } from '../segment/types';
import type { ColumnArray, ColumnarBatch, NumericOp, Predicate, StringPredicate } from './types';

export function evaluatePredicate(p: Predicate, batch: ColumnarBatch): Uint8Array {
  switch (p.kind) {
    case 'num':
      return evaluateNumeric(p.column, p.op, p.value, batch);
    case 'bigint':
      return evaluateBigInt(p.column, p.op, p.value, batch);
    case 'str':
      return evaluateString(p, batch);
    case 'and':
      return evaluateAnd(p.predicates, batch);
    case 'or':
      return evaluateOr(p.predicates, batch);
  }
}

/** True if zonemap evidence rules the page out for ALL rows. */
export function canSkipPage(
  p: Predicate,
  columnsById: ReadonlyMap<number, ColumnMetadata>,
  pageIdx: number,
): boolean {
  switch (p.kind) {
    case 'num': {
      const col = columnsById.get(p.column);
      if (!col) return false;
      const pg = col.pages[pageIdx];
      if (!pg?.zonemap) return false;
      return numericPredicateExcludesRange(p.op, p.value, pg.zonemap.min, pg.zonemap.max);
    }
    case 'bigint': {
      const col = columnsById.get(p.column);
      if (!col) return false;
      const pg = col.pages[pageIdx];
      if (!pg?.zonemap) return false;
      // Zonemap min/max are f64; for Int64 columns this is precise up
      // to 2^53 magnitude. Convert the bigint target to a Number to
      // check; if the magnitude exceeds 2^53, we conservatively say
      // we cannot skip.
      if (p.value > 0x1fffffffffffffn || p.value < -0x1fffffffffffffn) {
        return false;
      }
      const target = Number(p.value);
      return numericPredicateExcludesRange(p.op, target, pg.zonemap.min, pg.zonemap.max);
    }
    case 'str':
      // No string zonemap (yet). Bloom-filter pruning is a future
      // refinement when the page carries one.
      return false;
    case 'and':
      // AND of predicates: page is skippable if ANY sub-predicate is.
      for (const sub of p.predicates) {
        if (canSkipPage(sub, columnsById, pageIdx)) return true;
      }
      return false;
    case 'or':
      // OR of predicates: page is skippable only if ALL sub-predicates are.
      if (p.predicates.length === 0) return false;
      for (const sub of p.predicates) {
        if (!canSkipPage(sub, columnsById, pageIdx)) return false;
      }
      return true;
  }
}

// ---- numeric ----

function evaluateNumeric(
  column: number,
  op: NumericOp,
  target: number,
  batch: ColumnarBatch,
): Uint8Array {
  const values = batch.columns.get(column);
  if (!values) {
    throw new RangeError(`predicate: column ${column} not present in batch`);
  }
  if (!isNumericArray(values)) {
    throw new TypeError(`predicate: numeric op on non-numeric column ${column}`);
  }
  const n = batch.length;
  const mask = new Uint8Array(n);
  switch (op) {
    case 'eq':
      for (let i = 0; i < n; i++) if ((values[i] as number) === target) mask[i] = 1;
      break;
    case 'neq':
      for (let i = 0; i < n; i++) if ((values[i] as number) !== target) mask[i] = 1;
      break;
    case 'lt':
      for (let i = 0; i < n; i++) if ((values[i] as number) < target) mask[i] = 1;
      break;
    case 'lte':
      for (let i = 0; i < n; i++) if ((values[i] as number) <= target) mask[i] = 1;
      break;
    case 'gt':
      for (let i = 0; i < n; i++) if ((values[i] as number) > target) mask[i] = 1;
      break;
    case 'gte':
      for (let i = 0; i < n; i++) if ((values[i] as number) >= target) mask[i] = 1;
      break;
  }
  return mask;
}

function evaluateBigInt(
  column: number,
  op: NumericOp,
  target: bigint,
  batch: ColumnarBatch,
): Uint8Array {
  const values = batch.columns.get(column);
  if (!values) {
    throw new RangeError(`predicate: column ${column} not present in batch`);
  }
  if (!(values instanceof BigInt64Array)) {
    throw new TypeError(`predicate: bigint op requires BigInt64Array column, got ${column}`);
  }
  const n = batch.length;
  const mask = new Uint8Array(n);
  switch (op) {
    case 'eq':
      for (let i = 0; i < n; i++) if (values[i] === target) mask[i] = 1;
      break;
    case 'neq':
      for (let i = 0; i < n; i++) if (values[i] !== target) mask[i] = 1;
      break;
    case 'lt':
      for (let i = 0; i < n; i++) if ((values[i] as bigint) < target) mask[i] = 1;
      break;
    case 'lte':
      for (let i = 0; i < n; i++) if ((values[i] as bigint) <= target) mask[i] = 1;
      break;
    case 'gt':
      for (let i = 0; i < n; i++) if ((values[i] as bigint) > target) mask[i] = 1;
      break;
    case 'gte':
      for (let i = 0; i < n; i++) if ((values[i] as bigint) >= target) mask[i] = 1;
      break;
  }
  return mask;
}

// ---- string ----

function evaluateString(p: StringPredicate, batch: ColumnarBatch): Uint8Array {
  const values = batch.columns.get(p.column);
  if (!values) {
    throw new RangeError(`predicate: column ${p.column} not present in batch`);
  }
  if (!Array.isArray(values)) {
    throw new TypeError(`predicate: string op requires string[] column, got ${p.column}`);
  }
  const arr = values as readonly string[];
  const n = batch.length;
  const mask = new Uint8Array(n);
  switch (p.op) {
    case 'eq': {
      const target = p.values[0];
      if (target === undefined) return mask;
      for (let i = 0; i < n; i++) if (arr[i] === target) mask[i] = 1;
      break;
    }
    case 'neq': {
      const target = p.values[0];
      if (target === undefined) {
        // No exclusion → everything matches.
        mask.fill(1);
        return mask;
      }
      for (let i = 0; i < n; i++) if (arr[i] !== target) mask[i] = 1;
      break;
    }
    case 'in': {
      const set = new Set(p.values);
      for (let i = 0; i < n; i++) if (set.has(arr[i] as string)) mask[i] = 1;
      break;
    }
  }
  return mask;
}

// ---- boolean combinators ----

function evaluateAnd(preds: readonly Predicate[], batch: ColumnarBatch): Uint8Array {
  if (preds.length === 0) {
    const m = new Uint8Array(batch.length);
    m.fill(1);
    return m;
  }
  const first = evaluatePredicate(preds[0] as Predicate, batch);
  for (let p = 1; p < preds.length; p++) {
    const next = evaluatePredicate(preds[p] as Predicate, batch);
    for (let i = 0; i < first.length; i++) first[i] = (first[i] as number) & (next[i] as number);
  }
  return first;
}

function evaluateOr(preds: readonly Predicate[], batch: ColumnarBatch): Uint8Array {
  if (preds.length === 0) {
    return new Uint8Array(batch.length);
  }
  const first = evaluatePredicate(preds[0] as Predicate, batch);
  for (let p = 1; p < preds.length; p++) {
    const next = evaluatePredicate(preds[p] as Predicate, batch);
    for (let i = 0; i < first.length; i++) first[i] = (first[i] as number) | (next[i] as number);
  }
  return first;
}

// ---- helpers ----

function isNumericArray(v: ColumnArray): v is Int32Array | Uint32Array | Float64Array {
  return v instanceof Int32Array || v instanceof Uint32Array || v instanceof Float64Array;
}

function numericPredicateExcludesRange(
  op: NumericOp,
  target: number,
  min: number,
  max: number,
): boolean {
  switch (op) {
    case 'eq':
      return target < min || target > max;
    case 'neq':
      // Page-skip only when all values are guaranteed equal to target.
      return min === max && target === min;
    case 'lt':
      // No row < target if min >= target.
      return min >= target;
    case 'lte':
      return min > target;
    case 'gt':
      return max <= target;
    case 'gte':
      return max < target;
  }
}
