/**
 * In-memory queue for the e2e harness.
 *
 * Implements the `RelayQueue` interface from `@sr/app-relay`. The
 * production queue is `@sr/queue-core` (SegmentedLog backed by disk);
 * this harness uses an in-memory buffer per topic since the relay's
 * accept-or-reject behaviour and the ingest worker's parse behaviour
 * are what we want to exercise, not disk durability.
 */

import type { RelayQueue } from '@sr/app-relay';

export class InMemoryQueue implements RelayQueue {
  private readonly topics = new Map<string, Uint8Array[]>();
  private nextOffset = 0n;
  private _appendCount = 0;

  async append(topic: string, payload: Uint8Array): Promise<bigint> {
    const arr = this.topics.get(topic) ?? [];
    arr.push(payload);
    this.topics.set(topic, arr);
    const off = this.nextOffset;
    this.nextOffset++;
    this._appendCount++;
    return off;
  }

  /** Snapshot + clear: returns the appended records per topic. */
  drainAll(): Map<string, Uint8Array[]> {
    const out = new Map<string, Uint8Array[]>();
    for (const [t, arr] of this.topics) out.set(t, [...arr]);
    this.topics.clear();
    return out;
  }

  /** Non-destructive view. */
  peek(topic: string): readonly Uint8Array[] {
    return this.topics.get(topic) ?? [];
  }

  get appendCount(): number {
    return this._appendCount;
  }

  get topicNames(): readonly string[] {
    return [...this.topics.keys()];
  }
}