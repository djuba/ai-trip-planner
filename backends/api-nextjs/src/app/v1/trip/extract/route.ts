import { createExtractPost } from '../../../../http/extract.ts';
import { preflight } from '../../../../http/route.ts';
import { getLlmRuntime } from '../../../../llm/runtime.ts';

export const dynamic = 'force-dynamic';

export const POST = createExtractPost({ llm: getLlmRuntime });

export const OPTIONS = preflight;
