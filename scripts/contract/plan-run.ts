// Decides what scripts/run-contract.ts does, as a pure function so it can be unit-tested (plan D8).
// The project gate must always test this branch's api-nextjs, so an exported API_BASE_URL is used
// only when asked for with --external: it might point at another backend or a live dev server.
import { hashInviteCode, newInviteCode } from '../../backends/api-nextjs/src/http/invite-code.ts';
import { inviteEnv } from '../../backends/api-nextjs/tests/support/invite.ts';

export type RunPlan =
  | { startServer: true; vitestArgs: string[]; notices: string[] }
  | {
      startServer: false;
      baseUrl: string;
      /** CONTRACT_INVITE_CODE: the external backend must already accept it (WU-22 plan D7). */
      inviteCode: string;
      vitestArgs: string[];
      notices: string[];
    };

export class RunPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunPlanError';
  }
}

export function planRun(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): RunPlan {
  const external = argv.includes('--external');
  const vitestArgs = argv.filter((arg) => arg !== '--external');
  const apiBaseUrl = env.API_BASE_URL?.trim() || undefined;

  if (external) {
    if (!apiBaseUrl) {
      throw new RunPlanError('--external needs API_BASE_URL, the backend to test.');
    }
    let url: URL;
    try {
      url = new URL(apiBaseUrl);
    } catch {
      throw new RunPlanError(`API_BASE_URL is not a URL: ${apiBaseUrl}`);
    }
    const baseUrl = url.href.replace(/\/+$/, '');
    const inviteCode = env.CONTRACT_INVITE_CODE?.trim() || undefined;
    if (!inviteCode) {
      throw new RunPlanError(
        '--external needs CONTRACT_INVITE_CODE, an invite code the backend accepts.',
      );
    }
    return {
      startServer: false,
      baseUrl,
      inviteCode,
      vitestArgs,
      notices: [`Testing the backend at ${baseUrl} (--external; not started by this run).`],
    };
  }

  const notices = ['Building and starting api-nextjs on a free port for this run.'];
  if (apiBaseUrl) {
    notices.push(`Ignoring API_BASE_URL=${apiBaseUrl}; use pnpm test:contract:external for it.`);
  }
  return { startServer: true, vitestArgs, notices };
}

/**
 * A code made for one run of a server this runner starts, so no fixed code is needed (AC-GATE-13).
 * The server gets its entry and limits no run reaches; the suite gets the code. The code isn't
 * committed, so the server runs as hosted (no LOCAL_DEV): the contract runs check that config.
 */
export function freshInvite(make: () => string = newInviteCode): {
  code: string;
  serverEnv: Record<string, string>;
} {
  const code = make();
  return {
    code,
    serverEnv: { ...inviteEnv(`contract:${hashInviteCode(code)}`), LOCAL_DEV: 'false' },
  };
}
