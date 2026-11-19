import { describe, expect, it } from 'vitest';
import { loadAccessConfig } from '../../backends/api-nextjs/src/http/access-config.ts';
import { matchInviteCode } from '../../backends/api-nextjs/src/http/invite-code.ts';
import { INVITE_PARAM } from '../../apps/web-nextjs/src/lib/invite.ts';
import { InviteArgsError, WEB_URL_PLACEHOLDER, planInvite } from './plan-invite.ts';

function accepted(argv: string[]) {
  const { code, entry } = planInvite(argv);
  const config = loadAccessConfig({ INVITE_CODES: entry }, 'replay');
  return { code, entry, config };
}

describe('planInvite', () => {
  it('AC-GATE-15: prints a code and an entry that the gate accepts under that label', () => {
    const { code, entry } = planInvite(['acme-recruiter']);
    const config = loadAccessConfig({ INVITE_CODES: entry }, 'replay');
    expect(matchInviteCode(code, config.codes, config.revoked)).toEqual({
      kind: 'allowed',
      label: 'acme-recruiter',
    });
    expect(entry).not.toContain(code);
    expect(entry).not.toContain(';');
  });

  it('AC-GATE-30: prints an invite link for the same code, with a placeholder for the web URL', () => {
    const { code, link } = planInvite(['acme-recruiter', '--extract', '3']);
    expect(link).toBe(`<web_url>/?invite=${code}`);
    const url = new URL(link.replace(WEB_URL_PLACEHOLDER, 'https://web.example'));
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get(INVITE_PARAM)).toBe(code);
  });

  it('AC-GATE-15: makes a new code every time', () => {
    expect(planInvite(['a']).code).not.toBe(planInvite(['a']).code);
  });

  it('AC-GATE-28: each flag becomes its option, which the gate accepts', () => {
    const { code, entry, config } = accepted([
      'owner',
      '--extract',
      '5',
      '--recommend=none',
      '--present',
      '7',
      '--hour',
      '12',
      '--expires',
      '2027-01-31',
    ]);
    expect(entry).toMatch(
      /^owner:[0-9a-f]{64};extract=5;recommend=none;present=7;hour=12;expires=2027-01-31$/,
    );
    const found = config.codes[0];
    expect(found?.options).toEqual({
      quota: { extract: 5, recommend: null, present: 7 },
      perHour: 12,
      expiresAt: Date.UTC(2027, 0, 31) + 24 * 60 * 60 * 1000,
    });
    expect(matchInviteCode(code, config.codes, config.revoked)).toMatchObject({
      kind: 'allowed',
      label: 'owner',
    });
  });

  it('AC-GATE-28: --no-quota sets all three quotas to none, with flags in any order', () => {
    const { entry, config } = accepted(['--hour', '30', '--no-quota', 'owner']);
    expect(entry).toMatch(/^owner:[0-9a-f]{64};extract=none;recommend=none;present=none;hour=30$/);
    expect(config.codes[0]?.options).toEqual({
      quota: { extract: null, recommend: null, present: null },
      perHour: 30,
    });
  });

  it.each([
    [['a', '--bogus', '1']],
    [['a', '--extract', '1', '--extract', '2']],
    [['a', '--extract=1', '--extract', '2']],
    [['a', '--no-quota', '--no-quota']],
    [['a', '--extract']],
    [['a', '--extract', '--hour', '3']],
    [['a', '--extract=']],
    [['a', '--extract', '0']],
    [['a', '--extract', '1.5']],
    [['a', '--recommend', 'abc']],
    [['a', '--present', '-1']],
    [['a', '--hour', 'none']],
    [['a', '--hour', '0']],
    [['a', '--expires', '2027-02-30']],
    [['a', '--expires', '2027-1-1']],
    [['a', '--no-quota', '--extract', '5']],
    [['a', '--present=none', '--no-quota']],
    [['a', '--no-quota=1']],
    [['a', 'b']],
    [['--hour', '3']],
  ])('AC-GATE-28: refuses the arguments %j', (argv) => {
    expect(() => planInvite(argv)).toThrow(InviteArgsError);
    expect(() => planInvite(argv)).toThrow(/usage: pnpm invite:new/);
  });

  it.each([[[]], [['Acme']], [['a b']], [['x'.repeat(33)]], [['a', 'b']]])(
    'AC-GATE-15: refuses the arguments %j',
    (argv) => {
      expect(() => planInvite(argv)).toThrow(InviteArgsError);
    },
  );
});
