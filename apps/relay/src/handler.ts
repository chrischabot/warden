/**
 * Relay request handler.
 *
 * Per spec §3.1, applies (in order):
 *   1. URL/method routing for POST /api/{project_id}/envelope/[/]
 *   2. Parse envelope (sync over buffered body — see note).
 *   3. For each envelope item:
 *        a. Rate-limit per (project_id, item.type). Reject → 429 + rate_limited outcome.
 *        b. Dynamic sample (trace-scoped, deterministic on envelope trace_id).
 *           Drop → filtered outcome, no enqueue.
 *        c. PII-scrub the payload for JSON item types — never attachments.
 *        d. Enqueue (header line + LF + payload) to the dependency-injected queue.
 *        e. Accepted outcome.
 *   4. Envelope-level invalid outcome + 400 on parse error.
 *   5. Returns 200 with { id, accepted, rate_limited, filtered }.
 *
 * Why buffer the body and parse synchronously:
 *   The streaming parser allocated a growing `buf` internally and
 *   only yielded items after the relevant chunks had been read,
 *   so it was never actually streaming in the memory sense. It
 *   was paying async-generator + per-`reader.read()` microtask
 *   overhead on every envelope (~24 μs/envelope of pure
 *   plumbing on a 2 vCPU sandbox). Buffering once into a single
 *   `Uint8Array` and walking it synchronously delivers identical
 *   memory cost and avoids the plumbing tax. Production callers
 *   that need to gate by content-length can do so in front of
 *   this handler.
 *
 * Performance:
 *   - URL routing uses a single regex against `request.url` after
 *     a cheap prefix scan; avoids the per-request `new URL()`
 *     allocation. Fragment (`#…`) and query (`?…`) are stripped so
 *     the matched path equals `new URL().pathname`.
 *   - One `Date.now()` per envelope is reused across items.
 *   - The sampler input is built with a fixed shape (all fields
 *     always present on the object; absent ones set to `undefined`)
 *     so JSC keeps a single hidden class for the sampler's `decide`
 *     call site.
 *   - Outcomes are aggregated by reason per envelope and recorded
 *     in a single call per reason at the end, rather than one
 *     record per item.
 *   - The PII scrubber operates on the raw JSON string when it
 *     might contain PII, and is skipped entirely otherwise.
 */

import type { OutcomeRecorder } from '@sr/outcomes';
import type { Scrubber } from '@sr/pii';
import type { ItemHeader } from '@sr/proto';
import { parseEnvelope } from '@sr/proto';
import type { RateLimiter } from '@sr/rate-limit';
import type { EventLike, Sampler } from '@sr/sampling';

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
const utf8Encoder = new TextEncoder();

const JSON_ITEM_TYPES: ReadonlySet<string> = new Set([
  'event',
  'transaction',
  'session',
  'sessions',
  'log',
  'otel_log',
  'otel_span',
  'user_report',
  'feedback',
  'replay_event',
  'check_in',
  'statsd',
  'client_report',
]);

export interface RelayQueue {
  append(topic: string, payload: Uint8Array): Promise<bigint>;
}

export interface RelayDeps {
  readonly queue: RelayQueue;
  readonly rateLimiter?: RateLimiter;
  readonly sampler?: Sampler;
  readonly scrubber?: Scrubber;
  readonly outcomes?: OutcomeRecorder;
}

export interface RelayHandler {
  fetch(request: Request): Promise<Response>;
}

const PATH_RE = /^\/api\/(\d+)\/envelope\/?$/;

interface SamplerInput extends EventLike {
  item_type: string | undefined;
  trace_id: string | undefined;
  environment: string | undefined;
  release: string | undefined;
  transaction: string | undefined;
  platform: string | undefined;
  user_id: string | undefined;
}

export function createRelay(deps: RelayDeps): RelayHandler {
  const queue = deps.queue;
  const rateLimiter = deps.rateLimiter;
  const sampler = deps.sampler;
  const scrubber = deps.scrubber;
  const outcomes = deps.outcomes;
  const samplerActive = sampler !== undefined && !sampler.trivialKeep;
  const scrubberActive = scrubber !== undefined;
  const rateLimiterActive = rateLimiter !== undefined;
  const outcomesActive = outcomes !== undefined;

  return {
    async fetch(request: Request): Promise<Response> {
      const path = extractPath(request.url);
      if (!path) return jsonResponse({ error: 'invalid url' }, 400);
      const match = PATH_RE.exec(path);
      if (!match) return jsonResponse({ error: 'not found' }, 404);
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'method not allowed' }, 405);
      }
      const projectId = match[1] as string;

      const body = request.body;
      if (!body) return jsonResponse({ error: 'missing body' }, 400);

      // Buffer the body once. arrayBuffer() coalesces chunks for us;
      // the streaming parser was doing this internally anyway.
      let bodyBytes: Uint8Array;
      try {
        bodyBytes = new Uint8Array(await request.arrayBuffer());
      } catch (e) {
        return jsonResponse({ error: 'body read failed', detail: (e as Error).message }, 400);
      }

      let env;
      try {
        env = parseEnvelope(bodyBytes);
      } catch (e) {
        if (outcomesActive) {
          outcomes.record({
            projectId,
            dataCategory: 'envelope',
            reason: 'invalid',
          });
        }
        return jsonResponse({ error: 'bad envelope', detail: (e as Error).message }, 400);
      }

      const now = Date.now();

      let accepted = 0;
      let rateLimited = 0;
      let filtered = 0;

      // Stable-shape sampler input. Trace-scoped fields filled once.
      const trace = env.header.trace;
      const sampleInput: SamplerInput = {
        item_type: undefined,
        trace_id: trace?.trace_id as string | undefined,
        environment: trace?.environment as string | undefined,
        release: trace?.release as string | undefined,
        transaction: trace?.transaction as string | undefined,
        platform: undefined,
        user_id: undefined,
      };

      const outcomeCounts = new Map<string, number>();

      for (const item of env.items) {
        const itemType = String(item.header.type);
        const topic = `${projectId}:${itemType}`;

        // (a) Rate limit.
        if (rateLimiterActive) {
          const decision = rateLimiter.check(projectId, itemType, 1, now);
          if (decision === 'rate_limited') {
            rateLimited++;
            if (outcomesActive) incCount(outcomeCounts, itemType, 'rate_limited');
            continue;
          }
        }

        // (b) Dynamic sampling.
        if (samplerActive) {
          sampleInput.item_type = itemType;
          const decision = sampler.decide(sampleInput);
          if (decision.decision === 'drop') {
            filtered++;
            if (outcomesActive) incCount(outcomeCounts, itemType, 'filtered');
            continue;
          }
        }

        // (c) PII scrub for JSON item payloads.
        let payload = item.payload;
        if (scrubberActive && JSON_ITEM_TYPES.has(itemType)) {
          payload = scrubJsonPayloadFast(scrubber, payload);
        }

        // (d) Enqueue.
        const wire = encodeItemForQueue(item.header, payload);
        await queue.append(topic, wire);
        accepted++;

        // (e) Accepted outcome — aggregated.
        if (outcomesActive) incCount(outcomeCounts, itemType, 'accepted');
      }

      if (outcomesActive && outcomeCounts.size > 0) {
        for (const [key, quantity] of outcomeCounts) {
          if (quantity === 0) continue;
          const sep = key.indexOf('\u0000');
          const dataCategory = key.slice(0, sep);
          const reason = key.slice(sep + 1) as
            | 'accepted'
            | 'rate_limited'
            | 'filtered'
            | 'invalid';
          outcomes.record({
            projectId,
            dataCategory,
            reason,
            quantity,
          });
        }
      }

      const status = accepted > 0 ? 200 : rateLimited > 0 ? 429 : 200;
      const id = (env.header.event_id as string | undefined) ?? null;
      return jsonResponse({ id, accepted, rate_limited: rateLimited, filtered }, status);
    },
  };
}

function incCount(
  counts: Map<string, number>,
  dataCategory: string,
  reason: 'accepted' | 'rate_limited' | 'filtered' | 'invalid',
): void {
  const key = `${dataCategory}\u0000${reason}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function extractPath(url: string): string | undefined {
  const proto = url.indexOf('://');
  let pathStart: number;
  if (proto < 0) {
    pathStart = 0;
    if (!url.startsWith('/')) return undefined;
  } else {
    pathStart = url.indexOf('/', proto + 3);
    if (pathStart < 0) return '/';
  }
  let end = url.length;
  const q = url.indexOf('?', pathStart);
  if (q >= 0) end = q;
  const h = url.indexOf('#', pathStart);
  if (h >= 0 && h < end) end = h;
  return url.slice(pathStart, end);
}

function scrubJsonPayloadFast(scrubber: Scrubber, payload: Uint8Array): Uint8Array {
  const text = utf8Decoder.decode(payload);
  if (!scrubber.mayContainPii(text)) return payload;
  const scrubbed = scrubber.scrubRawJson(text);
  return utf8Encoder.encode(scrubbed);
}

function encodeItemForQueue(header: ItemHeader, payload: Uint8Array): Uint8Array {
  const t = header.type;
  const len = payload.byteLength;
  let headerJson: string;
  if (hasExtraKeys(header)) {
    const obj: Record<string, unknown> = { ...header };
    obj['length'] = len;
    headerJson = JSON.stringify(obj);
  } else {
    headerJson = `{"type":${JSON.stringify(t)},"length":${len}}`;
  }
  const headerBytes = utf8Encoder.encode(headerJson);
  const out = new Uint8Array(headerBytes.byteLength + 1 + len);
  out.set(headerBytes, 0);
  out[headerBytes.byteLength] = 0x0a;
  out.set(payload, headerBytes.byteLength + 1);
  return out;
}

function hasExtraKeys(header: ItemHeader): boolean {
  for (const k of Object.keys(header)) {
    if (k === 'type' || k === 'length') continue;
    return true;
  }
  return false;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}