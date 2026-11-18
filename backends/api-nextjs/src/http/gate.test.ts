import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ISSUED_AT,
  TEST_ACCOUNT,
  TEST_AUDIENCE,
  testSigner,
  type TestSigner,
} from '../../tests/support/id-token.ts';
import type { InviteEntry, Limits } from './access-config.ts';
import {
  QuotaExhaustedError,
  RateLimitedError,
  UnauthorizedError,
  consoleGateLog,
  createGate,
  type GateEvent,
} from './gate.ts';
import { createIdTokenVerifier } from './id-token.ts';
import { hashInviteCode } from './invite-code.ts';
import { MemoryUsageStore } from './usage-store.ts';

const CODE = 'alice-secret-code';
const OTHER = 'bob-secret-code';
const REVOKED = 'carol-secret-code';
const HOUR = 3_600_000;

const limits = (overrides: Partial<Limits> = {}): Limits => ({
  quota: { extract: 100, recommend: 100, present: 100 },
  perHour: 100,
  globalPerDay: 100,
  ...overrides,
});

function setup(limitOverrides: Partial<Limits> = {}) {
  const events: GateEvent[] = [];
  let clock = 0;
  const gate = createGate({
    config: {
      codes: [
        { label: 'alice', hash: hashInviteCode(CODE) },
        { label: 'bob', hash: hashInviteCode(OTHER) },
      ],
      revoked: [{ label: 'carol', hash: hashInviteCode(REVOKED) }],
      limits: limits(limitOverrides),
    },
    store: new MemoryUsageStore(),
    now: () => clock,
    log: (event) => events.push(event),
  });
  const request = (endpoint: string, authorization?: string) =>
    new Request(`http://api.test/v1/trip/${endpoint}`, {
      method: 'POST',
      headers: authorization === undefined ? {} : { authorization },
    });
  return {
    events,
    check: (endpoint: string, code?: string) =>
      gate.check(request(endpoint, code === undefined ? undefined : `Bearer ${code}`)),
    checkRaw: (endpoint: string, authorization: string) =>
      gate.check(request(endpoint, authorization)),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createGate', () => {
  it('AC-GATE-01: no code is a 401, logged as missing', async () => {
    const { check, events } = setup();
    await expect(check('extract')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(events).toEqual([{ outcome: 'missing', path: '/v1/trip/extract' }]);
  });

  it('AC-GATE-02: another scheme counts as missing; unknown and revoked are told apart in logs only', async () => {
    const { check, checkRaw, events } = setup();
    await expect(checkRaw('extract', `Basic ${CODE}`)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(check('extract', 'nobody')).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(check('extract', REVOKED)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(events.map((e) => [e.outcome, e.code])).toEqual([
      ['missing', undefined],
      ['unknown', undefined],
      ['revoked', 'carol'],
    ]);
  });

  it('AC-GATE-03: a valid code passes, logged with its label', async () => {
    const { check, events } = setup();
    await expect(check('recommend', CODE)).resolves.toBeUndefined();
    expect(events).toEqual([{ outcome: 'allowed', path: '/v1/trip/recommend', code: 'alice' }]);
  });

  it('AC-GATE-07: the hourly window gives a 429 with the seconds left, per code', async () => {
    const { check, advance, events } = setup({ perHour: 2 });
    await check('extract', CODE);
    advance(1_500);
    await check('extract', CODE);
    const error = await check('extract', CODE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    // 1.5 s into the window: ceil(3598.5) seconds left.
    expect((error as RateLimitedError).retryAfterSeconds).toBe(3599);
    expect(events.at(-1)).toEqual({
      outcome: 'rate_limited',
      path: '/v1/trip/extract',
      code: 'alice',
    });
    await expect(check('extract', OTHER)).resolves.toBeUndefined();
    advance(HOUR);
    await expect(check('extract', CODE)).resolves.toBeUndefined();
  });

  it('AC-GATE-07: Retry-After is at least 1 second', async () => {
    const { check, advance } = setup({ perHour: 1 });
    await check('extract', CODE);
    advance(HOUR - 1);
    const error = (await check('extract', CODE).catch((e: unknown) => e)) as RateLimitedError;
    expect(error.retryAfterSeconds).toBe(1);
  });

  it('AC-GATE-16: a spent quota is QUOTA_EXHAUSTED for that endpoint only, for good', async () => {
    const { check, advance, events } = setup({
      quota: { extract: 1, recommend: 100, present: 100 },
    });
    await check('extract', CODE);
    await expect(check('extract', CODE)).rejects.toBeInstanceOf(QuotaExhaustedError);
    advance(10 * 365 * 24 * HOUR);
    await expect(check('extract', CODE)).rejects.toBeInstanceOf(QuotaExhaustedError);
    await expect(check('recommend', CODE)).resolves.toBeUndefined();
    await expect(check('extract', OTHER)).resolves.toBeUndefined();
    expect(events.filter((e) => e.outcome === 'quota_exhausted')).toHaveLength(2);
  });

  it('AC-GATE-17: requests refused by a quota leave the global window untouched', async () => {
    const { check } = setup({
      quota: { extract: 1, recommend: 100, present: 100 },
      globalPerDay: 3,
    });
    await check('extract', CODE);
    for (let i = 0; i < 10; i += 1) {
      await expect(check('extract', CODE)).rejects.toBeInstanceOf(QuotaExhaustedError);
    }
    await expect(check('extract', OTHER)).resolves.toBeUndefined();
    await expect(check('present', OTHER)).resolves.toBeUndefined();
  });

  it('AC-GATE-18: the global daily window refuses every code once full', async () => {
    const { check, advance } = setup({ globalPerDay: 2 });
    await check('extract', CODE);
    await check('extract', OTHER);
    await expect(check('present', CODE)).rejects.toBeInstanceOf(RateLimitedError);
    const error = (await check('extract', OTHER).catch((e: unknown) => e)) as RateLimitedError;
    expect(error.retryAfterSeconds).toBe(24 * 3600);
    advance(24 * HOUR);
    await expect(check('extract', OTHER)).resolves.toBeUndefined();
  });

  it('a gated path with no quota is a bug, not an uncounted request', async () => {
    const { check } = setup();
    await expect(check('book', CODE)).rejects.toThrow('No quota is configured for /v1/trip/book');
  });

  it('AC-GATE-06: no event carries the code or its hash', async () => {
    const { check, checkRaw, events } = setup({
      quota: { extract: 1, recommend: 100, present: 100 },
      perHour: 2,
    });
    await check('extract', CODE);
    await check('extract', CODE).catch(() => undefined);
    await check('recommend', CODE);
    await check('recommend', CODE).catch(() => undefined);
    await check('extract', REVOKED).catch(() => undefined);
    await check('extract', 'nobody').catch(() => undefined);
    await checkRaw('extract', 'Bearer').catch(() => undefined);
    const text = JSON.stringify(events);
    for (const secret of [CODE, REVOKED, 'nobody', hashInviteCode(CODE), hashInviteCode(REVOKED)]) {
      expect(text).not.toContain(secret);
    }
    expect(new Set(events.map((e) => e.outcome))).toEqual(
      new Set(['allowed', 'quota_exhausted', 'rate_limited', 'revoked', 'unknown', 'missing']),
    );
  });
});

describe('consoleGateLog', () => {
  it('AC-GATE-06: writes one JSON line with a severity Cloud Logging reads', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleGateLog({ outcome: 'allowed', path: '/v1/trip/extract', code: 'alice' });
    consoleGateLog({ outcome: 'revoked', path: '/v1/trip/extract', code: 'carol' });
    expect(log.mock.calls.map(([line]) => JSON.parse(line as string) as unknown)).toEqual([
      {
        severity: 'INFO',
        event: 'gate',
        outcome: 'allowed',
        path: '/v1/trip/extract',
        code: 'alice',
      },
      {
        severity: 'WARNING',
        event: 'gate',
        outcome: 'revoked',
        path: '/v1/trip/extract',
        code: 'carol',
      },
    ]);
  });
});

describe('createGate: per-code options (WU-23a)', () => {
  const DAY = 24 * HOUR;

  function optioned(options: InviteEntry['options'], limitOverrides: Partial<Limits> = {}) {
    const events: GateEvent[] = [];
    let clock = Date.UTC(2027, 0, 31, 12);
    const gate = createGate({
      config: {
        codes: [
          { label: 'owner', hash: hashInviteCode(CODE), ...(options ? { options } : {}) },
          { label: 'bob', hash: hashInviteCode(OTHER) },
        ],
        revoked: [],
        limits: limits(limitOverrides),
      },
      store: new MemoryUsageStore(),
      now: () => clock,
      log: (event) => events.push(event),
    });
    const check = (endpoint: string, code = CODE) =>
      gate.check(
        new Request(`http://api.test/v1/trip/${endpoint}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${code}` },
        }),
      );
    return {
      events,
      check,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it('AC-GATE-20: an entry’s quota overrides the service-wide one for that code only', async () => {
    const { check } = optioned({ quota: { recommend: 1 } });
    await check('recommend');
    await expect(check('recommend')).rejects.toBeInstanceOf(QuotaExhaustedError);
    await expect(check('recommend', OTHER)).resolves.toBeUndefined();
    await expect(check('present')).resolves.toBeUndefined();
  });

  it('AC-GATE-20: a `none` quota never runs out, but the hourly and global windows still apply', async () => {
    const { check, advance } = optioned(
      { quota: { extract: null } },
      { quota: { extract: 1, recommend: 100, present: 100 }, perHour: 3, globalPerDay: 5 },
    );
    for (let i = 0; i < 3; i += 1) await check('extract');
    await expect(check('extract')).rejects.toBeInstanceOf(RateLimitedError);
    advance(HOUR);
    await check('extract');
    await check('extract');
    await expect(check('extract')).rejects.toBeInstanceOf(RateLimitedError);
    const error = (await check('extract', OTHER).catch((e: unknown) => e)) as RateLimitedError;
    expect(error).toBeInstanceOf(RateLimitedError);
  });

  it('AC-GATE-20: an entry’s hourly window overrides the service-wide one', async () => {
    const { check } = optioned({ perHour: 1 });
    await check('extract');
    await expect(check('extract')).rejects.toBeInstanceOf(RateLimitedError);
    await expect(check('extract', OTHER)).resolves.toBeUndefined();
  });

  it('AC-GATE-21: a code works through its expiry day (UTC), then is a 401 logged as expired', async () => {
    const expiresAt = Date.UTC(2027, 1, 1);
    const { check, advance, events } = optioned({ expiresAt });
    await expect(check('extract')).resolves.toBeUndefined();
    advance(expiresAt - 1 - Date.UTC(2027, 0, 31, 12));
    await expect(check('extract')).resolves.toBeUndefined();
    advance(1);
    await expect(check('extract')).rejects.toBeInstanceOf(UnauthorizedError);
    advance(DAY);
    await expect(check('extract')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(events.map((e) => [e.outcome, e.code])).toEqual([
      ['allowed', 'owner'],
      ['allowed', 'owner'],
      ['expired', 'owner'],
      ['expired', 'owner'],
    ]);
  });

  it('AC-GATE-21: an expired code touches no counter', async () => {
    const { check, advance } = optioned(
      { expiresAt: Date.UTC(2027, 0, 31, 13) },
      {
        globalPerDay: 1,
      },
    );
    advance(2 * HOUR);
    await expect(check('extract')).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(check('extract', OTHER)).resolves.toBeUndefined();
  });
});

describe('createGate: service-account ID tokens (WU-23a)', () => {
  const NOW = (ISSUED_AT + 60) * 1000;
  let signer: TestSigner;

  beforeAll(async () => {
    signer = await testSigner();
  });

  function trustedGate(options: { verifier?: boolean; globalPerDay?: number } = {}) {
    const events: GateEvent[] = [];
    const gate = createGate({
      config: {
        codes: [{ label: 'alice', hash: hashInviteCode(CODE) }],
        revoked: [],
        trusted: [{ label: 'ci-deploy', email: TEST_ACCOUNT }],
        limits: limits({
          quota: { extract: 1, recommend: 1, present: 1 },
          perHour: 1,
          globalPerDay: options.globalPerDay ?? 100,
        }),
      },
      store: new MemoryUsageStore(),
      now: () => NOW,
      log: (event) => events.push(event),
      ...(options.verifier === false
        ? {}
        : { idTokens: createIdTokenVerifier({ audience: TEST_AUDIENCE, keys: signer.keys }) }),
    });
    const check = (endpoint: string, credential: string) =>
      gate.check(
        new Request(`http://api.test/v1/trip/${endpoint}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${credential}` },
        }),
      );
    return { events, check };
  }

  it('AC-GATE-23: a trusted account’s token is allowed under its label, with no quota or hourly window', async () => {
    const { check, events } = trustedGate();
    const token = await signer.sign();
    for (let i = 0; i < 5; i += 1) await expect(check('recommend', token)).resolves.toBeUndefined();
    expect(events.at(-1)).toEqual({
      outcome: 'allowed',
      path: '/v1/trip/recommend',
      code: 'ci-deploy',
    });
  });

  it('AC-GATE-23: a trusted account is still counted by the global daily window', async () => {
    const { check } = trustedGate({ globalPerDay: 2 });
    const token = await signer.sign();
    await check('extract', token);
    await check('extract', CODE);
    await expect(check('extract', token)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('AC-GATE-24: an unlisted account or a bad token is a 401 logged as invalid_token, without the token', async () => {
    const { check, events } = trustedGate();
    const unlisted = await signer.sign({ email: 'someone@else.iam.gserviceaccount.com' });
    const wrongAudience = await signer.sign({ aud: 'elsewhere' });
    await expect(check('extract', unlisted)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(check('extract', wrongAudience)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(check('extract', 'x.y.z')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(events).toEqual([
      { outcome: 'invalid_token', path: '/v1/trip/extract' },
      { outcome: 'invalid_token', path: '/v1/trip/extract' },
      { outcome: 'invalid_token', path: '/v1/trip/extract' },
    ]);
    expect(JSON.stringify(events)).not.toContain(unlisted);
  });

  it('AC-GATE-24: with no verifier configured, every JWT is refused', async () => {
    const { check, events } = trustedGate({ verifier: false });
    await expect(check('extract', await signer.sign())).rejects.toBeInstanceOf(UnauthorizedError);
    expect(events).toEqual([{ outcome: 'invalid_token', path: '/v1/trip/extract' }]);
  });

  it('AC-GATE-24: with no trusted accounts, a valid token is still refused', async () => {
    const events: GateEvent[] = [];
    const gate = createGate({
      config: { codes: [], revoked: [], limits: limits() },
      store: new MemoryUsageStore(),
      now: () => NOW,
      log: (event) => events.push(event),
      idTokens: createIdTokenVerifier({ audience: TEST_AUDIENCE, keys: signer.keys }),
    });
    const request = new Request('http://api.test/v1/trip/extract', {
      method: 'POST',
      headers: { authorization: `Bearer ${await signer.sign()}` },
    });
    await expect(gate.check(request)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(events).toEqual([{ outcome: 'invalid_token', path: '/v1/trip/extract' }]);
  });
});

describe('createGate: a failing usage store (WU-23a)', () => {
  it('AC-GATE-27: fails closed: the check rejects, and nothing is logged as allowed', async () => {
    const events: GateEvent[] = [];
    const gate = createGate({
      config: {
        codes: [{ label: 'alice', hash: hashInviteCode(CODE) }],
        revoked: [],
        limits: limits(),
      },
      store: { take: () => Promise.reject(new Error('firestore unreachable')) },
      now: () => 0,
      log: (event) => events.push(event),
    });
    const request = new Request('http://api.test/v1/trip/extract', {
      method: 'POST',
      headers: { authorization: `Bearer ${CODE}` },
    });
    await expect(gate.check(request)).rejects.toThrow('firestore unreachable');
    expect(events).toEqual([]);
  });
});
