import { describe, expect, it } from 'vitest';
import { hashInviteCode } from '../../backends/api-nextjs/src/http/invite-code.ts';
import { RunPlanError, freshInvite, planRun } from './plan-run.ts';

const CODE = { CONTRACT_INVITE_CODE: 'external-code' };

describe('planRun', () => {
  it('AC-CONTRACT-11: by default starts its own server', () => {
    expect(planRun([], {})).toEqual({
      startServer: true,
      vitestArgs: [],
      notices: ['Building and starting api-nextjs on a free port for this run.'],
    });
  });

  it('AC-CONTRACT-11: by default ignores an exported API_BASE_URL, and says so', () => {
    const plan = planRun([], { API_BASE_URL: 'http://localhost:4000' });
    expect(plan.startServer).toBe(true);
    expect(plan.notices.join('\n')).toContain('Ignoring API_BASE_URL=http://localhost:4000');
  });

  it('AC-CONTRACT-11: --external targets API_BASE_URL and starts nothing', () => {
    expect(planRun(['--external'], { API_BASE_URL: 'http://127.0.0.1:8000/', ...CODE })).toEqual({
      startServer: false,
      baseUrl: 'http://127.0.0.1:8000',
      inviteCode: 'external-code',
      vitestArgs: [],
      notices: [
        'Testing the backend at http://127.0.0.1:8000 (--external; not started by this run).',
      ],
    });
  });

  it('AC-CONTRACT-11: --external without API_BASE_URL is an error', () => {
    expect(() => planRun(['--external'], CODE)).toThrow(RunPlanError);
    expect(() => planRun(['--external'], { API_BASE_URL: '  ', ...CODE })).toThrow(RunPlanError);
  });

  it('AC-CONTRACT-11: --external with an API_BASE_URL that is not a URL is an error', () => {
    expect(() => planRun(['--external'], { API_BASE_URL: 'localhost', ...CODE })).toThrow(
      /not a URL/,
    );
  });

  it('AC-GATE-13: --external without CONTRACT_INVITE_CODE is an error naming it', () => {
    for (const code of [undefined, '', '  ']) {
      expect(() =>
        planRun(['--external'], { API_BASE_URL: 'http://h:1', CONTRACT_INVITE_CODE: code }),
      ).toThrow(/CONTRACT_INVITE_CODE/);
    }
  });

  it('AC-GATE-13: a started server needs no code from the environment', () => {
    expect(planRun([], {}).startServer).toBe(true);
  });

  it('passes other arguments through to Vitest', () => {
    expect(
      planRun(['--external', '-t', 'health'], { API_BASE_URL: 'http://h:1', ...CODE }).vitestArgs,
    ).toEqual(['-t', 'health']);
    expect(planRun(['-t', 'cors'], {}).vitestArgs).toEqual(['-t', 'cors']);
  });
});

describe('freshInvite', () => {
  it('AC-GATE-13: makes a new code per run, and gives the server only its hash', () => {
    const a = freshInvite();
    const b = freshInvite();
    expect(a.code).not.toBe(b.code);
    expect(a.serverEnv.INVITE_CODES).toBe(`contract:${hashInviteCode(a.code)}`);
    expect(JSON.stringify(a.serverEnv)).not.toContain(a.code);
    expect(Number(a.serverEnv.QUOTA_RECOMMEND)).toBeGreaterThanOrEqual(1000);
    // The server under contract test runs as hosted.
    expect(a.serverEnv.LOCAL_DEV).toBe('false');
  });
});
