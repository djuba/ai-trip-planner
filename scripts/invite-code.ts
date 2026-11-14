// `pnpm invite:new <label>`: makes an invite code for one recipient (WU-22 plan D7, D10). Prints
// the code, to send to them, and its `label:hash` entry, for INVITE_CODES (infra/README.md). It
// takes no code as an argument, so a code never lands in shell history; and it stores nothing.
import { planInvite, InviteLabelError } from './invite/plan-invite.ts';

try {
  const { code, entry } = planInvite(process.argv.slice(2));
  console.log(`Code (send to the recipient; it is shown only now):\n  ${code}\n`);
  console.log(`Entry (add to INVITE_CODES / the invite_codes Terraform variable):\n  ${entry}`);
} catch (error) {
  if (!(error instanceof InviteLabelError)) throw error;
  console.error(`invite:new: ${error.message}`);
  process.exitCode = 2;
}
