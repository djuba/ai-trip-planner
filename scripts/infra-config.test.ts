// Pins the hosted service's configuration (infra/service.tf) to what the post-deploy contract check
// needs (WU-21). Cassette keys hash the model request, model ID included, so the service must use
// the contract runner's model IDs, or every replay misses. Text checks only: `pnpm verify` needs no
// Terraform, and the CI `infra` job validates the HCL itself.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

  it('AC-HOST-02: the replay twin, not api, runs with the contract runner’s mode and model IDs', () => {
    expect(terraformEnv(read('infra/replay.tf'))).toMatchObject({
      LLM_MODE: CONTRACT_TEST_ENV.LLM_MODE,
      MODEL_FAST: CONTRACT_TEST_ENV.MODEL_FAST,
      MODEL_REASONING: CONTRACT_TEST_ENV.MODEL_REASONING,
      MODEL_CRITIC: CONTRACT_TEST_ENV.MODEL_CRITIC,
    });
    expect(env.LLM_MODE).toBe('live');
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

  it('AC-GATE-29: the runtime account’s roles are Firestore, limited to the default database, and the one key secret', () => {
    const terraform = allTerraform();
    // Grants *to* the runtime account name it as the member.
    const grants = terraform.match(/member\s*=\s*google_service_account\.runtime\.member/g) ?? [];
    expect(grants).toHaveLength(2);
    expect(read('infra/secrets.tf')).toMatch(
      /member\s*=\s*google_service_account\.runtime\.member/,
    );
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
  readdirSync(new URL('infra/', root))
    .filter((name) => name.endsWith('.tf'))
    .sort()
    .map((name) => read(`infra/${name}`))
    .join('\n');

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

  it('AC-HOST-11: pins the contract runner’s model IDs and shares api’s web origin, so its cassettes and CORS match', () => {
    for (const name of ['MODEL_FAST', 'MODEL_REASONING', 'MODEL_CRITIC'] as const) {
      expect(twin[name], name).toBe(CONTRACT_TEST_ENV[name]);
    }
    expect(twin.WEB_ORIGIN).toBe(api.WEB_ORIGIN);
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
    const identity = read('infra/deploy-identity.tf');
    expect(identity).toMatch(
      /service_account_id = google_service_account\.deploy\.name\s+role\s+= "roles\/iam\.workloadIdentityUser"\s+member\s+= "\$\{local\.pool_principal\}\/attribute\.deployer\/build"/,
    );
    expect(identity).toMatch(
      /service_account_id = google_service_account\.promote\.name\s+role\s+= "roles\/iam\.workloadIdentityUser"\s+member\s+= "\$\{local\.pool_principal\}\/attribute\.deployer\/promote"/,
    );
    expect(identity).not.toContain('attribute.repository_id/');
  });

  it('AC-HOST-13: the build identity can neither deploy api nor act as its runtime account', () => {
    const identity = read('infra/deploy-identity.tf');
    const buildGrants = identity
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

  it('AC-HOST-13: the promote identity may read both repositories, and push to neither', () => {
    const promoteGrants = read('infra/deploy-identity.tf')
      .split(/\nresource /)
      .filter((block) => /member\s*=\s*google_service_account\.promote\.member/.test(block));
    const registry = promoteGrants.filter((block) => block.includes('artifactregistry'));
    expect(registry).toHaveLength(2);
    for (const block of registry) expect(block).toContain('roles/artifactregistry.reader');
    expect(promoteGrants.join('\n')).not.toContain('artifactregistry.writer');
  });
});

describe('live mode in the hosted environment (WU-23c)', () => {
  const service = read('infra/service.tf');
  const env = terraformEnv(service);
  const secrets = read('infra/secrets.tf');

  it('AC-LIVE-01: api runs live with the CLAUDE.md §8.1 model IDs', () => {
    expect(env).toMatchObject({
      LLM_MODE: 'live',
      MODEL_FAST: 'claude-haiku-5-5',
      MODEL_REASONING: 'claude-sonnet-5-5',
      MODEL_CRITIC: 'claude-sonnet-5-5',
    });
  });

  it('AC-LIVE-02: the API key comes only from the Terraform secret, at a pinned version Terraform never holds', () => {
    expect(service).toMatch(
      /name = "ANTHROPIC_API_KEY"\s*value_source \{\s*secret_key_ref \{\s*secret\s*= google_secret_manager_secret\.anthropic_api_key\.secret_id\s*version = var\.anthropic_api_key_version\s*\}/,
    );
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    const terraform = allTerraform();
    expect(terraform).not.toMatch(/google_secret_manager_secret_version|secret_data/);
    expect(terraform.match(/"ANTHROPIC_API_KEY"/g)).toHaveLength(1);
    expect(read('infra/variables.tf')).toMatch(
      /variable "anthropic_api_key_version" \{(?![^}]*default)[^]*?regex\("\^\[1-9\]\[0-9\]\*\$"/,
    );
  });

  it('AC-LIVE-03: only api’s runtime account may read the secret, and no project-wide Secret Manager role exists', () => {
    const roles = [
      ...allTerraform().matchAll(/role\s*=\s*"(roles\/secretmanager\.[A-Za-z]+)"/g),
    ].map(([, role]) => role);
    expect(roles).toEqual(['roles/secretmanager.secretAccessor']);
    expect(secrets).toMatch(
      /resource "google_secret_manager_secret_iam_member" "runtime_api_key" \{\s*secret_id = google_secret_manager_secret\.anthropic_api_key\.id\s*role\s*= "roles\/secretmanager\.secretAccessor"\s*member\s*= google_service_account\.runtime\.member\s*\}/,
    );
    expect(allTerraform()).not.toMatch(/google_project_iam_member"[^{]*\{[^}]*secretmanager/);
  });

  // Upper bounds from the cost arithmetic in ADR 0005's WU-23c addendum. Raising a limit past its
  // bound means redoing that arithmetic, then changing the bound here.
  const LIMIT_BOUNDS = {
    QUOTA_EXTRACT: 40,
    QUOTA_RECOMMEND: 5,
    QUOTA_PRESENT: 5,
    RATE_LIMIT_PER_HOUR: 30,
    RATE_LIMIT_GLOBAL_PER_DAY: 60,
  } as const;

  it('AC-LIVE-05: every limit on api is a positive integer within its cost-sized bound', () => {
    for (const [name, bound] of Object.entries(LIMIT_BOUNDS)) {
      const value = env[name] ?? '';
      expect(value, name).toMatch(/^[1-9][0-9]*$/);
      expect(Number(value), name).toBeLessThanOrEqual(bound);
    }
  });

  it('AC-LIVE-04: neither the replay twin nor web can see the key', () => {
    for (const file of ['infra/replay.tf', 'infra/web.tf']) {
      const hcl = read(file);
      expect(hcl, file).not.toMatch(/ANTHROPIC_API_KEY|value_source|secret_key_ref/);
    }
    expect(terraformEnv(read('infra/replay.tf')).LLM_MODE).toBe('replay');
  });
});
