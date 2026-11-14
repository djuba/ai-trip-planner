// The invite code every api-nextjs test sends (WU-22 plan D7). It is committed, so the server
// refuses it unless LOCAL_DEV=true (access-config.ts). No Vitest import: scripts outside the test runner
// (the contract runner, the image test) build server environments from this too.
import { TEST_INVITE_CODE_HASH } from '../../src/http/access-config.ts';

export const TEST_INVITE_CODE = 'test-invite-code';
export const TEST_INVITE_LABEL = 'test';

/** Limits no test run reaches. Replay and mock cost nothing. */
export const GENEROUS_LIMITS = {
  QUOTA_EXTRACT: '1000000',
  QUOTA_RECOMMEND: '1000000',
  QUOTA_PRESENT: '1000000',
  RATE_LIMIT_PER_HOUR: '1000000',
  RATE_LIMIT_GLOBAL_PER_DAY: '1000000',
} as const;

/**
 * Every gate variable, so a developer's .env.local can't change a test. LOCAL_DEV is true because
 * the test code is committed; the contract runners override it to run the server as hosted.
 */
export function inviteEnv(entries = `${TEST_INVITE_LABEL}:${TEST_INVITE_CODE_HASH}`) {
  return {
    LOCAL_DEV: 'true',
    ACCESS_GATE: 'on',
    INVITE_CODES: entries,
    REVOKED_INVITE_CODES: '',
    USAGE_STORE: 'memory',
    ...GENEROUS_LIMITS,
  };
}

export const authHeaders = (code: string = TEST_INVITE_CODE): Record<string, string> => ({
  authorization: `Bearer ${code}`,
});
