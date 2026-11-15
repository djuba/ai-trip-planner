// Synthetic Anthropic Messages API responses, for driving the real provider with no network
// (adapted from spikes/structured-output/src/capture-fetch.ts, ADR 0001 Q5).

export function anthropicMessage(opts: {
  model: string;
  text?: string;
  stopReason: 'end_turn' | 'max_tokens' | 'refusal';
}): unknown {
  return {
    id: 'msg_synthetic',
    type: 'message',
    role: 'assistant',
    model: opts.model,
    content: opts.text === undefined ? [] : [{ type: 'text', text: opts.text }],
    stop_reason: opts.stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: opts.text === undefined ? 0 : 20 },
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_synthetic' },
  });
}

export function anthropicError(status: number, type: string): Response {
  return jsonResponse({ type: 'error', error: { type, message: 'synthetic' } }, status);
}

export interface ScriptedFetch {
  fetch: typeof fetch;
  /** The parsed JSON body of every request, in order. */
  bodies: Array<Record<string, unknown>>;
}

/** Answers each request with the next scripted response; extra requests fail the test. */
export function scriptedFetch(...responses: Array<() => Response>): ScriptedFetch {
  const bodies: Array<Record<string, unknown>> = [];
  const fn = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    bodies.push(
      JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as Record<string, unknown>,
    );
    const next = responses[bodies.length - 1];
    if (next === undefined) throw new Error(`unexpected request #${bodies.length}`);
    return Promise.resolve(next());
  };
  return { fetch: fn, bodies };
}

/**
 * A synthetic Anthropic SSE stream (shape as in tests/support/fixtures/anthropic-stream.sse): the
 * text in `chunkSize` deltas, then `stopReason`. With `errorAfter`, only that many characters go
 * out, then an `error` event (an overload mid-stream) and no `message_stop` (WU-11 plan D5).
 */
export function anthropicSseEvents(opts: {
  model: string;
  text: string;
  chunkSize?: number;
  stopReason?: 'end_turn' | 'max_tokens' | 'refusal';
  errorAfter?: number;
}): string[] {
  const size = opts.chunkSize ?? 16;
  const sent = opts.errorAfter === undefined ? opts.text : opts.text.slice(0, opts.errorAfter);
  const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}`;
  const events = [
    event('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_synthetic',
        type: 'message',
        role: 'assistant',
        model: opts.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    }),
    event('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
  ];
  for (let i = 0; i < sent.length; i += size) {
    events.push(
      event('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: sent.slice(i, i + size) },
      }),
    );
  }
  if (opts.errorAfter !== undefined) {
    events.push(
      event('error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
    );
    return events;
  }
  events.push(
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: opts.stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: 20 },
    }),
    event('message_stop', { type: 'message_stop' }),
  );
  return events;
}

/** `anthropicSseEvents` as a streamed response, one event per chunk. */
export function sseResponse(events: readonly string[]): Response {
  const encoder = new TextEncoder();
  let next = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const event = events[next++];
        if (event === undefined) controller.close();
        else controller.enqueue(encoder.encode(`${event}\n\n`));
      },
    }),
    {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'request-id': 'req_synthetic',
      },
    },
  );
}
