// Decides what scripts/run-journeys.ts does, as pure functions so they can be unit-tested
// (WU-15 plan D1). The runner is the only part that knows the backend; the journeys only see URLs.

/**
 * Journey 4's first message (WU-15 plan D5). The runner swaps the response of every cassette whose
 * request contains it for a provider error. The same text is in
 * tests/journeys/specs/upstream-failure.spec.ts, which can't import this file (CLAUDE.md §6.6).
 */
export const UPSTREAM_FAILURE_MESSAGE =
  'A quiet cabin somewhere in the mountains for our anniversary.';

/** The web build's own output directory, so it never overwrites the functional suite's (plan D3). */
export const JOURNEY_DIST_DIR = '.next-journeys';

export type StackMode = 'replay' | 'record';

export interface StackPlan {
  mode: StackMode;
  /** Passed to Playwright unchanged, e.g. `--grep "@smoke|@critical"`. */
  playwrightArgs: string[];
}

/** Record mode only when `pnpm record:cassettes --journeys` started this run (its guard passed). */
export function planStack(argv: readonly string[], recording: boolean): StackPlan {
  return { mode: recording ? 'record' : 'replay', playwrightArgs: [...argv] };
}

/**
 * The API's environment on top of startApi's base (plan D2, D6; review fix 2, fix 3). In replay
 * the key is blanked here too, so no parent environment can make a journey run go live, and the
 * API reads the swapped copy of the cassettes. In record mode startApi's base env already carries
 * the key and the real cassette directory, and record mode needs LOCAL_DEV=true.
 */
export function apiEnv(options: {
  mode: StackMode;
  webOrigin: string;
  inviteServerEnv: Record<string, string>;
  cassetteDir: string | undefined;
}): Record<string, string> {
  const env: Record<string, string> = {
    ...options.inviteServerEnv,
    WEB_ORIGIN: options.webOrigin,
  };
  if (options.mode === 'record') {
    return { ...env, LLM_MODE: 'record', LOCAL_DEV: 'true' };
  }
  if (options.cassetteDir === undefined) {
    throw new Error('replay needs the copied cassette directory');
  }
  return {
    ...env,
    LLM_MODE: 'replay',
    LOCAL_DEV: 'false',
    ANTHROPIC_API_KEY: '',
    LLM_CASSETTE_DIR: options.cassetteDir,
  };
}

/** The web build and server's environment: Next inlines the API URL at build time (plan D2). */
export function webEnv(apiBaseUrl: string): Record<string, string> {
  return {
    NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
    NEXT_DIST_DIR: JOURNEY_DIST_DIR,
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

/** What the journeys see: URLs and the invite code, nothing else (CLAUDE.md §6.6; plan D7). */
export function playwrightEnv(options: {
  mode: StackMode;
  webBaseUrl: string;
  inviteCode: string;
}): Record<string, string> {
  return {
    WEB_BASE_URL: options.webBaseUrl,
    JOURNEY_INVITE_CODE: options.inviteCode,
    JOURNEYS_RECORDING: options.mode === 'record' ? '1' : '0',
  };
}

export interface CassetteFile {
  name: string;
  text: string;
}

/** The provider error journey 4 gets, twice (the LlmClient retries once with the same key). */
export const UPSTREAM_ERROR_RESPONSE = {
  status: 500,
  headers: { 'content-type': 'application/json' },
  body: { type: 'error', error: { type: 'api_error', message: 'Internal server error' } },
} as const;

/**
 * The cassettes to rewrite in the replay copy (plan D5): every one whose request body contains
 * `message`, with its response swapped for UPSTREAM_ERROR_RESPONSE. The request, and so the key,
 * is unchanged. Throws when none matches: journey 4 was never recorded, or its message drifted.
 */
export function failureCassettes(
  files: readonly CassetteFile[],
  message: string = UPSTREAM_FAILURE_MESSAGE,
): CassetteFile[] {
  const swapped: CassetteFile[] = [];
  for (const file of files) {
    const cassette = JSON.parse(file.text) as { request?: { body?: unknown }; response?: unknown };
    if (!JSON.stringify(cassette.request?.body ?? null).includes(message)) continue;
    swapped.push({
      name: file.name,
      text: JSON.stringify({ ...cassette, response: UPSTREAM_ERROR_RESPONSE }),
    });
  }
  if (swapped.length === 0) {
    throw new Error(
      `No cassette contains journey 4's message (${JSON.stringify(message)}). Record it with ` +
        '`pnpm record:cassettes --journeys upstream-failure`, or check the message matches ' +
        'tests/journeys/specs/upstream-failure.spec.ts.',
    );
  }
  return swapped;
}
