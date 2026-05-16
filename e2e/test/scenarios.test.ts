import { describe, expect, test } from 'bun:test';
import { Pipeline } from '../src/pipeline';
import { SCENARIOS } from '../src/scenarios';

describe('e2e scenarios — 20 common use cases', () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario.name} — ${scenario.description}`, async () => {
      const pipeline = new Pipeline();
      await scenario.emit(pipeline);
      await pipeline.flushAllTransports();
      let threw: unknown;
      try {
        await scenario.assert(pipeline);
      } catch (e) {
        threw = e;
      }
      if (threw) {
        const message =
          threw instanceof Error ? threw.message : String(threw);
        // Surface the error message in the bun:test output.
        expect.unreachable(`scenario "${scenario.name}" failed: ${message}`);
      }
    });
  }

  test('scenarios cover at least 20 distinct cases', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(20);
    const names = new Set(SCENARIOS.map((s) => s.name));
    expect(names.size).toBe(SCENARIOS.length);
  });
});