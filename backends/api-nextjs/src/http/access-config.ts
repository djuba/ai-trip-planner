// The access gate's configuration (WU-22 plan D4, D10, D11). A loader of its own, not part of
// `loadConfig`: the eval harness loads a live Config in-process and serves no HTTP, so it must not
// need invite codes. No Node APIs here, because instrumentation.ts is also compiled for Edge: the
// committed codes' hashes are literals, checked against the real hash function by the tests.
import { ConfigError, getConfig, type Config } from '../config.ts';

/** One `label:hash` entry. The label names the holder in logs and counters; it isn't secret. */
export interface InviteEntry {
  label: string;
  /** Lowercase hex SHA-256 of the code. */
  hash: string;
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
   * (WU-22 deviation 5). Refused on Cloud Run, which always sets K_SERVICE.
   */
  gate: 'on' | 'off';
  codes: InviteEntry[];
  revoked: InviteEntry[];
  limits: Limits;
  /** Only `memory` exists so far; a persistent store arrives with live mode (WU-23). */
  usageStore: 'memory';
}

/** SHA-256 of `local-dev-invite`, the code `.env.example` configures for `pnpm dev`. */
export const DEV_INVITE_CODE_HASH =
  'ef0876a0698d41ecf40c3fab1c80b26e141b656ebb0162d1f53df242b96f3f26';
/** SHA-256 of `TEST_INVITE_CODE` (tests/support/invite.ts). */
export const TEST_INVITE_CODE_HASH =
  '9f6182f7f4e46cf3b6783072e59f271824b518a9310252430adac0c40863641f';
/** Anyone with the repository knows these codes, so a service that spends money refuses them. */
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
const USAGE_STORES = ['memory'] as const;
const GATE_MODES = ['on', 'off'] as const;

type Env = Record<string, string | undefined>;
type Problem = { variable: string; reason: string };

/** Modes that reach the model provider, and so spend money (CLAUDE.md §8.3). */
const spends = (mode: Config['llmMode']): boolean => mode === 'live' || mode === 'record';

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** Parses `label:hash,label:hash`. Reasons never quote a value: an entry may be pasted wrongly. */
function entries(env: Env, name: string, fail: (p: Problem) => void): InviteEntry[] {
  const raw = read(env, name);
  if (raw === undefined) return [];
  const out: InviteEntry[] = [];
  raw.split(',').forEach((part, index) => {
    const entry = part.trim();
    const colon = entry.indexOf(':');
    const label = entry.slice(0, colon);
    const hash = entry.slice(colon + 1);
    if (colon < 0 || !LABEL.test(label) || !HASH.test(hash)) {
      fail({
        variable: name,
        reason: `entry ${index + 1} must be label:hash (label [a-z0-9-]{1,32}, hash 64 lowercase hex)`,
      });
      return;
    }
    out.push({ label, hash });
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

  const labels = new Set<string>();
  const hashes = new Set<string>();
  for (const { label, hash } of [...codes, ...revoked]) {
    if (labels.has(label)) fail({ variable: 'INVITE_CODES', reason: 'labels must be unique' });
    if (hashes.has(hash)) fail({ variable: 'INVITE_CODES', reason: 'hashes must be unique' });
    labels.add(label);
    hashes.add(hash);
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
  // Cloud Run sets K_SERVICE in every container, so a hosted service can never run ungated.
  if (gate === 'off' && read(env, 'K_SERVICE') !== undefined) {
    fail({ variable: 'ACCESS_GATE', reason: 'off is for local use only; refused on Cloud Run' });
  }

  // Fail closed wherever a request can spend money (plan D4, D11; deviation 1). Record mode is for
  // a developer's machine: it needs codes and refuses the dev code everyone knows, but accepts the
  // test code and the memory store, which the cassette recorder's harness uses; otherwise nothing
  // could record until WU-23. It is refused on Cloud Run, where live mode's checks apply instead.
  if (gate === 'on' && spends(llmMode) && codes.length === 0) {
    fail({ variable: 'INVITE_CODES', reason: 'required when LLM_MODE is live or record' });
  }
  if (gate === 'on' && llmMode === 'record' && codes.some((c) => c.hash === DEV_INVITE_CODE_HASH)) {
    fail({
      variable: 'INVITE_CODES',
      reason: 'must not include the .env.example dev code when LLM_MODE is record',
    });
  }
  if (llmMode === 'record' && read(env, 'K_SERVICE') !== undefined) {
    fail({ variable: 'LLM_MODE', reason: 'record is for local use only; refused on Cloud Run' });
  }
  if (gate === 'on' && llmMode === 'live') {
    if (codes.some(({ hash }) => COMMITTED_HASHES.has(hash))) {
      fail({
        variable: 'INVITE_CODES',
        reason: 'must not include a code committed to the repository when LLM_MODE is live',
      });
    }
    if (usageStore === 'memory') {
      fail({
        variable: 'USAGE_STORE',
        reason: 'memory resets on restart, so it cannot cap spend when LLM_MODE is live',
      });
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return { gate, codes, revoked, limits, usageStore };
}

let cached: AccessConfig | undefined;

/** Memoizes `loadAccessConfig(process.env, …)`, warning once when the gate is off or shut. */
export function getAccessConfig(): AccessConfig {
  if (cached === undefined) {
    cached = loadAccessConfig(process.env, getConfig().llmMode);
    if (cached.gate === 'off') {
      console.warn(
        'ACCESS_GATE=off: the trip endpoints are open to anyone who can reach this server, and ' +
          'nothing caps spend. For a local demo only.',
      );
    } else if (cached.codes.length === 0) {
      console.warn('INVITE_CODES is empty: every trip request will be refused with 401');
    }
  }
  return cached;
}
