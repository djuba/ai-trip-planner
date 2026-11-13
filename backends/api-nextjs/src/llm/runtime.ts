// The process-wide LlmRuntime the route handlers use (WU-09 plan D6). Built on first use, never at
// import, so `next build` doesn't read the environment.
import { getConfig } from '../config.ts';
import { createLlmClient, type LlmRuntime } from './index.ts';

let runtime: LlmRuntime | undefined;

export function getLlmRuntime(): LlmRuntime {
  runtime ??= createLlmClient(getConfig());
  return runtime;
}
