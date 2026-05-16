/**
 * Segment reader.
 *
 * Parses the footer eagerly (it's small and we need page offsets
 * for any query). Page bodies are returned as `EncodedColumn`
 * structures referencing into the underlying buffer with zero
 * copies — feed them directly to the encoding decoders.
 */

import type { EncodedColumn, EncodingTagValue } from '../types';
import { EncodingTag } from '../types';
import {
  type ColumnMetadata,
  type ColumnTypeIdValue,
  PAGE_HEADER_LEN,
  type PageMetadata,
  SEGMENT_FOOTER_LENGTH_LEN,
  SEGMENT_MAGIC,
  type SegmentMetadata,
} from './types';

const LE = true;
const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

export class SegmentReader {
  readonly bytes: Uint8Array;
  readonly metadata: SegmentMetadata;
  private readonly byColumnId: Map<number, ColumnMetadata>;

  constructor(bytes: Uint8Array) {
    if (bytes.byteLength < SEGMENT_MAGIC.byteLength + SEGMENT_FOOTER_LENGTH_LEN) {
      throw new RangeError(`SegmentReader: buffer too short (${bytes.byteLength} bytes)`);
    }
    for (let i = 0; i < SEGMENT_MAGIC.byteLength; i++) {
      if (bytes[i] !== SEGMENT_MAGIC[i]) {
        throw new RangeError(`SegmentReader: invalid magic at byte ${i}`);
      }
    }
    this.bytes = bytes;
    this.metadata = this.parseFooter();
    this.byColumnId = new Map(this.metadata.columns.map((c) => [c.id, c] as const));
  }

  get columns(): readonly ColumnMetadata[] {
    return this.metadata.columns;
  }

  /** Look up column metadata by id. */
  column(columnId: number): ColumnMetadata | undefined {
    return this.byColumnId.get(columnId);
  }

  /**
   * Read one page as a decoded `EncodedColumn`. The returned bytes
   * reference into the segment buffer — do not mutate them.
   */
  readPage(columnId: number, pageIdx: number): EncodedColumn {
    const col = this.byColumnId.get(columnId);
    if (!col) {
      throw new RangeError(`SegmentReader: no column with id ${columnId}`);
    }
    const page = col.pages[pageIdx];
    if (!page) {
      throw new RangeError(
        `SegmentReader: column ${columnId} has no page ${pageIdx} (have ${col.pages.length})`,
      );
    }
    return this.readPageAt(page);
  }

  private readPageAt(meta: PageMetadata): EncodedColumn {
    const view = this.bytes.subarray(meta.fileOffset, meta.fileOffset + meta.byteLength);
    if (view.byteLength < PAGE_HEADER_LEN) {
      throw new RangeError(
        `SegmentReader: page at offset ${meta.fileOffset} truncated (${view.byteLength} bytes)`,
      );
    }
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    const pageTotalLen = dv.getUint32(0, LE);
    const tag = view[4] as number;
    const rowCount = dv.getUint32(5, LE);
    const bodyLen = dv.getUint32(9, LE);
    if (pageTotalLen !== meta.byteLength) {
      throw new RangeError(
        `SegmentReader: page header length ${pageTotalLen} != footer-declared ${meta.byteLength}`,
      );
    }
    if (PAGE_HEADER_LEN + bodyLen !== pageTotalLen) {
      throw new RangeError(
        `SegmentReader: inconsistent page header (body=${bodyLen} + header=${PAGE_HEADER_LEN} != total=${pageTotalLen})`,
      );
    }
    if (rowCount !== meta.rowCount) {
      throw new RangeError(
        `SegmentReader: page header row count ${rowCount} != footer ${meta.rowCount}`,
      );
    }
    if (tag !== meta.encodingTag) {
      throw new RangeError(
        `SegmentReader: page header encoding ${tag} != footer ${meta.encodingTag}`,
      );
    }
    return Object.freeze({
      tag: tag as EncodingTagValue,
      count: rowCount,
      bytes: view.subarray(PAGE_HEADER_LEN, PAGE_HEADER_LEN + bodyLen),
    });
  }

  private parseFooter(): SegmentMetadata {
    const total = this.bytes.byteLength;
    const footerLenStart = total - SEGMENT_FOOTER_LENGTH_LEN;
    const footerLen = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + footerLenStart,
      SEGMENT_FOOTER_LENGTH_LEN,
    ).getUint32(0, LE);
    const footerStart = footerLenStart - footerLen;
    if (footerStart < SEGMENT_MAGIC.byteLength) {
      throw new RangeError(`SegmentReader: footer offset ${footerStart} overlaps magic`);
    }
    const footer = this.bytes.subarray(footerStart, footerStart + footerLen);
    const dv = new DataView(footer.buffer, footer.byteOffset, footer.byteLength);

    let off = 0;
    const columnCount = dv.getUint32(off, LE);
    off += 4;

    const columns: ColumnMetadata[] = [];
    for (let ci = 0; ci < columnCount; ci++) {
      if (off + 4 > footer.byteLength) {
        throw new RangeError(`SegmentReader: footer truncated at column ${ci}`);
      }
      const id = dv.getUint32(off, LE);
      off += 4;
      const nameLen = dv.getUint32(off, LE);
      off += 4;
      if (off + nameLen > footer.byteLength) {
        throw new RangeError(`SegmentReader: footer truncated mid-name at column ${ci}`);
      }
      const name = utf8Decoder.decode(footer.subarray(off, off + nameLen));
      off += nameLen;
      const type = footer[off] as ColumnTypeIdValue;
      off += 1;
      const pageCount = dv.getUint32(off, LE);
      off += 4;

      const pages: PageMetadata[] = [];
      for (let pi = 0; pi < pageCount; pi++) {
        // Fixed region: 19 bytes (u64 + u32 + u32 + u8 + u8 + u8)
        if (off + 19 > footer.byteLength) {
          throw new RangeError(`SegmentReader: footer truncated at page ${ci}/${pi} fixed region`);
        }
        const fileOffset = Number(dv.getBigUint64(off, LE));
        off += 8;
        const byteLength = dv.getUint32(off, LE);
        off += 4;
        const rowCount = dv.getUint32(off, LE);
        off += 4;
        const encodingTag = footer[off] as number;
        off += 1;
        const hasZonemap = footer[off] as number;
        off += 1;
        const hasBloom = footer[off] as number;
        off += 1;

        let zonemap: PageMetadata['zonemap'];
        if (hasZonemap === 1) {
          if (off + 16 > footer.byteLength) {
            throw new RangeError(`SegmentReader: footer truncated at page ${ci}/${pi} zonemap`);
          }
          const min = dv.getFloat64(off, LE);
          off += 8;
          const max = dv.getFloat64(off, LE);
          off += 8;
          zonemap = Object.freeze({ min, max });
        }
        let bloom: Uint8Array | undefined;
        if (hasBloom === 1) {
          if (off + 4 > footer.byteLength) {
            throw new RangeError(
              `SegmentReader: footer truncated at page ${ci}/${pi} bloom length`,
            );
          }
          const bloomLen = dv.getUint32(off, LE);
          off += 4;
          if (off + bloomLen > footer.byteLength) {
            throw new RangeError(`SegmentReader: footer truncated at page ${ci}/${pi} bloom body`);
          }
          bloom = footer.subarray(off, off + bloomLen);
          off += bloomLen;
        }

        // Bounds-check that the page lives in the data region.
        if (fileOffset < SEGMENT_MAGIC.byteLength || fileOffset + byteLength > footerStart) {
          throw new RangeError(`SegmentReader: page ${ci}/${pi} offset/length out of range`);
        }
        if (encodingTag > 255) {
          throw new RangeError(`SegmentReader: invalid encoding tag ${encodingTag}`);
        }
        // Soft sanity-check encoding tag against known values; unknown tags
        // are tolerated so the reader can survive forward-compatible
        // segments written by a newer codebase.
        const knownTags = new Set<number>(Object.values(EncodingTag));
        if (!knownTags.has(encodingTag)) {
          // Don't throw — record and let the caller deal with the unknown tag
          // when it actually tries to decode the page.
        }

        pages.push(
          Object.freeze({
            fileOffset,
            byteLength,
            rowCount,
            encodingTag,
            ...(zonemap ? { zonemap } : {}),
            ...(bloom ? { bloom } : {}),
          }),
        );
      }

      columns.push(
        Object.freeze({
          id,
          name,
          type,
          pages: Object.freeze(pages),
        }),
      );
    }

    if (off !== footer.byteLength) {
      throw new RangeError(
        `SegmentReader: footer body has ${footer.byteLength - off} trailing bytes`,
      );
    }

    return Object.freeze({ columns: Object.freeze(columns) });
  }
}
