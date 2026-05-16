/**
 * Bloom filter with double hashing.
 *
 * Reference: Mitzenmacher & Upfal — *Probability and Computing*
 * (Chapter on Hashing); double-hashing optimisation: Kirsch & Mitzenmacher,
 * *Less Hashing, Same Performance* (2008).
 *
 * Sizing:
 *   - Explicit `new BloomFilter(m, k)` for known-shape filters (e.g.
 *     embedded in segment-page indexes, where m and k are fixed by
 *     the segment format).
 *   - `BloomFilter.withFpr(n, fpr)` for stream filters where the
 *     expected element count and target false-positive rate are
 *     known.
 *
 * For the spec's "10 bits/key, 7 hashes" optimum (~1% FPR):
 *   m = 10·n, k = round((m/n) · ln 2) = round(10·0.6931) = 7.
 *
 * Double hashing: g_i(x) = (h1(x) + i·h2(x)) mod m. We derive h1 and h2
 * from the high and low 32 bits of a single 64-bit hash, so we pay
 * one hash per insert/query regardless of k.
 *
 * Merge across filters of the same shape is bitwise OR — associative,
 * suitable for fan-out aggregation.
 */

import { hash64 } from './hash';

export class BloomFilter {
  readonly m: number;
  readonly k: number;
  readonly bits: Uint8Array;
  private _count = 0;

  constructor(m: number, k: number) {
    if (!Number.isInteger(m) || m <= 0) {
      throw new RangeError(`Bloom: m must be a positive integer, got ${m}`);
    }
    if (!Number.isInteger(k) || k <= 0 || k > 32) {
      throw new RangeError(`Bloom: k must be a positive integer ≤ 32, got ${k}`);
    }
    this.m = m;
    this.k = k;
    this.bits = new Uint8Array(Math.ceil(m / 8));
  }

  /** Construct sized for `n` items at the given false-positive rate. */
  static withFpr(n: number, fpr: number): BloomFilter {
    if (!Number.isInteger(n) || n <= 0) {
      throw new RangeError(`Bloom.withFpr: n must be a positive integer, got ${n}`);
    }
    if (!Number.isFinite(fpr) || fpr <= 0 || fpr >= 1) {
      throw new RangeError(`Bloom.withFpr: fpr must be in (0, 1), got ${fpr}`);
    }
    const ln2sq = Math.log(2) ** 2;
    const m = Math.max(1, Math.ceil(-(n * Math.log(fpr)) / ln2sq));
    const k = Math.max(1, Math.min(32, Math.round((m / n) * Math.log(2))));
    return new BloomFilter(m, k);
  }

  add(value: string | Uint8Array): void {
    const h = hash64(value, 0);
    const h1 = Number(h >> 32n);
    const h2 = Number(h & 0xffffffffn);
    for (let i = 0; i < this.k; i++) {
      const pos = ((h1 + i * h2) >>> 0) % this.m;
      const byte = pos >>> 3;
      const bit = pos & 7;
      this.bits[byte] = (this.bits[byte] as number) | (1 << bit);
    }
    this._count++;
  }

  has(value: string | Uint8Array): boolean {
    const h = hash64(value, 0);
    const h1 = Number(h >> 32n);
    const h2 = Number(h & 0xffffffffn);
    for (let i = 0; i < this.k; i++) {
      const pos = ((h1 + i * h2) >>> 0) % this.m;
      const byte = pos >>> 3;
      const bit = pos & 7;
      if (((this.bits[byte] as number) & (1 << bit)) === 0) return false;
    }
    return true;
  }

  /** Number of `add` calls observed (may overcount if duplicates added). */
  get approximateCount(): number {
    return this._count;
  }

  /** Merge another Bloom of the same shape into this one (bitwise OR). */
  merge(other: BloomFilter): void {
    if (other.m !== this.m || other.k !== this.k) {
      throw new Error(
        `Bloom.merge: shape mismatch (m=${other.m}/k=${other.k} vs m=${this.m}/k=${this.k})`,
      );
    }
    for (let i = 0; i < this.bits.length; i++) {
      this.bits[i] = (this.bits[i] as number) | (other.bits[i] as number);
    }
    this._count += other._count;
  }

  serialize(): Uint8Array {
    const out = new Uint8Array(16 + this.bits.byteLength);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, this.m, true);
    dv.setUint32(4, this.k, true);
    dv.setFloat64(8, this._count, true);
    out.set(this.bits, 16);
    return out;
  }

  static deserialize(bytes: Uint8Array): BloomFilter {
    if (bytes.byteLength < 16) {
      throw new RangeError('Bloom.deserialize: header too short');
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const m = dv.getUint32(0, true);
    const k = dv.getUint32(4, true);
    const count = dv.getFloat64(8, true);
    const bf = new BloomFilter(m, k);
    const expectedBits = Math.ceil(m / 8);
    const expectedTotal = 16 + expectedBits;
    if (bytes.byteLength !== expectedTotal) {
      throw new RangeError(
        `Bloom.deserialize: expected exactly ${expectedTotal} bytes for m=${m}, got ${bytes.byteLength}`,
      );
    }
    bf.bits.set(bytes.subarray(16, 16 + expectedBits));
    bf._count = count;
    return bf;
  }
}
