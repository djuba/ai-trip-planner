// Pins the hosted service's configuration (infra/service.tf) to what the post-deploy contract check
// needs (WU-21). Cassette keys hash the model request, model ID included, so the service must use
// the contract runner's model IDs, or every replay misses. Text checks only: `pnpm verify` needs no
// Terraform, and the CI `infra` job validates the HCL itself.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEV_INVITE_CODE_HASH,
  TEST_INVITE_CODE_HASH,
} from '../backends/api-nextjs/src/http/access-config.ts';
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

describe('the access gate in the hosted environment (WU-22)', () => {
  const env = terraformEnv(read('infra/service.tf'));

  it('AC-GATE-14: takes the invite entries from Terraform variables, never literals', () => {
    expect(env.INVITE_CODES).toBe('local.invite_codes');
    expect(env.REVOKED_INVITE_CODES).toBe('local.revoked_invite_codes');
    const service = read('infra/service.tf');
    expect(service).toMatch(/invite_codes\s*=\s*join\(",", var\.invite_codes\)/);
    expect(service).toMatch(/revoked_invite_codes\s*=\s*join\(",", var\.revoked_invite_codes\)/);
    // The entries name their holders, so plan output must not print them.
    const variables = read('infra/variables.tf');
    for (const name of ['invite_codes', 'revoked_invite_codes']) {
      const block = new RegExp(`variable "${name}" \\{[^}]*\\}`).exec(variables)?.[0] ?? '';
      expect(block, name).toMatch(/sensitive\s*=\s*true/);
    }
  });

  it('AC-GATE-14: Terraform rejects the codes committed to the repository at plan time', () => {
    const variables = read('infra/variables.tf');
    const block = variables.slice(
      variables.indexOf('variable "invite_codes"'),
      variables.indexOf('variable "revoked_invite_codes"'),
    );
    for (const hash of [DEV_INVITE_CODE_HASH, TEST_INVITE_CODE_HASH]) {
      expect(block).toContain(`"${hash}"`);
    }
    expect(block).toMatch(/!contains\(/);
  });

  it('AC-GATE-19: never sets ACCESS_GATE, so the hosted service is always gated', () => {
    expect(env).not.toHaveProperty('ACCESS_GATE');
    expect(read('infra/service.tf')).not.toContain('ACCESS_GATE');
  });

  it('AC-GATE-14: sets every limit, as a positive integer', () => {
    for (const name of [
      'QUOTA_EXTRACT',
      'QUOTA_RECOMMEND',
      'QUOTA_PRESENT',
      'RATE_LIMIT_PER_HOUR',
      'RATE_LIMIT_GLOBAL_PER_DAY',
    ]) {
      expect(env[name], name).toMatch(/^[1-9][0-9]*$/);
    }
  });

  it('AC-GATE-14: exactly one deploy step sees the CI invite code: the contract tests', () => {
    const workflow = read('.github/workflows/deploy.yml');
    const steps = workflow.split(/\n\s+- (?=name:|uses:|run:)/).slice(1);
    const withSecret = steps.filter((step) => step.includes('secrets.CONTRACT_INVITE_CODE'));
    expect(withSecret).toHaveLength(1);
    expect(withSecret[0]).toMatch(/^name: Provider contract tests against the service/);
    expect(withSecret[0]).toContain('pnpm test:contract:external');
  });
});

describe('infra/deploy-identity.tf', () => {
  it('AC-HOST-05: names the deploy workflow that exists, so the identity condition can match it', () => {
    const match = /deploy_workflow_path\s*=\s*"([^"]+)"/.exec(read('infra/deploy-identity.tf'));
    expect(match?.[1]).toBe('.github/workflows/deploy.yml');
    expect(existsSync(new URL(match?.[1] ?? '', root))).toBe(true);
  });
});
