// Builds the LlmClient for the configured LLM_MODE (CLAUDE.md §6.1, §8.2; WU-08 plan D6, D7).
import { createAnthropic } from '@ai-sdk/anthropic';
import type { Config } from '../config.ts';
import type { LlmClient, LlmStage } from '../usecases/llm-client.ts';
import { consoleLlmLog, createAiSdkLlmClient, type LlmCallLog } from './ai-sdk-client.ts';
import { resolveCassetteDir, type Workspace } from './cassette-dir.ts';
import { createCassetteFetch } from './cassette-fetch.ts';
import { createMockLlmClient, type MockResponder } from './mock.ts';

export {
  createMockLlmClient,
  mockObject,
  mockRaw,
  mockRefusal,
  MockNotConfiguredError,
  type MockReply,
  type MockResponder,
} from './mock.ts';
export { CassetteMissError } from './cassette-fetch.ts';
export type { LlmCallLog } from './ai-sdk-client.ts';

export interface LlmRuntime {
  client: LlmClient;
  /** Resolves once every recording is on disk. A no-op outside `record` mode. */
  flush: () => Promise<void>;
}

export interface LlmRuntimeDeps {
  mockResponders?: Partial<Record<LlmStage, MockResponder>>;
  /** The real network. Replay never receives it. Defaults to the global `fetch`, read lazily. */
  network?: typeof fetch;
  log?: (entry: LlmCallLog) => void;
  now?: () => number;
  /** Where to look for the workspace root when LLM_CASSETTE_DIR is unset; defaults to the process. */
  workspace?: Workspace;
}

const noFlush = (): Promise<void> => Promise.resolve();

export function createLlmClient(config: Config, deps: LlmRuntimeDeps = {}): LlmRuntime {
  const log = deps.log ?? consoleLlmLog;
  const now = deps.now ?? (() => performance.now());
  const network: typeof fetch = deps.network ?? ((input, init) => globalThis.fetch(input, init));

  if (config.llmMode === 'mock') {
    if (deps.mockResponders === undefined) {
      throw new Error('LLM_MODE=mock needs mockResponders');
    }
    return { client: createMockLlmClient(deps.mockResponders, { log, now }), flush: noFlush };
  }

  let fetchFn: typeof fetch = network;
  let apiKey = config.anthropicApiKey;
  let flush = noFlush;

  if (config.llmMode === 'record' || config.llmMode === 'replay') {
    const dir = resolveCassetteDir(config.cassetteDir, deps.workspace);
    if (config.llmMode === 'record') {
      ({ fetch: fetchFn, flush } = createCassetteFetch({
        mode: 'record',
        dir,
        network,
      }));
    } else {
      ({ fetch: fetchFn, flush } = createCassetteFetch({
        mode: 'replay',
        dir,
      }));
      apiKey = 'replay-no-network';
    }
  }

  const anthropic = createAnthropic({ apiKey, fetch: fetchFn });
  const client = createAiSdkLlmClient({
    modelFor: (role) => anthropic(config.models[role]),
    log,
    now,
  });
  return { client, flush };
}
