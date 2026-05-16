/**
 * Segment writer.
 *
 * Lays out a self-contained segment file as a single Uint8Array:
 *   - 8-byte magic
 *   - all page bodies in column-then-page order, each prefixed by a
 *     13-byte page header
 *   - footer body (column index)
 *   - u32 footer length (little-endian)
 *
 * Segments are sized so the in-memory build cost is bounded:
 * spec default is 64 MiB. Streaming writers are a follow-up if we
 * ever need to emit larger units in one go.
 */

import {
  PAGE_HEADER_LEN,
  type PageSpec,
  SEGMENT_FOOTER_LENGTH_LEN,
  SEGMENT_MAGIC,
  type SegmentSpec,
} from './types';

const LE = true;
const utf8 = new TextEncoder();

/** Encode an entire segment to a contiguous byte buffer. */
export function encodeSegment(spec: SegmentSpec): Uint8Array {
  // Pass 1: lay out page headers + bodies, record offsets.
  const pageHeaders: Uint8Array[] = [];
  const pageBodies: Uint8Array[] = [];
  const fileOffsets: number[][] = [];
  const byteLengths: number[][] = [];

  let cursor = SEGMENT_MAGIC.byteLength;
  for (let ci = 0; ci < spec.columns.length; ci++) {
    const col = spec.columns[ci] as { pages: readonly PageSpec[] };
    const offsetsCol: number[] = [];
    const lengthsCol: number[] = [];
    for (let pi = 0; pi < col.pages.length; pi++) {
      const page = col.pages[pi] as PageSpec;
      const bodyLen = page.encoded.bytes.byteLength;
      const pageTotalLen = PAGE_HEADER_LEN + bodyLen;

      const header = new Uint8Array(PAGE_HEADER_LEN);
      const dv = new DataView(header.buffer);
      dv.setUint32(0, pageTotalLen, LE);
      header[4] = page.encoded.tag;
      dv.setUint32(5, page.rowCount, LE);
      dv.setUint32(9, bodyLen, LE);

      pageHeaders.push(header);
      pageBodies.push(page.encoded.bytes);
      offsetsCol.push(cursor);
      lengthsCol.push(pageTotalLen);
      cursor += pageTotalLen;
    }
    fileOffsets.push(offsetsCol);
    byteLengths.push(lengthsCol);
  }

  // Pass 2: build footer body.
  const footerParts: Uint8Array[] = [];

  // u32 column_count
  {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, spec.columns.length, LE);
    footerParts.push(buf);
  }

  for (let ci = 0; ci < spec.columns.length; ci++) {
    const col = spec.columns[ci]!;
    const offsetsCol = fileOffsets[ci]!;
    const lengthsCol = byteLengths[ci]!;

    const nameBytes = utf8.encode(col.name);
    const colHeader = new Uint8Array(4 + 4 + nameBytes.byteLength + 1 + 4);
    {
      const dv = new DataView(colHeader.buffer);
      let off = 0;
      dv.setUint32(off, col.id, LE);
      off += 4;
      dv.setUint32(off, nameBytes.byteLength, LE);
      off += 4;
      colHeader.set(nameBytes, off);
      off += nameBytes.byteLength;
      colHeader[off] = col.type;
      off += 1;
      dv.setUint32(off, col.pages.length, LE);
    }
    footerParts.push(colHeader);

    for (let pi = 0; pi < col.pages.length; pi++) {
      const page = col.pages[pi]!;
      const fileOff = offsetsCol[pi]!;
      const byteLen = lengthsCol[pi]!;

      // Fixed per-page region: u64 + u32 + u32 + u8 + u8 + u8 = 19 bytes
      const fixed = new Uint8Array(19);
      const dv = new DataView(fixed.buffer);
      dv.setBigUint64(0, BigInt(fileOff), LE);
      dv.setUint32(8, byteLen, LE);
      dv.setUint32(12, page.rowCount, LE);
      fixed[16] = page.encoded.tag;
      fixed[17] = page.zonemap ? 1 : 0;
      fixed[18] = page.bloom ? 1 : 0;
      footerParts.push(fixed);

      if (page.zonemap) {
        const zm = new Uint8Array(16);
        const zdv = new DataView(zm.buffer);
        zdv.setFloat64(0, page.zonemap.min, LE);
        zdv.setFloat64(8, page.zonemap.max, LE);
        footerParts.push(zm);
      }
      if (page.bloom) {
        const bloomLenBuf = new Uint8Array(4);
        new DataView(bloomLenBuf.buffer).setUint32(0, page.bloom.byteLength, LE);
        footerParts.push(bloomLenBuf);
        footerParts.push(page.bloom);
      }
    }
  }

  let footerLen = 0;
  for (const p of footerParts) footerLen += p.byteLength;

  // Pass 3: assemble.
  const totalBytes = cursor + footerLen + SEGMENT_FOOTER_LENGTH_LEN;
  const out = new Uint8Array(totalBytes);
  out.set(SEGMENT_MAGIC, 0);

  let off = SEGMENT_MAGIC.byteLength;
  for (let i = 0; i < pageHeaders.length; i++) {
    const h = pageHeaders[i] as Uint8Array;
    const b = pageBodies[i] as Uint8Array;
    out.set(h, off);
    off += h.byteLength;
    out.set(b, off);
    off += b.byteLength;
  }
  for (const p of footerParts) {
    out.set(p, off);
    off += p.byteLength;
  }
  new DataView(out.buffer).setUint32(totalBytes - 4, footerLen, LE);

  return out;
}
