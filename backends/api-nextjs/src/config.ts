export interface Config {
  llmMode: 'live' | 'record' | 'replay' | 'mock';
  models: { fast: string; reasoning: string; critic: string };
  webOrigin: string;
  anthropicApiKey?: string;
}

/** Names the bad variables only. Values are never included: they may hold the API key. */
export class ConfigError extends Error {
  readonly variables: readonly string[];

  constructor(problems: ReadonlyArray<{ variable: string; reason: string }>) {
    super(
      `Invalid environment configuration: ${problems
        .map((p) => `${p.variable} (${p.reason})`)
        .join(', ')}`,
    );
    this.name = 'ConfigError';
    this.variables = problems.map((p) => p.variable);
  }
}

const LLM_MODES = ['live', 'record', 'replay', 'mock'] as const;
const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

type Env = Record<string, string | undefined>;

/** A blank or whitespace-only value counts as unset. */
function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function isBareOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

export function loadConfig(env: Env): Config {
  const problems: Array<{ variable: string; reason: string }> = [];
  const fail = (variable: string, reason: string): void => {
    problems.push({ variable, reason });
  };

  const modeRaw = read(env, 'LLM_MODE');
  let llmMode: Config['llmMode'] = 'mock';
  if (modeRaw === undefined) {
    fail('LLM_MODE', 'required');
  } else if ((LLM_MODES as readonly string[]).includes(modeRaw)) {
    llmMode = modeRaw as Config['llmMode'];
  } else {
    fail('LLM_MODE', `must be one of ${LLM_MODES.join(', ')}`);
  }

  const model = (name: string): string => {
    const value = read(env, name);
    if (value === undefined) {
      fail(name, 'required');
      return '';
    }
    return value;
  };
  const models = {
    fast: model('MODEL_FAST'),
    reasoning: model('MODEL_REASONING'),
    critic: model('MODEL_CRITIC'),
  };

  const originRaw = read(env, 'WEB_ORIGIN');
  let webOrigin = DEFAULT_WEB_ORIGIN;
  if (originRaw !== undefined) {
    if (isBareOrigin(originRaw)) {
      webOrigin = originRaw;
    } else {
      fail('WEB_ORIGIN', 'must be a bare origin: scheme, host and optional port only');
    }
  }

  const anthropicApiKey = read(env, 'ANTHROPIC_API_KEY');
  if (anthropicApiKey === undefined && (llmMode === 'live' || llmMode === 'record')) {
    fail('ANTHROPIC_API_KEY', 'required when LLM_MODE is live or record');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    llmMode,
    models,
    webOrigin,
    ...(anthropicApiKey !== undefined ? { anthropicApiKey } : {}),
  };
}

let cached: Config | undefined;

/** Memoizes `loadConfig(process.env)`. Read lazily, never at import. */
export function getConfig(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}
