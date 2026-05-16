import { describe, expect, test } from 'bun:test';
import {
  _resetDefaultForTests,
  computeTopology,
  defaultTopology,
  detectCores,
  summarize,
  tierFor,
} from '../src/index';

describe('detectCores', () => {
  test('returns a positive integer', () => {
    const n = detectCores();
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
  });
});

describe('computeTopology — single-core minimum', () => {
  test('1-core host still gets every kind of worker', () => {
    const t = computeTopology({ cores: 1 });
    expect(t.cores).toBe(1);
    expect(t.columnarShards).toBe(1);
    expect(t.queueShards).toBe(1);
    expect(t.metadataShards).toBe(1);
    expect(t.ingestWorkers).toBe(1);
    expect(t.compactionWorkers).toBe(1);
    expect(t.queryWorkers).toBe(1);
    expect(t.relayProcs).toBe(2);
    expect(t.apiProcs).toBe(2);
    expect(t.wsFanoutProcs).toBe(2);
    expect(t.alertEvaluators).toBe(4);
    expect(t.uptimeProbers).toBe(2);
  });
});

describe('computeTopology — 4-core (e.g. M1 / minimal sandbox)', () => {
  test('exact sizings', () => {
    const t = computeTopology({ cores: 4 });
    expect(t.columnarShards).toBe(4);
    expect(t.queueShards).toBe(1);
    expect(t.metadataShards).toBe(1);
    expect(t.ingestWorkers).toBe(1);
    expect(t.compactionWorkers).toBe(1);
    expect(t.queryWorkers).toBe(1);
    expect(t.relayProcs).toBe(2);
    expect(t.apiProcs).toBe(2);
    expect(t.totalProcs).toBe(24);
  });
});

describe('computeTopology — 8-core (typical sandbox / M5 base)', () => {
  test('exact sizings', () => {
    const t = computeTopology({ cores: 8 });
    expect(t.columnarShards).toBe(8);
    expect(t.queueShards).toBe(2);
    expect(t.metadataShards).toBe(2);
    expect(t.ingestWorkers).toBe(2);
    expect(t.compactionWorkers).toBe(2);
    expect(t.queryWorkers).toBe(2);
    expect(t.relayProcs).toBe(2);
    expect(t.apiProcs).toBe(2);
    expect(t.totalProcs).toBe(33);
  });
});

describe('computeTopology — 16-core (acceptable production)', () => {
  test('exact sizings', () => {
    const t = computeTopology({ cores: 16 });
    expect(t.columnarShards).toBe(16);
    expect(t.queueShards).toBe(4);
    expect(t.metadataShards).toBe(4);
    expect(t.ingestWorkers).toBe(4);
    expect(t.compactionWorkers).toBe(4);
    expect(t.queryWorkers).toBe(4);
    expect(t.relayProcs).toBe(2);
    expect(t.apiProcs).toBe(2);
    expect(t.totalProcs).toBe(51);
  });
});

describe('computeTopology — 32-core (recommended production)', () => {
  test('exact sizings', () => {
    const t = computeTopology({ cores: 32 });
    expect(t.columnarShards).toBe(32);
    expect(t.queueShards).toBe(8);
    expect(t.metadataShards).toBe(8);
    expect(t.ingestWorkers).toBe(8);
    expect(t.compactionWorkers).toBe(8);
    expect(t.queryWorkers).toBe(8);
    expect(t.relayProcs).toBe(4);
    expect(t.apiProcs).toBe(4);
    expect(t.totalProcs).toBe(91);
  });
});

describe('computeTopology — 64-core (large host)', () => {
  test('exact sizings', () => {
    const t = computeTopology({ cores: 64 });
    expect(t.columnarShards).toBe(64);
    expect(t.queueShards).toBe(16);
    expect(t.metadataShards).toBe(16);
    expect(t.ingestWorkers).toBe(16);
    expect(t.compactionWorkers).toBe(16);
    expect(t.queryWorkers).toBe(16);
    expect(t.relayProcs).toBe(8);
    expect(t.apiProcs).toBe(8);
    expect(t.totalProcs).toBe(171);
  });
});

describe('computeTopology — alert evaluators', () => {
  test('floor of 4, scales every 100 projects', () => {
    expect(computeTopology({ cores: 8, projects: 0 }).alertEvaluators).toBe(4);
    expect(computeTopology({ cores: 8, projects: 100 }).alertEvaluators).toBe(4);
    expect(computeTopology({ cores: 8, projects: 400 }).alertEvaluators).toBe(4);
    expect(computeTopology({ cores: 8, projects: 401 }).alertEvaluators).toBe(5);
    expect(computeTopology({ cores: 8, projects: 1000 }).alertEvaluators).toBe(10);
    expect(computeTopology({ cores: 8, projects: 2500 }).alertEvaluators).toBe(25);
  });
});

describe('computeTopology — uptime probers', () => {
  test('floor of 2, scales every 500 monitors', () => {
    expect(computeTopology({ cores: 8, monitors: 0 }).uptimeProbers).toBe(2);
    expect(computeTopology({ cores: 8, monitors: 500 }).uptimeProbers).toBe(2);
    expect(computeTopology({ cores: 8, monitors: 1000 }).uptimeProbers).toBe(2);
    expect(computeTopology({ cores: 8, monitors: 1001 }).uptimeProbers).toBe(3);
    expect(computeTopology({ cores: 8, monitors: 5000 }).uptimeProbers).toBe(10);
  });
});

describe('computeTopology — monotonicity', () => {
  test('totalProcs is strictly increasing in cores', () => {
    const sizes = [1, 2, 4, 8, 16, 32, 64, 128].map(
      (c) => computeTopology({ cores: c }).totalProcs,
    );
    for (let i = 1; i < sizes.length; i++) {
      const prev = sizes[i - 1];
      const curr = sizes[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      expect(curr as number).toBeGreaterThan(prev as number);
    }
  });
});

describe('computeTopology — input validation', () => {
  test('rejects cores < 1', () => {
    expect(() => computeTopology({ cores: 0 })).toThrow(RangeError);
    expect(() => computeTopology({ cores: -1 })).toThrow(RangeError);
  });

  test('rejects negative projects / monitors', () => {
    expect(() => computeTopology({ cores: 8, projects: -1 })).toThrow(RangeError);
    expect(() => computeTopology({ cores: 8, monitors: -1 })).toThrow(RangeError);
  });

  test('rejects non-finite cores', () => {
    expect(() => computeTopology({ cores: Number.NaN })).toThrow(RangeError);
    expect(() => computeTopology({ cores: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});

describe('computeTopology — result immutability', () => {
  test('topology is frozen', () => {
    const t = computeTopology({ cores: 8 });
    expect(Object.isFrozen(t)).toBe(true);
    expect(() => {
      (t as { cores: number }).cores = 999;
    }).toThrow();
  });
});

describe('summarize', () => {
  test('emits a single line containing every count', () => {
    const t = computeTopology({ cores: 16, projects: 200, monitors: 750 });
    const s = summarize(t);
    expect(s.split('\n').length).toBe(1);
    expect(s).toContain('cores=16');
    expect(s).toContain('tier=16-core');
    expect(s).toContain('columnar=16');
    expect(s).toContain('queue=4');
    expect(s).toContain('total=');
  });
});

describe('tierFor', () => {
  test('classifies every documented host class', () => {
    expect(tierFor(1)).toBe('1-core');
    expect(tierFor(2)).toBe('4-core');
    expect(tierFor(4)).toBe('4-core');
    expect(tierFor(8)).toBe('8-core');
    expect(tierFor(16)).toBe('16-core');
    expect(tierFor(32)).toBe('32-core');
    expect(tierFor(64)).toBe('64-core');
    expect(tierFor(128)).toBe('large');
    expect(tierFor(256)).toBe('large');
  });
});

describe('defaultTopology', () => {
  test('caches across calls', () => {
    _resetDefaultForTests();
    const a = defaultTopology();
    const b = defaultTopology();
    expect(a).toBe(b);
  });

  test('reflects actual host detection', () => {
    _resetDefaultForTests();
    const t = defaultTopology();
    expect(t.cores).toBe(detectCores());
  });
});
