/**
 * Profile store. Holds full profile records keyed by id with
 * secondary indexes for query by project/trace/transaction.
 */

import type { Profile, ProfileQuery } from './types';

export class ProfileStore {
  private readonly byId = new Map<string, Profile>();

  record(profile: Profile): void {
    this.byId.set(profile.id, profile);
  }

  get(id: string): Profile | undefined {
    return this.byId.get(id);
  }

  list(query: ProfileQuery = {}): readonly Profile[] {
    const out: Profile[] = [];
    for (const p of this.byId.values()) {
      if (query.projectId !== undefined && p.projectId !== query.projectId) continue;
      if (query.transactionName !== undefined && p.transactionName !== query.transactionName)
        continue;
      if (query.platform !== undefined && p.platform !== query.platform) continue;
      if (query.traceId !== undefined && p.traceId !== query.traceId) continue;
      if (query.sinceTimestamp !== undefined && p.capturedAt < query.sinceTimestamp) {
        continue;
      }
      if (query.untilTimestamp !== undefined && p.capturedAt > query.untilTimestamp) {
        continue;
      }
      out.push(p);
    }
    out.sort((a, b) => b.capturedAt - a.capturedAt);
    return Object.freeze(out);
  }
}
