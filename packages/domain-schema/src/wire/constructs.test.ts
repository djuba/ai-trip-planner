// Construct rules (WU-04 D14, CLAUDE.md §4.1 and §4.4), enforced two ways:
// (a) a Zod walk over every registered schema, because `.refine()` vanishes from JSON Schema;
// (b) a JSON keyword walk over the generated schema of each LLM-facing schema.
// Each walker is proven by a deliberately bad schema below.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildJsonSchemas } from '../../gen/artifacts.ts';
import { CONTRACT_SCHEMAS, LLM_FACING_IDS } from '../../gen/registry.ts';

type JsonSchema = Record<string, unknown>;

// ---------- (a) Zod walk ----------

const FORBIDDEN_DEF_TYPES = new Set([
  'transform',
  'pipe',
  'default',
  'prefault',
  'catch',
  'date',
  'bigint',
  'lazy',
  'custom',
  'map',
  'set',
  'promise',
  'function',
]);

interface ZodNode {
  _zod: {
    def: {
      type: string;
      checks?: { _zod: { def: { check: string } } }[];
      [key: string]: unknown;
    };
  };
}

const isNode = (v: unknown): v is ZodNode => typeof v === 'object' && v !== null && '_zod' in v;

function children(def: ZodNode['_zod']['def']): ZodNode[] {
  const out: unknown[] = [];
  if (def.shape && typeof def.shape === 'object')
    out.push(...(Object.values(def.shape) as unknown[]));
  for (const key of [
    'element',
    'innerType',
    'options',
    'left',
    'right',
    'keyType',
    'valueType',
    'items',
    'rest',
    'catchall',
    'in',
    'out',
  ]) {
    const v = def[key];
    if (Array.isArray(v)) out.push(...(v as unknown[]));
    else if (v !== undefined && v !== null) out.push(v);
  }
  return out.filter(isNode);
}

/** Returns a description of each forbidden construct found anywhere under `root`. */
function findForbiddenConstructs(root: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<ZodNode>();
  const visit = (node: ZodNode, path: string) => {
    if (seen.has(node)) return;
    seen.add(node);
    const def = node._zod.def;
    if (FORBIDDEN_DEF_TYPES.has(def.type)) found.push(`${path}: def type '${def.type}'`);
    for (const check of def.checks ?? []) {
      if (check._zod.def.check === 'custom') found.push(`${path}: custom check (refine)`);
      // `.trim()`, `.toLowerCase()` etc. rewrite the value and vanish from JSON Schema.
      if (check._zod.def.check === 'overwrite') found.push(`${path}: overwrite check (trim etc.)`);
    }
    for (const child of children(def)) visit(child, `${path}>${child._zod.def.type}`);
  };
  if (!isNode(root)) throw new Error('not a Zod schema');
  visit(root, root._zod.def.type);
  return found;
}

describe('D14(a): Zod construct walk', () => {
  for (const [id, schema] of Object.entries(CONTRACT_SCHEMAS)) {
    it(`${id} has no refinements, transforms, defaults or other forbidden constructs`, () => {
      expect(findForbiddenConstructs(schema)).toEqual([]);
    });
  }

  it('self-test: reports a .refine() nested inside an array inside an object', () => {
    const bad = z.object({ list: z.array(z.string().refine((s) => s.length > 0)) });
    expect(findForbiddenConstructs(bad)).toEqual([expect.stringContaining('custom check')]);
  });

  it('self-test: reports an object-level .superRefine()', () => {
    const bad = z.object({ a: z.string() }).superRefine(() => {});
    expect(findForbiddenConstructs(bad)).not.toEqual([]);
  });

  it('self-test: reports a value-rewriting .trim() and .toLowerCase()', () => {
    const bad = z.object({ a: z.string().trim().min(1), b: z.string().toLowerCase() });
    expect(findForbiddenConstructs(bad)).toEqual([
      expect.stringContaining('overwrite check'),
      expect.stringContaining('overwrite check'),
    ]);
  });

  it('self-test: reports a forbidden construct inside an object catchall', () => {
    const bad = z.object({ a: z.string() }).catchall(z.string().refine((s) => s.length > 0));
    expect(findForbiddenConstructs(bad)).toEqual([expect.stringContaining('custom check')]);
  });

  it('self-test: reports a .transform()', () => {
    const bad = z.object({ a: z.string().transform((s) => s.length) });
    const found = findForbiddenConstructs(bad);
    expect(found.some((f) => f.includes("'transform'") || f.includes("'pipe'"))).toBe(true);
  });

  it('self-test: reports a .default()', () => {
    const bad = z.object({ a: z.string().default('x') });
    expect(findForbiddenConstructs(bad)).toEqual([expect.stringContaining("'default'")]);
  });

  it('self-test: passes a plain schema, including z.int() and a union', () => {
    const ok = z.object({
      n: z.int(),
      u: z.union([z.object({ kind: z.literal('a') }), z.object({ kind: z.literal('b') })]),
      x: z.string().nullable(),
      e: z.enum(['p', 'q']).optional(),
    });
    expect(findForbiddenConstructs(ok)).toEqual([]);
  });
});

// ---------- (b) JSON keyword walk ----------

const FORBIDDEN_KEYWORDS = [
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'prefixItems',
  'default',
  'propertyNames',
] as const;

const SAFE = Number.MAX_SAFE_INTEGER;
const isRecord = (v: unknown): v is JsonSchema =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Follows `$ref`s (relative file names) across `emitted`; guards against cycles. */
function findJsonViolations(rootName: string, emitted: Record<string, JsonSchema>): string[] {
  const found: string[] = [];
  const visitedFiles = new Set<string>();

  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((n, i) => walk(n, `${path}[${i}]`));
      return;
    }
    if (!isRecord(node)) return;

    for (const kw of FORBIDDEN_KEYWORDS) {
      if (kw in node) found.push(`${path}: forbidden keyword '${kw}'`);
    }
    for (const kw of ['minimum', 'maximum'] as const) {
      const v = node[kw];
      if (v !== undefined && v !== SAFE && v !== -SAFE) {
        found.push(`${path}: '${kw}' is ${JSON.stringify(v)}`);
      }
    }
    if (isRecord(node.additionalProperties)) {
      found.push(`${path}: object-valued additionalProperties`);
    }
    if (isRecord(node.properties)) {
      const required = Array.isArray(node.required) ? node.required : [];
      for (const key of Object.keys(node.properties)) {
        if (!required.includes(key)) found.push(`${path}: property '${key}' is not required`);
      }
    }
    if (typeof node.$ref === 'string') {
      const target = node.$ref;
      const file = emitted[target.replace(/\.schema\.json$/, '')];
      if (!file) found.push(`${path}: unresolved $ref '${target}'`);
      else if (!visitedFiles.has(target)) {
        visitedFiles.add(target);
        walk(file, target);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref') continue;
      // A `properties` map holds names → schemas; its keys are field names, not keywords.
      if (key === 'properties' && isRecord(value)) {
        for (const [name, sub] of Object.entries(value)) walk(sub, `${path}.properties.${name}`);
      } else walk(value, `${path}.${key}`);
    }
  };

  visitedFiles.add(`${rootName}.schema.json`);
  walk(emitted[rootName], `${rootName}.schema.json`);
  return found;
}

describe('D14(b): JSON keyword walk over LLM-facing schemas', () => {
  const emitted = buildJsonSchemas() as Record<string, JsonSchema>;

  for (const id of LLM_FACING_IDS) {
    it(`${id} uses only ADR 0001 Q3 constructs`, () => {
      expect(findJsonViolations(id, emitted)).toEqual([]);
    });
  }

  it('self-test: reports a forbidden keyword inline', () => {
    const bad = { Bad: { type: 'string', minLength: 1 } };
    expect(findJsonViolations('Bad', bad)).toEqual([expect.stringContaining('minLength')]);
  });

  it('self-test: reports a forbidden keyword behind a $ref in another schema (A7)', () => {
    const set = {
      Root: {
        type: 'object',
        properties: { child: { $ref: 'Child.schema.json' } },
        required: ['child'],
      },
      Child: { type: 'string', pattern: '^a$' },
    };
    expect(findJsonViolations('Root', set)).toEqual([expect.stringContaining('pattern')]);
  });

  it('self-test: follows a $ref cycle without looping', () => {
    const set = {
      A: { type: 'object', properties: { b: { $ref: 'B.schema.json' } }, required: ['b'] },
      B: { type: 'object', properties: { a: { $ref: 'A.schema.json' } }, required: ['a'] },
    };
    expect(findJsonViolations('A', set)).toEqual([]);
  });

  it('self-test: reports an unresolved $ref', () => {
    const set = { A: { $ref: 'Missing.schema.json' } };
    expect(findJsonViolations('A', set)).toEqual([expect.stringContaining('unresolved')]);
  });

  it('self-test: reports an optional property', () => {
    const bad = {
      Bad: { type: 'object', properties: { a: { type: 'string' } }, required: [] },
    };
    expect(findJsonViolations('Bad', bad)).toEqual([expect.stringContaining("'a'")]);
  });

  it('self-test: reports unsafe numeric bounds and object-valued additionalProperties', () => {
    const bad = {
      Bad: {
        type: 'object',
        properties: { n: { type: 'integer', minimum: 0 } },
        required: ['n'],
        additionalProperties: { type: 'string' },
      },
    };
    expect(findJsonViolations('Bad', bad)).toHaveLength(2);
  });

  it('self-test: a property named like a keyword is not a keyword', () => {
    const ok = {
      Ok: {
        type: 'object',
        properties: { format: { type: 'string' }, default: { type: 'string' } },
        required: ['format', 'default'],
      },
    };
    expect(findJsonViolations('Ok', ok)).toEqual([]);
  });

  it('self-test: passes an integer with safe-integer bounds', () => {
    const ok = {
      Ok: {
        type: 'object',
        properties: { n: { type: 'integer', minimum: -SAFE, maximum: SAFE } },
        required: ['n'],
      },
    };
    expect(findJsonViolations('Ok', ok)).toEqual([]);
  });
});
