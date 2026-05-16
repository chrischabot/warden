import { describe, expect, test } from 'bun:test';
import { HeuristicSeerProvider } from '../src/heuristic-provider';
import type { EventException, RootCauseRequest, SampledEvent, SummaryRequest } from '../src/types';

function event(exceptions: EventException[], extra: Partial<SampledEvent> = {}): SampledEvent {
  return {
    platform: 'javascript',
    exceptions,
    ...extra,
  };
}

function rcRequest(ev: SampledEvent): RootCauseRequest {
  return { projectId: '1', groupId: 'g1', groupHash: 'h1', event: ev };
}

const provider = new HeuristicSeerProvider();

describe('HeuristicSeerProvider — analyseRootCause rules', () => {
  test('TypeError on undefined property', async () => {
    const ev = event([
      {
        type: 'TypeError',
        value: 'cannot read properties of undefined (reading "x")',
        frames: [{ function: 'doIt', filename: 'src/x.ts', lineno: 42, inApp: true }],
      },
    ]);
    const res = await provider.analyseRootCause(rcRequest(ev));
    expect(res.candidates.length).toBeGreaterThan(0);
    expect(res.candidates[0]?.summary).toContain('undefined or null');
    expect(res.candidates[0]?.suggestedLocation?.path).toBe('src/x.ts');
    expect(res.candidates[0]?.suggestedLocation?.lineno).toBe(42);
  });

  test('ReferenceError', async () => {
    const ev = event([{ type: 'ReferenceError', value: 'fooBar is not defined', frames: [] }]);
    const res = await provider.analyseRootCause(rcRequest(ev));
    expect(res.candidates.some((c) => c.summary.includes('not defined in current scope'))).toBe(
      true,
    );
  });

  test('RangeError bounds', async () => {
    const ev = event([{ type: 'RangeError', value: 'invalid array length', frames: [] }]);
    const res = await provider.analyseRootCause(rcRequest(ev));
    expect(res.candidates.some((c) => c.summary.includes('bounds'))).toBe(true);
  });

  test('Network failure', async () => {
    const ev = event([{ type: 'Error', value: 'connect ECONNREFUSED 10.0.0.1:5432', frames: [] }]);
    const res = await provider.analyseRootCause(rcRequest(ev));
    expect(res.candidates[0]?.summary).toContain('network failure');
  });

  test('Permission error', async () => {
    const ev = event([{ type: 'Error', value: 'EACCES: permission denied', frames: [] }]);
    const res = await provider.analyseRootCause(rcRequest(ev));
    expect(res.candidates.some((c) => c.summary.includes('permission'))).toBe(true);
  });

  test('SQL keyword', async () => {
    const ev = event([
      { type: 'DatabaseError', value: 'INSERT INTO users failed: DUPLICATE KEY', frames: [] },
    ]);
    const res = await provider.analyseRootCause(rcRequest(ev));
    expect(res.candidates.some((c) => c.summary.includes('SQL'))).toBe(true);
  });

  test('Fallback when no rule matches', async () => {
    const ev = event([{ type: 'CustomError', value: 'totally unknown', frames: [] }]);
    const res = await provider.analyseRootCause(rcRequest(ev));
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0]?.confidence).toBeLessThanOrEqual(0.3);
  });
});

describe('HeuristicSeerProvider — summariseIssue', () => {
  test('builds a headline + bullet points', async () => {
    const ev = event(
      [
        {
          type: 'TypeError',
          value: 'cannot read properties of undefined',
          frames: [{ function: 'handler', filename: 'src/handler.ts', lineno: 88, inApp: true }],
        },
      ],
      { tags: { environment: 'production' } },
    );
    const req: SummaryRequest = { groupId: 'g1', groupHash: 'h1', event: ev };
    const res = await provider.summariseIssue(req);
    expect(res.summary).toContain('TypeError');
    expect(res.bulletPoints.some((b) => b.includes('handler'))).toBe(true);
    expect(res.bulletPoints.some((b) => b.includes('Environment: production'))).toBe(true);
  });

  test('falls back to event.message when no exception is present', async () => {
    const ev: SampledEvent = { platform: 'javascript', exceptions: [], message: 'something broke' };
    const res = await provider.summariseIssue({ groupId: 'g', groupHash: 'h', event: ev });
    expect(res.summary).toBe('something broke');
  });
});

describe('HeuristicSeerProvider — suggestFix', () => {
  test('returns a descriptive non-patch suggestion', async () => {
    const res = await provider.suggestFix({
      cause: {
        summary: 'Property access on undefined',
        rationale: '...',
        confidence: 0.75,
      },
      sources: [],
    });
    expect(res.suggestions[0]?.patch).toBe('');
    expect(res.suggestions[0]?.explanation).toContain('Property access on undefined');
    expect(res.suggestions[0]?.confidence).toBe(0);
  });
});
