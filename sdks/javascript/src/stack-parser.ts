/**
 * V8 / JavaScriptCore stack trace parser.
 *
 * Both Node and Bun emit stacks in the V8 format. Each frame line is
 * either:
 *
 *   `    at functionName (path/to/file.js:line:col)`
 *   `    at functionName (file:line:col)`
 *   `    at path/to/file.js:line:col`
 *   `    at <anonymous>`
 *
 * Sentry's convention is oldest → newest; V8 emits newest → oldest;
 * we reverse before returning.
 *
 * Lines that don't match any frame shape (Error message, blank
 * lines, native-code markers) are skipped.
 */

import type { Frame } from './types';

const FRAME_RE_WITH_FN = /^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/;
const FRAME_RE_NO_FN = /^\s*at\s+(.+?):(\d+):(\d+)\s*$/;
const FRAME_RE_NATIVE = /^\s*at\s+(.+?)\s+\(native\)\s*$/;

export function parseStack(stack: string): Frame[] {
  if (typeof stack !== 'string' || stack.length === 0) return [];
  const frames: Frame[] = [];
  const lines = stack.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;
    if (!line.startsWith('    at ') && !line.startsWith('\tat ') && !line.match(/^\s*at\s/)) {
      // Probably the Error message line.
      continue;
    }
    let m = FRAME_RE_WITH_FN.exec(line);
    if (m) {
      const fn = (m[1] as string).trim();
      const path = m[2] as string;
      const namedFrame: Frame = {
        abs_path: path,
        lineno: Number.parseInt(m[3] as string, 10),
        colno: Number.parseInt(m[4] as string, 10),
        ...(fn && fn !== '<anonymous>' ? { function: fn } : {}),
      };
      frames.push(namedFrame);
      continue;
    }
    m = FRAME_RE_NO_FN.exec(line);
    if (m) {
      frames.push({
        abs_path: m[1] as string,
        lineno: Number.parseInt(m[2] as string, 10),
        colno: Number.parseInt(m[3] as string, 10),
      });
      continue;
    }
    m = FRAME_RE_NATIVE.exec(line);
    if (m) {
      const fn = (m[1] as string).trim();
      const nativeFrame: Frame = {
        abs_path: '[native]',
        ...(fn && fn !== '<anonymous>' ? { function: fn } : {}),
      };
      frames.push(nativeFrame);
    }
    // Otherwise: unrecognised line, skip.
  }
  // Sentry expects oldest → newest; V8 emits newest → oldest.
  return frames.reverse();
}
