// Decides what scripts/run-contract.ts does, as a pure function so it can be unit-tested (plan D8).
// The project gate must always test this branch's api-nextjs, so an exported API_BASE_URL is used
// only when asked for with --external: it might point at another backend or a live dev server.

export type RunPlan =
  | { startServer: true; vitestArgs: string[]; notices: string[] }
  | { startServer: false; baseUrl: string; vitestArgs: string[]; notices: string[] };

export class RunPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunPlanError';
  }
}

export function planRun(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): RunPlan {
  const external = argv.includes('--external');
  const vitestArgs = argv.filter((arg) => arg !== '--external');
  const apiBaseUrl = env.API_BASE_URL?.trim() || undefined;

  if (external) {
    if (!apiBaseUrl) {
      throw new RunPlanError('--external needs API_BASE_URL, the backend to test.');
    }
    let url: URL;
    try {
      url = new URL(apiBaseUrl);
    } catch {
      throw new RunPlanError(`API_BASE_URL is not a URL: ${apiBaseUrl}`);
    }
    const baseUrl = url.href.replace(/\/+$/, '');
    return {
      startServer: false,
      baseUrl,
      vitestArgs,
      notices: [`Testing the backend at ${baseUrl} (--external; not started by this run).`],
    };
  }

  const notices = ['Building and starting api-nextjs on a free port for this run.'];
  if (apiBaseUrl) {
    notices.push(`Ignoring API_BASE_URL=${apiBaseUrl}; use pnpm test:contract:external for it.`);
  }
  return { startServer: true, vitestArgs, notices };
}
