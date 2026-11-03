// NON-PRODUCTION SPIKE (WU-03). See ../README.md.
//
// Q7: does the real `useObject` hook consume a plain `text/plain` partial-JSON stream?
// Two producers, both real HTTP servers on 127.0.0.1:
//   A) "polyglot": hand-chunked JSON text with no SDK involvement (what FastAPI/Go would send).
//   B) "sdk": streamText + Output.object -> toTextStream -> createTextStreamResponse (live call,
//      skipped when ANTHROPIC_API_KEY is absent). Captured with captureFetch.
// The hook runs under jsdom via @testing-library/react's renderHook.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createTextStreamResponse, Output, streamText, toTextStream } from 'ai';
import { JSDOM } from 'jsdom';
import { z } from 'zod';
import { captureFetch, printFindings } from './capture-fetch.ts';

// --- jsdom globals (before React / testing-library load) --------------------------------------
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const g = globalThis as Record<string, unknown>;
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'MutationObserver', 'getComputedStyle']) {
  const value = key === 'window' ? dom.window : (dom.window as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
g.IS_REACT_ACT_ENVIRONMENT = true;
const { renderHook, waitFor } = await import('@testing-library/react');
// v7 exports a stable `useObject`; `experimental_useObject` is a deprecated alias.
const { useObject } = await import('@ai-sdk/react');

// --- schema: a stand-in for PresentationModel -------------------------------------------------
const Presentation = z.object({
  headline: z.string(),
  cards: z.array(
    z.object({
      destination: z.string(),
      blurb: z.string(),
      verification: z.enum(['unverified', 'fixture']),
    }),
  ),
});
const FINAL = {
  headline: 'Three warm escapes from MSP',
  cards: [
    { destination: 'Cancún', blurb: 'Beaches and snorkeling.', verification: 'unverified' },
    { destination: 'Orlando', blurb: 'Theme parks galore.', verification: 'fixture' },
  ],
};

// --- servers ------------------------------------------------------------------------------------
function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
}

const polyglotServer = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, corsHeaders()).end();
  for await (const _ of req); // drain body
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders() });
  const text = JSON.stringify(FINAL);
  for (let i = 0; i < text.length; i += 7) {
    res.write(text.slice(i, i + 7)); // deliberately splits tokens, strings and the multibyte "ú"
    await new Promise((r) => setTimeout(r, 5));
  }
  res.end();
});

const live = Boolean(process.env.ANTHROPIC_API_KEY);
const sdkCapture = captureFetch('q7-sdk-stream-haiku');
let sdkResponseHeaders: Record<string, string> = {};
const sdkServer = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, corsHeaders()).end();
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const anthropic = createAnthropic({ fetch: sdkCapture.fetch });
  const result = streamText({
    model: anthropic('claude-haiku-5-5'),
    output: Output.object({ schema: Presentation }),
    providerOptions: { anthropic: { effort: 'low' } },
    maxOutputTokens: 800,
    prompt:
      `Write a vacation presentation for: ${raw}. Exactly 2 cards. ` +
      `Use verification "unverified" for every card. Keep blurbs under 15 words.`,
  });
  const response = createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) });
  sdkResponseHeaders = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, { ...sdkResponseHeaders, ...corsHeaders() });
  Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(res);
});

async function runHook(api: string, label: string) {
  const renders: unknown[] = [];
  let finished: { object?: unknown; error?: string } | undefined;
  const { result, unmount } = renderHook(() => {
    const r = useObject({
      api,
      schema: Presentation,
      onFinish: ({ object, error }) => {
        finished = { object, error: error?.message };
      },
    });
    renders.push(r.object === undefined ? undefined : structuredClone(r.object));
    return r;
  });
  const { act } = await import('@testing-library/react');
  await act(async () => result.current.submit({ request: 'warm beach trip from MSP, family of 4' }));
  await waitFor(() => expect(finished !== undefined), { timeout: 60_000, interval: 20 });
  const distinct = renders.filter((v, i) => JSON.stringify(v) !== JSON.stringify(renders[i - 1]));
  unmount();
  return {
    producer: label,
    distinctPartialStates: distinct.length,
    firstPartials: distinct.slice(0, 4),
    final: finished,
    finalMatchesSchema: Presentation.safeParse(finished?.object).success,
    hookError: result.current.error?.message,
  };
}

function expect(condition: boolean) {
  if (!condition) throw new Error('not yet');
}

const findings: unknown[] = [];
const polyglotUrl = await listen(polyglotServer);
findings.push(await runHook(`${polyglotUrl}/present`, 'polyglot hand-chunked text/plain'));
polyglotServer.close();

if (live) {
  const sdkUrl = await listen(sdkServer);
  const r = await runHook(`${sdkUrl}/present`, 'ai-sdk streamText -> createTextStreamResponse');
  findings.push({ ...r, sdkResponseHeaders, upstreamCalls: sdkCapture.calls.length });
  sdkServer.close();
} else {
  findings.push({ producer: 'ai-sdk', skipped: 'ANTHROPIC_API_KEY not set' });
}

printFindings('Q7 useObject over text/plain', findings);
dom.window.close();
