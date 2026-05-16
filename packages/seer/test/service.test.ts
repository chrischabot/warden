import { describe, expect, test } from 'bun:test';
import { HeuristicSeerProvider } from '../src/heuristic-provider';
import { SeerService } from '../src/service';
import type {
  FixRequest,
  FixResponse,
  RootCauseRequest,
  RootCauseResponse,
  SeerProvider,
  SummaryRequest,
  SummaryResponse,
} from '../src/types';

class CountingProvider implements SeerProvider {
  readonly name = 'counting';
  calls = { rc: 0, fix: 0, sum: 0 };
  async analyseRootCause(_request: RootCauseRequest): Promise<RootCauseResponse> {
    this.calls.rc += 1;
    return Object.freeze({ groupId: _request.groupId, candidates: [], providerLatencyMs: 0 });
  }
  async suggestFix(_request: FixRequest): Promise<FixResponse> {
    this.calls.fix += 1;
    return Object.freeze({ suggestions: [], providerLatencyMs: 0 });
  }
  async summariseIssue(_request: SummaryRequest): Promise<SummaryResponse> {
    this.calls.sum += 1;
    return Object.freeze({ summary: 'x', bulletPoints: [], providerLatencyMs: 0 });
  }
}

function rcRequest(): RootCauseRequest {
  return {
    projectId: '1',
    groupId: 'g1',
    groupHash: 'h1',
    event: {
      platform: 'javascript',
      exceptions: [{ type: 'TypeError', value: 'x', frames: [] }],
    },
  };
}

describe('SeerService caching', () => {
  test('repeated identical request hits cache', async () => {
    const provider = new CountingProvider();
    const service = new SeerService(provider);
    await service.analyseRootCause(rcRequest());
    await service.analyseRootCause(rcRequest());
    await service.analyseRootCause(rcRequest());
    expect(provider.calls.rc).toBe(1);
    expect(service.stats().hits).toBe(2);
    expect(service.stats().misses).toBe(1);
  });

  test('different group => different cache slot', async () => {
    const provider = new CountingProvider();
    const service = new SeerService(provider);
    await service.analyseRootCause(rcRequest());
    await service.analyseRootCause({ ...rcRequest(), groupHash: 'h2' });
    expect(provider.calls.rc).toBe(2);
  });

  test('TTL expiry triggers re-fetch', async () => {
    let clock = 1000;
    const provider = new CountingProvider();
    const service = new SeerService(provider, {
      cacheTtlMs: 1000,
      now: () => clock,
    });
    await service.analyseRootCause(rcRequest());
    clock += 999;
    await service.analyseRootCause(rcRequest());
    expect(provider.calls.rc).toBe(1);
    clock += 2;
    await service.analyseRootCause(rcRequest());
    expect(provider.calls.rc).toBe(2);
  });

  test('cache capacity LRU-evicts oldest entry', async () => {
    const provider = new CountingProvider();
    const service = new SeerService(provider, { cacheCapacity: 2 });
    await service.analyseRootCause({ ...rcRequest(), groupHash: 'a' });
    await service.analyseRootCause({ ...rcRequest(), groupHash: 'b' });
    await service.analyseRootCause({ ...rcRequest(), groupHash: 'c' });
    // 'a' should have been evicted; touching it again incurs a miss.
    await service.analyseRootCause({ ...rcRequest(), groupHash: 'a' });
    expect(provider.calls.rc).toBe(4);
  });

  test('clear empties cache and resets counters', async () => {
    const provider = new CountingProvider();
    const service = new SeerService(provider);
    await service.analyseRootCause(rcRequest());
    await service.analyseRootCause(rcRequest());
    expect(service.stats().hits).toBe(1);
    service.clear();
    expect(service.stats()).toEqual({ hits: 0, misses: 0, size: 0 });
  });

  test('integrates with the heuristic provider end-to-end', async () => {
    const service = new SeerService(new HeuristicSeerProvider());
    const res1 = await service.analyseRootCause(rcRequest());
    const res2 = await service.analyseRootCause(rcRequest());
    expect(res1).toBe(res2); // same cached object reference
  });
});
