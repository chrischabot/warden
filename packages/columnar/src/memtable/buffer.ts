/**
 * Dynamic typed column buffers.
 *
 * Each buffer wraps a TypedArray (or string[]) and grows by
 * doubling. `view()` returns a zero-copy subarray of valid entries
 * sized to the current row count, suitable for direct consumption
 * by the encoders. `pushBulk(slice)` appends a whole slice in one
 * pre-grow + memcpy, which compaction uses to stitch page-decoded
 * values from multiple source segments together quickly.
 *
 * String buffer reports an approximate byte size based on UTF-16
 * code-unit count of stored strings; encoders re-encode to UTF-8
 * at serialization time.
 */

const INITIAL_CAPACITY = 1024;

function ensureCapacityInt32(arr: Int32Array, needed: number): Int32Array {
  if (arr.length >= needed) return arr;
  let cap = arr.length || 1;
  while (cap < needed) cap *= 2;
  const next = new Int32Array(cap);
  next.set(arr);
  return next;
}
function ensureCapacityUint32(arr: Uint32Array, needed: number): Uint32Array {
  if (arr.length >= needed) return arr;
  let cap = arr.length || 1;
  while (cap < needed) cap *= 2;
  const next = new Uint32Array(cap);
  next.set(arr);
  return next;
}
function ensureCapacityFloat64(arr: Float64Array, needed: number): Float64Array {
  if (arr.length >= needed) return arr;
  let cap = arr.length || 1;
  while (cap < needed) cap *= 2;
  const next = new Float64Array(cap);
  next.set(arr);
  return next;
}
function ensureCapacityBigInt64(arr: BigInt64Array, needed: number): BigInt64Array {
  if (arr.length >= needed) return arr;
  let cap = arr.length || 1;
  while (cap < needed) cap *= 2;
  const next = new BigInt64Array(cap);
  next.set(arr);
  return next;
}

export class Int32Buffer {
  private arr: Int32Array;
  private len = 0;
  constructor(initial: number = INITIAL_CAPACITY) {
    this.arr = new Int32Array(Math.max(1, initial));
  }
  push(v: number): void {
    this.arr = ensureCapacityInt32(this.arr, this.len + 1);
    this.arr[this.len++] = v;
  }
  pushBulk(slice: ArrayLike<number>): void {
    if (slice.length === 0) return;
    this.arr = ensureCapacityInt32(this.arr, this.len + slice.length);
    this.arr.set(slice as Int32Array, this.len);
    this.len += slice.length;
  }
  view(): Int32Array {
    return this.arr.subarray(0, this.len);
  }
  get size(): number {
    return this.len;
  }
  get byteSize(): number {
    return this.len * 4;
  }
  reset(): void {
    this.len = 0;
  }
}

export class Uint32Buffer {
  private arr: Uint32Array;
  private len = 0;
  constructor(initial: number = INITIAL_CAPACITY) {
    this.arr = new Uint32Array(Math.max(1, initial));
  }
  push(v: number): void {
    this.arr = ensureCapacityUint32(this.arr, this.len + 1);
    this.arr[this.len++] = v;
  }
  pushBulk(slice: ArrayLike<number>): void {
    if (slice.length === 0) return;
    this.arr = ensureCapacityUint32(this.arr, this.len + slice.length);
    this.arr.set(slice as Uint32Array, this.len);
    this.len += slice.length;
  }
  view(): Uint32Array {
    return this.arr.subarray(0, this.len);
  }
  get size(): number {
    return this.len;
  }
  get byteSize(): number {
    return this.len * 4;
  }
  reset(): void {
    this.len = 0;
  }
}

export class Float64Buffer {
  private arr: Float64Array;
  private len = 0;
  constructor(initial: number = INITIAL_CAPACITY) {
    this.arr = new Float64Array(Math.max(1, initial));
  }
  push(v: number): void {
    this.arr = ensureCapacityFloat64(this.arr, this.len + 1);
    this.arr[this.len++] = v;
  }
  pushBulk(slice: ArrayLike<number>): void {
    if (slice.length === 0) return;
    this.arr = ensureCapacityFloat64(this.arr, this.len + slice.length);
    this.arr.set(slice as Float64Array, this.len);
    this.len += slice.length;
  }
  view(): Float64Array {
    return this.arr.subarray(0, this.len);
  }
  get size(): number {
    return this.len;
  }
  get byteSize(): number {
    return this.len * 8;
  }
  reset(): void {
    this.len = 0;
  }
}

export class BigInt64Buffer {
  private arr: BigInt64Array;
  private len = 0;
  constructor(initial: number = INITIAL_CAPACITY) {
    this.arr = new BigInt64Array(Math.max(1, initial));
  }
  push(v: bigint): void {
    this.arr = ensureCapacityBigInt64(this.arr, this.len + 1);
    this.arr[this.len++] = v;
  }
  pushBulk(slice: ArrayLike<bigint>): void {
    if (slice.length === 0) return;
    this.arr = ensureCapacityBigInt64(this.arr, this.len + slice.length);
    this.arr.set(slice as BigInt64Array, this.len);
    this.len += slice.length;
  }
  view(): BigInt64Array {
    return this.arr.subarray(0, this.len);
  }
  get size(): number {
    return this.len;
  }
  get byteSize(): number {
    return this.len * 8;
  }
  reset(): void {
    this.len = 0;
  }
}

export class StringBuffer {
  private arr: string[] = [];
  private bytes = 0;
  push(v: string): void {
    this.arr.push(v);
    this.bytes += v.length * 2;
  }
  pushBulk(slice: ArrayLike<string>): void {
    for (let i = 0; i < slice.length; i++) {
      const s = slice[i] as string;
      this.arr.push(s);
      this.bytes += s.length * 2;
    }
  }
  view(): readonly string[] {
    return this.arr;
  }
  slice(start: number, end: number): string[] {
    return this.arr.slice(start, end);
  }
  get size(): number {
    return this.arr.length;
  }
  get byteSize(): number {
    return this.bytes;
  }
  reset(): void {
    this.arr = [];
    this.bytes = 0;
  }
}

export type AnyBuffer = Int32Buffer | Uint32Buffer | Float64Buffer | BigInt64Buffer | StringBuffer;
