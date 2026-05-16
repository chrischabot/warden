/**
 * Flamegraph aggregator.
 *
 * Builds a hierarchical tree from a profile's sample stream. Each
 * node corresponds to a (parent, frame_id) pair; sample at the top
 * of stack contributes 1 to the node's `self` count, and 1 to every
 * ancestor's `total` count.
 *
 * Output preserves Sentry's UI expectation of root-first traversal:
 * the root nodes are the bottoms of stacks (deepest ancestors),
 * children fan out toward the top of stack.
 */

import type { Profile, Sample } from './types';

export interface FlameNode {
  readonly frameId: number;
  /** Number of samples whose top-of-stack is at this node. */
  self: number;
  /** Number of samples whose stack passes through this node. */
  total: number;
  readonly children: FlameNode[];
}

export interface Flamegraph {
  readonly threadId: number;
  readonly totalSamples: number;
  readonly roots: readonly FlameNode[];
  /** Per-frame aggregated totals across the entire profile. */
  readonly perFrameSelf: ReadonlyMap<number, number>;
  readonly perFrameTotal: ReadonlyMap<number, number>;
}

export interface FlamegraphOptions {
  /** Restrict aggregation to a single thread. Default: aggregate every thread together (thread_id reported as -1). */
  readonly threadId?: number;
}

export function buildFlamegraph(profile: Profile, options: FlamegraphOptions = {}): Flamegraph {
  const samples: Sample[] =
    options.threadId !== undefined
      ? profile.samples.filter((s) => s.threadId === options.threadId)
      : [...profile.samples];

  const roots: FlameNode[] = [];
  const perFrameSelf = new Map<number, number>();
  const perFrameTotal = new Map<number, number>();
  let total = 0;

  for (const sample of samples) {
    total++;
    // Walk from bottom-of-stack (root) to top-of-stack.
    const stack = sample.stack;
    let parentChildren = roots;
    for (let i = stack.length - 1; i >= 0; i--) {
      const frameId = stack[i] as number;
      let node = findChild(parentChildren, frameId);
      if (!node) {
        node = { frameId, self: 0, total: 0, children: [] };
        parentChildren.push(node);
      }
      node.total += 1;
      perFrameTotal.set(frameId, (perFrameTotal.get(frameId) ?? 0) + 1);
      if (i === 0) {
        node.self += 1;
        perFrameSelf.set(frameId, (perFrameSelf.get(frameId) ?? 0) + 1);
      }
      parentChildren = node.children;
    }
  }

  return Object.freeze({
    threadId: options.threadId ?? -1,
    totalSamples: total,
    roots: Object.freeze(roots),
    perFrameSelf,
    perFrameTotal,
  });
}

function findChild(children: FlameNode[], frameId: number): FlameNode | undefined {
  for (const c of children) {
    if (c.frameId === frameId) return c;
  }
  return undefined;
}

/**
 * Top N functions by self-time. Use to power the "Hottest functions"
 * table in the profile detail view.
 */
export function hottestFunctions(
  flamegraph: Flamegraph,
  profile: Profile,
  limit = 10,
): Array<{
  readonly frameId: number;
  readonly name: string;
  readonly self: number;
  readonly total: number;
  readonly selfRatio: number;
}> {
  const frames = new Map<number, Profile['frames'][number]>();
  for (const f of profile.frames) frames.set(f.id, f);
  const entries: Array<{
    readonly frameId: number;
    readonly name: string;
    readonly self: number;
    readonly total: number;
    readonly selfRatio: number;
  }> = [];
  for (const [frameId, self] of flamegraph.perFrameSelf.entries()) {
    const f = frames.get(frameId);
    const name =
      (f?.function ?? f?.module ?? f?.filename ?? `frame_${frameId}`) +
      (f?.lineno !== undefined ? `:${f.lineno}` : '');
    entries.push({
      frameId,
      name,
      self,
      total: flamegraph.perFrameTotal.get(frameId) ?? 0,
      selfRatio: flamegraph.totalSamples === 0 ? 0 : self / flamegraph.totalSamples,
    });
  }
  entries.sort((a, b) => b.self - a.self);
  return entries.slice(0, limit);
}
