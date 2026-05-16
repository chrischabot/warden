import { describe, expect, test } from 'bun:test';
import { ENVELOPE_TYPES } from '../src/envelope-types';
import { Pipeline } from '../src/pipeline';

describe('e2e envelope types — 10 item types', () => {
  for (const item of ENVELOPE_TYPES) {
    test(`type=${item.type} — ${item.description}`, async () => {
      const pipeline = new Pipeline();
      await item.send(pipeline, '1');
      let threw: unknown;
      try {
        item.assert(pipeline, '1');
      } catch (e) {
        threw = e;
      }
      if (threw) {
        const message = threw instanceof Error ? threw.message : String(threw);
        expect.unreachable(`envelope type "${item.type}" failed: ${message}`);
      }
    });
  }

  test('envelope-type coverage is at least 10', () => {
    expect(ENVELOPE_TYPES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ENVELOPE_TYPES.map((t) => t.type)).size).toBe(ENVELOPE_TYPES.length);
  });
});