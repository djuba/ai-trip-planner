// `pnpm invite:new <label> [options]`: makes an invite code for one recipient (WU-22 plan D7, D10). Prints
// the code, to send to them, and its `label:hash` entry, for INVITE_CODES (infra/README.md). It
// takes no code as an argument, so a code never lands in shell history; and it stores nothing.
import { planInvite, InviteArgsError } from './invite/plan-invite.ts';

try {
  const { code, entry } = planInvite(process.argv.slice(2));
  console.log(`Code (send to the recipient; it is shown only now):\n  ${code}\n`);
  console.log(
    `Entry (add to invite_codes in infra/terraform.tfvars, or to INVITE_CODES locally):\n  ${entry}\n`,
  );
  console.log(
    'Its options (;extract=, ;recommend=, ;present=, ;hour=, ;expires=) can be edited in the entry later without reissuing the code.',
  );
} catch (error) {
  if (!(error instanceof InviteArgsError)) throw error;
  console.error(`invite:new: ${error.message}`);
  process.exitCode = 2;
}
