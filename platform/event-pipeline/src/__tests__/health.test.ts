import { describe, it, expect } from 'vitest';
import { getHealthReport } from '../health';
import { MetricsRegistry } from '../metrics';
import { loadConfig } from '../config';
import { EventStore } from '../event-store';
import { StoredEvent } from '../types';

function fakeStore(overrides: Partial<EventStore> = {}): EventStore {
  const base = {
    ping: async () => 5,
    getTotalEventCount: async () => 42,
    getTotalBatchCount: async () => 7,
    getMostRecentEvent: async (): Promise<StoredEvent | null> => ({
      eventId: 'evt-1',
      matchId: 'm1',
      playerId: 'p1',
      gameId: 'g1',
      seq: 1,
      ts: 1000,
      serverTs: 2000,
      type: 'PlayerMoved',
      payload: {},
      schemaVersion: '1',
      validationStatus: 'valid',
      sourcePlugin: 'test',
    }),
  };
  return { ...base, ...overrides } as unknown as EventStore;
}

describe('getHealthReport', () => {
  const config = loadConfig();

  it('reports healthy when DB is reachable with low latency', async () => {
    const report = await getHealthReport(fakeStore(), new MetricsRegistry(), config);
    expect(report.status).toBe('healthy');
    expect(report.database.connected).toBe(true);
    expect(report.storage.totalEvents).toBe(42);
    expect(report.storage.totalBatches).toBe(7);
    expect(report.lastEventProcessed?.eventId).toBe('evt-1');
  });

  it('reports unhealthy when the DB ping throws', async () => {
    const store = fakeStore({
      ping: async () => {
        throw new Error('connection refused');
      },
    });
    const report = await getHealthReport(store, new MetricsRegistry(), config);
    expect(report.status).toBe('unhealthy');
    expect(report.database.connected).toBe(false);
    expect(report.database.error).toContain('connection refused');
  });

  it('reports degraded when DB latency is elevated but not catastrophic', async () => {
    const store = fakeStore({ ping: async () => 500 });
    const report = await getHealthReport(store, new MetricsRegistry(), config);
    expect(report.status).toBe('degraded');
  });

  it('reports unhealthy when DB latency is extremely high', async () => {
    const store = fakeStore({ ping: async () => 5000 });
    const report = await getHealthReport(store, new MetricsRegistry(), config);
    expect(report.status).toBe('unhealthy');
  });

  it('handles no events processed yet (null lastEventProcessed)', async () => {
    const store = fakeStore({ getMostRecentEvent: async () => null, getTotalEventCount: async () => 0, getTotalBatchCount: async () => 0 });
    const report = await getHealthReport(store, new MetricsRegistry(), config);
    expect(report.lastEventProcessed).toBeNull();
    expect(report.storage.totalEvents).toBe(0);
  });

  it('includes pipeline metrics snapshot fields', async () => {
    const metrics = new MetricsRegistry();
    metrics.eventsProcessed.inc({ outcome: 'accepted' }, 10);
    metrics.validationFailures.inc({}, 2);
    const report = await getHealthReport(fakeStore(), metrics, config);
    expect(report.pipeline.eventsProcessed).toBe(10);
    expect(report.pipeline.validationErrors).toBe(2);
  });

  it('surfaces the configured version and a non-negative uptime', async () => {
    const report = await getHealthReport(fakeStore(), new MetricsRegistry(), loadConfig({ version: '9.9.9' }));
    expect(report.version).toBe('9.9.9');
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('does not crash the whole report if storage counters fail but DB is reachable', async () => {
    const store = fakeStore({
      getTotalEventCount: async () => {
        throw new Error('count timeout');
      },
    });
    const report = await getHealthReport(store, new MetricsRegistry(), config);
    expect(report.database.connected).toBe(true);
    expect(report.storage.totalEvents).toBe(0);
  });
});
