// Heuristic Seer provider.
//
// Implements the SeerProvider interface using pattern-matching
// heuristics rather than an LLM. Suitable for offline operation,
// deterministic tests, and the default when no AI provider is
// configured. Production deployments wire an LLM provider on top.
//
// Heuristics (matched in declared order):
//
//   - `TypeError ... cannot read property|properties ... of (undefined|null)` →
//     "Property access on undefined or null value". Matches both
//     legacy V8 (`Cannot read property 'x' of undefined`) and
//     modern V8 (`Cannot read properties of undefined (reading 'x')`).
//   - `ReferenceError` / "is not defined" → "missing import or scope issue"
//   - `RangeError` / "out of range|bounds" → "off-by-one / bounds"
//   - `ECONNREFUSED|ETIMEDOUT|ENOTFOUND|...` → "outbound network failure"
//   - `PermissionError|EACCES` → "filesystem permissions"
//   - SQL keywords in message → "SQL execution issue"
//   - else → "no specific cause inferred"

import type {
  EventFrame,
  FixRequest,
  FixResponse,
  RootCauseCandidate,
  RootCauseRequest,
  RootCauseResponse,
  SampledEvent,
  SeerProvider,
  SummaryRequest,
  SummaryResponse,
} from './types';

interface HeuristicRule {
  readonly id: string;
  readonly match: (event: SampledEvent, message: string, types: string[]) => boolean;
  readonly candidate: (event: SampledEvent) => RootCauseCandidate;
}

// Single regex covers both V8 phrasings:
//   "Cannot read property 'x' of undefined"
//   "Cannot read properties of undefined (reading 'x')"
const UNDEF_PROP_RE = /cannot read propert(?:y|ies)\b.*?\bof (undefined|null)/i;

const RULES: readonly HeuristicRule[] = [
  {
    id: 'undef-prop-access',
    match: (_event, message) => UNDEF_PROP_RE.test(message),
    candidate: (event): RootCauseCandidate => {
      const loc = topInAppLocation(event);
      const base: RootCauseCandidate = {
        summary: 'Property access on undefined or null value',
        rationale:
          'The stack indicates a `.x` access on a value that resolved to undefined or null. Add a guard at the top of the failing function or trace the assignment that left the variable unset.',
        confidence: 0.75,
      };
      return loc !== undefined ? { ...base, suggestedLocation: loc } : base;
    },
  },
  {
    id: 'reference-error',
    match: (_event, message, types) =>
      types.includes('ReferenceError') || /is not defined/i.test(message),
    candidate: (event): RootCauseCandidate => {
      const loc = topInAppLocation(event);
      const base: RootCauseCandidate = {
        summary: 'Identifier is not defined in current scope',
        rationale:
          'The runtime could not resolve the identifier. Typical causes: missing import, typo in a variable name, or referencing a symbol from a module that did not finish loading.',
        confidence: 0.7,
      };
      return loc !== undefined ? { ...base, suggestedLocation: loc } : base;
    },
  },
  {
    id: 'array-bounds',
    match: (_event, message, types) =>
      types.includes('RangeError') ||
      types.includes('IndexError') ||
      /(out of range|out of bounds|invalid array length)/i.test(message),
    candidate: (event): RootCauseCandidate => {
      const loc = topInAppLocation(event);
      const base: RootCauseCandidate = {
        summary: 'Array bounds or off-by-one error',
        rationale:
          'The exception indicates an index outside the valid range. Re-check the loop bounds and the producer of the index (slice math, pagination cursors, off-by-one in length-vs-index arithmetic).',
        confidence: 0.65,
      };
      return loc !== undefined ? { ...base, suggestedLocation: loc } : base;
    },
  },
  {
    id: 'network-failure',
    match: (_event, message) =>
      /\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|connection refused|connection reset)\b/i.test(
        message,
      ),
    candidate: (): RootCauseCandidate => ({
      summary: 'Outbound network failure',
      rationale:
        'A downstream dependency was unreachable. Verify DNS, network policy, and that the target host is up. Consider retries with backoff if the call is idempotent.',
      confidence: 0.85,
    }),
  },
  {
    id: 'permission-error',
    match: (_event, message, types) =>
      types.includes('PermissionError') ||
      types.includes('PermissionDenied') ||
      /\b(EACCES|permission denied)\b/i.test(message),
    candidate: (event): RootCauseCandidate => {
      const loc = topInAppLocation(event);
      const base: RootCauseCandidate = {
        summary: 'Filesystem or OS permission denied',
        rationale:
          'The process attempted an operation the OS rejected. Verify file/directory permissions and the runtime user, or whether SELinux/AppArmor policy is interfering.',
        confidence: 0.8,
      };
      return loc !== undefined ? { ...base, suggestedLocation: loc } : base;
    },
  },
  {
    id: 'sql-failure',
    match: (_event, message) =>
      /\b(SELECT|INSERT|UPDATE|DELETE|DUPLICATE KEY|foreign key|constraint|deadlock|relation .* does not exist)\b/i.test(
        message,
      ),
    candidate: (): RootCauseCandidate => ({
      summary: 'SQL execution issue',
      rationale:
        'The message references SQL keywords. Likely causes: query syntax, missing index, schema drift, or constraint violation. Re-run the query with EXPLAIN against a recent dump.',
      confidence: 0.7,
    }),
  },
];

export class HeuristicSeerProvider implements SeerProvider {
  readonly name = 'heuristic';

  async analyseRootCause(request: RootCauseRequest): Promise<RootCauseResponse> {
    const start = Date.now();
    const event = request.event;
    const message = composeMessage(event);
    const types = event.exceptions.map((e) => e.type);

    const candidates: RootCauseCandidate[] = [];
    for (const rule of RULES) {
      if (rule.match(event, message, types)) candidates.push(rule.candidate(event));
    }
    if (candidates.length === 0) {
      const loc = topInAppLocation(event);
      const fallback: RootCauseCandidate = {
        summary: 'No specific cause inferred from heuristics',
        rationale:
          'No built-in pattern matched the error text. Inspect the captured stack trace and recent code changes around the top in-app frame.',
        confidence: 0.2,
      };
      candidates.push(loc !== undefined ? { ...fallback, suggestedLocation: loc } : fallback);
    }
    const response: RootCauseResponse = {
      groupId: request.groupId,
      candidates,
      providerLatencyMs: Date.now() - start,
    };
    return response;
  }

  async suggestFix(request: FixRequest): Promise<FixResponse> {
    const start = Date.now();
    // The heuristic provider has no source-aware patcher; emit a
    // descriptive non-diff suggestion the UI surfaces verbatim.
    const response: FixResponse = {
      suggestions: [
        {
          patch: '',
          explanation:
            `The heuristic provider does not synthesize code patches. Cause was identified as: ${request.cause.summary}. ` +
            'Review the suggested rationale and apply the fix manually, or rerun with an LLM provider configured.',
          confidence: 0,
        },
      ],
      providerLatencyMs: Date.now() - start,
    };
    return response;
  }

  async summariseIssue(request: SummaryRequest): Promise<SummaryResponse> {
    const start = Date.now();
    const ex = request.event.exceptions[0];
    const headline = ex ? `${ex.type}: ${ex.value}` : (request.event.message ?? 'Unknown issue');
    const topFrame = ex ? firstInAppFrame(ex.frames) : undefined;
    const bullets: string[] = [];
    if (topFrame) {
      const loc = formatLocation(topFrame);
      if (loc) bullets.push(`Most recently failed in ${loc}.`);
    }
    if (ex) bullets.push(`Exception type: ${ex.type}`);
    bullets.push(`Platform: ${request.event.platform}`);
    if (request.event.tags) {
      const env = request.event.tags['environment'];
      if (env) bullets.push(`Environment: ${env}`);
    }
    const response: SummaryResponse = {
      summary: headline,
      bulletPoints: bullets,
      providerLatencyMs: Date.now() - start,
    };
    return response;
  }
}

function composeMessage(event: SampledEvent): string {
  const parts: string[] = [];
  if (event.message) parts.push(event.message);
  for (const ex of event.exceptions) {
    parts.push(`${ex.type}: ${ex.value}`);
  }
  return parts.join(' || ');
}

function topInAppLocation(
  event: SampledEvent,
): { readonly path: string; readonly lineno?: number } | undefined {
  for (const ex of event.exceptions) {
    const f = firstInAppFrame(ex.frames);
    if (f) {
      const path = f.absPath ?? f.filename ?? f.module ?? f.function ?? '';
      if (path) {
        return f.lineno !== undefined ? { path, lineno: f.lineno } : { path };
      }
    }
  }
  return undefined;
}

function firstInAppFrame(frames: readonly EventFrame[]): EventFrame | undefined {
  // Sentry stores frames oldest-to-newest, so the most recent call is at
  // the end. Walk from there to find the first in-app frame.
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i] as EventFrame;
    if (f.inApp !== false) return f;
  }
  return frames[frames.length - 1];
}

function formatLocation(f: EventFrame): string {
  const path = f.filename ?? f.absPath ?? '';
  const fn = f.function ?? '';
  const line = f.lineno !== undefined ? `:${f.lineno}` : '';
  if (path && fn) return `${fn} at ${path}${line}`;
  if (path) return `${path}${line}`;
  if (fn) return fn;
  return '';
}
