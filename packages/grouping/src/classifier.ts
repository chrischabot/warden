/**
 * Per-platform `in_app` classification.
 *
 * Spec §3.4 enumerates the canonical "system" prefixes for each
 * platform. Anything matching them is system code; everything else
 * is in-app. An explicit `frame.in_app` set by the SDK always wins.
 *
 * Patterns are tuned for the platforms our five internal services
 * use (Python, JS/TS, Rust, Go, Swift, JVM) and a few common ones
 * for broader compatibility (Ruby, .NET).
 */

import type { Frame } from './types';

const SYSTEM_PATTERNS: Readonly<Record<string, readonly RegExp[]>> = Object.freeze({
  python: [
    /[\\/]site-packages[\\/]/,
    /[\\/]dist-packages[\\/]/,
    /[\\/]python[0-9.]+[\\/]/,
    /^<frozen importlib/,
  ],
  javascript: [
    /[\\/]node_modules[\\/]/,
    /^webpack:\/\//,
    /^webpack-internal:\/\//,
    /^[\w-]+:\/\/[^/]+\/(?:_next|static)\/chunks\//,
    /\bvendor(?:s)?\./,
    /(?:^|[\\/])bun:/,
  ],
  node: [
    /[\\/]node_modules[\\/]/,
    /^(?:fs|path|http|https|net|stream|util|crypto|os|child_process)$/,
    /^node:/,
  ],
  ruby: [/\/gems\//, /^kernel#/],
  java: [/^java\./, /^javax\./, /^kotlin\./, /^scala\./, /^sun\./, /^com\.sun\./, /^jdk\./],
  swift: [
    /^Foundation\./,
    /^UIKit\./,
    /^SwiftUI\./,
    /^Combine\./,
    /^System\./,
    /^Swift\./,
    /^_dispatch_/,
  ],
  cocoa: [/^Foundation\./, /^UIKit\./, /^SwiftUI\./],
  rust: [/^std::/, /^core::/, /^alloc::/, /^test::/, /^proc_macro::/],
  go: [/^runtime\./, /^reflect\./, /^net\/http\./, /^encoding\//, /^syscall\./, /^time\./],
  csharp: [/^System\./, /^Microsoft\./],
  dotnet: [/^System\./, /^Microsoft\./],
});

/** Determine whether `frame` is in-app code for the given `platform`. */
export function classifyFrame(frame: Frame, platform: string | undefined): boolean {
  if (typeof frame.in_app === 'boolean') return frame.in_app;
  if (!platform) return true;
  const patterns = SYSTEM_PATTERNS[platform.toLowerCase()];
  if (!patterns || patterns.length === 0) return true;
  const probe = frame.abs_path ?? frame.module ?? frame.function ?? '';
  for (const re of patterns) {
    if (re.test(probe)) return false;
  }
  return true;
}
