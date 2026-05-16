import { describe, expect, test } from 'bun:test';
import { formatReport } from '../src/metrics';
import { runLoadTest } from '../src/load';

describe('e2e load — 20k+ event burst', () => {
  test(
    'pumps ≥ 20,000 events end-to-end and produces an accurate report',
    async () => {
      const total = Number.parseInt(Bun.env['SR_E2E_EVENTS'] ?? '20000', 10);
      const errors = Math.floor(total * 0.8);
      const transactions = Math.floor(total * 0.15);
      const logs = total - errors - transactions;

      const result = await runLoadTest({ errors, transactions, logs });

      // Print the report to bun:test stdout for visibility.
      console.log('\n' + formatReport('LOAD RESULTS', result.perf));
      console.log('\nACCURACY');
      console.log(
        `  errors:       sent ${result.accuracy.errorsSent}  drained ${result.accuracy.errorsDrained}`,
      );
      console.log(
        `  transactions: sent ${result.accuracy.transactionsSent}  drained ${result.accuracy.transactionsDrained}`,
      );
      console.log(`  logs:         sent ${result.accuracy.logsSent}  drained ${result.accuracy.logsDrained}`);
      console.log(
        `  distinct error groups: ${result.accuracy.distinctGroupsCreated} / ${result.accuracy.expectedDistinctGroups} expected`,
      );

      // Accuracy gates.
      expect(result.accuracy.errorsDrained).toBe(result.accuracy.errorsSent);
      expect(result.accuracy.transactionsDrained).toBe(result.accuracy.transactionsSent);
      expect(result.accuracy.logsDrained).toBe(result.accuracy.logsSent);
      expect(result.accuracy.distinctGroupsCreated).toBe(result.accuracy.expectedDistinctGroups);

      // Performance gates: ≥ 500 events/s sustained on the sandbox.
      expect(result.perf.throughputPerSec).toBeGreaterThan(500);

      // Memory gate: peak RSS delta < 800 MiB (in-memory pipeline only).
      expect(result.perf.memory.rssDeltaBytes).toBeLessThan(800 * 1024 * 1024);

      // Total events processed by the recorder matches what we asked for.
      expect(result.perf.events).toBe(total);
    },
    { timeout: 120_000 },
  );
});