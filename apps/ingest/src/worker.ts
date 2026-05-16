/**
 * Ingest worker — consumes envelope item records from the queue
 * and runs the spec §3.3 pipeline:
 *
 *   parse → validate → normalize → group → symbolicate → save
 *
 * This first cut wires three of the six stages:
 *   - parse:    item header + payload from queue record bytes
 *   - group:    event fingerprinting via @sr/grouping
 *   - save:     hand the processed item to a dependency-injected sink
 *
 * Validation, normalization, and symbolication are pluggable hooks
 * that take an `Item` in and return an `Item` out; the default
 * implementations are identity. As the spec rings progress (Ring 4
 * for grouping-state updates, Ring 2 wave-2 for native
 * symbolicator), the orchestrator wires real implementations in.
 *
 * The worker doesn't manage its own queue source; the caller hands
 * it an `AsyncIterable<QueueMessage>` (e.g. an adapter over
 * `SegmentedLog.read()`), so tests can inject in-memory streams.
 */

import type { Event, GroupingResult } from '@sr/grouping';
import { fingerprintEvent } from '@sr/grouping';
import type { ItemHeader } from '@sr/proto';

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

export interface QueueMessage {
  /** Opaque offset used to ack the message back to the queue. */
  readonly offset: bigint;
  /** Topic the message was consumed from. */
  readonly topic: string;
  /** Item header + LF + payload, as written by the relay. */
  readonly payload: Uint8Array;
}

export interface ParsedItem {
  readonly topic: string;
  readonly header: ItemHeader;
  readonly payload: Uint8Array;
}

export interface ProcessedEvent {
  readonly topic: string;
  readonly header: ItemHeader;
  readonly event: Event;
  readonly grouping: GroupingResult;
}

export type SinkPayload = ProcessedEvent | ParsedItem;

export interface IngestSink {
  /**
   * Save a processed event (or pass-through item for non-event
   * types). Resolves when the sink has accepted ownership of the
   * payload.
   */
  save(payload: SinkPayload): Promise<void>;
}

export interface IngestOptions {
  /**
   * Maximum concurrent in-flight items. Use 1 (default) for strict
   * in-order processing; higher numbers trade ordering for throughput.
   */
  readonly concurrency?: number;
}

export class IngestParseError extends Error {
  public readonly topic: string;
  public readonly offset: bigint;
  constructor(message: string, topic: string, offset: bigint) {
    super(message);
    this.name = 'IngestParseError';
    this.topic = topic;
    this.offset = offset;
  }
}

/**
 * Run the worker against an async iterable of queue messages.
 * Returns when the source closes; tests typically drive a finite
 * iterable, production drives an unbounded one.
 */
export async function runWorker(
  source: AsyncIterable<QueueMessage>,
  sink: IngestSink,
  options: IngestOptions = {},
): Promise<{ processed: number; failed: number }> {
  const concurrency = Math.max(1, options.concurrency ?? 1);
  let processed = 0;
  let failed = 0;

  if (concurrency === 1) {
    // Strict in-order — process one at a time.
    for await (const msg of source) {
      try {
        await processOne(msg, sink);
        processed++;
      } catch {
        failed++;
      }
    }
    return { processed, failed };
  }

  // Bounded concurrent processing while preserving the async-iter source.
  const inflight = new Set<Promise<void>>();
  for await (const msg of source) {
    const p = (async () => {
      try {
        await processOne(msg, sink);
        processed++;
      } catch {
        failed++;
      }
    })();
    inflight.add(p);
    p.finally(() => inflight.delete(p));
    if (inflight.size >= concurrency) {
      await Promise.race(inflight);
    }
  }
  await Promise.all(inflight);
  return { processed, failed };
}

/** Process a single queue message end-to-end. Exported for unit testing. */
export async function processOne(msg: QueueMessage, sink: IngestSink): Promise<void> {
  const item = parseQueueRecord(msg);
  const itemType = String(item.header.type);
  if (itemType === 'event' || itemType === 'transaction') {
    const event = parseEventPayload(item.payload, msg.topic, msg.offset);
    const grouping = fingerprintEvent(event);
    await sink.save({ topic: item.topic, header: item.header, event, grouping });
    return;
  }
  // Non-event items pass through with no fingerprinting.
  await sink.save(item);
}

/**
 * Split a queue record (item header line + LF + payload) back into
 * `{ header, payload }`. Inverse of the relay's `encodeItemForQueue`.
 */
export function parseQueueRecord(msg: QueueMessage): ParsedItem {
  const lf = msg.payload.indexOf(0x0a);
  if (lf < 0) {
    throw new IngestParseError('queue record missing LF separator', msg.topic, msg.offset);
  }
  const headerText = utf8Decoder.decode(msg.payload.subarray(0, lf));
  let header: ItemHeader;
  try {
    const parsed = JSON.parse(headerText) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`expected JSON object, got ${typeof parsed}`);
    }
    header = parsed as ItemHeader;
  } catch (e) {
    throw new IngestParseError(
      `invalid item header: ${(e as Error).message}`,
      msg.topic,
      msg.offset,
    );
  }
  const payload = msg.payload.subarray(lf + 1);
  return Object.freeze({ topic: msg.topic, header, payload });
}

function parseEventPayload(payload: Uint8Array, topic: string, offset: bigint): Event {
  let text: string;
  try {
    text = utf8Decoder.decode(payload);
  } catch (e) {
    throw new IngestParseError(
      `invalid UTF-8 in event payload: ${(e as Error).message}`,
      topic,
      offset,
    );
  }
  try {
    const obj = JSON.parse(text) as unknown;
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new IngestParseError(`event payload is not a JSON object`, topic, offset);
    }
    return obj as Event;
  } catch (e) {
    if (e instanceof IngestParseError) throw e;
    throw new IngestParseError(
      `invalid JSON in event payload: ${(e as Error).message}`,
      topic,
      offset,
    );
  }
}
