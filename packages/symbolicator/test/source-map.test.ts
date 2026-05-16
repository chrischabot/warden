import { describe, expect, test } from 'bun:test';
import { SourceMapResolver } from '../src/source-map';
import type { SourceMapV3 } from '../src/types';
import { encodeVlq } from '../src/vlq';

/** Build a v3 source map with the given segment list, packing VLQs accordingly. */
function buildMap(opts: {
  sources: readonly string[];
  names?: readonly string[];
  /** Per generated line, an array of segments. Deltas relative to previous segment in same line / persistent state. */
  lines: ReadonlyArray<
    ReadonlyArray<{
      readonly generatedColumnDelta: number;
      readonly sourceIndexDelta?: number;
      readonly originalLineDelta?: number;
      readonly originalColumnDelta?: number;
      readonly nameIndexDelta?: number;
    }>
  >;
  debug_id?: string;
}): SourceMapV3 {
  const lineStrings: string[] = [];
  for (const line of opts.lines) {
    const segStrings: string[] = [];
    for (const seg of line) {
      let s = encodeVlq(seg.generatedColumnDelta);
      if (seg.sourceIndexDelta !== undefined) {
        s += encodeVlq(seg.sourceIndexDelta);
        s += encodeVlq(seg.originalLineDelta as number);
        s += encodeVlq(seg.originalColumnDelta as number);
        if (seg.nameIndexDelta !== undefined) s += encodeVlq(seg.nameIndexDelta);
      }
      segStrings.push(s);
    }
    lineStrings.push(segStrings.join(','));
  }
  return {
    version: 3,
    sources: opts.sources,
    ...(opts.names ? { names: opts.names } : {}),
    mappings: lineStrings.join(';'),
    ...(opts.debug_id ? { debug_id: opts.debug_id } : {}),
  };
}

describe('SourceMapResolver — basic resolution', () => {
  test('empty mappings → no resolution', () => {
    const resolver = new SourceMapResolver({ version: 3, sources: [], mappings: '' });
    expect(resolver.resolve(1, 0)).toBeUndefined();
  });

  test('single segment maps gen(1, 0) → original (1, 0) in source 0', () => {
    const map = buildMap({
      sources: ['src/app.ts'],
      lines: [
        [
          {
            generatedColumnDelta: 0,
            sourceIndexDelta: 0,
            originalLineDelta: 0,
            originalColumnDelta: 0,
          },
        ],
      ],
    });
    const r = new SourceMapResolver(map);
    const pos = r.resolve(1, 0);
    expect(pos).toBeDefined();
    expect(pos?.source).toBe('src/app.ts');
    expect(pos?.line).toBe(1);
    expect(pos?.column).toBe(0);
    expect(pos?.name).toBeUndefined();
  });

  test('segment without 4 fields → unmapped', () => {
    const map = buildMap({
      sources: ['x.ts'],
      lines: [[{ generatedColumnDelta: 0 }]],
    });
    const r = new SourceMapResolver(map);
    expect(r.resolve(1, 0)).toBeUndefined();
  });

  test('multiple segments per line — binary search picks the right one', () => {
    // Generated line 1 has segments at columns 0, 10, 20 mapping to
    // original lines 1, 2, 3 respectively (all in source 0, col 0).
    const map = buildMap({
      sources: ['app.ts'],
      lines: [
        [
          {
            generatedColumnDelta: 0,
            sourceIndexDelta: 0,
            originalLineDelta: 0,
            originalColumnDelta: 0,
          },
          {
            generatedColumnDelta: 10,
            sourceIndexDelta: 0,
            originalLineDelta: 1,
            originalColumnDelta: 0,
          },
          {
            generatedColumnDelta: 10,
            sourceIndexDelta: 0,
            originalLineDelta: 1,
            originalColumnDelta: 0,
          },
        ],
      ],
    });
    const r = new SourceMapResolver(map);
    expect(r.resolve(1, 0)?.line).toBe(1);
    expect(r.resolve(1, 9)?.line).toBe(1);
    expect(r.resolve(1, 10)?.line).toBe(2);
    expect(r.resolve(1, 19)?.line).toBe(2);
    expect(r.resolve(1, 20)?.line).toBe(3);
    expect(r.resolve(1, 100)?.line).toBe(3);
  });

  test('multiple generated lines', () => {
    const map = buildMap({
      sources: ['a.ts', 'b.ts'],
      lines: [
        // line 1: gen(1,0) → a.ts:1:0
        [
          {
            generatedColumnDelta: 0,
            sourceIndexDelta: 0,
            originalLineDelta: 0,
            originalColumnDelta: 0,
          },
        ],
        // line 2: gen(2,0) → b.ts:1:0 (delta +1 source, delta -0 line: keeps prevLine=0)
        // After line 1, prevSourceIndex=0, prevOriginalLine=0, prevOriginalColumn=0.
        // For line 2: sourceIndexDelta=+1 (→ index 1 = b.ts), lineDelta=0, columnDelta=0.
        [
          {
            generatedColumnDelta: 0,
            sourceIndexDelta: 1,
            originalLineDelta: 0,
            originalColumnDelta: 0,
          },
        ],
      ],
    });
    const r = new SourceMapResolver(map);
    const p1 = r.resolve(1, 0);
    const p2 = r.resolve(2, 0);
    expect(p1?.source).toBe('a.ts');
    expect(p2?.source).toBe('b.ts');
    expect(p2?.line).toBe(1);
  });

  test('name index resolves through names[]', () => {
    const map = buildMap({
      sources: ['app.ts'],
      names: ['createUser', 'validateInput'],
      lines: [
        [
          {
            generatedColumnDelta: 0,
            sourceIndexDelta: 0,
            originalLineDelta: 0,
            originalColumnDelta: 0,
            nameIndexDelta: 0,
          },
          {
            generatedColumnDelta: 10,
            sourceIndexDelta: 0,
            originalLineDelta: 1,
            originalColumnDelta: 0,
            nameIndexDelta: 1,
          },
        ],
      ],
    });
    const r = new SourceMapResolver(map);
    expect(r.resolve(1, 0)?.name).toBe('createUser');
    expect(r.resolve(1, 10)?.name).toBe('validateInput');
  });

  test('debug_id is exposed', () => {
    const map = buildMap({
      sources: ['app.ts'],
      lines: [
        [
          {
            generatedColumnDelta: 0,
            sourceIndexDelta: 0,
            originalLineDelta: 0,
            originalColumnDelta: 0,
          },
        ],
      ],
      debug_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    const r = new SourceMapResolver(map);
    expect(r.debugId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  test('debugId (camelCase) also recognised', () => {
    const map: SourceMapV3 = {
      version: 3,
      sources: ['app.ts'],
      mappings: 'AAAA',
      debugId: 'cammelcased-id',
    };
    expect(new SourceMapResolver(map).debugId).toBe('cammelcased-id');
  });
});

describe('SourceMapResolver — out-of-range queries', () => {
  test('line beyond mapped lines → undefined', () => {
    const map = buildMap({
      sources: ['a.ts'],
      lines: [
        [
          {
            generatedColumnDelta: 0,
            sourceIndexDelta: 0,
            originalLineDelta: 0,
            originalColumnDelta: 0,
          },
        ],
      ],
    });
    const r = new SourceMapResolver(map);
    expect(r.resolve(99, 0)).toBeUndefined();
  });

  test('column before any segment → undefined', () => {
    // Build a map where the first segment is at gen column 5.
    const map = buildMap({
      sources: ['a.ts'],
      lines: [
        [
          {
            generatedColumnDelta: 5,
            sourceIndexDelta: 0,
            originalLineDelta: 0,
            originalColumnDelta: 0,
          },
        ],
      ],
    });
    const r = new SourceMapResolver(map);
    expect(r.resolve(1, 0)).toBeUndefined();
    expect(r.resolve(1, 4)).toBeUndefined();
    expect(r.resolve(1, 5)?.source).toBe('a.ts');
  });

  test('invalid line or column → undefined', () => {
    const map = buildMap({
      sources: ['a.ts'],
      lines: [
        [
          {
            generatedColumnDelta: 0,
            sourceIndexDelta: 0,
            originalLineDelta: 0,
            originalColumnDelta: 0,
          },
        ],
      ],
    });
    const r = new SourceMapResolver(map);
    expect(r.resolve(0, 0)).toBeUndefined();
    expect(r.resolve(-1, 0)).toBeUndefined();
    expect(r.resolve(1, -1)).toBeUndefined();
    expect(r.resolve(1.5, 0)).toBeUndefined();
  });
});

describe('SourceMapResolver — schema validation', () => {
  test('rejects unsupported version', () => {
    expect(
      () =>
        new SourceMapResolver({
          version: 2 as unknown as 3,
          sources: [],
          mappings: '',
        }),
    ).toThrow(RangeError);
  });
});

describe('SourceMapResolver — real-world fragment', () => {
  test('parses a minimal output from a bundler', () => {
    // Two generated lines:
    //   line 1: gen(0) → app.ts:1:0
    //   line 2: gen(0) → app.ts:2:0
    const map = buildMap({
      sources: ['app.ts'],
      lines: [
        [
          {
            generatedColumnDelta: 0,
            sourceIndexDelta: 0,
            originalLineDelta: 0,
            originalColumnDelta: 0,
          },
        ],
        [
          {
            generatedColumnDelta: 0,
            sourceIndexDelta: 0,
            originalLineDelta: 1,
            originalColumnDelta: 0,
          },
        ],
      ],
    });
    const r = new SourceMapResolver(map);
    expect(r.resolve(1, 0)?.line).toBe(1);
    expect(r.resolve(2, 0)?.line).toBe(2);
  });
});
