import { describe, expect, test } from 'bun:test';
import { HealthCheckRegistry } from '../src/health';
import type { Heartbeat } from '../src/heartbeat';
import { HeartbeatEmitter } from '../src/heartbeat';
import { SystemMetricsCollector } from '../src/system-metrics';

describe('HeartbeatEmitter', () => {
  test('emitOnce assembles health + system + sequence + service info', async () => {
    const health = new HealthCheckRegistry();
    health.register('relay', 'queue-drain', () => ({ status: 'pass' }));
    const system = new SystemMetricsCollector({
      now: () => 12345,
      schedule: (cb) => cb(),
    });
    const beats: Heartbeat[] = [];
    const emitter = new HeartbeatEmitter({
      serviceName: 'sentry-replica',
      serviceVersion: '0.0.0',
      health,
      system,
      onBeat: (b) => beats.push(b),
      now: () => 12345,
    });
    const beat = await emitter.emitOnce();
    expect(beat.sequence).toBe(1);
    expect(beat.serviceName).toBe('sentry-replica');
    expect(beat.serviceVersion).toBe('0.0.0');
    expect(beat.health.status).toBe('pass');
    expect(beat.system.capturedAt).toBe(12345);
    expect(beats.length).toBe(1);
    expect(beats[0]?.sequence).toBe(1);
  });

  test('sequence increments monotonically', async () => {
    const health = new HealthCheckRegistry();
    const system = new SystemMetricsCollector({ schedule: (cb) => cb() });
    const beats: Heartbeat[] = [];
    const emitter = new HeartbeatEmitter({
      serviceName: 'x',
      serviceVersion: 'y',
      health,
      system,
      onBeat: (b) => beats.push(b),
    });
    await emitter.emitOnce();
    await emitter.emitOnce();
    await emitter.emitOnce();
    expect(beats.map((b) => b.sequence)).toEqual([1, 2, 3]);
  });

  test('aggregated health surfaces via the heartbeat', async () => {
    const health = new HealthCheckRegistry();
    health.register('a', '1', () => ({ status: 'fail', message: 'db down' }));
    const system = new SystemMetricsCollector({ schedule: (cb) => cb() });
    let captured: Heartbeat | undefined;
    const emitter = new HeartbeatEmitter({
      serviceName: 'x',
      serviceVersion: 'y',
      health,
      system,
      onBeat: (b) => {
        captured = b;
      },
    });
    await emitter.emitOnce();
    expect(captured?.health.status).toBe('fail');
    expect(captured?.health.results[0]?.message).toBe('db down');
  });
});
