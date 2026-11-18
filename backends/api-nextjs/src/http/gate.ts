// The access gate every trip route passes through before its body is read (WU-22 plan D2, D3,
// D10, D11; WU-23a plan D3, D4): 401 for no usable credential, then 429 for a full window or a
// spent quota. A credential is an invite code, or a trusted service account's Google ID token.
import {
  getAccessConfig,
  type AccessConfig,
  type InviteEntry,
  type TripEndpoint,
} from './access-config.ts';
import { googleIdTokenVerifier, looksLikeJwt, type IdTokenVerifier } from './id-token.ts';
import { matchInviteCode, parseBearer } from './invite-code.ts';
import { createUsageStore } from './usage-store-factory.ts';
import { type Counter, type UsageStore } from './usage-store.ts';

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
  | 'allowed'
  | 'missing'
  | 'unknown'
  | 'revoked'
  | 'expired'
  | 'invalid_token'
  | 'rate_limited'
  | 'quota_exhausted';

/** One structured log line per decision (D10). Never a code or a hash. */
export interface GateEvent {
  outcome: GateOutcome;
  path: string;
  /** The entry's or trusted account's label, when the credential matched one. */
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
  config: Pick<AccessConfig, 'codes' | 'revoked' | 'limits'> &
    Partial<Pick<AccessConfig, 'trusted'>>;
  store: UsageStore;
  now: () => number;
  log?: (event: GateEvent) => void;
  /** Needed only when `config.trusted` is non-empty; without it every JWT is refused. */
  idTokens?: IdTokenVerifier;
}

const TRIP_PATH = /^\/v1\/trip\/([a-z-]+)\/?$/;

function endpointOf(path: string, quota: AccessConfig['limits']['quota']): TripEndpoint {
  const name = TRIP_PATH.exec(path)?.[1];
  if (name !== undefined && Object.hasOwn(quota, name)) return name as TripEndpoint;
  // A gated route with no quota is a bug, so it fails loudly as a 500 rather than going uncounted.
  throw new Error(`No quota is configured for ${path}`);
}

/** Takes the counters, then logs and throws for a refusal. */
async function take(
  store: UsageStore,
  counters: Counter[],
  at: number,
  event: { path: string; code: string },
  log: (event: GateEvent) => void,
): Promise<void> {
  const result = await store.take(counters, at);
  if (result.allowed) {
    log({ outcome: 'allowed', ...event });
    return;
  }
  if (result.resetAt === null) {
    log({ outcome: 'quota_exhausted', ...event });
    throw new QuotaExhaustedError();
  }
  log({ outcome: 'rate_limited', ...event });
  throw new RateLimitedError(Math.max(1, Math.ceil((result.resetAt - at) / 1000)));
}

const globalCounter = (limits: AccessConfig['limits']): Counter => ({
  key: 'global:day',
  limit: limits.globalPerDay,
  windowMs: DAY_MS,
});

export function createGate({ config, store, now, log = consoleGateLog, idTokens }: GateDeps): Gate {
  const { codes, revoked, limits, trusted = [] } = config;
  const entries = new Map<string, InviteEntry>(codes.map((entry) => [entry.label, entry]));
  const accounts = new Map(trusted.map(({ label, email }) => [email, label]));
  return {
    async check(request) {
      const path = new URL(request.url).pathname;
      const code = parseBearer(request.headers.get('authorization'));
      if (code === undefined) {
        log({ outcome: 'missing', path });
        throw new UnauthorizedError();
      }

      if (looksLikeJwt(code)) {
        const at = now();
        const email =
          idTokens === undefined || accounts.size === 0
            ? undefined
            : await idTokens.verify(code, at);
        const label = email === undefined ? undefined : accounts.get(email);
        if (label === undefined) {
          log({ outcome: 'invalid_token', path });
          throw new UnauthorizedError();
        }
        // A trusted account has no quota or hourly window, but shares the global one (D4).
        endpointOf(path, limits.quota);
        await take(store, [globalCounter(limits)], at, { path, code: label }, log);
        return;
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
      const options = entries.get(label)?.options ?? {};
      const at = now();
      if (options.expiresAt !== undefined && at >= options.expiresAt) {
        log({ outcome: 'expired', path, code: label });
        throw new UnauthorizedError();
      }
      const endpoint = endpointOf(path, limits.quota);
      const quota =
        options.quota?.[endpoint] === undefined ? limits.quota[endpoint] : options.quota[endpoint];
      // Quota first, so a spent code is told so, not to wait for a window. `null` is no quota.
      const counters: Counter[] = [
        ...(quota === null
          ? []
          : [{ key: `quota:${label}:${endpoint}`, limit: quota, windowMs: null }]),
        { key: `hour:${label}`, limit: options.perHour ?? limits.perHour, windowMs: HOUR_MS },
        globalCounter(limits),
      ];
      await take(store, counters, at, { path, code: label }, log);
    },
  };
}

/** What ACCESS_GATE=off uses: every request proceeds, uncounted and unlogged. */
export const OPEN_GATE: Gate = { check: () => Promise.resolve() };

let cached: Gate | undefined;

/**
 * The production gate: config from the environment, the configured usage store, Google's keys
 * for ID tokens, the system clock.
 */
export function getGate(): Gate {
  if (cached === undefined) {
    const config = getAccessConfig();
    cached =
      config.gate === 'off'
        ? OPEN_GATE
        : createGate({
            config,
            store: createUsageStore(config.usageStore, process.env),
            now: () => Date.now(),
            ...(config.idTokenAudience === undefined
              ? {}
              : { idTokens: googleIdTokenVerifier(config.idTokenAudience) }),
          });
  }
  return cached;
}
