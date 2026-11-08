// JSON Schema validation of response bodies against generated/*.schema.json (plan D3). The Ajv
// setup mirrors packages/domain-schema/src/wire/parity.test.ts but is copied, not imported (D2).
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadSchemaFiles } from './artifacts.ts';

interface ValidateFn {
  (data: unknown): boolean;
  errors?: unknown;
}
interface AjvLike {
  addSchema(schema: object): unknown;
  getSchema(id: string): ValidateFn | undefined;
}
type AjvCtor = new (opts: { strict: boolean; allErrors: boolean }) => AjvLike;
// Under `moduleResolution: bundler` these CJS packages can surface as namespace objects.
const interop = <T>(m: unknown): T => ((m as { default?: unknown }).default ?? m) as T;

/** A contract violation found by a check. Its message says what was expected and what came back. */
export class ConformanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConformanceError';
  }
}

let ajv: AjvLike | undefined;

function getAjv(): AjvLike {
  if (!ajv) {
    const instance = new (interop<AjvCtor>(Ajv2020))({ strict: true, allErrors: true });
    interop<(a: AjvLike) => unknown>(addFormats)(instance);
    // Every schema first: their $ids and $refs are relative to each other.
    for (const schema of loadSchemaFiles()) instance.addSchema(schema);
    ajv = instance;
  }
  return ajv;
}

/** Throws a ConformanceError unless `value` is valid against `generated/<id>.schema.json`. */
export function assertSchema(id: string, value: unknown, context: string): void {
  const validate = getAjv().getSchema(`${id}.schema.json`);
  if (!validate) throw new Error(`No generated schema named ${id}`);
  if (!validate(value)) {
    throw new ConformanceError(
      `${context}: body is not a valid ${id}: ${JSON.stringify(validate.errors)}\n` +
        `body: ${JSON.stringify(value).slice(0, 2_000)}`,
    );
  }
}
