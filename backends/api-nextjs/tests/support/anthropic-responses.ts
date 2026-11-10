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
