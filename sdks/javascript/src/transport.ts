/**
 * SDK transport.
 *
 * The `Transport` interface separates envelope production from
 * delivery so unit tests can inject stubs without HTTP.
 *
 * `HttpTransport` posts to a relay endpoint via global `fetch`,
 * which works on Bun, Node 18+, browsers, and Workers without any
 * additional dependency. Fire-and-forget by default; awaitable
 * via `flush()` for tests and graceful shutdown.
 */

export interface Transport {
  /** Hand the envelope bytes to the transport. Resolves when accepted (not necessarily delivered). */
  send(envelope: Uint8Array): Promise<void>;
  /** Wait for all in-flight sends to settle. Optional timeout. */
  flush(timeoutMs?: number): Promise<boolean>;
}

export interface HttpTransportOptions {
  /** Extra headers to attach (e.g. `X-Sentry-Auth`). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Concurrency cap. Default 4. */
  readonly maxConcurrent?: number;
}

const DEFAULT_MAX_CONCURRENT = 4;

export class HttpTransport implements Transport {
  readonly envelopeUrl: string;
  private readonly headers: Record<string, string>;
  private readonly maxConcurrent: number;
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(envelopeUrl: string, options: HttpTransportOptions = {}) {
    if (typeof envelopeUrl !== 'string' || envelopeUrl.length === 0) {
      throw new RangeError('HttpTransport: envelopeUrl is required');
    }
    this.envelopeUrl = envelopeUrl;
    this.headers = {
      'content-type': 'application/x-sentry-envelope',
      ...(options.headers ?? {}),
    };
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  }

  async send(envelope: Uint8Array): Promise<void> {
    // Back-pressure: wait until under concurrency cap.
    while (this.inflight.size >= this.maxConcurrent) {
      await Promise.race(this.inflight);
    }
    const p = fetch(this.envelopeUrl, {
      method: 'POST',
      body: envelope as BodyInit,
      headers: this.headers,
    });
    this.inflight.add(p);
    p.finally(() => this.inflight.delete(p)).catch(() => {
      // Swallow per-request errors at the field level; tests/integrations
      // can override `send` to surface them.
    });
    // We resolve the caller's `send()` once we've enqueued the fetch.
    // Production might want to delay until the response arrives;
    // we expose that via `flush()`.
    await Promise.resolve();
  }

  async flush(timeoutMs?: number): Promise<boolean> {
    if (this.inflight.size === 0) return true;
    const all = Promise.allSettled(this.inflight).then(() => true);
    if (timeoutMs === undefined) return all;
    const timer = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(this.inflight.size === 0), timeoutMs),
    );
    return Promise.race([all, timer]);
  }
}

/** A no-op transport useful for unit tests. */
export class NoopTransport implements Transport {
  readonly sent: Uint8Array[] = [];

  async send(envelope: Uint8Array): Promise<void> {
    this.sent.push(envelope);
  }

  async flush(): Promise<boolean> {
    return true;
  }
}
