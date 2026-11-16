// @vitest-environment jsdom
// `usePresentation` over the real typed client and `useObject`, against msw (CLAUDE.md §6.3 web
// integration: partial-JSON stream consumption). This pins the `useObject` 4.0.158 behaviour the
// hook relies on (WU-14 plan D2, R2): partial objects per chunk, the final schema check, a non-2xx
// before the stream, and a stream that breaks partway.
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PresentationModel } from '@vp/domain-schema/wire';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiClient, type ApiError } from '../../src/lib/api/index.ts';
import { usePresentation } from '../../src/lib/presentation/use-presentation.ts';
import { errorBody, presentRequest, tripPresentation } from '../support/fixtures.ts';

const BASE = 'http://127.0.0.1:4999';
const PRESENT = `${BASE}/v1/trip/present`;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const encoder = new TextEncoder();

/** A 200 text stream of `chunks`; `breakAfter` errors the stream after that many chunks. */
function streamOf(chunks: string[], breakAfter?: number) {
  return () =>
    new HttpResponse(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const [index, chunk] of chunks.entries()) {
            if (index === breakAfter) {
              controller.error(new Error('connection reset'));
              return;
            }
            controller.enqueue(encoder.encode(chunk));
            await delay(10);
          }
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
}

function split(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function setup(code: string | null = 'invite-1', fetch?: typeof globalThis.fetch) {
  const client = createApiClient({
    baseUrl: BASE,
    getInviteCode: () => code ?? undefined,
    ...(fetch === undefined ? {} : { fetch }),
  });
  const finished: PresentationModel[] = [];
  const failed: { error: ApiError; hadInviteCode: boolean }[] = [];
  const partials: unknown[] = [];
  const onFinished = (model: PresentationModel) => void finished.push(model);
  const onFailed = (error: ApiError, hadInviteCode: boolean) =>
    void failed.push({ error, hadInviteCode });
  const hasInviteCode = () => code !== null;
  const hook = renderHook(() => {
    const p = usePresentation({ client, hasInviteCode, onFinished, onFailed });
    partials.push(p.partial);
    return p;
  });
  return { hook, finished, failed, partials };
}

describe('usePresentation over HTTP', () => {
  it('AC-CARDS-03 AC-CARDS-05: partial objects arrive per chunk, then the validated model', async () => {
    const model = tripPresentation();
    const seen = vi.fn();
    server.use(
      http.post(PRESENT, async ({ request }) => {
        seen(request.headers.get('authorization'), await request.clone().json());
        return streamOf(split(JSON.stringify(model), 25))();
      }),
    );
    const { hook, finished, failed, partials } = setup();
    act(() => hook.result.current.submit(presentRequest()));
    await waitFor(() => expect(finished).toHaveLength(1), { timeout: 5000 });
    expect(finished[0]).toEqual(model);
    expect(failed).toEqual([]);
    expect(seen).toHaveBeenCalledWith('Bearer invite-1', presentRequest());
    const distinct = new Set(partials.filter((p) => p !== undefined).map((p) => JSON.stringify(p)));
    expect(distinct.size).toBeGreaterThan(2);
  });

  it('AC-CARDS-05: a finished stream that fails the schema is a contract error', async () => {
    server.use(http.post(PRESENT, streamOf(['{"headline":"x",', '"intro":"y"}'])));
    const { hook, finished, failed } = setup();
    act(() => hook.result.current.submit(presentRequest()));
    await waitFor(() => expect(failed).toHaveLength(1));
    expect(failed[0]?.error.kind).toBe('contract');
    expect(finished).toEqual([]);
  });

  it('AC-CARDS-06: a stream that breaks partway is interrupted, never finished', async () => {
    // msw's interceptor ends an errored response stream cleanly, unlike a real connection, so
    // this case hands the real client a `fetch` whose body errors (WU-14 deviation 2). The
    // browser case, a destroyed socket, is in tests/functional/presentation.spec.ts.
    const text = JSON.stringify(tripPresentation());
    const breaking: typeof globalThis.fetch = () => Promise.resolve(streamOf(split(text, 25), 3)());
    const { hook, finished, failed } = setup('invite-1', breaking);
    act(() => hook.result.current.submit(presentRequest()));
    await waitFor(() => expect(failed).toHaveLength(1));
    expect(failed[0]).toEqual({ error: { kind: 'interrupted' }, hadInviteCode: true });
    expect(finished).toEqual([]);
  });

  it('AC-CARDS-07: error statuses before the stream map to the client errors', async () => {
    const cases: [() => Response, ApiError][] = [
      [
        () => HttpResponse.json(errorBody('UNAUTHORIZED', 'no'), { status: 401 }),
        { kind: 'unauthorized' },
      ],
      [
        () => HttpResponse.json(errorBody('QUOTA_EXHAUSTED', 'spent'), { status: 429 }),
        { kind: 'quota_exhausted' },
      ],
      [
        () => HttpResponse.json(errorBody('LLM_REFUSAL', 'no'), { status: 502 }),
        { kind: 'upstream', refusal: true },
      ],
    ];
    for (const [answer, expected] of cases) {
      server.use(http.post(PRESENT, answer));
      const { hook, failed, finished } = setup(null);
      act(() => hook.result.current.submit(presentRequest()));
      await waitFor(() => expect(failed).toHaveLength(1));
      expect(failed[0]).toEqual({ error: expected, hadInviteCode: false });
      expect(finished).toEqual([]);
      hook.unmount();
    }
  });

  it('AC-CARDS-10: clear() aborts the stream: no callback, and the partial object is gone', async () => {
    const text = JSON.stringify(tripPresentation());
    server.use(
      http.post(
        PRESENT,
        () =>
          new HttpResponse(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode(text.slice(0, 60)));
              }, // never closes
            }),
            { headers: { 'content-type': 'text/plain; charset=utf-8' } },
          ),
      ),
    );
    const { hook, finished, failed } = setup();
    act(() => hook.result.current.submit(presentRequest()));
    await waitFor(() => expect(hook.result.current.partial).toBeDefined());
    act(() => hook.result.current.clear());
    await waitFor(() => expect(hook.result.current.partial).toBeUndefined());
    await delay(50);
    expect(finished).toEqual([]);
    expect(failed).toEqual([]);
  });
});
