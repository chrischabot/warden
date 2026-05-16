/**
 * Session replay types per spec §5.4.
 *
 * A `Replay` aggregates a user's session. Segments arrive
 * incrementally as the session progresses; each segment carries an
 * opaque `payload` (rrweb event stream bytes — we don't interpret
 * them here) and a monotone `sequenceId`. The Replay's metadata
 * fields (startedAt, lastSeenAt, duration, errorCount, urls) are
 * advanced by `recordSegment`.
 */

export interface ReplayMetadata {
  readonly id: string;
  readonly projectId: string;
  readonly traceId?: string;
  readonly user?: { id?: string; email?: string };
  readonly browser?: { name?: string; version?: string };
  readonly os?: { name?: string; version?: string };
  readonly platform?: string;
  startedAt: number;
  lastSeenAt: number;
  durationMs: number;
  segmentCount: number;
  errorCount: number;
  /** URLs the user visited, in encounter order. */
  urls: string[];
  releases: string[];
  environment?: string;
  /** Final state: 'completed' when sentinel reached, 'ongoing' otherwise. */
  status: 'ongoing' | 'completed';
}

export interface ReplaySegment {
  readonly replayId: string;
  readonly sequenceId: number;
  readonly receivedAt: number;
  readonly startTimestamp: number;
  readonly endTimestamp: number;
  readonly payload: Uint8Array;
  /** Optional URL visited within this segment. */
  readonly url?: string;
  /** Number of errors captured in this segment. */
  readonly errorCount: number;
  /** If true, this is the final segment — sets the replay to `completed`. */
  readonly isFinal?: boolean;
}

export interface CreateReplayInput {
  readonly replayId: string;
  readonly projectId: string;
  readonly traceId?: string;
  readonly user?: { id?: string; email?: string };
  readonly browser?: { name?: string; version?: string };
  readonly os?: { name?: string; version?: string };
  readonly platform?: string;
  readonly release?: string;
  readonly environment?: string;
  readonly startedAt: number;
}

export interface ReplayQuery {
  readonly projectId?: string;
  readonly userId?: string;
  readonly url?: string;
  readonly hasErrors?: boolean;
  readonly sinceTimestamp?: number;
  readonly untilTimestamp?: number;
}

export interface ReplayListOptions {
  readonly sortBy?: 'started_at' | 'duration' | 'error_count';
  readonly sortDir?: 'asc' | 'desc';
  readonly limit?: number;
  readonly offset?: number;
}
