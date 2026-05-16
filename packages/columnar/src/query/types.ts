/**
 * Query layer types.
 *
 * `ColumnarBatch` is the unit of data flowing between operators —
 * a single contiguous batch of `length` rows, with columns keyed
 * by column id. Each column is a TypedArray (Int32Array,
 * Uint32Array, BigInt64Array, Float64Array) or a `readonly string[]`
 * depending on the source column's type.
 *
 * `Predicate` is an algebraic ADT covering numeric comparisons,
 * string equality / membership, and AND/OR combinators. Predicates
 * are pure values; the executor evaluates them against batches
 * and uses their structure for page-skip via zonemaps.
 */

/** Column data carried in a batch. */
export type ColumnArray =
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | Float64Array
  | readonly string[];

export interface ColumnarBatch {
  readonly length: number;
  readonly columns: ReadonlyMap<number, ColumnArray>;
}

// ---- Predicates ----

export type NumericOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';
export type StringOp = 'eq' | 'neq' | 'in';

export interface NumericPredicate {
  readonly kind: 'num';
  readonly column: number;
  readonly op: NumericOp;
  /** Numeric target. For Int64 columns pass a bigint via BigIntPredicate. */
  readonly value: number;
}

export interface BigIntPredicate {
  readonly kind: 'bigint';
  readonly column: number;
  readonly op: NumericOp;
  readonly value: bigint;
}

export interface StringPredicate {
  readonly kind: 'str';
  readonly column: number;
  readonly op: StringOp;
  /** For `eq`/`neq` provide one value; for `in` provide the set. */
  readonly values: readonly string[];
}

export interface AndPredicate {
  readonly kind: 'and';
  readonly predicates: readonly Predicate[];
}

export interface OrPredicate {
  readonly kind: 'or';
  readonly predicates: readonly Predicate[];
}

export type Predicate =
  | NumericPredicate
  | BigIntPredicate
  | StringPredicate
  | AndPredicate
  | OrPredicate;
