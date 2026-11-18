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

/** The steps of a workflow file, each starting at its first key. */
const workflowSteps = (workflow: string) =>
  workflow.split(/\n\s+- (?=name:|uses:|run:|id:)/).slice(1);

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

  it('AC-GATE-19: never sets ACCESS_GATE or LOCAL_DEV, so the hosted service is gated and strict', () => {
    expect(env).not.toHaveProperty('ACCESS_GATE');
    expect(env).not.toHaveProperty('LOCAL_DEV');
    expect(read('infra/service.tf')).not.toContain('ACCESS_GATE');
    expect(read('infra/service.tf')).not.toContain('LOCAL_DEV');
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

  it('AC-GATE-14: no deploy step reads a stored invite code; the contract tests get an ID token', () => {
    const workflow = read('.github/workflows/deploy.yml');
    expect(workflow).not.toContain('secrets.CONTRACT_INVITE_CODE');
    const steps = workflowSteps(workflow);
    const contract = steps.find((step) =>
      step.startsWith('name: Provider contract tests against the service'),
    );
    expect(contract).toContain(
      'CONTRACT_INVITE_CODE: ${{ steps.contract-token.outputs.id_token }}',
    );
    expect(contract).toContain('pnpm test:contract:external');
  });

  it('AC-GATE-14: the ID-token step adds no cloud credential, and its audience is the service’s', () => {
    const steps = workflowSteps(read('.github/workflows/deploy.yml'));
    const token = steps.find((step) => step.includes('id: contract-token')) ?? '';
    expect(token).toContain('token_format: id_token');
    expect(token).toContain('id_token_include_email: true');
    expect(token).toContain('create_credentials_file: false');
    expect(token).toContain('export_environment_variables: false');
    const audience = /id_token_audience:\s*(\S+)/.exec(token)?.[1];
    const variable = /variable "id_token_audience" \{[^}]*default\s*=\s*"([^"]+)"/.exec(
      read('infra/variables.tf'),
    )?.[1];
    expect(audience).toBeDefined();
    expect(audience).toBe(variable);
    expect(env.ID_TOKEN_AUDIENCE).toBe('var.id_token_audience');
    expect(env.TRUSTED_SERVICE_ACCOUNTS).toBe('ci-deploy:${google_service_account.deploy.email}');
  });
});

describe('persistent counts and alerts in the hosted environment (WU-23a)', () => {
  const env = terraformEnv(read('infra/service.tf'));

  it('AC-GATE-29: the service counts in Firestore by default', () => {
    expect(env.USAGE_STORE).toBe('var.usage_store');
    expect(read('infra/variables.tf')).toMatch(
      /variable "usage_store" \{[^}]*default\s*=\s*"firestore"/,
    );
  });

  it('AC-GATE-29: the runtime account’s only role is Firestore, limited to the default database', () => {
    const terraform = [
      'main',
      'service',
      'firestore',
      'alerts',
      'deploy-identity',
      'registry',
      'budget',
    ]
      .map((name) => read(`infra/${name}.tf`))
      .join('\n');
    // Grants *to* the runtime account name it as the member.
    const grants = terraform.match(/member\s*=\s*google_service_account\.runtime\.member/g) ?? [];
    expect(grants).toHaveLength(1);
    const firestore = read('infra/firestore.tf');
    expect(firestore).toMatch(/role\s*=\s*"roles\/datastore\.user"/);
    expect(firestore).toMatch(/expression\s*=\s*"resource\.name == /);
  });

  it('AC-GATE-29: one alert matches gate refusals for revoked, expired, exhausted and rate-limited codes', () => {
    const alerts = read('infra/alerts.tf');
    expect(alerts.match(/resource "google_monitoring_alert_policy"/g)).toHaveLength(1);
    expect(alerts).toContain('jsonPayload.event=\\"gate\\"');
    for (const outcome of ['revoked', 'expired', 'quota_exhausted', 'rate_limited']) {
      expect(alerts).toContain(`\\"${outcome}\\"`);
    }
    expect(alerts).not.toContain('\\"unknown\\"');
  });
});

describe('infra/deploy-identity.tf', () => {
  it('AC-HOST-05: names the deploy workflow that exists, so the identity condition can match it', () => {
    const match = /deploy_workflow_path\s*=\s*"([^"]+)"/.exec(read('infra/deploy-identity.tf'));
    expect(match?.[1]).toBe('.github/workflows/deploy.yml');
    expect(existsSync(new URL(match?.[1] ?? '', root))).toBe(true);
  });
});
