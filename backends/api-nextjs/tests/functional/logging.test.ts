// What the built server writes to its logs (AC-LOG-01): usage and gate lines yes, user text, invite
// codes and their hashes never. Requests replay existing cassettes; no new ones are recorded.
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hashInviteCode } from '../../src/http/invite-code.ts';
import { CASSETTE_DIR, startApi, type RunningApi } from '../support/api-server.ts';
import { EXTRACT_REQUESTS } from '../support/extract-requests.ts';
import { authHeaders, inviteEnv } from '../support/invite.ts';
import { PRESENT_REQUESTS } from '../support/present-requests.ts';
import { RECOMMEND_REQUESTS } from '../support/recommend-requests.ts';

const code = `log-test-${randomUUID()}`;
const hash = hashInviteCode(code);

const post = (api: RunningApi, path: string, body: unknown) =>
  fetch(`${api.baseUrl}/v1/trip/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(code) },
    body: JSON.stringify(body),
  });

function expectNothingSensitive(output: string, messages: string[]): void {
  expect(output).not.toContain(code);
  expect(output).not.toContain(hash);
  for (const message of messages) expect(output).not.toContain(message);
}

describe('what the server logs', () => {
  const apis: RunningApi[] = [];
  let dir: string | undefined;

  afterAll(async () => {
    await Promise.all(apis.map((api) => api.stop()));
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('AC-LOG-01: extract, recommend and present log usage and gate lines, never user text or the code', async () => {
    const api = await startApi({ env: inviteEnv(`logtest:${hash}`) });
    apis.push(api);

    const extract = await post(api, 'extract', EXTRACT_REQUESTS.complete);
    expect(extract.status).toBe(200);
    const recommend = await post(api, 'recommend', RECOMMEND_REQUESTS.firstTry);
    expect(recommend.status).toBe(200);
    const present = await post(api, 'present', PRESENT_REQUESTS.contract);
    expect(present.status).toBe(200);
    await present.text();

    const output = api.output();
    expect(output).toMatch(/\[llm\] .*inputTokens=\d+/);
    expect(output).toContain('"event":"gate"');
    expect(output).toContain('"code":"logtest"');
    expectNothingSensitive(output, [
      EXTRACT_REQUESTS.complete.message,
      'Maui, Hawaii',
      'Warm beaches and calm snorkeling water',
    ]);
  });

  it('AC-LOG-01: a request that ends in an upstream failure (502) logs no user text or code either', async () => {
    // The vague extraction cassette with its response swapped for a provider error (as in extract.test.ts).
    dir = await mkdtemp(join(tmpdir(), 'vp-logging-502-'));
    let copied = 0;
    for (const file of await readdir(CASSETTE_DIR)) {
      const cassette = JSON.parse(await readFile(join(CASSETTE_DIR, file), 'utf8')) as {
        request: { body: unknown };
        response: unknown;
      };
      const body = JSON.stringify(cassette.request.body);
      if (!body.includes('Somewhere warm, maybe.') || !body.includes('currentProfile')) continue;
      cassette.response = {
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: { type: 'error', error: { type: 'api_error', message: 'Internal server error' } },
      };
      await writeFile(join(dir, file), JSON.stringify(cassette));
      copied += 1;
    }
    expect(copied, 'the recorded vague extraction cassette').toBe(1);

    const api = await startApi({
      env: { ...inviteEnv(`logtest:${hash}`), LLM_CASSETTE_DIR: dir },
    });
    apis.push(api);
    const response = await post(api, 'extract', EXTRACT_REQUESTS.vague);
    expect(response.status).toBe(502);

    const output = api.output();
    expect(output).toMatch(/\[llm\] .*outcome=error/);
    expect(output).toContain('"event":"gate"');
    expectNothingSensitive(output, [EXTRACT_REQUESTS.vague.message]);
  });
});
