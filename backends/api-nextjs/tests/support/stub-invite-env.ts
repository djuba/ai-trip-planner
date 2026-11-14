// For in-process tests that call route modules directly (WU-22 review fix 1). Call it in
// `beforeAll`, before the first request: the gate reads the environment once per module instance.
import { vi } from 'vitest';
import { inviteEnv } from './invite.ts';

export function stubInviteEnv(overrides: Record<string, string> = {}): void {
  for (const [name, value] of Object.entries({ ...inviteEnv(), ...overrides })) {
    vi.stubEnv(name, value);
  }
}
