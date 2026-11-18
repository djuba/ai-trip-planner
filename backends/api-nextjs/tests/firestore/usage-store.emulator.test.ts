// The usage-store suite against the real Firestore emulator (WU-23a plan D6). It proves the fake
// in tests/support/fake-firestore.ts. Run by `pnpm test:firestore`, which starts the emulator;
// `pnpm verify` doesn't collect this folder.
import { firestoreUsageStoreFromEnv } from '../../src/http/firestore-usage-store.ts';
import { describeUsageStore } from '../support/usage-store-suite.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GOOGLE_CLOUD_PROJECT) {
  throw new Error('run this through `pnpm test:firestore`: it needs FIRESTORE_EMULATOR_HOST');
}

// Two stores on one emulator are two server instances. The suite's keys are unique per run.
describeUsageStore('FirestoreUsageStore on the emulator', () => [
  firestoreUsageStoreFromEnv(process.env),
  firestoreUsageStoreFromEnv(process.env),
]);
