/**
 * Hot-page cache wrapped around a SegmentReader.
 *
 * Caches `EncodedColumn` page references (cheap: TypedArray
 * subviews into the segment buffer) keyed by `(columnId, pageIdx)`.
 * For warm-path queries that re-touch the same pages this avoids
 * the header re-parse on every call.
 *
 * For a fuller cache that also avoids re-decoding (i.e. cache the
 * typed values rather than the encoded bytes), the wrapper at a
 * higher layer in Ring 2 will key by `(segmentId, columnId,
 * pageIdx)` and store `ColumnArray`. This first cut caches the
 * encoded form because it's strictly safer (Uint8Array byte length
 * is a stable, accurate weight) and still wins on segments with
 * many small pages.
 *
 * Subclasses SegmentReader so any code that takes a `SegmentReader`
 * accepts a `CachedSegmentReader` transparently.
 */

import { SegmentReader } from '../segment/reader';
import type { EncodedColumn } from '../types';
import { LRUCache } from './lru';

export interface HotPageCacheConfig {
  /** Maximum bytes of encoded pages held in the cache. Default 256 MiB. */
  readonly maxBytes?: number;
  /** Optional cap on the number of cached pages, regardless of size. */
  readonly maxEntries?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

export class CachedSegmentReader extends SegmentReader {
  private readonly cache: LRUCache<string, EncodedColumn>;

  constructor(bytes: Uint8Array, config: HotPageCacheConfig = {}) {
    super(bytes);
    this.cache = new LRUCache<string, EncodedColumn>({
      maxBytes: config.maxBytes ?? DEFAULT_MAX_BYTES,
      weight: (v) => v.bytes.byteLength,
      ...(config.maxEntries !== undefined ? { maxEntries: config.maxEntries } : {}),
    });
  }

  override readPage(columnId: number, pageIdx: number): EncodedColumn {
    const key = `${columnId}:${pageIdx}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const page = super.readPage(columnId, pageIdx);
    this.cache.set(key, page);
    return page;
  }

  /** Cache diagnostics: entries currently held + their summed encoded byte size. */
  get cacheStats(): { readonly entries: number; readonly bytes: number } {
    return Object.freeze({ entries: this.cache.size, bytes: this.cache.bytes });
  }

  /** Drop everything from the cache. */
  clearCache(): void {
    this.cache.clear();
  }
}
