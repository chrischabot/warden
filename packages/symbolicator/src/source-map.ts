/**
 * Source-map v3 resolver.
 *
 * Parses the `mappings` string into an array of segments per
 * generated line. `resolve(line, column)` binary-searches the
 * segments for the largest `generatedColumn ≤ column` and returns
 * the original source/line/column/name if the segment carries them.
 *
 * Segment field count:
 *   1: generated column only — unmapped position
 *   4: generated column, source index, original line, original column
 *   5: as 4 + name index
 *
 * Delta accumulation per spec §A:
 *   - generated column resets at each new generated line (`;`)
 *   - source index, original line, original column, name index
 *     persist across lines — only the generated column resets
 */

import type { OriginalPosition, SourceMapV3 } from './types';
import { decodeVlq } from './vlq';

interface Segment {
  readonly generatedColumn: number;
  readonly sourceIndex?: number;
  readonly originalLine?: number;
  readonly originalColumn?: number;
  readonly nameIndex?: number;
}

export class SourceMapResolver {
  readonly sources: readonly string[];
  readonly names: readonly string[];
  readonly debugId: string | undefined;
  readonly file: string | undefined;
  readonly sourceRoot: string | undefined;
  private readonly lineSegments: Segment[][];

  constructor(sourceMap: SourceMapV3) {
    if (sourceMap.version !== 3) {
      throw new RangeError(
        `SourceMapResolver: unsupported source-map version ${String(sourceMap.version)}`,
      );
    }
    this.sources = sourceMap.sources;
    this.names = sourceMap.names ?? [];
    this.debugId = sourceMap.debug_id ?? sourceMap.debugId;
    this.file = sourceMap.file;
    this.sourceRoot = sourceMap.sourceRoot;
    this.lineSegments = parseMappings(sourceMap.mappings);
  }

  /** Number of generated lines represented in the map. */
  get generatedLineCount(): number {
    return this.lineSegments.length;
  }

  /**
   * Resolve a generated (line, column) to its original position.
   * `line` is 1-based; `column` is 0-based per the spec.
   */
  resolve(line: number, column: number): OriginalPosition | undefined {
    if (!Number.isInteger(line) || line < 1) return undefined;
    if (!Number.isInteger(column) || column < 0) return undefined;
    const segs = this.lineSegments[line - 1];
    if (!segs || segs.length === 0) return undefined;

    // Binary search: largest seg.generatedColumn <= column.
    let lo = 0;
    let hi = segs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const seg = segs[mid] as Segment;
      if (seg.generatedColumn <= column) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return undefined;
    const seg = segs[lo - 1] as Segment;
    if (
      seg.sourceIndex === undefined ||
      seg.originalLine === undefined ||
      seg.originalColumn === undefined
    ) {
      return undefined;
    }
    const source = this.sources[seg.sourceIndex];
    if (source === undefined) return undefined;
    const name = seg.nameIndex !== undefined ? this.names[seg.nameIndex] : undefined;
    return Object.freeze({
      source,
      line: seg.originalLine + 1, // VLQ encodes 0-based lines; expose 1-based
      column: seg.originalColumn,
      name,
    });
  }
}

function parseMappings(mappings: string): Segment[][] {
  if (mappings.length === 0) return [[]];

  const lines: Segment[][] = [];
  let lineSegs: Segment[] = [];

  // Persistent across the whole map:
  let prevSourceIndex = 0;
  let prevOriginalLine = 0;
  let prevOriginalColumn = 0;
  let prevNameIndex = 0;
  // Resets at each new generated line:
  let prevGenColumn = 0;

  let pos = 0;
  const len = mappings.length;
  while (pos < len) {
    const ch = mappings.charCodeAt(pos);
    if (ch === 59 /* ';' */) {
      lines.push(lineSegs);
      lineSegs = [];
      prevGenColumn = 0;
      pos++;
      continue;
    }
    if (ch === 44 /* ',' */) {
      pos++;
      continue;
    }

    const v0 = decodeVlq(mappings, pos);
    pos = v0.nextPos;
    prevGenColumn += v0.value;

    let sourceIndex: number | undefined;
    let originalLine: number | undefined;
    let originalColumn: number | undefined;
    let nameIndex: number | undefined;

    if (pos < len && !isSegmentBoundary(mappings.charCodeAt(pos))) {
      const v1 = decodeVlq(mappings, pos);
      pos = v1.nextPos;
      prevSourceIndex += v1.value;
      sourceIndex = prevSourceIndex;

      if (pos >= len || isSegmentBoundary(mappings.charCodeAt(pos))) {
        // Spec requires 4 fields when more than 1 — bail with the
        // partial value but document the malformation.
        throw new RangeError(
          `parseMappings: segment at pos ${pos} has 2 VLQs, expected 1, 4, or 5`,
        );
      }
      const v2 = decodeVlq(mappings, pos);
      pos = v2.nextPos;
      prevOriginalLine += v2.value;
      originalLine = prevOriginalLine;

      if (pos >= len || isSegmentBoundary(mappings.charCodeAt(pos))) {
        throw new RangeError(
          `parseMappings: segment at pos ${pos} has 3 VLQs, expected 1, 4, or 5`,
        );
      }
      const v3 = decodeVlq(mappings, pos);
      pos = v3.nextPos;
      prevOriginalColumn += v3.value;
      originalColumn = prevOriginalColumn;

      if (pos < len && !isSegmentBoundary(mappings.charCodeAt(pos))) {
        const v4 = decodeVlq(mappings, pos);
        pos = v4.nextPos;
        prevNameIndex += v4.value;
        nameIndex = prevNameIndex;
      }
    }

    lineSegs.push(
      Object.freeze({
        generatedColumn: prevGenColumn,
        ...(sourceIndex !== undefined ? { sourceIndex } : {}),
        ...(originalLine !== undefined ? { originalLine } : {}),
        ...(originalColumn !== undefined ? { originalColumn } : {}),
        ...(nameIndex !== undefined ? { nameIndex } : {}),
      }),
    );
  }
  lines.push(lineSegs);
  return lines;
}

function isSegmentBoundary(charCode: number): boolean {
  return charCode === 44 /* ',' */ || charCode === 59 /* ';' */;
}
