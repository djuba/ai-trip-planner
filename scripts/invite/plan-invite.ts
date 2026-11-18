// The logic of `pnpm invite:new`, pure apart from the random code, so it can be unit-tested.
import { hashInviteCode, newInviteCode } from '../../backends/api-nextjs/src/http/invite-code.ts';

/** The label rule INVITE_CODES enforces (backends/api-nextjs/src/http/access-config.ts). */
const LABEL = /^[a-z0-9-]{1,32}$/;

const USAGE =
  'usage: pnpm invite:new <label> [--extract n|none] [--recommend n|none] [--present n|none] ' +
  '[--no-quota] [--hour n] [--expires YYYY-MM-DD]';

/** Options in the fixed order they are written into an entry. */
const VALUE_FLAGS = ['extract', 'recommend', 'present', 'hour', 'expires'] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];
const QUOTA_FLAGS: readonly ValueFlag[] = ['extract', 'recommend', 'present'];

export class InviteArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteArgsError';
  }
}

const fail = (message: string): never => {
  throw new InviteArgsError(`${message}\n${USAGE}`);
};

const isPositiveInteger = (value: string): boolean =>
  /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));

/** A real `YYYY-MM-DD` calendar date, as the server requires. */
function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function checkValue(flag: ValueFlag, value: string): void {
  if (QUOTA_FLAGS.includes(flag)) {
    if (value !== 'none' && !isPositiveInteger(value)) {
      fail(`--${flag} must be a positive integer or none`);
    }
  } else if (flag === 'hour') {
    if (!isPositiveInteger(value)) fail('--hour must be a positive integer');
  } else if (!isRealDate(value)) {
    fail('--expires must be a real date written YYYY-MM-DD');
  }
}

export function planInvite(
  argv: readonly string[],
  make: () => string = newInviteCode,
): { code: string; entry: string } {
  const labels: string[] = [];
  const values = new Map<ValueFlag, string>();
  let noQuota = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith('--')) {
      labels.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    const name = equals < 0 ? arg.slice(2) : arg.slice(2, equals);
    if (name === 'no-quota') {
      if (equals >= 0) fail('--no-quota takes no value');
      if (noQuota) fail('--no-quota given more than once');
      noQuota = true;
      continue;
    }
    if (!(VALUE_FLAGS as readonly string[]).includes(name)) fail(`unknown flag --${name}`);
    const flag = name as ValueFlag;
    if (values.has(flag)) fail(`--${flag} given more than once`);
    let value: string | undefined;
    if (equals >= 0) {
      value = arg.slice(equals + 1);
    } else {
      value = argv[i + 1];
      i++;
    }
    if (value === undefined || value === '' || value.startsWith('--')) {
      fail(`--${flag} needs a value`);
    }
    checkValue(flag, value as string);
    values.set(flag, value as string);
  }

  const [label, ...rest] = labels;
  if (label === undefined || rest.length > 0) fail('give exactly one label');
  if (!LABEL.test(label as string)) fail('the label must be 1 to 32 characters of a-z, 0-9 and -');
  if (noQuota && QUOTA_FLAGS.some((flag) => values.has(flag))) {
    fail('--no-quota cannot be combined with --extract, --recommend or --present');
  }
  if (noQuota) for (const flag of QUOTA_FLAGS) values.set(flag, 'none');

  const options = VALUE_FLAGS.filter((flag) => values.has(flag)).map(
    (flag) => `;${flag}=${values.get(flag)}`,
  );
  const code = make();
  return { code, entry: `${label}:${hashInviteCode(code)}${options.join('')}` };
}
