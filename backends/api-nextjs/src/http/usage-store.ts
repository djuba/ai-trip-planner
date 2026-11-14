// Usage counters for the access gate (WU-22 plan D11). `take` checks every counter a request
// needs and increments all of them or none, so a request one limit refuses consumes nothing from
// the others. Async, so a database can implement it in a transaction (WU-23: Firestore).

export interface Counter {
  key: string;
  limit: number;
  /** A fixed window's length, or null for a lifetime count that never resets. */
  windowMs: number | null;
}

export type TakeResult =
  | { allowed: true }
  /** `resetAt` is when the refusing window ends (epoch ms), or null for a lifetime counter. */
  | { allowed: false; key: string; resetAt: number | null };

export interface UsageStore {
  /** Counters are checked in order, and the first that refuses is reported. */
  take(counters: readonly Counter[], now: number): Promise<TakeResult>;
}

interface Slot {
  count: number;
  /** Start of the current window; unused for lifetime counters. */
  windowStart: number;
}

/**
 * Counts in memory. Correct only with one instance (ADR 0005 §4), and every restart resets it,
 * so it can't cap spend: hosted live mode refuses it (access-config.ts). Memory is bounded by
 * the configured codes, because unknown codes are refused before any counter is touched.
 */
export class MemoryUsageStore implements UsageStore {
  readonly #slots = new Map<string, Slot>();

  /** Never awaits between checking and incrementing, so concurrent requests can't both pass. */
  take(counters: readonly Counter[], now: number): Promise<TakeResult> {
    const current = counters.map((counter) => {
      const slot = this.#slots.get(counter.key);
      const expired =
        slot === undefined ||
        (counter.windowMs !== null && now >= slot.windowStart + counter.windowMs);
      return { counter, slot: expired ? { count: 0, windowStart: now } : slot };
    });

    for (const { counter, slot } of current) {
      if (slot.count >= counter.limit) {
        const resetAt = counter.windowMs === null ? null : slot.windowStart + counter.windowMs;
        return Promise.resolve({ allowed: false, key: counter.key, resetAt });
      }
    }
    for (const { counter, slot } of current) {
      this.#slots.set(counter.key, { count: slot.count + 1, windowStart: slot.windowStart });
    }
    return Promise.resolve({ allowed: true });
  }
}
