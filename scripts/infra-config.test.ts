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

  it('AC-HOST-10: sets WEB_ORIGIN to the web service’s URI, which the deploy workflow reads back', () => {
    expect(env.WEB_ORIGIN).toBe('google_cloud_run_v2_service.web.uri');
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
    // The contract suite runs on the replay twin (WU-23b plan D4).
    const twin = terraformEnv(read('infra/replay.tf'));
    expect(twin.ID_TOKEN_AUDIENCE).toBe('var.id_token_audience');
    expect(twin.TRUSTED_SERVICE_ACCOUNTS).toBe('ci-deploy:${google_service_account.deploy.email}');
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
      'replay',
      'web',
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

// WU-23b: the web service, the replay twin and the automated pipeline.

/** The jobs of a workflow file, by name, each with its own lines. */
function workflowJobs(workflow: string): Record<string, string> {
  const jobs: Record<string, string> = {};
  const body = workflow.slice(workflow.indexOf('\njobs:\n'));
  for (const part of body.split(/\n {2}(?=[a-z][a-z-]*:\n)/).slice(1)) {
    const name = /^([a-z][a-z-]*):/.exec(part)?.[1] ?? '';
    jobs[name] = part;
  }
  return jobs;
}

/** Every Terraform file in infra/, joined. */
const allTerraform = () =>
  [
    'main',
    'service',
    'replay',
    'web',
    'firestore',
    'alerts',
    'deploy-identity',
    'registry',
    'budget',
  ]
    .map((name) => read(`infra/${name}.tf`))
    .join('\n');

/** The part of deploy-identity.tf before its rollout-only section (WU-23b plan D8). */
const steadyIdentity = () => {
  const identity = read('infra/deploy-identity.tf');
  const end = identity.indexOf('# Rollout only');
  return end === -1 ? identity : identity.slice(0, end);
};

describe('the web service (WU-23b)', () => {
  it('AC-HOST-10: has no env, no secret and a runtime account with no role', () => {
    const web = read('infra/web.tf');
    expect(web).not.toMatch(/\benv\s*\{/);
    expect(web).not.toMatch(/secret_key_ref|google_secret_manager/);
    expect(web).toMatch(/service_account\s*=\s*google_service_account\.web_runtime\.email/);
    expect(allTerraform()).not.toMatch(/member\s*=\s*google_service_account\.web_runtime\.member/);
  });

  it('AC-HOST-10: scales from zero to one instance and is public', () => {
    const web = read('infra/web.tf');
    expect(web).toMatch(/min_instance_count\s*=\s*0/);
    expect(web).toMatch(/max_instance_count\s*=\s*1/);
    expect(web).toMatch(/member\s*=\s*"allUsers"/);
  });
});

describe('the replay twin (WU-23b)', () => {
  const twin = terraformEnv(read('infra/replay.tf'));
  const api = terraformEnv(read('infra/service.tf'));

  it('AC-HOST-11: always replays, counts in memory and trusts only the build identity', () => {
    expect(twin.LLM_MODE).toBe('replay');
    expect(twin.USAGE_STORE).toBe('memory');
    expect(twin.TRUSTED_SERVICE_ACCOUNTS).toBe('ci-deploy:${google_service_account.deploy.email}');
    expect(twin).not.toHaveProperty('INVITE_CODES');
    expect(twin).not.toHaveProperty('ACCESS_GATE');
    expect(twin).not.toHaveProperty('LOCAL_DEV');
  });

  it('AC-HOST-11: shares api’s model IDs and web origin, so its cassettes and CORS match', () => {
    for (const name of ['MODEL_FAST', 'MODEL_REASONING', 'MODEL_CRITIC', 'WEB_ORIGIN']) {
      expect(twin[name], name).toBe(api[name]);
    }
    expect(twin.MODEL_FAST).toBe(CONTRACT_TEST_ENV.MODEL_FAST);
  });

  it('AC-HOST-11: its runtime account has no role', () => {
    expect(read('infra/replay.tf')).toMatch(
      /service_account\s*=\s*google_service_account\.replay_runtime\.email/,
    );
    expect(allTerraform()).not.toMatch(
      /member\s*=\s*google_service_account\.replay_runtime\.member/,
    );
  });
});

describe('the deploy pipeline (WU-23b)', () => {
  const jobs = workflowJobs(read('.github/workflows/deploy.yml'));

  it('AC-HOST-12: has the four jobs, and only twin-check runs the contract suite, on the twin', () => {
    expect(Object.keys(jobs).sort()).toEqual(['build', 'journeys', 'promote', 'twin-check']);
    expect(jobs['twin-check']).toContain('gcloud run services update api-replay');
    expect(jobs['twin-check']).toContain('pnpm test:contract:external');
    for (const name of ['build', 'journeys', 'promote']) {
      expect(jobs[name], name).not.toContain('test:contract');
    }
  });

  it('AC-HOST-14: build and twin-check never deploy the services users reach', () => {
    for (const name of ['build', 'twin-check']) {
      expect(jobs[name], name).not.toMatch(/services update (api|web) /);
      expect(jobs[name], name).not.toContain('service_account: ${{ secrets.GCP_PROMOTE_SA }}');
    }
  });

  it('AC-HOST-14: build checks a dispatched commit is a full SHA on main, and only a dispatched one', () => {
    const steps = workflowSteps(jobs.build ?? '');
    const check = steps.find((step) => step.startsWith('name: Check the commit is on main')) ?? '';
    expect(check).toContain("if: inputs.sha != ''");
    expect(check).toContain('^[0-9a-f]{40}$');
    expect(check).toContain('git merge-base --is-ancestor "$SHA" origin/main');
  });

  it('AC-HOST-14: journeys runs the integrated gate with no cloud access', () => {
    const journeys = jobs.journeys ?? '';
    expect(journeys).toContain('pnpm verify:integrated');
    expect(journeys).not.toContain('id-token');
    expect(journeys).not.toContain('secrets.');
  });

  it('AC-HOST-14: promote waits for every check, runs in environment live and installs nothing', () => {
    const promote = jobs.promote ?? '';
    expect(promote).toMatch(/needs:\s*\[build, twin-check, journeys\]/);
    expect(promote).toMatch(/environment:\s*live/);
    expect(promote).toContain('service_account: ${{ secrets.GCP_PROMOTE_SA }}');
    expect(promote).not.toMatch(/pnpm|npm |yarn|docker build/);
    expect(promote).not.toContain('cache:');
  });

  it('AC-HOST-14: promote deploys the digests build pushed, never a tag', () => {
    const promote = jobs.promote ?? '';
    expect(promote).toContain('API_DIGEST: ${{ needs.build.outputs.api_digest }}');
    expect(promote).toContain('WEB_DIGEST: ${{ needs.build.outputs.web_digest }}');
    expect(promote).toContain('api/api-nextjs@$API_DIGEST');
    expect(promote).toContain('web/web-nextjs@$WEB_DIGEST');
    expect(promote).not.toMatch(/api-nextjs:\$/);
    expect(jobs['twin-check']).toContain('api/api-nextjs@$API_DIGEST');
  });

  it('AC-HOST-17: promote runs the smoke check, and rolls back to the recorded images on failure', () => {
    const steps = workflowSteps(jobs.promote ?? '');
    const order = steps.map((step) => /^name: (.*)/.exec(step)?.[1] ?? '');
    const deploy = order.indexOf('Deploy the API and the web client');
    const smoke = order.indexOf('Smoke check');
    const rollback = order.indexOf('Roll back to the images that were running');
    expect(order.indexOf('Read the services and record what is running')).toBeLessThan(deploy);
    expect(deploy).toBeLessThan(smoke);
    expect(smoke).toBeLessThan(rollback);
    expect(steps[smoke]).toContain('node scripts/release-smoke.ts');
    expect(steps[rollback]).toMatch(/if: \(failure\(\) \|\| cancelled\(\)\)/);
    for (const step of [deploy, smoke, rollback]) {
      expect(steps[step], order[step]).toMatch(/timeout-minutes: [0-9]+/);
    }
    expect(steps[rollback]).toContain('--image "$PREV_API_IMAGE"');
    expect(steps[rollback]).toContain('--image "$PREV_WEB_IMAGE"');
  });
});

describe('the build and promote identities (WU-23b)', () => {
  it('AC-HOST-13: a token maps to promote only in environment live, and to build only with no environment', () => {
    const identity = read('infra/deploy-identity.tf');
    expect(identity).toContain('"attribute.deployer"      = local.deployer_mapping');
    const mapping = /deployer_mapping\s*=\s*"(.*)"\n/.exec(identity)?.[1] ?? '';
    expect(mapping).toContain('(\\"environment\\" in assertion)');
    expect(mapping).toContain('assertion.environment == \\"live\\" ? \\"promote\\" : \\"none\\"');
    expect(mapping).toMatch(/: \\"build\\"$/);
  });

  it('AC-HOST-13: each identity is bound to its own deployer value', () => {
    const steady = steadyIdentity();
    expect(steady).toMatch(
      /service_account_id = google_service_account\.deploy\.name\s+role\s+= "roles\/iam\.workloadIdentityUser"\s+member\s+= "\$\{local\.pool_principal\}\/attribute\.deployer\/build"/,
    );
    expect(steady).toMatch(
      /service_account_id = google_service_account\.promote\.name\s+role\s+= "roles\/iam\.workloadIdentityUser"\s+member\s+= "\$\{local\.pool_principal\}\/attribute\.deployer\/promote"/,
    );
    expect(steady).not.toContain('attribute.repository_id/');
  });

  it('AC-HOST-13: outside the rollout, the build identity can neither deploy api nor act as its runtime account', () => {
    const steady = steadyIdentity();
    const buildGrants = steady
      .split(/\nresource /)
      .filter(
        (block) =>
          block.includes('member   = google_service_account.deploy.member') ||
          /member\s*=\s*google_service_account\.deploy\.member/.test(block),
      );
    const developer = buildGrants.filter((block) => block.includes('roles/run.developer'));
    expect(developer).toHaveLength(1);
    expect(developer[0]).toContain('google_cloud_run_v2_service.api_replay.name');
    const actAs = buildGrants.filter((block) => block.includes('roles/iam.serviceAccountUser'));
    expect(actAs).toHaveLength(1);
    expect(actAs[0]).toContain('google_service_account.replay_runtime.name');
  });

  it('AC-HOST-13: the rollout-only grants switch off with rollout_wu23b', () => {
    const identity = read('infra/deploy-identity.tf');
    const rollout = identity.slice(identity.indexOf('# Rollout only'));
    const resources = rollout.match(/\nresource "/g) ?? [];
    const counted = rollout.match(/count\s*=\s*var\.rollout_wu23b \? 1 : 0/g) ?? [];
    expect(resources.length).toBeGreaterThan(0);
    expect(counted).toHaveLength(resources.length);
  });
});
