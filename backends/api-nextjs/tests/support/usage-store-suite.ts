// The semantics every UsageStore must share, run against each implementation (WU-23a plan D2).
// `makeStores` returns two stores on the same backend, standing in for two server instances.
import { describe, expect, it } from 'vitest';
import type { Counter, UsageStore } from '../../src/http/usage-store.ts';

const HOUR = 3_600_000;

export interface UsageStoreSuiteOptions {
  /** False for a store whose state lives in the instance (memory): skips the cross-instance cases. */
  sharesState?: boolean;
}

export function describeUsageStore(
  name: string,
  makeStores: () => [UsageStore, UsageStore] | Promise<[UsageStore, UsageStore]>,
  { sharesState = true }: UsageStoreSuiteOptions = {},
): void {
  describe(`${name} (usage store semantics)`, () => {
    // Every test gets keys of its own, so tests sharing a backend (the emulator) don't collide.
    let sequence = 0;
    const prefix = `t${process.pid}-${String(Date.now())}`;
    const key = (label: string) => `${prefix}-${String((sequence += 1))}-${label}`;
    const lifetime = (k: string, limit: number): Counter => ({ key: k, limit, windowMs: null });
    const hourly = (k: string, limit: number): Counter => ({ key: k, limit, windowMs: HOUR });

    it('AC-GATE-16: a lifetime counter refuses at its limit forever, with resetAt null', async () => {
      const [store] = await makeStores();
      const k = key('q');
      expect(await store.take([lifetime(k, 2)], 0)).toEqual({ allowed: true });
      expect(await store.take([lifetime(k, 2)], 0)).toEqual({ allowed: true });
      for (const now of [1, HOUR, 100 * 365 * 24 * HOUR]) {
        expect(await store.take([lifetime(k, 2)], now)).toEqual({
          allowed: false,
          key: k,
          resetAt: null,
        });
      }
    });

    it('AC-GATE-07: a window refuses with resetAt = start + length, then resets', async () => {
      const [store] = await makeStores();
      const k = key('h');
      expect(await store.take([hourly(k, 2)], 1_000)).toEqual({ allowed: true });
      expect(await store.take([hourly(k, 2)], 2_000)).toEqual({ allowed: true });
      expect(await store.take([hourly(k, 2)], 3_000)).toEqual({
        allowed: false,
        key: k,
        resetAt: 1_000 + HOUR,
      });
      expect(await store.take([hourly(k, 2)], 1_000 + HOUR - 1)).toMatchObject({ allowed: false });
      expect(await store.take([hourly(k, 2)], 1_000 + HOUR)).toEqual({ allowed: true });
      // The new window starts at the request that reopened it.
      expect(await store.take([hourly(k, 2)], 1_000 + HOUR + 1)).toEqual({ allowed: true });
      expect(await store.take([hourly(k, 2)], 1_000 + HOUR + 2)).toEqual({
        allowed: false,
        key: k,
        resetAt: 1_000 + 2 * HOUR,
      });
    });

    it('AC-GATE-07: each key counts separately', async () => {
      const [store] = await makeStores();
      const [a, b] = [key('a'), key('b')];
      expect(await store.take([hourly(a, 1)], 0)).toEqual({ allowed: true });
      expect(await store.take([hourly(b, 1)], 0)).toEqual({ allowed: true });
      expect(await store.take([hourly(a, 1)], 0)).toMatchObject({ allowed: false, key: a });
    });

    it('AC-GATE-18: the first refusing counter, in the order given, is reported', async () => {
      const [store] = await makeStores();
      const [quota, hour] = [key('quota'), key('hour')];
      const counters = [lifetime(quota, 1), hourly(hour, 1)];
      expect(await store.take(counters, 0)).toEqual({ allowed: true });
      expect(await store.take(counters, 0)).toEqual({ allowed: false, key: quota, resetAt: null });
      expect(await store.take([...counters].reverse(), 0)).toEqual({
        allowed: false,
        key: hour,
        resetAt: HOUR,
      });
    });

    it('AC-GATE-17: a refused take increments nothing', async () => {
      const [store] = await makeStores();
      const [quota, hour, global] = [key('quota'), key('hour'), key('global')];
      const counters = [lifetime(quota, 10), hourly(hour, 1), hourly(global, 10)];
      expect(await store.take(counters, 0)).toEqual({ allowed: true });
      for (let i = 0; i < 5; i += 1) {
        expect(await store.take(counters, 1)).toMatchObject({ allowed: false, key: hour });
      }
      // Each of the other counters has been used once, not six times.
      expect(await store.take([lifetime(quota, 2)], 1)).toEqual({ allowed: true });
      expect(await store.take([lifetime(quota, 2)], 1)).toMatchObject({ allowed: false });
      expect(await store.take([hourly(global, 2)], 1)).toEqual({ allowed: true });
      expect(await store.take([hourly(global, 2)], 1)).toMatchObject({ allowed: false });
    });

    it('AC-GATE-26: concurrent takes on one instance allow exactly the limit', async () => {
      const [store] = await makeStores();
      const k = key('q');
      const results = await Promise.all(
        Array.from({ length: 12 }, () => store.take([lifetime(k, 3)], 0)),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(3);
    });

    // Registered only for stores that share state, so a run shows no skipped tests.
    if (sharesState) {
      it('AC-GATE-26: counts persist across instances', async () => {
        const [a, b] = await makeStores();
        const k = key('q');
        expect(await a.take([lifetime(k, 2)], 0)).toEqual({ allowed: true });
        expect(await b.take([lifetime(k, 2)], 0)).toEqual({ allowed: true });
        expect(await a.take([lifetime(k, 2)], 0)).toMatchObject({ allowed: false });
        expect(await b.take([lifetime(k, 2)], 0)).toMatchObject({ allowed: false });
      });

      it('AC-GATE-26: concurrent takes across two instances allow exactly the limit', async () => {
        const [a, b] = await makeStores();
        const k = key('q');
        const results = await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            (i % 2 === 0 ? a : b).take([lifetime(k, 5), hourly(`${k}-h`, 100)], 0),
          ),
        );
        expect(results.filter((r) => r.allowed)).toHaveLength(5);
        expect(results.filter((r) => !r.allowed)).toHaveLength(15);
      });
    }
  });
}
