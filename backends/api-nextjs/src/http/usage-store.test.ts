import { describe, expect, it } from 'vitest';
import { MemoryUsageStore, type Counter } from './usage-store.ts';

const HOUR = 3_600_000;
const lifetime = (key: string, limit: number): Counter => ({ key, limit, windowMs: null });
const hourly = (key: string, limit: number): Counter => ({ key, limit, windowMs: HOUR });

describe('MemoryUsageStore', () => {
  it('AC-GATE-07: a window allows its limit, then refuses until it ends, then resets', async () => {
    const store = new MemoryUsageStore();
    const counter = [hourly('h', 2)];
    expect(await store.take(counter, 1_000)).toEqual({ allowed: true });
    expect(await store.take(counter, 2_000)).toEqual({ allowed: true });
    expect(await store.take(counter, 3_000)).toEqual({
      allowed: false,
      key: 'h',
      resetAt: 1_000 + HOUR,
    });
    expect(await store.take(counter, 1_000 + HOUR - 1)).toMatchObject({ allowed: false });
    // The window starts at its first request, so it ends exactly one hour later.
    expect(await store.take(counter, 1_000 + HOUR)).toEqual({ allowed: true });
  });

  it('AC-GATE-07: each key counts separately', async () => {
    const store = new MemoryUsageStore();
    expect(await store.take([hourly('a', 1)], 0)).toEqual({ allowed: true });
    expect(await store.take([hourly('b', 1)], 0)).toEqual({ allowed: true });
    expect(await store.take([hourly('a', 1)], 0)).toMatchObject({ allowed: false, key: 'a' });
  });

  it('AC-GATE-16: a lifetime counter never resets', async () => {
    const store = new MemoryUsageStore();
    expect(await store.take([lifetime('q', 1)], 0)).toEqual({ allowed: true });
    expect(await store.take([lifetime('q', 1)], 100 * 365 * 24 * HOUR)).toEqual({
      allowed: false,
      key: 'q',
      resetAt: null,
    });
  });

  it('AC-GATE-17: a refused request increments no counter', async () => {
    const store = new MemoryUsageStore();
    const counters = [lifetime('quota', 10), hourly('hour', 1), hourly('global', 10)];
    expect(await store.take(counters, 0)).toEqual({ allowed: true });
    // The hourly window refuses, so neither the quota nor the global count moves.
    for (let i = 0; i < 5; i += 1) {
      expect(await store.take(counters, 1)).toMatchObject({ allowed: false, key: 'hour' });
    }
    expect(await store.take([lifetime('quota', 2)], 1)).toEqual({ allowed: true });
    expect(await store.take([lifetime('quota', 2)], 1)).toMatchObject({ allowed: false });
    expect(await store.take([hourly('global', 2)], 1)).toEqual({ allowed: true });
    expect(await store.take([hourly('global', 2)], 1)).toMatchObject({ allowed: false });
  });

  it('reports the first refusing counter, in the order given', async () => {
    const store = new MemoryUsageStore();
    const counters = [lifetime('quota', 1), hourly('hour', 1)];
    await store.take(counters, 0);
    expect(await store.take(counters, 0)).toMatchObject({ key: 'quota', resetAt: null });
  });

  it('AC-GATE-17: concurrent requests cannot both take the last slot', async () => {
    const store = new MemoryUsageStore();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.take([lifetime('q', 3)], 0)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });
});
