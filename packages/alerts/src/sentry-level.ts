/** Re-declared here to avoid a hard dependency on @sr/issues. */
export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export const LEVEL_RANK: Readonly<Record<SentryLevel, number>> = Object.freeze({
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  fatal: 4,
});
