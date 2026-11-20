// `pnpm invite:usage`: what each invite code has used on the hosted API, against its limits. Reads
// the entries in infra/terraform.tfvars (git-ignored), the service-wide limits in infra/service.tf,
// and the gate's counters in Firestore with your own gcloud login. It writes nothing. Its output
// names labels, which say whom you've given demos to: keep it out of anything public.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { ConfigError } from '../backends/api-nextjs/src/config.ts';
import {
  UsageReportError,
  formatUsageReport,
  hostedAccessConfig,
  listUsage,
  tfvarsString,
  usageReport,
} from './invite/usage-report.ts';

const infra = (file: string) => new URL(`../infra/${file}`, import.meta.url);

function accessToken(): string {
  const result = spawnSync('gcloud', ['auth', 'print-access-token'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const token = result.stdout?.trim();
  if (result.status !== 0 || !token) {
    throw new UsageReportError('gcloud could not print an access token: run `gcloud auth login`');
  }
  return token;
}

try {
  if (process.argv.length > 2)
    throw new UsageReportError('usage: pnpm invite:usage (no arguments)');
  if (!existsSync(infra('terraform.tfvars'))) {
    throw new UsageReportError('needs infra/terraform.tfvars (see infra/README.md)');
  }
  const tfvars = readFileSync(infra('terraform.tfvars'), 'utf8');
  const projectId = tfvarsString(tfvars, 'project_id');
  if (projectId === undefined)
    throw new UsageReportError('infra/terraform.tfvars sets no project_id');
  const config = hostedAccessConfig(tfvars, readFileSync(infra('service.tf'), 'utf8'));
  const documents = await listUsage(fetch, projectId, accessToken());
  console.log(formatUsageReport(usageReport(config, documents, Date.now())));
} catch (error) {
  if (!(error instanceof UsageReportError || error instanceof ConfigError)) throw error;
  console.error(`invite:usage: ${error.message}`);
  process.exitCode = 1;
}
