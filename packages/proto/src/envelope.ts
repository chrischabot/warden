/**
 * Sentry envelope codec.
 *
 * Wire format (newline-delimited):
 *
 *   <envelope-header-json>\n
 *   <item-header-json>\n
 *   <item-payload-bytes>\n           # length-prefixed via item.length
 *   <item-header-json>\n
 *   <item-payload-line>\n            # no length; whole line is payload
 *   ...
 *
 * Either an item's header declares `length: N` (binary or
 * length-prefixed JSON) or it omits length, in which case the
 * payload is everything up to the next `\n`.
 */

import type { EnvelopeHeader, Item, ItemHeader } from './items';

const LF = 0x0a;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

export interface Envelope {
  readonly header: EnvelopeHeader;
  readonly items: readonly Item[];
}

export class EnvelopeParseError extends Error {
  public readonly atOffset: number;
  constructor(message: string, atOffset: number) {
    super(message);
    this.name = 'EnvelopeParseError';
    this.atOffset = atOffset;
  }
}

// ---------- Encoder ----------

/** Encode an envelope to a contiguous Uint8Array. */
export function encodeEnvelope(env: Envelope): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(enc.encode(JSON.stringify(env.header)));
  parts.push(Uint8Array.of(LF));
  for (const item of env.items) {
    const headerObj: Record<string, unknown> = { ...item.header };
    // Always emit `length` so downstream parsers can skip directly
    // over binary payloads without scanning for LF.
    if (typeof headerObj['length'] !== 'number') {
      headerObj['length'] = item.payload.byteLength;
    }
    parts.push(enc.encode(JSON.stringify(headerObj)));
    parts.push(Uint8Array.of(LF));
    parts.push(item.payload);
    parts.push(Uint8Array.of(LF));
  }
  return concat(parts);
}

// ---------- Eager parser ----------

/**
 * Parse an envelope from a complete byte buffer. For streaming
 * ingest, use `parseEnvelopeStream`.
 */
export function parseEnvelope(bytes: Uint8Array): Envelope {
  let off = 0;

  const headerLine = readLine(bytes, off);
  if (!headerLine) {
    throw new EnvelopeParseError('envelope is empty', 0);
  }
  off = headerLine.next;
  const header = parseJsonObject(headerLine.bytes, 0) as EnvelopeHeader;

  const items: Item[] = [];
  while (off < bytes.byteLength) {
    if (bytes[off] === LF) {
      off++;
      continue;
    }
    const itemHeaderStartOff = off;
    const itemHeaderLine = readLine(bytes, off);
    if (!itemHeaderLine) break;
    off = itemHeaderLine.next;
    const itemHeader = parseJsonObject(itemHeaderLine.bytes, itemHeaderStartOff) as ItemHeader;

    const declared = itemHeader.length;
    let payload: Uint8Array;
    if (typeof declared === 'number' && declared >= 0) {
      if (off + declared > bytes.byteLength) {
        throw new EnvelopeParseError(
          `item payload declared length ${declared} exceeds remaining buffer (have ${bytes.byteLength - off})`,
          off,
        );
      }
      payload = bytes.subarray(off, off + declared);
      off += declared;
      if (off < bytes.byteLength && bytes[off] === LF) off++;
    } else {
      const payloadLine = readLine(bytes, off);
      if (!payloadLine) {
        payload = new Uint8Array(0);
      } else {
        payload = payloadLine.bytes;
        off = payloadLine.next;
      }
    }

    items.push(Object.freeze({ header: itemHeader, payload }));
  }

  return Object.freeze({ header, items: Object.freeze(items) });
}

// ---------- Streaming parser ----------

export type StreamEvent =
  | { readonly kind: 'envelope-header'; readonly header: EnvelopeHeader }
  | { readonly kind: 'item'; readonly header: ItemHeader; readonly payload: Uint8Array };

/**
 * Streaming envelope parser. Yields the envelope header first, then
 * one event per item. The relay consumes this directly off
 * `req.body` so giant attachments never materialise as a single
 * object in memory.
 */
export async function* parseEnvelopeStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent, void, void> {
  const reader = stream.getReader();
  let buf = new Uint8Array(0);
  let eof = false;

  async function readMore(): Promise<boolean> {
    if (eof) return false;
    const { value, done } = await reader.read();
    if (done) {
      eof = true;
      return false;
    }
    if (value && value.byteLength > 0) {
      const next = new Uint8Array(buf.byteLength + value.byteLength);
      next.set(buf, 0);
      next.set(value, buf.byteLength);
      buf = next;
    }
    return true;
  }

  async function readLineFromBuf(): Promise<Uint8Array | null> {
    for (;;) {
      const idx = buf.indexOf(LF);
      if (idx >= 0) {
        const line = buf.subarray(0, idx);
        buf = buf.subarray(idx + 1);
        return line;
      }
      const got = await readMore();
      if (!got) {
        if (buf.byteLength === 0) return null;
        const line = buf;
        buf = new Uint8Array(0);
        return line;
      }
    }
  }

  async function readBytes(n: number): Promise<Uint8Array> {
    while (buf.byteLength < n) {
      const got = await readMore();
      if (!got) {
        throw new EnvelopeParseError(`unexpected EOF: need ${n} bytes, have ${buf.byteLength}`, 0);
      }
    }
    const out = buf.subarray(0, n);
    buf = buf.subarray(n);
    return out;
  }

  const envHeaderLine = await readLineFromBuf();
  if (!envHeaderLine || envHeaderLine.byteLength === 0) {
    throw new EnvelopeParseError('envelope is empty', 0);
  }
  const envHeader = parseJsonObject(envHeaderLine, 0) as EnvelopeHeader;
  yield { kind: 'envelope-header', header: envHeader };

  for (;;) {
    const itemHeaderLine = await readLineFromBuf();
    if (itemHeaderLine === null) return;
    if (itemHeaderLine.byteLength === 0) continue;
    const itemHeader = parseJsonObject(itemHeaderLine, 0) as ItemHeader;
    const declared = itemHeader.length;
    let payload: Uint8Array;
    if (typeof declared === 'number' && declared >= 0) {
      // Copy out so the yielded Uint8Array is stable past the next buffer reslice.
      const view = await readBytes(declared);
      payload = new Uint8Array(view);
      if (buf.byteLength > 0 && buf[0] === LF) buf = buf.subarray(1);
    } else {
      const line = await readLineFromBuf();
      payload = line ? new Uint8Array(line) : new Uint8Array(0);
    }
    yield { kind: 'item', header: itemHeader, payload };
  }
}

// ---------- helpers ----------

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

interface ReadLineResult {
  readonly bytes: Uint8Array;
  readonly next: number;
}

function readLine(bytes: Uint8Array, from: number): ReadLineResult | null {
  if (from >= bytes.byteLength) return null;
  const idx = bytes.indexOf(LF, from);
  if (idx < 0) {
    return { bytes: bytes.subarray(from), next: bytes.byteLength };
  }
  return { bytes: bytes.subarray(from, idx), next: idx + 1 };
}

function parseJsonObject(line: Uint8Array, atOffset: number): Record<string, unknown> {
  let text: string;
  try {
    text = dec.decode(line);
  } catch (e) {
    throw new EnvelopeParseError(`invalid UTF-8: ${(e as Error).message}`, atOffset);
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new EnvelopeParseError(`invalid JSON: ${(e as Error).message}`, atOffset);
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new EnvelopeParseError(
      `expected JSON object, got ${obj === null ? 'null' : Array.isArray(obj) ? 'array' : typeof obj}`,
      atOffset,
    );
  }
  return obj as Record<string, unknown>;
}
