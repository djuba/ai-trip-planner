// Release smoke check (WU-23b plan D6): after a promotion, confirms the hosted API and web service
// are up and wired together. Reads API_BASE_URL, WEB_BASE_URL and WEB_ORIGIN from the environment.
// It never calls the model (so it stays valid in live mode, WU-23c) and never sends a credential.
// It must stay dependency-free: the promote job runs it without `pnpm install`, so only Node
// built-ins and relative imports are allowed here and in scripts/release/smoke-checks.ts.
import { runSmoke } from './release/smoke-checks.ts';

const names = ['API_BASE_URL', 'WEB_BASE_URL', 'WEB_ORIGIN'] as const;
const values: Record<string, string> = {};
for (const name of names) {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') {
    console.error(`release-smoke: ${name} is not set`);
    process.exit(2);
  }
  values[name] = value.replace(/\/+$/, '');
}

const results = await runSmoke(
  {
    apiBaseUrl: values['API_BASE_URL'] ?? '',
    webBaseUrl: values['WEB_BASE_URL'] ?? '',
    webOrigin: values['WEB_ORIGIN'] ?? '',
  },
  fetch,
);
for (const result of results) {
  console.log(result.ok ? `ok  ${result.name}` : `FAIL ${result.name}: ${result.detail}`);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
