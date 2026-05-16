import { describe, expect, test } from 'bun:test';
import { renderText } from '@sr/metrics';
import {
  sourceCountBucket,
  storeCompactionDebtSegments,
  storeCompactionLatencySeconds,
  storeMemtableBytes,
  storeQueryLatencySeconds,
  storeSegmentCount,
  storeWriteLatencySeconds,
} from '../src/metrics';

describe('sr_store_* metrics — registration', () => {
  test('all metrics register and appear in renderText', async () => {
    // Touch each so it appears in output.
    storeWriteLatencySeconds.observe({ op: 'addRow', shard: '0' }, 0.001);
    storeMemtableBytes.set({ shard: '0' }, 123456);
    storeSegmentCount.set({ project_id: '1', tier: 'L0' }, 12);
    storeCompactionDebtSegments.set({ tier: 'L0' }, 4);
    storeQueryLatencySeconds.observe({ op: 'discover' }, 0.05);
    storeCompactionLatencySeconds.observe({ source_count: '4' }, 0.5);

    const text = await renderText();
    expect(text).toContain('sr_store_write_latency_seconds');
    expect(text).toContain('sr_store_memtable_bytes');
    expect(text).toContain('sr_store_segment_count');
    expect(text).toContain('sr_store_compaction_debt_segments');
    expect(text).toContain('sr_store_query_latency_seconds');
    expect(text).toContain('sr_store_compaction_latency_seconds');
  });

  test('write-latency carries op + shard labels', async () => {
    storeWriteLatencySeconds.observe({ op: 'addRow', shard: '7' }, 0.01);
    const text = await renderText();
    expect(text).toMatch(
      /sr_store_write_latency_seconds_count\{[^}]*op="addRow"[^}]*shard="7"[^}]*\}/,
    );
  });
});

describe('sourceCountBucket', () => {
  test('buckets coarsely so cardinality stays bounded', () => {
    expect(sourceCountBucket(1)).toBe('2');
    expect(sourceCountBucket(2)).toBe('2');
    expect(sourceCountBucket(3)).toBe('4');
    expect(sourceCountBucket(4)).toBe('4');
    expect(sourceCountBucket(5)).toBe('8');
    expect(sourceCountBucket(8)).toBe('8');
    expect(sourceCountBucket(9)).toBe('16');
    expect(sourceCountBucket(16)).toBe('16');
    expect(sourceCountBucket(17)).toBe('32');
    expect(sourceCountBucket(32)).toBe('32');
    expect(sourceCountBucket(33)).toBe('32+');
    expect(sourceCountBucket(1000)).toBe('32+');
  });
});
