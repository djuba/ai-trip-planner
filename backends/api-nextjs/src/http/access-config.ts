// The access gate's configuration (WU-22 plan D4, D10, D11). A loader of its own, not part of
// `loadConfig`: the eval harness loads a live Config in-process and serves no HTTP, so it must not
// need invite codes. No Node APIs here, because instrumentation.ts is also compiled for Edge: the
// committed codes' hashes are literals, checked against the real hash function by the tests.
import { ConfigError, getConfig, type Config } from '../config.ts';

/**
 * One code's own limits, from `;key=value` options on its entry (WU-23a plan D3). Unset fields take
 * the service-wide values; the global daily window always applies.
 */
export interface EntryOptions {
  /** Lifetime quota per endpoint; `null` means none for that endpoint. */
  quota?: Partial<Record<TripEndpoint, number | null>>;
  perHour?: number;
  /** The first instant (epoch ms) the code no longer works: midnight UTC after its `expires` day. */
  expiresAt?: number;
}

/** One `label:hash[;options]` entry. The label names the holder in logs and counters; it isn't secret. */
export interface InviteEntry {
  label: string;
  /** Lowercase hex SHA-256 of the code. */
  hash: string;
  /** Present only when the entry has options. */
  options?: EntryOptions;
}

/** A service account whose Google ID token is accepted in place of a code (WU-23a plan D4). */
export interface TrustedAccount {
  label: string;
  email: string;
}

export interface Limits {
  /** Requests per code over its whole life, per trip endpoint. */
  quota: { extract: number; recommend: number; present: number };
  /** Requests per code per fixed hourly window. */
  perHour: number;
  /** Requests across every code per fixed daily window. */
  globalPerDay: number;
}

export type TripEndpoint = keyof Limits['quota'];

export interface AccessConfig {
  /**
   * `off` lets every trip request through, with no code and no limits: for a local demo only
   * (WU-22 deviation 5). Refused unless LOCAL_DEV=true (deviation 7).
   */
  gate: 'on' | 'off';
  codes: InviteEntry[];
  revoked: InviteEntry[];
  /** Empty unless TRUSTED_SERVICE_ACCOUNTS is set. */
  trusted: TrustedAccount[];
  /** The `aud` an ID token must carry; set exactly when `trusted` is non-empty. */
  idTokenAudience?: string;
  limits: Limits;
  /** `memory` resets on restart; `firestore` persists (WU-23a plan D1). */
  usageStore: 'memory' | 'firestore';
}

/** SHA-256 of `local-dev-invite`, the code `.env.example` configures for `pnpm dev`. */
export const DEV_INVITE_CODE_HASH =
  'ef0876a0698d41ecf40c3fab1c80b26e141b656ebb0162d1f53df242b96f3f26';
/** SHA-256 of `TEST_INVITE_CODE` (tests/support/invite.ts). */
export const TEST_INVITE_CODE_HASH =
  '9f6182f7f4e46cf3b6783072e59f271824b518a9310252430adac0c40863641f';
/** Anyone with the repository knows these codes, so only a LOCAL_DEV server accepts them. */
const COMMITTED_HASHES: ReadonlySet<string> = new Set([
  DEV_INVITE_CODE_HASH,
  TEST_INVITE_CODE_HASH,
]);

export const DEFAULT_LIMITS: Limits = {
  quota: { extract: 60, recommend: 3, present: 5 },
  perHour: 30,
  globalPerDay: 300,
};

const LABEL = /^[a-z0-9-]{1,32}$/;
const HASH = /^[0-9a-f]{64}$/;
const USAGE_STORES = ['memory', 'firestore'] as const;
const QUOTA_OPTIONS = ['extract', 'recommend', 'present'] as const;
const EMAIL = /^[^\s@:;,]+@[^\s@:;,]+\.[^\s@:;,]+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const GATE_MODES = ['on', 'off'] as const;

type Env = Record<string, string | undefined>;
type Problem = { variable: string; reason: string };

/** Modes that reach the model provider, and so spend money (CLAUDE.md §8.3). */
const spends = (mode: Config['llmMode']): boolean => mode === 'live' || mode === 'record';

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/**
 * The items of a list variable: separated by commas or newlines, with blank items and lines
 * starting with `#` skipped, so a hand-edited list can carry comments (AC-GATE-22).
 */
function items(env: Env, name: string): string[] {
  const raw = read(env, name);
  if (raw === undefined) return [];
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== '' && !item.startsWith('#'));
}

/** The exclusive end (epoch ms) of a real `YYYY-MM-DD` day in UTC, or undefined. */
function endOfDay(value: string): number | undefined {
  const match = DATE.exec(value);
  if (match === null) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const start = Date.UTC(year, month - 1, day);
  const date = new Date(start);
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? start + 24 * 60 * 60 * 1000 : undefined;
}

const isPositiveInteger = (value: string): boolean =>
  /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));

/** Parses `;key=value` options (AC-GATE-20); returns undefined after failing on any bad one. */
function options(parts: readonly string[]): EntryOptions | undefined | 'invalid' {
  if (parts.length === 0) return undefined;
  const out: EntryOptions = {};
  const seen = new Set<string>();
  for (const part of parts) {
    const equals = part.indexOf('=');
    const key = part.slice(0, equals);
    const value = part.slice(equals + 1);
    if (equals < 0 || seen.has(key)) return 'invalid';
    seen.add(key);
    if ((QUOTA_OPTIONS as readonly string[]).includes(key)) {
      if (value !== 'none' && !isPositiveInteger(value)) return 'invalid';
      out.quota = { ...out.quota, [key]: value === 'none' ? null : Number(value) };
    } else if (key === 'hour') {
      if (!isPositiveInteger(value)) return 'invalid';
      out.perHour = Number(value);
    } else if (key === 'expires') {
      const expiresAt = endOfDay(value);
      if (expiresAt === undefined) return 'invalid';
      out.expiresAt = expiresAt;
    } else {
      return 'invalid';
    }
  }
  return out;
}

/**
 * Parses `label:hash[;key=value…]` items. Reasons never quote a value: an entry may be pasted
 * wrongly, and a hash next to a label says who holds which code.
 */
function entries(env: Env, name: string, fail: (p: Problem) => void): InviteEntry[] {
  const out: InviteEntry[] = [];
  items(env, name).forEach((item, index) => {
    const [head = '', ...rest] = item.split(';').map((part) => part.trim());
    const colon = head.indexOf(':');
    const label = head.slice(0, colon);
    const hash = head.slice(colon + 1);
    const parsed = options(rest);
    if (colon < 0 || !LABEL.test(label) || !HASH.test(hash) || parsed === 'invalid') {
      fail({
        variable: name,
        reason:
          `entry ${index + 1} must be label:hash[;option=value…] (label [a-z0-9-]{1,32}, hash 64 ` +
          'lowercase hex; options extract, recommend, present, hour, expires, each at most once)',
      });
      return;
    }
    out.push(parsed === undefined ? { label, hash } : { label, hash, options: parsed });
  });
  return out;
}

/** Parses `label:email` items of TRUSTED_SERVICE_ACCOUNTS (AC-GATE-25). */
function trustedAccounts(env: Env, fail: (p: Problem) => void): TrustedAccount[] {
  const out: TrustedAccount[] = [];
  items(env, 'TRUSTED_SERVICE_ACCOUNTS').forEach((item, index) => {
    const colon = item.indexOf(':');
    const label = item.slice(0, colon);
    const email = item.slice(colon + 1);
    if (colon < 0 || !LABEL.test(label) || !EMAIL.test(email)) {
      fail({
        variable: 'TRUSTED_SERVICE_ACCOUNTS',
        reason: `entry ${index + 1} must be label:email (label [a-z0-9-]{1,32})`,
      });
      return;
    }
    out.push({ label, email });
  });
  return out;
}

function positiveInteger(env: Env, name: string, fallback: number, fail: (p: Problem) => void) {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    fail({ variable: name, reason: 'must be a positive integer' });
    return fallback;
  }
  return Number(raw);
}

export function loadAccessConfig(env: Env, llmMode: Config['llmMode']): AccessConfig {
  const problems: Problem[] = [];
  const fail = (problem: Problem): void => {
    problems.push(problem);
  };

  const codes = entries(env, 'INVITE_CODES', fail);
  const revoked = entries(env, 'REVOKED_INVITE_CODES', fail);
  const trusted = trustedAccounts(env, fail);
  const idTokenAudience = read(env, 'ID_TOKEN_AUDIENCE');
  if (trusted.length > 0 && idTokenAudience === undefined) {
    fail({
      variable: 'ID_TOKEN_AUDIENCE',
      reason: 'required when TRUSTED_SERVICE_ACCOUNTS is set',
    });
  }

  const labels = new Set<string>();
  const hashes = new Set<string>();
  for (const { label, hash } of [...codes, ...revoked]) {
    if (labels.has(label)) fail({ variable: 'INVITE_CODES', reason: 'labels must be unique' });
    if (hashes.has(hash)) fail({ variable: 'INVITE_CODES', reason: 'hashes must be unique' });
    labels.add(label);
    hashes.add(hash);
  }
  for (const { label } of trusted) {
    if (labels.has(label)) {
      fail({
        variable: 'TRUSTED_SERVICE_ACCOUNTS',
        reason: 'labels must be unique, and differ from every invite entry',
      });
    }
    labels.add(label);
  }

  const limits: Limits = {
    quota: {
      extract: positiveInteger(env, 'QUOTA_EXTRACT', DEFAULT_LIMITS.quota.extract, fail),
      recommend: positiveInteger(env, 'QUOTA_RECOMMEND', DEFAULT_LIMITS.quota.recommend, fail),
      present: positiveInteger(env, 'QUOTA_PRESENT', DEFAULT_LIMITS.quota.present, fail),
    },
    perHour: positiveInteger(env, 'RATE_LIMIT_PER_HOUR', DEFAULT_LIMITS.perHour, fail),
    globalPerDay: positiveInteger(
      env,
      'RATE_LIMIT_GLOBAL_PER_DAY',
      DEFAULT_LIMITS.globalPerDay,
      fail,
    ),
  };

  const storeRaw = read(env, 'USAGE_STORE') ?? 'memory';
  let usageStore: AccessConfig['usageStore'] = 'memory';
  if ((USAGE_STORES as readonly string[]).includes(storeRaw)) {
    usageStore = storeRaw as AccessConfig['usageStore'];
  } else {
    fail({ variable: 'USAGE_STORE', reason: `must be one of ${USAGE_STORES.join(', ')}` });
  }

  const gateRaw = read(env, 'ACCESS_GATE') ?? 'on';
  let gate: AccessConfig['gate'] = 'on';
  if ((GATE_MODES as readonly string[]).includes(gateRaw)) {
    gate = gateRaw as AccessConfig['gate'];
  } else {
    fail({ variable: 'ACCESS_GATE', reason: `must be one of ${GATE_MODES.join(', ')}` });
  }
  // Fail closed (plan D4, D11; deviation 7). Every server is treated as hosted unless it opts in
  // with LOCAL_DEV=true, so a host nobody thought of gets the strict rules. Locally the only caller
  // is the developer, so the committed codes, the memory store, record mode and ACCESS_GATE=off are
  // allowed there (with startup warnings). Cloud Run always sets K_SERVICE, so the opt-in is
  // refused there as a second guard.
  const localRaw = read(env, 'LOCAL_DEV') ?? 'false';
  if (localRaw !== 'true' && localRaw !== 'false') {
    fail({ variable: 'LOCAL_DEV', reason: 'must be true or false' });
  }
  const local = localRaw === 'true';
  if (local && read(env, 'K_SERVICE') !== undefined) {
    fail({ variable: 'LOCAL_DEV', reason: 'true is for local use only; refused on Cloud Run' });
  }
  if (!local && gate === 'off') {
    fail({ variable: 'ACCESS_GATE', reason: 'off needs LOCAL_DEV=true, so it is never hosted' });
  }
  if (!local && llmMode === 'record') {
    fail({ variable: 'LLM_MODE', reason: 'record needs LOCAL_DEV=true, so it is never hosted' });
  }
  if (gate === 'on' && spends(llmMode) && codes.length === 0) {
    fail({ variable: 'INVITE_CODES', reason: 'required when LLM_MODE is live or record' });
  }
  if (!local && gate === 'on' && codes.some(({ hash }) => COMMITTED_HASHES.has(hash))) {
    fail({
      variable: 'INVITE_CODES',
      reason: 'must not include a code committed to the repository unless LOCAL_DEV=true',
    });
  }
  if (!local && gate === 'on' && llmMode === 'live' && usageStore === 'memory') {
    fail({
      variable: 'USAGE_STORE',
      reason: 'memory resets on restart, so it cannot cap hosted spend when LLM_MODE is live',
    });
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    gate,
    codes,
    revoked,
    trusted,
    ...(trusted.length > 0 ? { idTokenAudience } : {}),
    limits,
    usageStore,
  };
}

/** What a developer should know at startup about a valid configuration; never quotes a value. */
export function startupWarnings(config: AccessConfig, llmMode: Config['llmMode']): string[] {
  if (config.gate === 'off') {
    return [
      'ACCESS_GATE=off: the trip endpoints are open to anyone who can reach this server, and ' +
        'nothing caps spend. For a local demo only.',
    ];
  }
  if (config.codes.length === 0 && config.trusted.length === 0) {
    return ['INVITE_CODES is empty: every trip request will be refused with 401'];
  }
  const warnings: string[] = [];
  if (spends(llmMode) && config.codes.some(({ hash }) => COMMITTED_HASHES.has(hash))) {
    warnings.push(
      `INVITE_CODES includes a code committed to the repository while LLM_MODE is ${llmMode}: ` +
        'anyone who can reach this server can spend with it. Fine on your own machine only.',
    );
  }
  if (spends(llmMode) && config.usageStore === 'memory') {
    warnings.push('USAGE_STORE is memory: every restart resets the quotas and windows.');
  }
  return warnings;
}

let cached: AccessConfig | undefined;

/** Memoizes `loadAccessConfig(process.env, …)`, printing its startup warnings once. */
export function getAccessConfig(): AccessConfig {
  if (cached === undefined) {
    const { llmMode } = getConfig();
    cached = loadAccessConfig(process.env, llmMode);
    for (const warning of startupWarnings(cached, llmMode)) console.warn(warning);
  }
  return cached;
}
