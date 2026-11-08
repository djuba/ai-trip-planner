// Consumer-driven contract verification (CLAUDE.md §6.5): replays every pact the web consumer
// tests write to contracts/pacts/ (WU-12) against the backend under test. The Pact verifier is
// language-neutral, so the same pacts verify any backend. No broker: pacts are committed.
import { fileURLToPath } from 'node:url';
import { Verifier } from '@pact-foundation/pact';
import { describe, it } from 'vitest';
import { listPactFiles, targetUrl } from './support/artifacts.ts';
import { explainPactError } from './support/pact-errors.ts';

const PROVIDER = 'vacation-api';
const WIRING_PACT = fileURLToPath(new URL('./support/wiring.pact.json', import.meta.url));
const VERIFY_TIMEOUT_MS = 60_000;

// Pact's usage telemetry is opt-out; the runner sets this too.
process.env.PACT_DO_NOT_TRACK = 'true';

async function verify(pactUrls: string[]): Promise<void> {
  try {
    await new Verifier({
      provider: PROVIDER,
      providerBaseUrl: targetUrl(),
      pactUrls,
      logLevel: 'warn',
    }).verifyProvider();
  } catch (error) {
    throw explainPactError(error);
  }
}

describe('Pact provider verification', () => {
  it(
    'AC-CONTRACT-08: the wiring pact verifies against the backend',
    async () => {
      await verify([WIRING_PACT]);
    },
    VERIFY_TIMEOUT_MS,
  );

  const pacts = listPactFiles();
  if (pacts.length === 0) {
    it.skip('AC-CONTRACT-08: no pact files in contracts/pacts yet (written by WU-12)', () => {});
  } else {
    it(
      `AC-CONTRACT-08: consumer pacts verify (${pacts.length} file(s))`,
      async () => {
        await verify(pacts);
      },
      VERIFY_TIMEOUT_MS,
    );
  }
});
