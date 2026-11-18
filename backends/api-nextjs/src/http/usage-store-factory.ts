// Picks the usage store USAGE_STORE names (WU-23a plan D1). Kept apart from gate.ts so the gate's
// tests construct stores directly.
import type { AccessConfig } from './access-config.ts';
import { firestoreUsageStoreFromEnv } from './firestore-usage-store.ts';
import { MemoryUsageStore, type UsageStore } from './usage-store.ts';

export function createUsageStore(
  kind: AccessConfig['usageStore'],
  env: Record<string, string | undefined>,
): UsageStore {
  return kind === 'firestore' ? firestoreUsageStoreFromEnv(env) : new MemoryUsageStore();
}
