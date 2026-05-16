/**
 * Replay metadata and segment store.
 *
 * Segments are recorded with a monotone `sequenceId` per replay.
 * Recording an out-of-order or duplicate sequenceId rejects.
 */

import type {
  CreateReplayInput,
  ReplayListOptions,
  ReplayMetadata,
  ReplayQuery,
  ReplaySegment,
} from './types';

export class ReplayStore {
  private readonly replays = new Map<string, ReplayMetadata>();
  private readonly segmentsByReplay = new Map<string, ReplaySegment[]>();

  createReplay(input: CreateReplayInput): ReplayMetadata {
    if (this.replays.has(input.replayId)) {
      throw new RangeError(`ReplayStore: replay "${input.replayId}" already exists`);
    }
    const replay: ReplayMetadata = {
      id: input.replayId,
      projectId: input.projectId,
      ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
      ...(input.user !== undefined ? { user: input.user } : {}),
      ...(input.browser !== undefined ? { browser: input.browser } : {}),
      ...(input.os !== undefined ? { os: input.os } : {}),
      ...(input.platform !== undefined ? { platform: input.platform } : {}),
      startedAt: input.startedAt,
      lastSeenAt: input.startedAt,
      durationMs: 0,
      segmentCount: 0,
      errorCount: 0,
      urls: [],
      releases: input.release !== undefined ? [input.release] : [],
      ...(input.environment !== undefined ? { environment: input.environment } : {}),
      status: 'ongoing',
    };
    this.replays.set(input.replayId, replay);
    this.segmentsByReplay.set(input.replayId, []);
    return replay;
  }

  recordSegment(segment: ReplaySegment): ReplayMetadata {
    const replay = this.replays.get(segment.replayId);
    if (!replay) {
      throw new RangeError(`ReplayStore.recordSegment: replay "${segment.replayId}" not found`);
    }
    if (replay.status === 'completed') {
      throw new RangeError(
        `ReplayStore.recordSegment: replay "${segment.replayId}" already completed`,
      );
    }
    const segments = this.segmentsByReplay.get(segment.replayId) ?? [];
    const lastSeq =
      segments.length > 0 ? (segments[segments.length - 1] as ReplaySegment).sequenceId : -1;
    if (segment.sequenceId <= lastSeq) {
      throw new RangeError(
        `ReplayStore.recordSegment: sequenceId ${segment.sequenceId} not greater than last ${lastSeq}`,
      );
    }
    segments.push(segment);
    this.segmentsByReplay.set(segment.replayId, segments);

    replay.segmentCount += 1;
    replay.errorCount += segment.errorCount;
    if (segment.endTimestamp > replay.lastSeenAt) {
      replay.lastSeenAt = segment.endTimestamp;
      replay.durationMs = replay.lastSeenAt - replay.startedAt;
    }
    if (segment.url && !replay.urls.includes(segment.url)) {
      replay.urls.push(segment.url);
    }
    if (segment.isFinal) {
      replay.status = 'completed';
    }
    return replay;
  }

  /** Add a release marker observed in this replay (e.g. from an error event). */
  observeRelease(replayId: string, release: string): void {
    const replay = this.replays.get(replayId);
    if (!replay) return;
    if (!replay.releases.includes(release)) replay.releases.push(release);
  }

  get(replayId: string): ReplayMetadata | undefined {
    return this.replays.get(replayId);
  }

  segments(replayId: string): readonly ReplaySegment[] {
    return Object.freeze([...(this.segmentsByReplay.get(replayId) ?? [])]);
  }

  list(
    query: ReplayQuery = {},
    options: ReplayListOptions = {},
  ): { readonly replays: readonly ReplayMetadata[]; readonly total: number } {
    const filtered: ReplayMetadata[] = [];
    for (const r of this.replays.values()) {
      if (matches(r, query)) filtered.push(r);
    }
    const sortBy = options.sortBy ?? 'started_at';
    const dir = options.sortDir ?? 'desc';
    const mult = dir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      let av: number;
      let bv: number;
      switch (sortBy) {
        case 'duration':
          av = a.durationMs;
          bv = b.durationMs;
          break;
        case 'error_count':
          av = a.errorCount;
          bv = b.errorCount;
          break;
        case 'started_at':
        default:
          av = a.startedAt;
          bv = b.startedAt;
          break;
      }
      if (av !== bv) return (av - bv) * mult;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    return Object.freeze({
      replays: Object.freeze(filtered.slice(offset, offset + limit)),
      total: filtered.length,
    });
  }
}

function matches(r: ReplayMetadata, q: ReplayQuery): boolean {
  if (q.projectId !== undefined && r.projectId !== q.projectId) return false;
  if (q.userId !== undefined && r.user?.id !== q.userId) return false;
  if (q.url !== undefined && !r.urls.includes(q.url)) return false;
  if (q.hasErrors === true && r.errorCount === 0) return false;
  if (q.hasErrors === false && r.errorCount > 0) return false;
  if (q.sinceTimestamp !== undefined && r.startedAt < q.sinceTimestamp) return false;
  if (q.untilTimestamp !== undefined && r.startedAt > q.untilTimestamp) return false;
  return true;
}
