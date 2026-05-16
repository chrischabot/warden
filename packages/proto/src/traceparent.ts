/**
 * W3C traceparent header codec.
 *
 * Format: `<version>-<trace_id>-<parent_id>-<flags>`
 *   version:   2 hex chars; currently `00`; `ff` is reserved.
 *   trace_id:  32 hex chars; not all zeros.
 *   parent_id: 16 hex chars; not all zeros.
 *   flags:     2 hex chars; bit 0 is sampled.
 *
 * Reference: https://www.w3.org/TR/trace-context/
 *
 * Forward-compatibility: per W3C §3.2.2.5, receivers SHOULD parse
 * known fields with the version-00 layout and ignore any trailing
 * extension fields when encountering a higher version. We accept
 * any 2-hex-digit version other than the reserved `ff` and apply
 * version-00 semantics; downstream callers can inspect the
 * `version` field if they need to gate on it.
 */

export interface Traceparent {
  readonly version: number;
  readonly traceId: string;
  readonly parentId: string;
  readonly flags: number;
  readonly sampled: boolean;
}

const HEX_2 = /^[0-9a-f]{2}$/;
const HEX_16 = /^[0-9a-f]{16}$/;
const HEX_32 = /^[0-9a-f]{32}$/;
const ALL_ZERO_TRACE = '0'.repeat(32);
const ALL_ZERO_PARENT = '0'.repeat(16);

export class TraceparentParseError extends Error {
  public readonly input: string;
  constructor(message: string, input: string) {
    super(message);
    this.name = 'TraceparentParseError';
    this.input = input;
  }
}

export function parseTraceparent(input: string): Traceparent {
  if (typeof input !== 'string' || input.length === 0) {
    throw new TraceparentParseError('traceparent must be a non-empty string', String(input));
  }
  const parts = input.trim().toLowerCase().split('-');
  if (parts.length !== 4) {
    throw new TraceparentParseError(`traceparent must have 4 fields, got ${parts.length}`, input);
  }
  const versionHex = parts[0] as string;
  const traceId = parts[1] as string;
  const parentId = parts[2] as string;
  const flagsHex = parts[3] as string;

  if (!HEX_2.test(versionHex)) {
    throw new TraceparentParseError(`invalid version: "${versionHex}"`, input);
  }
  if (versionHex === 'ff') {
    throw new TraceparentParseError('version "ff" is reserved', input);
  }
  if (!HEX_32.test(traceId) || traceId === ALL_ZERO_TRACE) {
    throw new TraceparentParseError(`invalid trace_id: "${traceId}"`, input);
  }
  if (!HEX_16.test(parentId) || parentId === ALL_ZERO_PARENT) {
    throw new TraceparentParseError(`invalid parent_id: "${parentId}"`, input);
  }
  if (!HEX_2.test(flagsHex)) {
    throw new TraceparentParseError(`invalid flags: "${flagsHex}"`, input);
  }
  const version = Number.parseInt(versionHex, 16);
  const flags = Number.parseInt(flagsHex, 16);
  const sampled = (flags & 0b1) === 1;
  return Object.freeze({ version, traceId, parentId, flags, sampled });
}

export function formatTraceparent(t: Traceparent): string {
  const version = (t.version & 0xff).toString(16).padStart(2, '0');
  const flags = (t.flags & 0xff).toString(16).padStart(2, '0');
  return `${version}-${t.traceId}-${t.parentId}-${flags}`;
}
