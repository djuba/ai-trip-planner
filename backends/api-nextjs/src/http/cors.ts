// CORS for the one allowed web origin (CLAUDE.md §5). The header is constant, not reflected from
// the request, because there is only one origin to allow.

const ALLOW_ORIGIN = 'access-control-allow-origin';

/** `useObject` and the API client send a JSON POST, which needs a preflight (ADR 0001, Q7). */
export function preflightResponse(webOrigin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      [ALLOW_ORIGIN]: webOrigin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
    },
  });
}

/** Adds CORS without reading the body, so a streaming response keeps streaming. */
export function withCors(response: Response, webOrigin: string): Response {
  const headers = new Headers(response.headers);
  headers.set(ALLOW_ORIGIN, webOrigin);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
