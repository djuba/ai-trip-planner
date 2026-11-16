'use client';
// Streams `/v1/trip/present` with `useObject` (WU-14 plan D2). `useObject` parses the partial
// JSON and runs the final schema check; its `fetch` goes through the typed client, so the base
// URL, the invite code and the status → `ApiError` mapping stay in `client.ts`. Only the partial
// object lives here; the validated result is reported to the caller, which owns the state.
import { useObject } from '@ai-sdk/react';
import { PresentationModel, type PresentRequest } from '@vp/domain-schema/wire';
import { useCallback, useLayoutEffect, useRef } from 'react';
import type { ApiClient, ApiError } from '../api';

/** A non-2xx (or unreachable) `/present`, carrying the client's mapped error. */
export class PresentFailed extends Error {
  readonly error: ApiError;
  constructor(error: ApiError) {
    super(`present failed: ${error.kind}`);
    this.name = 'PresentFailed';
    this.error = error;
  }
}

export interface PresentationDeps {
  /** Must keep its identity across renders (see `ConversationDeps`). */
  client: Pick<ApiClient, 'present'>;
  /** Whether an invite code is stored, read when the request is sent (for the 401 wording). */
  hasInviteCode: () => boolean;
  onFinished: (model: PresentationModel) => void;
  onFailed: (error: ApiError, hadInviteCode: boolean) => void;
}

export interface Presentation {
  /** The partial object so far. Undefined until the first chunk, and after `clear()`. */
  partial: unknown;
  submit: (request: PresentRequest) => void;
  /** Aborts the stream and forgets the partial object (plan fix 2). */
  clear: () => void;
}

export function usePresentation({
  client,
  hasInviteCode,
  onFinished,
  onFailed,
}: PresentationDeps): Presentation {
  const hadInviteCode = useRef(false);

  const fetch = useCallback(
    async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      hadInviteCode.current = hasInviteCode();
      // `useObject` sends `JSON.stringify(input)`; the input is always a `PresentRequest`.
      if (typeof init?.body !== 'string') throw new Error('useObject sent a non-string body');
      const body = JSON.parse(init.body) as PresentRequest;
      const result = await client.present(body, init?.signal ? { signal: init.signal } : {});
      if (!result.ok) {
        // `useObject` ignores an AbortError, as it does for its own aborts.
        if (result.error.kind === 'aborted') throw new DOMException('aborted', 'AbortError');
        throw new PresentFailed(result.error);
      }
      return new Response(result.data, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    },
    [client, hasInviteCode],
  );

  const { object, submit, clear } = useObject({
    // Unused: the custom `fetch` above decides where the request goes.
    api: '/v1/trip/present',
    schema: PresentationModel,
    fetch,
    onFinish: ({ object: model, error }) => {
      if (model !== undefined) onFinished(model);
      else {
        onFailed(
          { kind: 'contract', detail: `presentation: ${error?.message ?? 'invalid'}` },
          hadInviteCode.current,
        );
      }
    },
    // A `PresentFailed` happened before the stream; anything else broke a 2xx stream partway.
    onError: (error) =>
      onFailed(
        error instanceof PresentFailed ? error.error : { kind: 'interrupted' },
        hadInviteCode.current,
      ),
  });

  // `useObject` returns new `submit` and `clear` functions on every render. The caller's effect
  // depends on these, so they are kept in refs and handed out as stable functions; otherwise
  // each render would abort the stream and start it again.
  const latest = useRef({ submit, clear });
  useLayoutEffect(() => {
    latest.current = { submit, clear };
  });
  const start = useCallback((request: PresentRequest) => void latest.current.submit(request), []);
  const stop = useCallback(() => latest.current.clear(), []);

  return { partial: object, submit: start, clear: stop };
}
