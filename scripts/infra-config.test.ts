// Pins the hosted service's configuration (infra/service.tf) to what the post-deploy contract check
// needs (WU-21). Cassette keys hash the model request, model ID included, so the service must use
// the contract runner's model IDs, or every replay misses. Text checks only: `pnpm verify` needs no
// Terraform, and the CI `infra` job validates the HCL itself.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTRACT_TEST_ENV } from '../backends/api-nextjs/tests/support/api-server.ts';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

/**
 * The `env { name = "X" value = ... }` blocks of a Terraform file, as a map. A quoted value is
 * unquoted; an expression (e.g. `var.web_origin`) is kept as written.
 */
function terraformEnv(hcl: string): Record<string, string> {
  const env: Record<string, string> = {};
  const block = /env\s*\{\s*name\s*=\s*"([^"]+)"\s*value\s*=\s*(?:"([^"]*)"|([^\s}]+))\s*\}/g;
  for (const [, name = '', quoted, expression] of hcl.matchAll(block)) {
    env[name] = quoted ?? expression ?? '';
  }
  return env;
}

describe('infra/service.tf', () => {
  const env = terraformEnv(read('infra/service.tf'));

  it('AC-HOST-02: runs in replay mode with the contract runner’s model IDs', () => {
    expect(env).toMatchObject({
      LLM_MODE: CONTRACT_TEST_ENV.LLM_MODE,
      MODEL_FAST: CONTRACT_TEST_ENV.MODEL_FAST,
      MODEL_REASONING: CONTRACT_TEST_ENV.MODEL_REASONING,
      MODEL_CRITIC: CONTRACT_TEST_ENV.MODEL_CRITIC,
    });
  });

  it('AC-HOST-02: sets WEB_ORIGIN from a variable, which the deploy workflow reads back', () => {
    expect(env.WEB_ORIGIN).toBe('var.web_origin');
  });
});

describe('infra/deploy-identity.tf', () => {
  it('AC-HOST-05: names the deploy workflow that exists, so the identity condition can match it', () => {
    const match = /deploy_workflow_path\s*=\s*"([^"]+)"/.exec(read('infra/deploy-identity.tf'));
    expect(match?.[1]).toBe('.github/workflows/deploy.yml');
    expect(existsSync(new URL(match?.[1] ?? '', root))).toBe(true);
  });
});
