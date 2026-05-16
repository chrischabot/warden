/**
 * Seer types per spec §5.12.
 *
 * Three product use-cases:
 *
 *   - `analyseRootCause` ← takes a group fingerprint + a sampled
 *     event payload and returns ranked candidate causes with brief
 *     rationale + linked source locations.
 *
 *   - `suggestFix` ← takes a candidate cause + relevant source
 *     blobs and returns a unified-diff patch + explanation.
 *
 *   - `summariseIssue` ← non-engineer-friendly summary of a group.
 *
 * Each use-case is mediated by a `SeerProvider`. The package ships
 * a deterministic heuristic provider; production wires in an LLM
 * provider that satisfies the same interface.
 */

export interface EventFrame {
  readonly function?: string;
  readonly module?: string;
  readonly filename?: string;
  readonly absPath?: string;
  readonly lineno?: number;
  readonly inApp?: boolean;
  readonly contextLine?: string;
}

export interface EventException {
  readonly type: string;
  readonly value: string;
  readonly frames: readonly EventFrame[];
}

export interface SampledEvent {
  readonly platform: string;
  readonly message?: string;
  readonly exceptions: readonly EventException[];
  readonly tags?: Readonly<Record<string, string>>;
}

export interface RootCauseRequest {
  readonly projectId: string;
  readonly groupId: string;
  readonly groupHash: string;
  readonly event: SampledEvent;
}

export interface RootCauseCandidate {
  readonly summary: string;
  readonly rationale: string;
  readonly confidence: number; // 0..1
  readonly suggestedLocation?: {
    readonly path: string;
    readonly lineno?: number;
  };
}

export interface RootCauseResponse {
  readonly groupId: string;
  readonly candidates: readonly RootCauseCandidate[];
  readonly providerLatencyMs: number;
}

export interface SourceBlob {
  readonly path: string;
  readonly content: string;
}

export interface FixRequest {
  readonly cause: RootCauseCandidate;
  readonly sources: readonly SourceBlob[];
}

export interface FixSuggestion {
  /** Unified-diff patch text. */
  readonly patch: string;
  readonly explanation: string;
  readonly confidence: number;
}

export interface FixResponse {
  readonly suggestions: readonly FixSuggestion[];
  readonly providerLatencyMs: number;
}

export interface SummaryRequest {
  readonly groupId: string;
  readonly groupHash: string;
  readonly event: SampledEvent;
}

export interface SummaryResponse {
  readonly summary: string;
  readonly bulletPoints: readonly string[];
  readonly providerLatencyMs: number;
}

export interface SeerProvider {
  readonly name: string;
  analyseRootCause(request: RootCauseRequest): Promise<RootCauseResponse>;
  suggestFix(request: FixRequest): Promise<FixResponse>;
  summariseIssue(request: SummaryRequest): Promise<SummaryResponse>;
}
