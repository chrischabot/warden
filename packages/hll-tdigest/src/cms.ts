/**
 * Count-Min Sketch with conservative update.
 *
 * Reference: Cormode & Muthukrishnan, *An improved data stream
 * summary: the count-min sketch and its applications* (2005).
 * Conservative-update variant (Estan & Varghese, 2002) tightens the
 * overestimation bound by only incrementing cells already at the
 * current minimum.
 *
 * Defaults: width=2048, depth=5 → 5·2048·4 ≈ 40 KiB per sketch.
 * Error: estimated count error ≤ ε·N with probability ≥ 1-δ, where
 *   ε = e/width ≈ 0.0013 and δ = e^-depth ≈ 0.0067.
 *
 * Merge across sketches is element-wise addition. With conservative
 * update this is a slight overestimate; the alternative (element-wise
 * max) underestimates true counts. Sum is the right pick for
 * cross-segment aggregation of distinct streams.
 */

import { hash32 } from './hash';

const DEFAULT_WIDTH = 2048;
const DEFAULT_DEPTH = 5;

export class CountMinSketch {
  readonly width: number;
  readonly depth: number;
  readonly table: Uint32Array;
  private _totalCount = 0;

  constructor(width: number = DEFAULT_WIDTH, depth: number = DEFAULT_DEPTH) {
    if (!Number.isInteger(width) || width <= 0) {
      throw new RangeError(`CMS: width must be a positive integer, got ${width}`);
    }
    if (!Number.isInteger(depth) || depth <= 0) {
      throw new RangeError(`CMS: depth must be a positive integer, got ${depth}`);
    }
    this.width = width;
    this.depth = depth;
    this.table = new Uint32Array(width * depth);
  }

  /** Add `count` occurrences of `value`. Uses conservative update. */
  add(value: string | Uint8Array, count = 1): void {
    if (!Number.isInteger(count) || count <= 0) {
      throw new RangeError(`CMS.add: count must be a positive integer, got ${count}`);
    }
    const positions = this.positions(value);
    let curMin = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.depth; i++) {
      const v = this.table[positions[i] as number] as number;
      if (v < curMin) curMin = v;
    }
    // Cap at uint32 max to avoid wraparound on extreme counts.
    const target = Math.min(curMin + count, 0xffffffff);
    for (let i = 0; i < this.depth; i++) {
      const pos = positions[i] as number;
      if ((this.table[pos] as number) < target) {
        this.table[pos] = target;
      }
    }
    this._totalCount += count;
  }

  /** Estimated count of `value`. Always an overestimate. */
  query(value: string | Uint8Array): number {
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.depth; i++) {
      const pos = i * this.width + (hash32(value, i + 1) % this.width);
      const v = this.table[pos] as number;
      if (v < min) min = v;
    }
    return min === Number.POSITIVE_INFINITY ? 0 : min;
  }

  get totalCount(): number {
    return this._totalCount;
  }

  /** Element-wise sum merge (see header). Throws on shape mismatch. */
  merge(other: CountMinSketch): void {
    if (other.width !== this.width || other.depth !== this.depth) {
      throw new Error(
        `CMS.merge: shape mismatch (${other.width}×${other.depth} vs ${this.width}×${this.depth})`,
      );
    }
    const len = this.table.length;
    for (let i = 0; i < len; i++) {
      const a = this.table[i] as number;
      const b = other.table[i] as number;
      const sum = a + b;
      this.table[i] = sum > 0xffffffff ? 0xffffffff : sum;
    }
    this._totalCount += other._totalCount;
  }

  serialize(): Uint8Array {
    const out = new Uint8Array(16 + this.table.byteLength);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, this.width, true);
    dv.setUint32(4, this.depth, true);
    dv.setFloat64(8, this._totalCount, true);
    // Copy table bytes as little-endian uint32 sequence.
    let off = 16;
    for (let i = 0; i < this.table.length; i++) {
      dv.setUint32(off, this.table[i] as number, true);
      off += 4;
    }
    return out;
  }

  static deserialize(bytes: Uint8Array): CountMinSketch {
    if (bytes.byteLength < 16) {
      throw new RangeError('CMS.deserialize: header too short');
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = dv.getUint32(0, true);
    const depth = dv.getUint32(4, true);
    const total = dv.getFloat64(8, true);
    const cms = new CountMinSketch(width, depth);
    const expectedTableBytes = width * depth * 4;
    const expectedTotal = 16 + expectedTableBytes;
    if (bytes.byteLength !== expectedTotal) {
      throw new RangeError(
        `CMS.deserialize: expected exactly ${expectedTotal} bytes for ${width}×${depth} sketch, got ${bytes.byteLength}`,
      );
    }
    let off = 16;
    for (let i = 0; i < cms.table.length; i++) {
      cms.table[i] = dv.getUint32(off, true);
      off += 4;
    }
    cms._totalCount = total;
    return cms;
  }

  private positions(value: string | Uint8Array): number[] {
    const positions: number[] = new Array(this.depth);
    for (let i = 0; i < this.depth; i++) {
      positions[i] = i * this.width + (hash32(value, i + 1) % this.width);
    }
    return positions;
  }
}
