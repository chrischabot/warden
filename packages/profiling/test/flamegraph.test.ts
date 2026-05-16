import { describe, expect, test } from 'bun:test';
import { buildFlamegraph, hottestFunctions } from '../src/flamegraph';
import type { Frame, Profile, Sample } from '../src/types';

function profile(overrides: Partial<Profile> = {}): Profile {
  const frames: Frame[] = [
    { id: 0, function: 'main' },
    { id: 1, function: 'work' },
    { id: 2, function: 'compute' },
    { id: 3, function: 'allocate' },
  ];
  return {
    id: 'p1',
    projectId: '1',
    platform: 'javascript',
    capturedAt: 1000,
    durationNs: 1_000_000_000,
    samplingRateHz: 101,
    frames,
    threads: [{ id: 0, name: 'main' }],
    samples: [],
    ...overrides,
  };
}

function sample(stack: number[], threadId = 0, ts = 0): Sample {
  return { threadId, relativeTsNs: ts, stack };
}

describe('buildFlamegraph', () => {
  test('single sample produces a single root path', () => {
    const p = profile({ samples: [sample([2, 1, 0])] });
    const fg = buildFlamegraph(p);
    expect(fg.totalSamples).toBe(1);
    expect(fg.roots.length).toBe(1);
    expect(fg.roots[0]?.frameId).toBe(0);
    expect(fg.roots[0]?.children[0]?.frameId).toBe(1);
    expect(fg.roots[0]?.children[0]?.children[0]?.frameId).toBe(2);
    expect(fg.roots[0]?.children[0]?.children[0]?.self).toBe(1);
  });

  test('shared root coalesces; siblings expand', () => {
    const p = profile({
      samples: [sample([2, 1, 0]), sample([3, 1, 0]), sample([2, 1, 0])],
    });
    const fg = buildFlamegraph(p);
    expect(fg.roots.length).toBe(1);
    expect(fg.roots[0]?.total).toBe(3);
    expect(fg.roots[0]?.children[0]?.total).toBe(3);
    // Two sibling tops: compute(2) and allocate(3)
    expect(fg.roots[0]?.children[0]?.children.length).toBe(2);
    const compute = fg.roots[0]?.children[0]?.children.find((c) => c.frameId === 2);
    const allocate = fg.roots[0]?.children[0]?.children.find((c) => c.frameId === 3);
    expect(compute?.self).toBe(2);
    expect(allocate?.self).toBe(1);
  });

  test('disjoint root frames produce two roots', () => {
    const p = profile({
      samples: [
        sample([1, 0]),
        sample([2, 3]), // different bottom-of-stack
      ],
    });
    const fg = buildFlamegraph(p);
    expect(fg.roots.length).toBe(2);
  });

  test('perFrameSelf + perFrameTotal aggregates', () => {
    const p = profile({
      samples: [sample([2, 1, 0]), sample([2, 1, 0]), sample([1, 0])],
    });
    const fg = buildFlamegraph(p);
    // Frame 0 is in all three stacks, so total=3, self=0
    expect(fg.perFrameTotal.get(0)).toBe(3);
    expect(fg.perFrameSelf.get(0) ?? 0).toBe(0);
    // Frame 1 is in all three; top in the third sample only
    expect(fg.perFrameTotal.get(1)).toBe(3);
    expect(fg.perFrameSelf.get(1)).toBe(1);
    // Frame 2 is top in two samples
    expect(fg.perFrameSelf.get(2)).toBe(2);
  });

  test('threadId filter restricts samples', () => {
    const p = profile({
      threads: [
        { id: 0, name: 'main' },
        { id: 1, name: 'worker' },
      ],
      samples: [sample([0], 0), sample([0], 1), sample([0], 1)],
    });
    expect(buildFlamegraph(p).totalSamples).toBe(3);
    expect(buildFlamegraph(p, { threadId: 0 }).totalSamples).toBe(1);
    expect(buildFlamegraph(p, { threadId: 1 }).totalSamples).toBe(2);
  });
});

describe('hottestFunctions', () => {
  test('ranks by self-time descending', () => {
    const p = profile({
      samples: [
        sample([2, 1, 0]),
        sample([2, 1, 0]),
        sample([2, 1, 0]),
        sample([1, 0]),
        sample([1, 0]),
      ],
    });
    const fg = buildFlamegraph(p);
    const hot = hottestFunctions(fg, p);
    expect(hot[0]?.frameId).toBe(2);
    expect(hot[0]?.self).toBe(3);
    expect(hot[1]?.frameId).toBe(1);
    expect(hot[1]?.self).toBe(2);
  });

  test('respects limit', () => {
    const p = profile({
      samples: [sample([0]), sample([1]), sample([2]), sample([3])],
    });
    const fg = buildFlamegraph(p);
    expect(hottestFunctions(fg, p, 2).length).toBe(2);
  });

  test('selfRatio is fraction of total samples', () => {
    const p = profile({
      samples: [sample([2, 1, 0]), sample([1, 0]), sample([0])],
    });
    const fg = buildFlamegraph(p);
    const hot = hottestFunctions(fg, p);
    const sumRatio = hot.reduce((s, h) => s + h.selfRatio, 0);
    expect(sumRatio).toBeCloseTo(1.0, 6);
  });

  test('frame name falls back through function/module/filename', () => {
    const p: Profile = {
      ...profile(),
      frames: [
        { id: 0 }, // no name fields
        { id: 1, module: 'mod' },
        { id: 2, filename: 'file.js', lineno: 10 },
        { id: 3, function: 'work', lineno: 5 },
      ],
      samples: [sample([0]), sample([1]), sample([2]), sample([3])],
    };
    const fg = buildFlamegraph(p);
    const hot = hottestFunctions(fg, p);
    const names = hot.map((h) => h.name).sort();
    expect(names).toContain('frame_0');
    expect(names).toContain('mod');
    expect(names).toContain('file.js:10');
    expect(names).toContain('work:5');
  });
});
