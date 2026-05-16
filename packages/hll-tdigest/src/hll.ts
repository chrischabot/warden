/**
 * HyperLogLog for unique-cardinality estimation.
 *
 * Reference: Flajolet, Fusy, Gandouet, Meunier — *HyperLogLog: the
 * analysis of a near-optimal cardinality estimation algorithm*
 * (AofA 2007). Uses the modernised 64-bit-hash variant (Heule,
 * Nunkesser, Hall, 2013) so the original large-range correction is
 * unnecessary; we apply the standard linear-counting correction
 * below the 2.5·m bias threshold.
 *
 * What this implementation deliberately does NOT include:
 *   - HLL++'s empirical bias-correction tables (precomputed per
 *     precision). Net error is slightly worse than full HLL++ but
 *     well inside the spec's "~1.6% error at p=14" target.
 *   - Sparse representation for low-cardinality streams. The
 *     constant-size dense register array is acceptable at our scale.
 *
 * These are tagged as follow-up wins; add them only if measured
 * error in production exceeds the tolerated band.
 *
 * Defaults: p=14 → m=16384 registers → 16 KiB → ~1.625% standard error.
 * Merge is the per-register max, which is associative — perfect for
 * cross-segment fan-out aggregation in the columnar query layer.
 */

import { hash64 } from './hash';

const DEFAULT_PRECISION = 14;
const MAX_PRECISION = 18;
const MIN_PRECISION = 4;

export class HLL {
  readonly precision: number;
  readonly m: number;
  readonly registers: Uint8Array;

  constructor(precision: number = DEFAULT_PRECISION) {
    if (!Number.isInteger(precision) || precision < MIN_PRECISION || precision > MAX_PRECISION) {
      throw new RangeError(
        `HLL precision must be an integer in [${MIN_PRECISION}, ${MAX_PRECISION}], got ${precision}`,
      );
    }
    this.precision = precision;
    this.m = 1 << precision;
    this.registers = new Uint8Array(this.m);
  }

  /** Add one element to the multiset. */
  add(value: string | Uint8Array): void {
    this.addHashed(hash64(value, 0));
  }

  /** Add a precomputed 64-bit hash. */
  addHashed(h: bigint): void {
    const p = this.precision;
    const idx = Number(h >> BigInt(64 - p));
    const tailWidth = 64 - p;
    const tail = h & ((1n << BigInt(tailWidth)) - 1n);
    const rank = leadingZeros(tail, tailWidth) + 1;
    if (rank > (this.registers[idx] as number)) {
      this.registers[idx] = rank;
    }
  }

  /** Estimated cardinality. */
  estimate(): number {
    const m = this.m;
    let sum = 0;
    let zeros = 0;
    for (let i = 0; i < m; i++) {
      const r = this.registers[i] as number;
      sum += 2 ** -r;
      if (r === 0) zeros++;
    }
    const raw = (alphaFor(m) * m * m) / sum;
    if (raw <= 2.5 * m && zeros > 0) {
      // Linear-counting correction for sparse registers.
      return m * Math.log(m / zeros);
    }
    // With 64-bit hashes the large-range correction is unnecessary.
    return raw;
  }

  /** Merge another HLL into this one (per-register max). */
  merge(other: HLL): void {
    if (other.precision !== this.precision) {
      throw new Error(`HLL.merge: precision mismatch (${other.precision} vs ${this.precision})`);
    }
    for (let i = 0; i < this.m; i++) {
      const a = this.registers[i] as number;
      const b = other.registers[i] as number;
      if (b > a) this.registers[i] = b;
    }
  }

  serialize(): Uint8Array {
    const out = new Uint8Array(1 + this.m);
    out[0] = this.precision;
    out.set(this.registers, 1);
    return out;
  }

  static deserialize(bytes: Uint8Array): HLL {
    if (bytes.byteLength < 1) {
      throw new RangeError('HLL.deserialize: empty buffer');
    }
    const precision = bytes[0] as number;
    const hll = new HLL(precision);
    if (bytes.byteLength !== 1 + hll.m) {
      throw new RangeError(
        `HLL.deserialize: expected ${1 + hll.m} bytes for p=${precision}, got ${bytes.byteLength}`,
      );
    }
    hll.registers.set(bytes.subarray(1));
    return hll;
  }
}

/** Count leading zeros in `value` interpreted as a `width`-bit unsigned integer. */
function leadingZeros(value: bigint, width: number): number {
  if (value === 0n) return width;
  let count = 0;
  let probe = 1n << BigInt(width - 1);
  while (probe > 0n && (value & probe) === 0n) {
    count++;
    probe >>= 1n;
  }
  return count;
}

function alphaFor(m: number): number {
  if (m === 16) return 0.673;
  if (m === 32) return 0.697;
  if (m === 64) return 0.709;
  return 0.7213 / (1 + 1.079 / m);
}
