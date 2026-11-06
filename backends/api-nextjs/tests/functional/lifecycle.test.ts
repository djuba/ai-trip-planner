import { describe, expect, it } from 'vitest';
import { ApiExitedError, startApi } from '../support/api-server.ts';

describe('server lifecycle', () => {
  it('AC-API-17: an invalid config stops the server, naming the variable', async () => {
    const failure = await startApi({ env: { LLM_MODE: 'bogus' } }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiExitedError);
    const exited = failure as ApiExitedError;
    expect(exited.exitCode).not.toBe(0);
    expect(exited.message).toContain('LLM_MODE');
  });

  it('AC-API-18: after stop, the port refuses connections', async () => {
    const api = await startApi();
    const health = `${api.baseUrl}/v1/health`;
    expect((await fetch(health)).status).toBe(200);
    await api.stop();
    await expect(fetch(health)).rejects.toThrow();
  });
});
