// The logic of `pnpm invite:new`, pure apart from the random code, so it can be unit-tested.
import { hashInviteCode, newInviteCode } from '../../backends/api-nextjs/src/http/invite-code.ts';

/** The label rule INVITE_CODES enforces (backends/api-nextjs/src/http/access-config.ts). */
const LABEL = /^[a-z0-9-]{1,32}$/;

export class InviteLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteLabelError';
  }
}

export function planInvite(
  argv: readonly string[],
  make: () => string = newInviteCode,
): { code: string; entry: string } {
  const [label, ...rest] = argv;
  if (label === undefined || rest.length > 0) {
    throw new InviteLabelError(
      'usage: pnpm invite:new <label>, e.g. pnpm invite:new acme-recruiter',
    );
  }
  if (!LABEL.test(label)) {
    throw new InviteLabelError('the label must be 1 to 32 characters of a-z, 0-9 and -');
  }
  const code = make();
  return { code, entry: `${label}:${hashInviteCode(code)}` };
}
