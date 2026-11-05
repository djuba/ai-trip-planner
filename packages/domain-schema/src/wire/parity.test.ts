// The generated JSON Schema must accept and reject exactly what the Zod schema does (CLAUDE.md 4.1).
// Strict mode stays on: anything Ajv strict rejects in the generated output is a generator bug.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { buildJsonSchemas } from '../../gen/artifacts.ts';
import { CONTRACT_SCHEMAS, type ContractSchemaId } from '../../gen/registry.ts';
import { SAMPLES } from '../../tests/support/samples.ts';

// Under `moduleResolution: bundler` these CJS packages can surface as namespace objects.
interface AjvLike {
  addSchema(schema: object): unknown;
  getSchema(id: string): (((data: unknown) => boolean) & { errors?: unknown }) | undefined;
}
type AjvCtor = new (opts: { strict: boolean; allErrors: boolean }) => AjvLike;
const interop = <T>(m: unknown): T => ((m as { default?: unknown }).default ?? m) as T;
const AjvClass = interop<AjvCtor>(Ajv2020);
const applyFormats = interop<(ajv: AjvLike) => unknown>(addFormats);

const schemas = buildJsonSchemas();
const ids = Object.keys(CONTRACT_SCHEMAS) as ContractSchemaId[];

const ajv = new AjvClass({ strict: true, allErrors: true });
applyFormats(ajv);
for (const id of ids) ajv.addSchema(schemas[id]);

describe('Zod / JSON Schema parity', () => {
  it('compiles every generated schema in strict mode', () => {
    for (const id of ids) {
      expect(ajv.getSchema(`${id}.schema.json`), id).toBeDefined();
    }
  });

  describe.each(ids)('%s', (id) => {
    const all = [
      ...SAMPLES[id].valid.map((v, i) => ({ v, label: `valid sample ${i}`, expected: true })),
      ...SAMPLES[id].invalid.map((v, i) => ({ v, label: `invalid sample ${i}`, expected: false })),
    ];

    it.each(all)('Ajv and Zod agree on $label', ({ v, expected }) => {
      const validate = ajv.getSchema(`${id}.schema.json`);
      if (!validate) throw new Error(`no validator for ${id}`);
      const zod = CONTRACT_SCHEMAS[id].safeParse(v).success;
      const json = validate(v);
      expect(zod).toBe(expected);
      expect(json, JSON.stringify(validate.errors)).toBe(zod);
    });
  });
});
