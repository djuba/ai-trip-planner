// Keeps gated test runs from reaching a live LLM (CLAUDE.md §6.1; WU-08 plan D10). Vitest's config
// forces LLM_MODE=replay unless recording is allowed, and a setup file blocks non-loopback fetches.

/**
 * Recording needs both variables, and `pnpm record:cassettes` is the only thing that sets the second
 * one, so a leftover `LLM_MODE=record` or `VP_LLM_RECORD=1` in a shell can't make a gate go live.
 */
export function recordingAllowed(env: Record<string, string | undefined>): boolean {
  return env.VP_LLM_RECORD === '1' && env.npm_lifecycle_event === 'record:cassettes';
}

export const NETWORK_BLOCKED_MESSAGE = 'network access is blocked in tests (CLAUDE.md §6.1)';

function hostOf(input: string | URL | Request): string | undefined {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(href).hostname;
  } catch {
    return undefined; // A relative URL can't leave the machine; let fetch reject it as usual.
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

/** Wraps `fetch` so any non-loopback URL rejects. Returns a function that restores the original. */
export function installNetworkGuard(target: { fetch: typeof fetch } = globalThis): () => void {
  const original = target.fetch;
  const guarded = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const host = hostOf(input);
    if (host !== undefined && !isLoopbackHost(host)) {
      return Promise.reject(new Error(`${NETWORK_BLOCKED_MESSAGE}: ${host}`));
    }
    return original(input, init);
  };
  target.fetch = guarded;
  return () => {
    target.fetch = original;
  };
}
