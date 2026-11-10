// Record/replay at the HTTP boundary (CLAUDE.md §6.1, §8.2; ADR 0001 Q6; WU-08 plan D4/D5). The
// Anthropic provider takes this as its `fetch`, so our code and the SDK run for real and only the
// network is recorded or replayed.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * The only response headers written. Anthropic responses also carry account identifiers
 * (`anthropic-organization-id`, `anthropic-workspace-id`), so this is an allowlist, never a denylist.
 * Request headers are never written at all, which keeps `x-api-key` out by construction.
 */
export const CASSETTE_RESPONSE_HEADERS: readonly string[] = ['content-type', 'request-id'];

const RE_RECORD = 're-record with `LLM_MODE=record`';

// No `key` field: the file name is the key. A hash under a field named `key` also reads as an
// API key to gitleaks' generic-api-key rule.
const Cassette = z.object({
  request: z.object({ method: z.string(), url: z.string(), body: z.unknown() }),
  response: z.union([
    z.object({
      status: z.int(),
      headers: z.record(z.string(), z.string()),
      sse: z.array(z.string()),
    }),
    z.object({ status: z.int(), headers: z.record(z.string(), z.string()), body: z.unknown() }),
  ]),
});
export type Cassette = z.infer<typeof Cassette>;

/** A request with no cassette in replay mode. A test-setup failure, never an upstream error. */
export class CassetteMissError extends Error {
  readonly key: string;

  constructor(key: string, model: string | undefined, dir: string) {
    super(
      `No LLM cassette for request ${key}${model === undefined ? '' : ` (model ${model})`} in ` +
        `${dir}: ${RE_RECORD}.`,
    );
    this.name = 'CassetteMissError';
    this.key = key;
  }
}

/** The SHA-256 of the exact request body string. Headers (incl. the SDK user agent) never count. */
export function cassetteKey(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

export type CassetteFetchOptions =
  { mode: 'replay'; dir: string } | { mode: 'record'; dir: string; network: typeof fetch };

export interface CassetteFetch {
  fetch: typeof fetch;
  /** Resolves once every recording started so far is on disk. Replay has nothing to wait for. */
  flush: () => Promise<void>;
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function bodyOf(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') {
    throw new TypeError('cassette fetch needs a string request body to compute its key');
  }
  return init.body;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function modelOf(body: string): string | undefined {
  const parsed = parseJson(body);
  if (typeof parsed === 'object' && parsed !== null && 'model' in parsed) {
    return typeof parsed.model === 'string' ? parsed.model : undefined;
  }
  return undefined;
}

function isEventStream(headers: Headers): boolean {
  return headers.get('content-type')?.includes('text/event-stream') ?? false;
}

function allowlisted(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of CASSETTE_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

/** Splits an SSE body into events (without their blank-line terminators). */
export function splitSseEvents(text: string): string[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((event) => event.replace(/\r?\n$/, ''))
    .filter((event) => event.trim() !== '');
}

function cassetteFile(dir: string, key: string): string {
  return join(dir, `${key}.json`);
}

function replayResponse(cassette: Cassette): Response {
  const { status, headers } = cassette.response;
  if ('sse' in cassette.response) {
    const events = cassette.response.sse;
    const encoder = new TextEncoder();
    let next = 0;
    // One event per pull, so the consumer sees separate chunks as it did live (ADR 0001 Q6).
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const event = events[next++];
        if (event === undefined) controller.close();
        else controller.enqueue(encoder.encode(`${event}\n\n`));
      },
    });
    return new Response(stream, { status, headers });
  }
  const body = cassette.response.body;
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

async function loadCassette(dir: string, key: string, body: string): Promise<Cassette> {
  let text: string;
  try {
    text = await readFile(cassetteFile(dir, key), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CassetteMissError(key, modelOf(body), dir);
    }
    throw error;
  }
  const parsed = Cassette.safeParse(parseJson(text));
  if (!parsed.success) {
    throw new Error(`LLM cassette ${key} in ${dir} is malformed: ${RE_RECORD}.`);
  }
  return parsed.data;
}

export function createCassetteFetch(options: CassetteFetchOptions): CassetteFetch {
  const pending = new Set<Promise<void>>();

  if (options.mode === 'replay') {
    // No network handle exists in this branch, so a miss can never fall through to live (§6.1).
    const replay = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = bodyOf(init);
      return replayResponse(await loadCassette(options.dir, cassetteKey(body), body));
    };
    return { fetch: replay, flush: () => Promise.resolve() };
  }

  const { dir, network } = options;
  const record = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = bodyOf(init);
    const key = cassetteKey(body);
    const response = await network(input, init);
    if (!response.ok) {
      // A failed attempt must never become the committed cassette (WU-08 plan D5).
      console.warn(`[llm-cassette] not recording ${key}: upstream returned ${response.status}`);
      return response;
    }
    const stream = isEventStream(response.headers);
    const request = { method: init?.method ?? 'GET', url: urlOf(input), body: parseJson(body) };
    const status = response.status;
    const headers = allowlisted(response.headers);
    // Read the clone in the background: awaiting it here would buffer a stream end to end, so the
    // caller would get one chunk (ADR 0001 Q6). Each key holds one exchange; the last 2xx wins.
    const write = response
      .clone()
      .text()
      .then(async (text) => {
        const cassette: Cassette = {
          request,
          response: stream
            ? { status, headers, sse: splitSseEvents(text) }
            : { status, headers, body: parseJson(text) },
        };
        await mkdir(dir, { recursive: true });
        await writeFile(cassetteFile(dir, key), `${JSON.stringify(cassette, null, 2)}\n`);
      });
    const tracked = write.finally(() => pending.delete(tracked));
    pending.add(tracked);
    // `flush()` reports a failed write; this only stops it being an unhandled rejection meanwhile.
    tracked.catch(() => undefined);
    return response;
  };

  return {
    fetch: record,
    flush: async () => {
      await Promise.all([...pending]);
    },
  };
}
