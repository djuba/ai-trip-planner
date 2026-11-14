// The adapter every route handler goes through: parse → call → serialize (CLAUDE.md §9). Uses only
// standard Request and Response, so it is testable without Next.
import type { z } from 'zod';
import { getConfig } from '../config.ts';
import { parseJsonBody } from './body.ts';
import { preflightResponse, withCors } from './cors.ts';
import { toErrorResponse } from './errors.ts';
import { getGate, type Gate } from './gate.ts';

export type RouteHandler = (request: Request) => Response | Promise<Response>;

export interface RouteOptions {
  /** The access gate; the production one by default. Tests inject their own (WU-22 plan). */
  gate?: () => Gate;
}

function wrap(handler: RouteHandler, gate: (() => Gate) | null) {
  return async (request: Request): Promise<Response> => {
    let response: Response;
    try {
      // Before anything reads the body: 401 and 429 come before 413 and 422 (WU-22 plan D2).
      await gate?.().check(request);
      response = await handler(request);
    } catch (error) {
      response = toErrorResponse(error);
    }
    return withCors(response, getConfig().webOrigin);
  };
}

/**
 * Gated by default: the handler runs only for a valid invite code within its limits. Turns every
 * throw into the error envelope and adds CORS to every response.
 */
export function route(
  handler: RouteHandler,
  { gate = getGate }: RouteOptions = {},
): (request: Request) => Promise<Response> {
  return wrap(handler, gate);
}

/** Needs no invite code. Only `GET /v1/health` uses it; a test pins that (AC-GATE-10). */
export function openRoute(handler: RouteHandler): (request: Request) => Promise<Response> {
  return wrap(handler, null);
}

/** A gated JSON POST: the handler receives the body already parsed against `schema`. */
export function postRoute<Schema extends z.ZodType>(
  schema: Schema,
  handler: (body: z.output<Schema>) => Response | Promise<Response>,
  options: RouteOptions = {},
): (request: Request) => Promise<Response> {
  return route(async (request) => handler(await parseJsonBody(request, schema)), options);
}

/** Serializes a response body, failing as a 500 rather than sending one that breaks the contract. */
export function jsonResponse<Schema extends z.ZodType>(
  schema: Schema,
  value: z.input<Schema>,
  status = 200,
): Response {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Response breaks the contract: ${result.error.message}`);
  }
  return Response.json(result.data, { status });
}

/** The `OPTIONS` export of every route. Next's automatic answer carries no CORS headers. */
export function preflight(): Response {
  return preflightResponse(getConfig().webOrigin);
}
