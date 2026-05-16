/**
 * Source-map v3 JSON shape per https://sourcemaps.info/spec.html.
 * The fields the resolver actually consults are documented; the
 * rest are passed through opaquely.
 */

export interface SourceMapV3 {
  readonly version: 3;
  readonly sources: readonly string[];
  readonly names?: readonly string[];
  readonly mappings: string;
  readonly file?: string;
  readonly sourceRoot?: string;
  readonly sourcesContent?: ReadonlyArray<string | null>;
  /** Per the Sentry bundler-plugin design and the upstream debug-id RFC. */
  readonly debug_id?: string;
  readonly debugId?: string;
  /** Catch-all for additional fields. */
  readonly [key: string]: unknown;
}

export interface OriginalPosition {
  /** Source identifier (relative to sourceRoot when set). */
  readonly source: string;
  /** 1-based line number in the original source. */
  readonly line: number;
  /** 0-based column in the original source. */
  readonly column: number;
  /** Original symbol name, if the segment carried a name index. */
  readonly name: string | undefined;
}
