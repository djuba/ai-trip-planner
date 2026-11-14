// A conformant fake backend for the suite's self-test (plan D7). Its default bodies are validated
// against the generated schemas when it is constructed, so the fake cannot drift from the contract.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inviteCode, loadConstants } from '../support/artifacts.ts';
import { assertSchema } from '../support/schemas.ts';
import { POST_ENDPOINTS } from '../conformance/checks/requests.ts';

export interface FakeRequest {
  method: string;
  path: string;
  origin: string | undefined;
  /** The raw Authorization header, if any. */
  authorization: string | undefined;
  /** Declared content-length is over `maxRequestBodyBytes`. */
  oversized: boolean;
  bodyText: string;
}

export interface FakeResponse {
  status: number;
  headers: Record<string, string>;
  /** The body, sent as one chunk per entry (so /present can stream). */
  chunks: string[];
}

export type FakeHook = (req: FakeRequest, defaultResponse: FakeResponse) => FakeResponse;

export interface FakeOptions {
  /** Changes the response for one request. */
  hook?: FakeHook;
  /** Answer 413 as soon as headers arrive, before the upload ends, then close (plan D6). */
  early413?: boolean;
  /** The origin that gets CORS headers. */
  origin?: string;
  /** The invite code the fake accepts; defaults to the suite's CONTRACT_INVITE_CODE. */
  inviteCode?: string;
  /** Preflight status. */
  preflightStatus?: number;
}

export interface FakeBackend {
  url: string;
  close(): Promise<void>;
}

const PROFILE = {
  departure: { city: 'Minneapolis', mode: 'plane', maxStops: 0 },
  dateRange: { kind: 'fixed', start: '2030-02-10', end: '2030-02-17' },
  region: 'Hawaii',
  climate: 'tropical',
  experiences: ['beach', 'snorkeling'],
  people: [
    { userType: 'adult', age: 40 },
    { userType: 'adult', age: 38 },
  ],
};
const CLAIM = {
  kind: 'flight',
  statement: 'Flights from Minneapolis may be available with one stop.',
  verification: 'unverified',
};

function validated(schema: string, body: unknown): string {
  assertSchema(schema, body, `fake backend default for ${schema}`);
  return JSON.stringify(body);
}

export const errorBody = (code: string): string =>
  validated('ErrorResponse', { error: { code, message: `fake ${code}` } });

function defaults(): Record<string, string> {
  return {
    health: validated('HealthResponse', {
      status: 'ok',
      contractVersion: loadConstants().contractVersion,
    }),
    extract: validated('ExtractResponse', { status: 'ready', profile: PROFILE }),
    extractClarify: validated('ExtractResponse', {
      status: 'needs_clarification',
      profile: {},
      violations: [
        { code: 'INSUFFICIENT_DETAIL', path: '', params: { populated: 0, required: 3 } },
      ],
      clarificationQuestion: 'Where would you like to go, and when?',
    }),
    recommend: validated('RecommendResponse', {
      recommendations: [
        {
          id: 'rec-1',
          destination: 'Maui, Hawaii',
          summary: 'Warm beaches and calm snorkeling water in February.',
          matchedExperiences: ['beach', 'snorkeling'],
          claims: [CLAIM],
        },
      ],
      critique: { pass: true, unresolved: [] },
    }),
    present: validated('PresentationModel', {
      headline: 'A week of sun and snorkeling in Maui',
      intro: 'Here is a destination that fits your dates.',
      cards: [
        {
          recommendationId: 'rec-1',
          title: 'Maui, Hawaii',
          blurb: 'Warm beaches and calm snorkeling water.',
          highlights: ['Molokini snorkeling'],
          claims: [CLAIM],
        },
      ],
    }),
  };
}

const json = (status: number, body: string): FakeResponse => ({
  status,
  headers: { 'content-type': 'application/json' },
  chunks: [body],
});

function chunkText(text: string, parts = 4): string[] {
  const size = Math.ceil(text.length / parts);
  return Array.from({ length: parts }, (_, i) => text.slice(i * size, (i + 1) * size));
}

export async function startFakeBackend(options: FakeOptions = {}): Promise<FakeBackend> {
  const allowedOrigin = options.origin ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  const maxBytes = loadConstants().maxRequestBodyBytes;
  const bodies = defaults();
  const code = options.inviteCode ?? inviteCode();
  const schemaFor = new Map(POST_ENDPOINTS.map((e) => [e.path, e.schema]));
  const okBody = new Map([
    ['/v1/trip/extract', bodies.extract],
    ['/v1/trip/recommend', bodies.recommend],
  ]);

  const cors = (origin: string | undefined): Record<string, string> =>
    origin === allowedOrigin ? { 'access-control-allow-origin': allowedOrigin } : {};

  function defaultResponse(req: FakeRequest): FakeResponse {
    const corsHeaders = cors(req.origin);
    const withCors = (r: FakeResponse): FakeResponse => ({
      ...r,
      headers: { ...r.headers, ...corsHeaders },
    });
    if (req.method === 'OPTIONS') {
      return {
        status: options.preflightStatus ?? 204,
        headers: {
          ...corsHeaders,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type, authorization',
        },
        chunks: [],
      };
    }
    if (req.path === '/v1/health' && req.method === 'GET') {
      return withCors(json(200, bodies.health ?? ''));
    }
    const schema = schemaFor.get(req.path);
    if (!schema || req.method !== 'POST') return withCors(json(404, errorBody('INTERNAL_ERROR')));
    const [scheme, token, ...rest] = (req.authorization ?? '').trim().split(/\s+/);
    if (scheme?.toLowerCase() !== 'bearer' || token !== code || rest.length > 0) {
      const denied = json(401, errorBody('UNAUTHORIZED'));
      denied.headers['www-authenticate'] = 'Bearer';
      return withCors(denied);
    }
    if (req.oversized) return withCors(json(413, errorBody('PAYLOAD_TOO_LARGE')));
    try {
      assertSchema(schema, JSON.parse(req.bodyText), 'request');
    } catch {
      return withCors(json(422, errorBody('VALIDATION_FAILED')));
    }
    if (req.path === '/v1/trip/present') {
      return withCors({
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        chunks: chunkText(bodies.present ?? ''),
      });
    }
    if (req.path === '/v1/trip/extract') {
      const { currentProfile } = JSON.parse(req.bodyText) as { currentProfile?: unknown };
      return withCors(json(200, (currentProfile ? bodies.extract : bodies.extractClarify) ?? ''));
    }
    if (req.path === '/v1/trip/recommend') {
      const { profile } = JSON.parse(req.bodyText) as {
        profile: { people?: { userType?: string }[] };
      };
      const people = profile.people ?? [];
      if (people.length > 0 && !people.some((p) => p.userType === 'adult')) {
        return withCors(json(422, errorBody('VALIDATION_FAILED')));
      }
    }
    return withCors(json(200, okBody.get(req.path) ?? ''));
  }

  function send(res: ServerResponse, response: FakeResponse, onDone?: () => void): void {
    res.writeHead(response.status, response.headers);
    for (const chunk of response.chunks) res.write(chunk);
    res.end(onDone);
  }

  function describeRequest(
    req: IncomingMessage,
    bodyText: string,
    oversized: boolean,
  ): FakeRequest {
    return {
      method: req.method ?? 'GET',
      path: new URL(req.url ?? '/', 'http://fake').pathname,
      origin: req.headers.origin,
      authorization: req.headers.authorization,
      oversized,
      bodyText,
    };
  }

  const hook: FakeHook = options.hook ?? ((_req, def) => def);

  const server: Server = createServer((req, res) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    const oversized = declared > maxBytes;

    if (oversized && options.early413) {
      // Answer before the upload ends, then close gracefully, as real servers do: discard the rest
      // of the body and let Connection: close end the socket with a FIN. Destroying the socket
      // while upload data is unread sends a TCP reset that can discard the 413 in transit.
      const fake = describeRequest(req, '', true);
      res.setHeader('connection', 'close');
      req.resume();
      send(res, hook(fake, defaultResponse(fake)));
      return;
    }

    // Oversized bodies are drained but not kept.
    const parts: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      if (!oversized) parts.push(chunk);
    });
    req.on('end', () => {
      const fake = describeRequest(req, Buffer.concat(parts).toString('utf8'), oversized);
      send(res, hook(fake, defaultResponse(fake)));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
