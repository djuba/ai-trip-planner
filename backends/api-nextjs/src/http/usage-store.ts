// Usage counters for the access gate (WU-22 plan D11). `take` checks every counter a request
// needs and increments all of them or none, so a request one limit refuses consumes nothing from
// the others. Async, so a database can implement it (WU-23a: Firestore, firestore-usage-store.ts).

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

/** One counter's stored state. */
export interface Slot {
  count: number;
  /** Start of the current window; unused for lifetime counters. */
  windowStart: number;
}

/**
 * The one rule both stores apply (WU-23a plan D2): given each counter's stored slot (undefined if
 * none), refuse at the first counter that is full, else increment every one. An ended window
 * counts as empty and restarts at `now`. `next` is what to store when the request is allowed.
 */
export function decide(
  counters: readonly Counter[],
  slots: ReadonlyArray<Slot | undefined>,
  now: number,
): { result: TakeResult; next: Slot[] } {
  const current = counters.map((counter, index) => {
    const slot = slots[index];
    const expired =
      slot === undefined ||
      (counter.windowMs !== null && now >= slot.windowStart + counter.windowMs);
    return expired ? { count: 0, windowStart: now } : slot;
  });
  for (const [index, counter] of counters.entries()) {
    const slot = current[index] as Slot;
    if (slot.count >= counter.limit) {
      const resetAt = counter.windowMs === null ? null : slot.windowStart + counter.windowMs;
      return { result: { allowed: false, key: counter.key, resetAt }, next: [] };
    }
  }
  return {
    result: { allowed: true },
    next: current.map(({ count, windowStart }) => ({ count: count + 1, windowStart })),
  };
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
    const { result, next } = decide(
      counters,
      counters.map(({ key }) => this.#slots.get(key)),
      now,
    );
    if (result.allowed) {
      counters.forEach(({ key }, index) => this.#slots.set(key, next[index] as Slot));
    }
    return Promise.resolve(result);
  }
}
