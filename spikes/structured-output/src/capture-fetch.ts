// NON-PRODUCTION SPIKE (WU-03). See ../README.md.
//
// Two fetch implementations for the Anthropic provider:
// - captureFetch: passes through to the real network, records request + response with auth
//   headers stripped (the shape WU-08's recorder will need).
// - syntheticFetch: never touches the network; records the request and returns a canned
//   Anthropic Messages response. Used for free, deterministic probes (Q2 request shape, Q5, Q6).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CAPTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'captures');

const SECRET_HEADERS = new Set(['x-api-key', 'authorization', 'anthropic-api-key', 'cookie']);
// Finding (WU-08): Anthropic response headers carry account identifiers
// (anthropic-organization-id, anthropic-workspace-id) plus rate-limit and CDN noise.
// Allowlist response headers instead of denylisting.
export const RESPONSE_HEADER_ALLOWLIST = new Set(['content-type', 'request-id']);

function allowlistHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    if (RESPONSE_HEADER_ALLOWLIST.has(key.toLowerCase())) out[key] = value;
  });
  return out;
}

export type Capture = {
  label: string;
  request: { url: string; method: string; headers: Record<string, string>; body: unknown };
  response?: { status: number; headers: Record<string, string>; body: unknown };
};

function cleanHeaders(h: HeadersInit | Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h).forEach((value, key) => {
    out[key] = SECRET_HEADERS.has(key.toLowerCase()) ? '[stripped]' : value;
  });
  return out;
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

export function saveCapture(capture: Capture): void {
  mkdirSync(CAPTURE_DIR, { recursive: true });
  writeFileSync(join(CAPTURE_DIR, `${capture.label}.json`), JSON.stringify(capture, null, 2) + '\n');
}

/** Real network; records the exchange. `calls` collects every capture for inspection. */
export function captureFetch(label: string, calls: Capture[] = []) {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const capture: Capture = {
      label: calls.length === 0 ? label : `${label}-${calls.length}`,
      request: {
        url: urlOf(input),
        method: init?.method ?? 'GET',
        headers: cleanHeaders(init?.headers),
        body: typeof init?.body === 'string' ? parseMaybeJson(init.body) : '[non-string body]',
      },
    };
    calls.push(capture);
    const res = await fetch(input, init);
    const isStream = res.headers.get('content-type')?.includes('event-stream') ?? false;
    const record = (text: string) => {
      capture.response = {
        status: res.status,
        headers: allowlistHeaders(res.headers),
        body: isStream ? text : parseMaybeJson(text),
      };
      saveCapture(capture);
    };
    // Finding (WU-08): awaiting the clone's body before returning buffers an SSE stream end to
    // end, so the caller sees one chunk. Record streams in the background instead.
    if (isStream) void res.clone().text().then(record);
    else record(await res.clone().text());
    return res;
  };
  return { fetch: fn as typeof fetch, calls };
}

/** Offline; returns `body` as an Anthropic Messages JSON response. */
export function syntheticFetch(label: string, body: unknown, status = 200) {
  const calls: Capture[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const capture: Capture = {
      label,
      request: {
        url: urlOf(input),
        method: init?.method ?? 'GET',
        headers: cleanHeaders(init?.headers),
        body: typeof init?.body === 'string' ? parseMaybeJson(init.body) : '[non-string body]',
      },
      response: { status, headers: { 'content-type': 'application/json' }, body },
    };
    calls.push(capture);
    saveCapture(capture);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'request-id': 'req_synthetic' },
    });
  };
  return { fetch: fn as typeof fetch, calls };
}

/** Builds a minimal Anthropic Messages API response. */
export function anthropicMessage(opts: {
  model: string;
  text?: string;
  stopReason: 'end_turn' | 'max_tokens' | 'refusal' | 'tool_use';
  stopDetails?: unknown;
}) {
  return {
    id: 'msg_synthetic',
    type: 'message',
    role: 'assistant',
    model: opts.model,
    content: opts.text == null ? [] : [{ type: 'text', text: opts.text }],
    stop_reason: opts.stopReason,
    stop_sequence: null,
    ...(opts.stopDetails !== undefined && { stop_details: opts.stopDetails }),
    usage: { input_tokens: 10, output_tokens: opts.text == null ? 0 : 20 },
  };
}

export function printFindings(title: string, findings: unknown): void {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(findings, null, 2));
}
