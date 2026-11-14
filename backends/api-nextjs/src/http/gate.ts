// The access gate every trip route passes through before its body is read (WU-22 plan D2, D3,
// D10, D11): 401 for no usable code, then 429 for a full window or a spent quota.
import { getAccessConfig, type AccessConfig, type TripEndpoint } from './access-config.ts';
import { matchInviteCode, parseBearer } from './invite-code.ts';
import { MemoryUsageStore, type Counter, type UsageStore } from './usage-store.ts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** No usable code. The response doesn't say whether it was missing, unknown or revoked. */
export class UnauthorizedError extends Error {
  constructor() {
    super('A valid invite code is required: Authorization: Bearer <code>');
    this.name = 'UnauthorizedError';
  }
}

/** A window is full; retrying after `retryAfterSeconds` can succeed. */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Too many requests; retry after ${retryAfterSeconds} seconds`);
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The code's lifetime allowance for this endpoint is used up; retrying won't help. */
export class QuotaExhaustedError extends Error {
  constructor() {
    super('This invite code has used its allowance for this endpoint');
    this.name = 'QuotaExhaustedError';
  }
}

export type GateOutcome =
  'allowed' | 'missing' | 'unknown' | 'revoked' | 'rate_limited' | 'quota_exhausted';

/** One structured log line per decision (D10). Never a code or a hash. */
export interface GateEvent {
  outcome: GateOutcome;
  path: string;
  /** The entry's label, when the code matched one. */
  code?: string;
}

/** JSON on stdout, which Cloud Logging parses into fields; `severity` is its level field. */
export function consoleGateLog(event: GateEvent): void {
  const severity = event.outcome === 'allowed' ? 'INFO' : 'WARNING';
  console.log(JSON.stringify({ severity, event: 'gate', ...event }));
}

export interface Gate {
  /** Resolves when the request may proceed; otherwise throws one of the errors above. */
  check(request: Request): Promise<void>;
}

export interface GateDeps {
  config: Pick<AccessConfig, 'codes' | 'revoked' | 'limits'>;
  store: UsageStore;
  now: () => number;
  log?: (event: GateEvent) => void;
}

const TRIP_PATH = /^\/v1\/trip\/([a-z-]+)\/?$/;

function endpointOf(path: string, quota: AccessConfig['limits']['quota']): TripEndpoint {
  const name = TRIP_PATH.exec(path)?.[1];
  if (name !== undefined && Object.hasOwn(quota, name)) return name as TripEndpoint;
  // A gated route with no quota is a bug, so it fails loudly as a 500 rather than going uncounted.
  throw new Error(`No quota is configured for ${path}`);
}

export function createGate({ config, store, now, log = consoleGateLog }: GateDeps): Gate {
  const { codes, revoked, limits } = config;
  return {
    async check(request) {
      const path = new URL(request.url).pathname;
      const code = parseBearer(request.headers.get('authorization'));
      if (code === undefined) {
        log({ outcome: 'missing', path });
        throw new UnauthorizedError();
      }
      const match = matchInviteCode(code, codes, revoked);
      if (match.kind === 'unknown') {
        log({ outcome: 'unknown', path });
        throw new UnauthorizedError();
      }
      if (match.kind === 'revoked') {
        log({ outcome: 'revoked', path, code: match.label });
        throw new UnauthorizedError();
      }

      const { label } = match;
      const endpoint = endpointOf(path, limits.quota);
      const quotaKey = `quota:${label}:${endpoint}`;
      // Quota first, so a spent code is told so, not to wait for a window.
      const counters: Counter[] = [
        { key: quotaKey, limit: limits.quota[endpoint], windowMs: null },
        { key: `hour:${label}`, limit: limits.perHour, windowMs: HOUR_MS },
        { key: 'global:day', limit: limits.globalPerDay, windowMs: DAY_MS },
      ];
      const at = now();
      const result = await store.take(counters, at);
      if (result.allowed) {
        log({ outcome: 'allowed', path, code: label });
        return;
      }
      if (result.resetAt === null) {
        log({ outcome: 'quota_exhausted', path, code: label });
        throw new QuotaExhaustedError();
      }
      log({ outcome: 'rate_limited', path, code: label });
      throw new RateLimitedError(Math.max(1, Math.ceil((result.resetAt - at) / 1000)));
    },
  };
}

/** What ACCESS_GATE=off uses: every request proceeds, uncounted and unlogged. */
export const OPEN_GATE: Gate = { check: () => Promise.resolve() };

let cached: Gate | undefined;

/** The production gate: config from the environment, counts in memory, the system clock. */
export function getGate(): Gate {
  if (cached === undefined) {
    const config = getAccessConfig();
    cached =
      config.gate === 'off'
        ? OPEN_GATE
        : createGate({ config, store: new MemoryUsageStore(), now: () => Date.now() });
  }
  return cached;
}
