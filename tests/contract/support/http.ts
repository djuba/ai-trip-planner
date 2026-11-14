// HTTP helpers for the conformance checks. Everything is read as text, so a check sees exactly
// what a client in any language would.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { inviteCode } from './artifacts.ts';

export interface HttpResult {
  status: number;
  header(name: string): string | undefined;
  text: string;
}

/**
 * Authorization for a request: left out, the helper sends the suite's invite code as a Bearer
 * token; `null` sends no Authorization header; a string is sent as given.
 */
export interface AuthOptions {
  authorization?: string | null;
}

function authHeaders(options: AuthOptions): Record<string, string> {
  const value =
    options.authorization === undefined ? `Bearer ${inviteCode()}` : options.authorization;
  return value === null ? {} : { authorization: value };
}

function fromResponse(response: Response, text: string): HttpResult {
  return {
    status: response.status,
    header: (name) => response.headers.get(name) ?? undefined,
    text,
  };
}

export async function get(
  baseUrl: string,
  path: string,
  origin?: string,
  options: AuthOptions = {},
): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { ...(origin ? { origin } : {}), ...authHeaders(options) },
  });
  return fromResponse(response, await response.text());
}

/** POSTs `body` exactly as given (it may be deliberately malformed). */
export async function postText(
  baseUrl: string,
  path: string,
  body: string,
  origin?: string,
  options: AuthOptions = {},
): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
      ...authHeaders(options),
    },
    body,
  });
  return fromResponse(response, await response.text());
}

export const postJson = (
  baseUrl: string,
  path: string,
  body: unknown,
  origin?: string,
  options: AuthOptions = {},
) => postText(baseUrl, path, JSON.stringify(body), origin, options);

/** A CORS preflight for a JSON request, as a browser sends it (never with Authorization). */
export async function preflight(
  baseUrl: string,
  path: string,
  method: string,
  origin: string,
): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'content-type, authorization',
    },
  });
  return fromResponse(response, await response.text());
}

/** Reads a streamed body to the end, counting the chunks it arrived in. */
export async function postStream(
  baseUrl: string,
  path: string,
  body: unknown,
  options: AuthOptions = {},
): Promise<HttpResult & { chunks: number }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(options) },
    body: JSON.stringify(body),
  });
  const decoder = new TextDecoder();
  let text = '';
  let chunks = 0;
  if (response.body) {
    // Typed `any` without the DOM lib; fetch bodies are byte streams.
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      chunks += 1;
      text += decoder.decode(chunk, { stream: true });
    }
  }
  text += decoder.decode();
  return { ...fromResponse(response, text), chunks };
}

const UPLOAD_CHUNK = 64 * 1024;

/**
 * POSTs `size` bytes with an explicit content-length (plan D6). A server may answer before the
 * upload is complete and then close the socket; that is normal, so the response wins. Only a
 * connection that fails before any response arrives is an error.
 */
export function postOversized(
  baseUrl: string,
  path: string,
  size: number,
  origin?: string,
  options: AuthOptions = {},
): Promise<HttpResult> {
  const url = new URL(`${baseUrl}${path}`);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  // A JSON string: valid JSON at any length, so only the size can be the reason for a rejection.
  const body = Buffer.alloc(size, 'a');
  body[0] = 0x22; // "
  body[size - 1] = 0x22;

  return new Promise((resolve, reject) => {
    let answered = false;
    const req = send(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(size),
          ...(origin ? { origin } : {}),
          ...authHeaders(options),
        },
      },
      (res) => {
        answered = true;
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        const finish = () =>
          resolve({
            status: res.statusCode ?? 0,
            header: (name) => {
              const value = res.headers[name.toLowerCase()];
              return Array.isArray(value) ? value.join(', ') : value;
            },
            text,
          });
        res.on('end', finish);
        // The server may reset the socket after sending a complete response.
        res.on('error', finish);
      },
    );
    req.on('error', (error) => {
      if (!answered) {
        reject(
          new Error(
            `POST ${path} with ${size} bytes: the connection failed before any response ` +
              `(${error.message}). A server must answer 413 before closing.`,
          ),
        );
      }
    });

    let offset = 0;
    const pump = () => {
      while (offset < size) {
        const end = Math.min(offset + UPLOAD_CHUNK, size);
        const more = req.write(body.subarray(offset, end));
        offset = end;
        if (!more) {
          req.once('drain', pump);
          return;
        }
      }
      req.end();
    };
    pump();
  });
}

/** `text/plain; charset=utf-8` → `text/plain`. Parameters are not part of the contract (D5). */
export const mediaType = (contentType: string | undefined): string | undefined =>
  contentType?.split(';')[0]?.trim().toLowerCase();

/** Comma-separated header tokens, lower-cased. */
export const headerTokens = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
