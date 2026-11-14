import { describe, expect, it } from 'vitest';
import { ConfigError } from '../config.ts';
import { TEST_INVITE_CODE } from '../../tests/support/invite.ts';
import {
  DEFAULT_LIMITS,
  DEV_INVITE_CODE_HASH,
  TEST_INVITE_CODE_HASH,
  loadAccessConfig,
} from './access-config.ts';
import { hashInviteCode } from './invite-code.ts';

const HASH_A = hashInviteCode('code-a');
const HASH_B = hashInviteCode('code-b');

function failure(
  env: Record<string, string | undefined>,
  mode: 'live' | 'record' | 'replay' = 'replay',
): ConfigError {
  try {
    loadAccessConfig(env, mode);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('expected loadAccessConfig to throw');
}

describe('loadAccessConfig', () => {
  it('parses label:hash entries, revoked entries and defaults', () => {
    expect(
      loadAccessConfig(
        { INVITE_CODES: ` alice:${HASH_A} , bob:${HASH_B}`, REVOKED_INVITE_CODES: '' },
        'replay',
      ),
    ).toEqual({
      gate: 'on',
      codes: [
        { label: 'alice', hash: HASH_A },
        { label: 'bob', hash: HASH_B },
      ],
      revoked: [],
      limits: DEFAULT_LIMITS,
      usageStore: 'memory',
    });
  });

  it('AC-GATE-09: the defaults are 60/3/5 per code for life, 30 per hour, 300 a day in all', () => {
    expect(DEFAULT_LIMITS).toEqual({
      quota: { extract: 60, recommend: 3, present: 5 },
      perHour: 30,
      globalPerDay: 300,
    });
  });

  it('AC-GATE-09: reads every limit variable', () => {
    const { limits } = loadAccessConfig(
      {
        QUOTA_EXTRACT: '7',
        QUOTA_RECOMMEND: '2',
        QUOTA_PRESENT: '4',
        RATE_LIMIT_PER_HOUR: '9',
        RATE_LIMIT_GLOBAL_PER_DAY: '11',
      },
      'mock',
    );
    expect(limits).toEqual({
      quota: { extract: 7, recommend: 2, present: 4 },
      perHour: 9,
      globalPerDay: 11,
    });
  });

  it.each(['0', '-1', '1.5', 'ten', '1e3', '99999999999999999999'])(
    'AC-GATE-09: a limit of %j is refused, naming the variable only',
    (value) => {
      const error = failure({ RATE_LIMIT_PER_HOUR: value });
      expect(error.variables).toEqual(['RATE_LIMIT_PER_HOUR']);
      expect(error.message).not.toContain(value);
    },
  );

  it.each([
    ['no colon', HASH_A],
    ['an upper-case label', `Alice:${HASH_A}`],
    ['a long label', `${'a'.repeat(33)}:${HASH_A}`],
    ['a short hash', 'alice:abc123'],
    ['an upper-case hash', `alice:${HASH_A.toUpperCase()}`],
    ['an empty entry', `alice:${HASH_A},,bob:${HASH_B}`],
  ])('AC-GATE-08: an entry with %s is refused in every mode, without its value', (_, value) => {
    const error = failure({ INVITE_CODES: value });
    expect(error.variables).toEqual(['INVITE_CODES']);
    expect(error.message).not.toContain(HASH_A);
  });

  it('AC-GATE-08: a malformed revoked entry is refused', () => {
    expect(failure({ REVOKED_INVITE_CODES: 'nope' }).variables).toEqual(['REVOKED_INVITE_CODES']);
  });

  it('AC-GATE-08: labels and hashes must be unique across both lists', () => {
    expect(
      failure({ INVITE_CODES: `alice:${HASH_A}`, REVOKED_INVITE_CODES: `alice:${HASH_B}` })
        .variables,
    ).toEqual(['INVITE_CODES']);
    expect(failure({ INVITE_CODES: `alice:${HASH_A},bob:${HASH_A}` }).variables).toEqual([
      'INVITE_CODES',
    ]);
  });

  it('AC-GATE-08: replay and mock start with no codes (and refuse every trip request)', () => {
    expect(loadAccessConfig({}, 'replay').codes).toEqual([]);
    expect(loadAccessConfig({}, 'mock').codes).toEqual([]);
  });

  it('AC-GATE-08: live refuses to start without codes, and with the memory store', () => {
    const error = failure({}, 'live');
    expect(error.variables).toEqual(['INVITE_CODES', 'USAGE_STORE']);
    expect(failure({ INVITE_CODES: `alice:${HASH_A}` }, 'live').variables).toEqual(['USAGE_STORE']);
  });

  it.each([
    ['the dev code', DEV_INVITE_CODE_HASH],
    ['the test code', TEST_INVITE_CODE_HASH],
  ])('AC-GATE-08: live refuses %s, which is committed to the repository', (_, hash) => {
    expect(failure({ INVITE_CODES: `alice:${HASH_A},x:${hash}` }, 'live').variables).toContain(
      'INVITE_CODES',
    );
  });

  it('AC-GATE-08: record needs codes, but may use the test code and the memory store', () => {
    expect(failure({}, 'record').variables).toEqual(['INVITE_CODES']);
    expect(
      loadAccessConfig({ INVITE_CODES: `test:${TEST_INVITE_CODE_HASH}` }, 'record'),
    ).toMatchObject({ codes: [{ label: 'test' }], usageStore: 'memory' });
  });

  it('AC-GATE-08: record refuses the .env.example dev code, without quoting it', () => {
    const env = { INVITE_CODES: `alice:${HASH_A},dev:${DEV_INVITE_CODE_HASH}` };
    const error = failure(env, 'record');
    expect(error.variables).toEqual(['INVITE_CODES']);
    expect(error.message).not.toContain(DEV_INVITE_CODE_HASH);
  });

  it('AC-GATE-08: record is refused on Cloud Run, which sets K_SERVICE', () => {
    const env = { INVITE_CODES: `alice:${HASH_A}`, K_SERVICE: 'api' };
    expect(failure(env, 'record').variables).toEqual(['LLM_MODE']);
    expect(loadAccessConfig(env, 'replay').codes).toHaveLength(1);
  });

  it('AC-GATE-19: ACCESS_GATE=off needs no codes, even in live mode with the memory store', () => {
    expect(loadAccessConfig({ ACCESS_GATE: 'off' }, 'live')).toMatchObject({
      gate: 'off',
      codes: [],
      usageStore: 'memory',
    });
  });

  it('AC-GATE-19: ACCESS_GATE=off is refused on Cloud Run, which sets K_SERVICE', () => {
    expect(failure({ ACCESS_GATE: 'off', K_SERVICE: 'api' }).variables).toEqual(['ACCESS_GATE']);
    expect(loadAccessConfig({ ACCESS_GATE: 'on', K_SERVICE: 'api' }, 'replay').gate).toBe('on');
  });

  it('AC-GATE-19: ACCESS_GATE takes only on or off, and defaults to on', () => {
    expect(failure({ ACCESS_GATE: 'false' }).variables).toEqual(['ACCESS_GATE']);
    expect(loadAccessConfig({}, 'replay').gate).toBe('on');
  });

  it('AC-GATE-19: ACCESS_GATE=off still refuses malformed entries', () => {
    expect(failure({ ACCESS_GATE: 'off', INVITE_CODES: 'nope' }).variables).toEqual([
      'INVITE_CODES',
    ]);
  });

  it('refuses an unknown usage store', () => {
    expect(failure({ USAGE_STORE: 'redis' }).variables).toEqual(['USAGE_STORE']);
  });

  it('the committed hashes are the real hashes of the committed codes', () => {
    expect(hashInviteCode('local-dev-invite')).toBe(DEV_INVITE_CODE_HASH);
    expect(hashInviteCode(TEST_INVITE_CODE)).toBe(TEST_INVITE_CODE_HASH);
  });
});
