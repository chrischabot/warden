/**
 * T-Digest for streaming quantile estimation.
 *
 * Reference: Dunning & Ertl, *Computing Extremely Accurate Quantiles
 * Using t-Digests* (2019). This is a MergingDigest variant.
 *
 * Algorithm summary:
 *   - Each centroid is (mean, count); centroids are kept sorted by mean.
 *   - The k-function k(q) = δ·(asin(2q-1)/π + 0.5) is monotone in q;
 *     two samples are mergeable iff Δk ≤ 1, which concentrates centroids
 *     near the tails for tight quantile accuracy at p99/p999.
 *   - Buffered inserts compress lazily when the buffer reaches
 *     δ·BUFFER_FACTOR samples.
 *
 * Defaults: δ=100 → ~100 centroids in the steady state (~2.4 KiB).
 * Merge is associative — combine T-Digests across segments by
 * appending their centroids and recompressing.
 */

const DEFAULT_DELTA = 100;
const BUFFER_FACTOR = 5;

export class TDigest {
  readonly delta: number;
  // Centroid storage (sorted by mean after compress).
  private means: number[] = [];
  private counts: number[] = [];
  // Pending insertion buffer (compressed in batches).
  private bufMeans: number[] = [];
  private bufCounts: number[] = [];
  private _totalCount = 0;

  constructor(delta: number = DEFAULT_DELTA) {
    if (!Number.isFinite(delta) || delta < 10) {
      throw new RangeError(`TDigest delta must be a finite number ≥ 10, got ${delta}`);
    }
    this.delta = delta;
  }

  /** Add a sample with optional weight (default 1). */
  add(value: number, weight = 1): void {
    if (!Number.isFinite(value)) {
      throw new RangeError(`TDigest.add: value must be finite, got ${value}`);
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new RangeError(`TDigest.add: weight must be a positive finite number, got ${weight}`);
    }
    this.bufMeans.push(value);
    this.bufCounts.push(weight);
    this._totalCount += weight;
    if (this.bufMeans.length >= this.delta * BUFFER_FACTOR) {
      this.compress();
    }
  }

  /** Number of samples (weighted) observed so far. */
  get totalCount(): number {
    return this._totalCount;
  }

  /** Compute the q-quantile. 0 ≤ q ≤ 1. Returns NaN on an empty digest. */
  quantile(q: number): number {
    if (q < 0 || q > 1) {
      throw new RangeError(`TDigest.quantile: q must be in [0, 1], got ${q}`);
    }
    this.compress();
    if (this._totalCount === 0) return Number.NaN;
    const n = this.means.length;
    if (n === 1) return this.means[0] as number;

    // Centroid mean positions in count-space: each centroid spans
    // [cum, cum + count) and its mean lives at cum + count/2.
    const positions = new Float64Array(n);
    let cum = 0;
    for (let i = 0; i < n; i++) {
      const c = this.counts[i] as number;
      positions[i] = cum + c / 2;
      cum += c;
    }

    const target = q * this._totalCount;
    if (target <= (positions[0] as number)) return this.means[0] as number;
    const last = n - 1;
    if (target >= (positions[last] as number)) return this.means[last] as number;
    for (let i = 1; i < n; i++) {
      if (target <= (positions[i] as number)) {
        const left = positions[i - 1] as number;
        const right = positions[i] as number;
        const t = (target - left) / (right - left);
        const mLeft = this.means[i - 1] as number;
        const mRight = this.means[i] as number;
        return mLeft + t * (mRight - mLeft);
      }
    }
    return this.means[last] as number;
  }

  /** Merge another T-Digest into this one. */
  merge(other: TDigest): void {
    other.compress();
    for (let i = 0; i < other.means.length; i++) {
      this.bufMeans.push(other.means[i] as number);
      this.bufCounts.push(other.counts[i] as number);
      this._totalCount += other.counts[i] as number;
    }
    this.compress();
  }

  /** Force compression now. Idempotent. */
  compress(): void {
    if (this.bufMeans.length === 0 && this.means.length <= this.delta) return;

    const allMeans = this.means.concat(this.bufMeans);
    const allCounts = this.counts.concat(this.bufCounts);
    this.means = [];
    this.counts = [];
    this.bufMeans = [];
    this.bufCounts = [];

    // Sort by mean using a parallel index permutation.
    const n = allMeans.length;
    const idx: number[] = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((a, b) => (allMeans[a] as number) - (allMeans[b] as number));

    const total = this._totalCount;
    if (total === 0 || n === 0) return;

    const delta = this.delta;
    const k = (qq: number) => delta * (Math.asin(2 * qq - 1) / Math.PI + 0.5);

    let q0 = 0;
    let curMean = allMeans[idx[0] as number] as number;
    let curCount = allCounts[idx[0] as number] as number;

    for (let i = 1; i < n; i++) {
      const ix = idx[i] as number;
      const m = allMeans[ix] as number;
      const c = allCounts[ix] as number;
      const newCount = curCount + c;
      const newQ = q0 + newCount / total;
      if (k(newQ) - k(q0) <= 1) {
        // Mergeable: update weighted mean.
        curMean = curMean + (c * (m - curMean)) / newCount;
        curCount = newCount;
      } else {
        // Emit current centroid; start a new one.
        this.means.push(curMean);
        this.counts.push(curCount);
        q0 += curCount / total;
        curMean = m;
        curCount = c;
      }
    }
    this.means.push(curMean);
    this.counts.push(curCount);
  }

  /** Number of centroids after compression (for diagnostics). */
  get centroidCount(): number {
    return this.means.length + this.bufMeans.length;
  }

  serialize(): Uint8Array {
    this.compress();
    const n = this.means.length;
    const out = new Uint8Array(16 + n * 16);
    const dv = new DataView(out.buffer);
    dv.setFloat64(0, this._totalCount, true);
    dv.setFloat64(8, this.delta, true);
    let off = 16;
    for (let i = 0; i < n; i++) {
      dv.setFloat64(off, this.means[i] as number, true);
      dv.setFloat64(off + 8, this.counts[i] as number, true);
      off += 16;
    }
    return out;
  }

  static deserialize(bytes: Uint8Array): TDigest {
    if (bytes.byteLength < 16) {
      throw new RangeError('TDigest.deserialize: header too short');
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const total = dv.getFloat64(0, true);
    const delta = dv.getFloat64(8, true);
    const td = new TDigest(delta);
    const remaining = bytes.byteLength - 16;
    if (remaining % 16 !== 0) {
      throw new RangeError(`TDigest.deserialize: misaligned centroid body (${remaining} bytes)`);
    }
    const n = remaining / 16;
    let off = 16;
    for (let i = 0; i < n; i++) {
      td.means.push(dv.getFloat64(off, true));
      td.counts.push(dv.getFloat64(off + 8, true));
      off += 16;
    }
    td._totalCount = total;
    return td;
  }
}
