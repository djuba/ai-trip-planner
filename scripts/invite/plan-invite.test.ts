import { describe, expect, it } from 'vitest';
import { loadAccessConfig } from '../../backends/api-nextjs/src/http/access-config.ts';
import { matchInviteCode } from '../../backends/api-nextjs/src/http/invite-code.ts';
import { InviteLabelError, planInvite } from './plan-invite.ts';

describe('planInvite', () => {
  it('AC-GATE-15: prints a code and an entry that the gate accepts under that label', () => {
    const { code, entry } = planInvite(['acme-recruiter']);
    const config = loadAccessConfig({ INVITE_CODES: entry }, 'replay');
    expect(matchInviteCode(code, config.codes, config.revoked)).toEqual({
      kind: 'allowed',
      label: 'acme-recruiter',
    });
    expect(entry).not.toContain(code);
  });

  it('AC-GATE-15: makes a new code every time', () => {
    expect(planInvite(['a']).code).not.toBe(planInvite(['a']).code);
  });

  it.each([[[]], [['Acme']], [['a b']], [['x'.repeat(33)]], [['a', 'b']]])(
    'AC-GATE-15: refuses the arguments %j',
    (argv) => {
      expect(() => planInvite(argv)).toThrow(InviteLabelError);
    },
  );
});
