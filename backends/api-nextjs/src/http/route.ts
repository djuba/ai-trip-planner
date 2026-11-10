// The adapter every route handler goes through: parse → call → serialize (CLAUDE.md §9). Uses only
// standard Request and Response, so it is testable without Next.
import type { z } from 'zod';
import { getConfig } from '../config.ts';
import { parseJsonBody } from './body.ts';
import { preflightResponse, withCors } from './cors.ts';
import { toErrorResponse } from './errors.ts';

export type RouteHandler = (request: Request) => Response | Promise<Response>;

/** Turns every throw into the error envelope and adds CORS to every response. */
export function route(handler: RouteHandler): (request: Request) => Promise<Response> {
  return async (request) => {
    let response: Response;
    try {
      response = await handler(request);
    } catch (error) {
      response = toErrorResponse(error);
    }
    return withCors(response, getConfig().webOrigin);
  };
}

/** A JSON POST: the handler receives the body already parsed against `schema`. */
export function postRoute<Schema extends z.ZodType>(
  schema: Schema,
  handler: (body: z.output<Schema>) => Response | Promise<Response>,
): (request: Request) => Promise<Response> {
  return route(async (request) => handler(await parseJsonBody(request, schema)));
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
