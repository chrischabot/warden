/**
 * Event-to-group fingerprinting.
 *
 * Hierarchy (spec §3.4):
 *
 *   1. `event.fingerprint`, if supplied.
 *   2. The top N in-app frames of the most recent exception's
 *      stack trace, joined by module + function.
 *   3. The exception type + value of the most recent exception.
 *   4. The event message.
 *   5. The literal string `default` when nothing else applies.
 *
 * The group hash is the 16-char lowercase hex of a 64-bit
 * `Bun.hash` (wyhash) over the components joined by `|`. Non-
 * cryptographic by design — collision resistance matters here for
 * uniqueness, not adversarial resistance.
 */

import { classifyFrame } from './classifier';
import type {
  Event,
  ExceptionValue,
  Frame,
  GroupingOptions,
  GroupingResult,
  GroupingStrategy,
  Stacktrace,
} from './types';

const DEFAULT_TOP_FRAMES = 5;

export function fingerprintEvent(event: Event, options: GroupingOptions = {}): GroupingResult {
  const platform = options.platform ?? event.platform;
  const topFrames = options.topFrames ?? DEFAULT_TOP_FRAMES;

  // 1. Explicit fingerprint.
  if (event.fingerprint && event.fingerprint.length > 0) {
    return finalize('fingerprint', event.fingerprint);
  }

  // 2 + 3. Exception chain — prefer the last (innermost / most recent).
  const exceptions = event.exception?.values;
  if (exceptions && exceptions.length > 0) {
    const last = exceptions[exceptions.length - 1] as ExceptionValue;
    const stackParts = fingerprintFromStacktrace(last.stacktrace, platform, topFrames);
    if (stackParts) return finalize('stacktrace', stackParts);
    const excParts = fingerprintFromException(last);
    if (excParts) return finalize('exception', excParts);
  }

  // Fallback to top-level event.stacktrace if no exception interface.
  if (event.stacktrace) {
    const stackParts = fingerprintFromStacktrace(event.stacktrace, platform, topFrames);
    if (stackParts) return finalize('stacktrace', stackParts);
  }

  // 4. Message.
  if (typeof event.message === 'string' && event.message.length > 0) {
    return finalize('message', [`message:${event.message}`]);
  }

  // 5. Default.
  return finalize('default', ['default']);
}

function fingerprintFromStacktrace(
  st: Stacktrace | undefined,
  platform: string | undefined,
  topFrames: number,
): readonly string[] | undefined {
  if (!st?.frames || st.frames.length === 0) return undefined;
  // Sentry's frames are typically reported oldest → newest, so the
  // "top" of the stack (the most recent call) is at the end.
  const inApp: Frame[] = [];
  for (let i = st.frames.length - 1; i >= 0 && inApp.length < topFrames; i--) {
    const f = st.frames[i] as Frame;
    if (classifyFrame(f, platform)) inApp.push(f);
  }
  if (inApp.length === 0) return undefined;
  // Compose stable identifiers. Module and function combined give
  // a reasonable signal even when filenames/linenos differ across
  // minified or restructured builds.
  const parts: string[] = [];
  for (const f of inApp) {
    parts.push(`frame:${f.module ?? ''}|${f.function ?? ''}`);
  }
  return parts;
}

function fingerprintFromException(exc: ExceptionValue): readonly string[] | undefined {
  if (!exc.type) return undefined;
  const parts: string[] = [`exception:${exc.type}`];
  if (typeof exc.value === 'string' && exc.value.length > 0) {
    parts.push(`value:${exc.value}`);
  }
  return parts;
}

function finalize(strategy: GroupingStrategy, fingerprint: readonly string[]): GroupingResult {
  const joined = fingerprint.join('|');
  const raw = (Bun.hash as (data: string) => bigint)(joined);
  const unsigned = BigInt.asUintN(64, raw);
  const groupHash = unsigned.toString(16).padStart(16, '0');
  return Object.freeze({ groupHash, fingerprint: Object.freeze([...fingerprint]), strategy });
}
