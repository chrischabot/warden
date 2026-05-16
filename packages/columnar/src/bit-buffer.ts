/**
 * Bit-level I/O for encoders that pack values at arbitrary bit widths.
 *
 * Convention: MSB-first within each byte (matches Parquet RLE/BitPack
 * and is friendly to debugging in hex dumps).
 *
 * The current implementation reads and writes one bit at a time.
 * It's correct and tiny. If bit-pack throughput becomes a hotspot,
 * specialise into 32-bit chunked variants per bit width.
 */

export class BitWriter {
  private readonly bytes: number[] = [];
  private cur = 0;
  private nbits = 0;

  /**
   * Write the low `n` bits of `value`, MSB first.
   * `value` must fit in 32 bits unsigned (0 ≤ value ≤ 2^32 - 1).
   */
  writeBits(value: number, n: number): void {
    if (n === 0) return;
    if (n < 0 || n > 32) {
      throw new RangeError(`BitWriter.writeBits: n must be in [0, 32], got ${n}`);
    }
    for (let i = n - 1; i >= 0; i--) {
      const bit = (value >>> i) & 1;
      this.cur = ((this.cur << 1) | bit) & 0xff;
      this.nbits++;
      if (this.nbits === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.nbits = 0;
      }
    }
  }

  /** Finalise; returns a packed Uint8Array. Pads the last byte with zero bits. */
  finish(): Uint8Array {
    if (this.nbits > 0) {
      this.cur = (this.cur << (8 - this.nbits)) & 0xff;
      this.bytes.push(this.cur);
      this.cur = 0;
      this.nbits = 0;
    }
    return new Uint8Array(this.bytes);
  }

  /** Bits emitted so far including the in-progress partial byte. */
  get bitsWritten(): number {
    return this.bytes.length * 8 + this.nbits;
  }
}

export class BitReader {
  private readonly bytes: Uint8Array;
  private byte = 0;
  private nbits = 0;
  private pos = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /**
   * Read `n` bits as an unsigned integer, MSB first.
   * Throws RangeError if there aren't enough bits remaining.
   */
  readBits(n: number): number {
    if (n === 0) return 0;
    if (n < 0 || n > 32) {
      throw new RangeError(`BitReader.readBits: n must be in [0, 32], got ${n}`);
    }
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (this.nbits === 0) {
        if (this.pos >= this.bytes.length) {
          throw new RangeError(`BitReader: out of bits (pos=${this.pos}, want ${n - i} more)`);
        }
        this.byte = this.bytes[this.pos] as number;
        this.pos++;
        this.nbits = 8;
      }
      const bit = (this.byte >>> (this.nbits - 1)) & 1;
      this.nbits--;
      result = (result << 1) | bit;
    }
    // Coerce to unsigned 32-bit so callers can compare or add safely.
    return result >>> 0;
  }
}
