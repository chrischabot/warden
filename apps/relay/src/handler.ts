/**
 * Relay request handler.
 *
 * Per spec §3.1, applies (in order):
 *   1. URL/method routing for POST /api/{project_id}/envelope/[/]
 *   2. Streaming envelope parse
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
 * Dependencies (queue, rate limiter, sampler, scrubber, outcomes)
 * are all injected so unit tests can use stubs and production
 * wiring can compose them however needed.
 */

import type { OutcomeRecorder } from '@sr/outcomes';
import type { Scrubber } from '@sr/pii';
import type { EnvelopeHeader, ItemHeader } from '@sr/proto';
import { parseEnvelopeStream } from '@sr/proto';
import type { RateLimiter } from '@sr/rate-limit';
import type { Sampler } from '@sr/sampling';

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

export function createRelay(deps: RelayDeps): RelayHandler {
  return {
    async fetch(request: Request): Promise<Response> {
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return jsonResponse({ error: 'invalid url' }, 400);
      }

      const match = PATH_RE.exec(url.pathname);
      if (!match) return jsonResponse({ error: 'not found' }, 404);
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'method not allowed' }, 405);
      }
      const projectId = match[1] as string;

      const body = request.body;
      if (!body) return jsonResponse({ error: 'missing body' }, 400);

      let envHeader: EnvelopeHeader | undefined;
      let accepted = 0;
      let rateLimited = 0;
      let filtered = 0;
      try {
        for await (const ev of parseEnvelopeStream(body)) {
          if (ev.kind === 'envelope-header') {
            envHeader = ev.header;
            continue;
          }
          const itemType = String(ev.header.type);
          const topic = `${projectId}:${itemType}`;

          // (a) Rate limit.
          if (deps.rateLimiter) {
            const decision = deps.rateLimiter.check(projectId, itemType, 1);
            if (decision === 'rate_limited') {
              rateLimited++;
              deps.outcomes?.record({
                projectId,
                dataCategory: itemType,
                reason: 'rate_limited',
              });
              continue;
            }
          }

          // (b) Dynamic sampling.
          if (deps.sampler) {
            const traceId = envHeader?.trace?.trace_id as string | undefined;
            const sampleEvent: Parameters<typeof deps.sampler.decide>[0] = { item_type: itemType };
            if (traceId !== undefined) {
              (sampleEvent as { trace_id?: string }).trace_id = traceId;
            }
            const env = envHeader?.trace?.environment as string | undefined;
            if (env !== undefined) (sampleEvent as { environment?: string }).environment = env;
            const rel = envHeader?.trace?.release as string | undefined;
            if (rel !== undefined) (sampleEvent as { release?: string }).release = rel;
            const tx = envHeader?.trace?.transaction as string | undefined;
            if (tx !== undefined) (sampleEvent as { transaction?: string }).transaction = tx;
            const decision = deps.sampler.decide(sampleEvent);
            if (decision.decision === 'drop') {
              filtered++;
              deps.outcomes?.record({
                projectId,
                dataCategory: itemType,
                reason: 'filtered',
              });
              continue;
            }
          }

          // (c) PII scrub for JSON item payloads.
          let payload = ev.payload;
          if (deps.scrubber && JSON_ITEM_TYPES.has(itemType)) {
            payload = scrubJsonPayload(deps.scrubber, payload);
          }

          // (d) Enqueue.
          const wire = encodeItemForQueue(ev.header, payload);
          await deps.queue.append(topic, wire);
          accepted++;

          // (e) Accepted outcome.
          deps.outcomes?.record({
            projectId,
            dataCategory: itemType,
            reason: 'accepted',
          });
        }
      } catch (e) {
        deps.outcomes?.record({
          projectId,
          dataCategory: 'envelope',
          reason: 'invalid',
        });
        return jsonResponse({ error: 'bad envelope', detail: (e as Error).message }, 400);
      }

      const status = accepted > 0 ? 200 : rateLimited > 0 ? 429 : 200;
      const id = (envHeader?.event_id as string | undefined) ?? null;
      return jsonResponse({ id, accepted, rate_limited: rateLimited, filtered }, status);
    },
  };
}

function scrubJsonPayload(scrubber: Scrubber, payload: Uint8Array): Uint8Array {
  const text = utf8Decoder.decode(payload);
  let scrubbed: string;
  try {
    const obj = JSON.parse(text) as unknown;
    const cleaned = scrubber.scrub(obj);
    scrubbed = JSON.stringify(cleaned);
  } catch {
    scrubbed = scrubber.scrubString(text);
  }
  return utf8Encoder.encode(scrubbed);
}

function encodeItemForQueue(header: ItemHeader, payload: Uint8Array): Uint8Array {
  const headerObj: Record<string, unknown> = { ...header };
  headerObj['length'] = payload.byteLength;
  const headerBytes = utf8Encoder.encode(JSON.stringify(headerObj));
  const out = new Uint8Array(headerBytes.byteLength + 1 + payload.byteLength);
  out.set(headerBytes, 0);
  out[headerBytes.byteLength] = 0x0a;
  out.set(payload, headerBytes.byteLength + 1);
  return out;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
