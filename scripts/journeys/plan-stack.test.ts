import { describe, expect, it } from 'vitest';
import {
  JOURNEY_DIST_DIR,
  UPSTREAM_ERROR_RESPONSE,
  UPSTREAM_FAILURE_MESSAGE,
  apiEnv,
  failureCassettes,
  planStack,
  playwrightEnv,
  webEnv,
} from './plan-stack.ts';

const INVITE = { INVITE_CODES: 'contract:abc', LOCAL_DEV: 'false', ACCESS_GATE: 'on' };

describe('planStack', () => {
  it('AC-JOURNEY-06: passes every argument through to Playwright unchanged', () => {
    const plan = planStack(['--grep', '@smoke|@critical', '--repeat-each=3'], false);
    expect(plan).toEqual({
      mode: 'replay',
      playwrightArgs: ['--grep', '@smoke|@critical', '--repeat-each=3'],
    });
  });

  it('AC-JOURNEY-06: records only when the recording guard passed', () => {
    expect(planStack([], true).mode).toBe('record');
    expect(planStack([], false).mode).toBe('replay');
  });
});

describe('apiEnv', () => {
  it('AC-JOURNEY-06: replay is hosted config, with a blank key and the copied cassettes', () => {
    const env = apiEnv({
      mode: 'replay',
      webOrigin: 'http://127.0.0.1:5123',
      inviteServerEnv: INVITE,
      cassetteDir: '/tmp/copy',
    });
    expect(env).toMatchObject({
      LLM_MODE: 'replay',
      LOCAL_DEV: 'false',
      ANTHROPIC_API_KEY: '',
      LLM_CASSETTE_DIR: '/tmp/copy',
      WEB_ORIGIN: 'http://127.0.0.1:5123',
      INVITE_CODES: 'contract:abc',
    });
  });

  it('AC-JOURNEY-06: a key in the parent environment never reaches a replay API', () => {
    const parent = { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-live-looking' };
    // startApi spreads its base env first and this env last, so this value wins.
    const merged: NodeJS.ProcessEnv = {
      ...parent,
      ...apiEnv({ mode: 'replay', webOrigin: 'x', inviteServerEnv: INVITE, cassetteDir: '/c' }),
    };
    expect(merged.ANTHROPIC_API_KEY).toBe('');
    expect(merged.LLM_MODE).toBe('replay');
  });

  it('AC-JOURNEY-06: record mode records, as local dev, into the real cassette directory', () => {
    const env = apiEnv({
      mode: 'record',
      webOrigin: 'http://127.0.0.1:5123',
      inviteServerEnv: INVITE,
      cassetteDir: undefined,
    });
    expect(env).toMatchObject({ LLM_MODE: 'record', LOCAL_DEV: 'true' });
    expect(env).not.toHaveProperty('LLM_CASSETTE_DIR');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('AC-JOURNEY-06: replay without the copied directory is an error', () => {
    expect(() =>
      apiEnv({ mode: 'replay', webOrigin: 'x', inviteServerEnv: INVITE, cassetteDir: undefined }),
    ).toThrow(/cassette directory/);
  });
});

describe('webEnv and playwrightEnv', () => {
  it('AC-JOURNEY-06: the web build gets the API URL and its own dist dir', () => {
    expect(webEnv('http://127.0.0.1:4123')).toEqual({
      NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4123',
      NEXT_DIST_DIR: JOURNEY_DIST_DIR,
      NEXT_TELEMETRY_DISABLED: '1',
    });
  });

  it('AC-JOURNEY-06: Playwright gets URLs, the code and the recording flag only', () => {
    expect(
      playwrightEnv({ mode: 'replay', webBaseUrl: 'http://127.0.0.1:5123', inviteCode: 'c' }),
    ).toEqual({
      WEB_BASE_URL: 'http://127.0.0.1:5123',
      JOURNEY_INVITE_CODE: 'c',
      JOURNEYS_RECORDING: '0',
    });
    expect(
      playwrightEnv({ mode: 'record', webBaseUrl: 'u', inviteCode: 'c' }).JOURNEYS_RECORDING,
    ).toBe('1');
  });
});

describe('failureCassettes', () => {
  const cassette = (message: string) =>
    JSON.stringify({
      request: { method: 'POST', url: 'u', body: { messages: [{ content: message }] } },
      response: { status: 200, headers: {}, body: { ok: true } },
    });

  it('AC-JOURNEY-07: swaps every matching response for a 500 and keeps the request', () => {
    const files = [
      { name: 'a.json', text: cassette(`User: ${UPSTREAM_FAILURE_MESSAGE}`) },
      { name: 'b.json', text: cassette('Somewhere warm, maybe.') },
      { name: 'c.json', text: cassette(UPSTREAM_FAILURE_MESSAGE) },
    ];
    const swapped = failureCassettes(files);
    expect(swapped.map((file) => file.name)).toEqual(['a.json', 'c.json']);
    for (const file of swapped) {
      const parsed = JSON.parse(file.text) as { request: unknown; response: unknown };
      const original = JSON.parse(files.find((f) => f.name === file.name)!.text) as {
        request: unknown;
      };
      expect(parsed.request).toEqual(original.request);
      expect(parsed.response).toEqual(UPSTREAM_ERROR_RESPONSE);
    }
  });

  it('AC-JOURNEY-07: no match is an error naming the message', () => {
    expect(() => failureCassettes([{ name: 'b.json', text: cassette('other') }])).toThrow(
      UPSTREAM_FAILURE_MESSAGE,
    );
  });
});
