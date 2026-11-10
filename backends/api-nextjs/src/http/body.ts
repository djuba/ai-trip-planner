// Reads and validates a JSON request body, enforcing the contract's size cap (CLAUDE.md §5).
// `request.json()` has no limit, and a chunked request has no content-length, so bytes are counted
// as they arrive.
import { MAX_REQUEST_BODY_BYTES } from '@vp/domain-schema/wire';
import { z } from 'zod';
import { PayloadTooLargeError, RequestValidationError } from './errors.ts';

const TOO_LARGE = `Request body is over ${MAX_REQUEST_BODY_BYTES} bytes`;

async function readCapped(request: Request): Promise<Uint8Array> {
  // The header can reject a body early, but never allow one: it may be absent or wrong.
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BODY_BYTES) {
    throw new PayloadTooLargeError(TOO_LARGE);
  }
  if (!request.body) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  // Leaving this loop early, including by throwing, cancels the stream.
  for await (const chunk of request.body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > MAX_REQUEST_BODY_BYTES) throw new PayloadTooLargeError(TOO_LARGE);
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RequestValidationError('Request body is not valid JSON');
  }
}

export async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.output<Schema>> {
  const result = schema.safeParse(decodeJson(await readCapped(request)));
  if (!result.success) throw new RequestValidationError(z.prettifyError(result.error));
  return result.data;
}
