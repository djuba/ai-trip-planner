import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { CONTRACT_VERSION } from '../src/wire/index.ts';
import { buildArtifacts, buildJsonSchemas, buildOpenApi } from './artifacts.ts';
import { CONTRACT_SCHEMAS, LLM_ONLY_IDS } from './registry.ts';

const collectRefs = (node: unknown, out: string[] = []): string[] => {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (typeof node === 'object' && node !== null) {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
};

const resolve = (root: unknown, ref: string): unknown =>
  ref
    .slice(2)
    .split('/')
    .reduce<unknown>((n, seg) => (n as Record<string, unknown> | undefined)?.[seg], root);

describe('buildArtifacts', () => {
  const files = buildArtifacts();

  it('is deterministic', () => {
    expect([...buildArtifacts()]).toEqual([...files]);
  });

  it('emits one schema file per contract schema plus openapi.yaml and constants.json', () => {
    const expected = [
      ...Object.keys(CONTRACT_SCHEMAS).map((id) => `${id}.schema.json`),
      'openapi.yaml',
      'constants.json',
    ];
    expect([...files.keys()].sort()).toEqual(expected.sort());
  });

  it('uses LF only and ends every file with exactly one newline', () => {
    for (const [name, content] of files) {
      expect(content, name).not.toContain('\r');
      expect(content.endsWith('\n'), name).toBe(true);
      expect(content.endsWith('\n\n'), name).toBe(false);
    }
  });

  it('leaves objects open: no additionalProperties false (plan D2)', () => {
    const offenders = [...files]
      .filter(([name]) => name.endsWith('.schema.json'))
      .filter(([, content]) => /"additionalProperties":\s*false/.test(content))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
    expect(Object.keys(buildJsonSchemas())).toEqual(Object.keys(CONTRACT_SCHEMAS));
  });

  it('AC-LIMITS-05: writes constants.json from the contract constants, caps included', () => {
    expect(JSON.parse(files.get('constants.json') ?? '')).toEqual({
      contractVersion: CONTRACT_VERSION,
      minPopulatedFields: 3,
      maxRequestBodyBytes: 1_048_576,
      maxMessageLength: 2000,
      maxShortTextLength: 100,
      maxNoteLength: 300,
      maxDateTextLength: 32,
      maxExperiences: 20,
      maxUnmappedExperiences: 10,
      maxPeople: 50,
    });
  });
});

describe('OpenAPI document', () => {
  const doc = buildOpenApi();

  it('declares OpenAPI 3.1.1 and the contract version', () => {
    expect(doc.openapi).toBe('3.1.1');
    expect((doc.info as { version: string }).version).toBe(CONTRACT_VERSION);
  });

  it('has the four v1 paths', () => {
    expect(Object.keys(doc.paths as object).sort()).toEqual([
      '/v1/health',
      '/v1/trip/extract',
      '/v1/trip/present',
      '/v1/trip/recommend',
    ]);
  });

  it('declares a 413 on every POST, and not on GET /v1/health', () => {
    const paths = doc.paths as Record<string, { post?: { responses: object } }>;
    for (const path of ['/v1/trip/extract', '/v1/trip/recommend', '/v1/trip/present']) {
      expect(paths[path]?.post?.responses, path).toHaveProperty('413');
    }
    expect(JSON.stringify(paths['/v1/health'])).not.toContain('413');
  });

  it('leaves LLM-only schemas out of components but keeps their JSON Schema files', () => {
    const { schemas } = doc.components as { schemas: Record<string, unknown> };
    for (const id of LLM_ONLY_IDS) {
      expect(schemas[id], id).toBeUndefined();
      expect(buildArtifacts().has(`${id}.schema.json`), id).toBe(true);
    }
    expect(schemas.PresentationModel).toBeDefined();
  });

  it('resolves every #/components $ref', () => {
    const refs = collectRefs(doc);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('#/components/'), ref).toBe(true);
      expect(resolve(doc, ref), ref).toBeDefined();
    }
  });

  it('serializes to YAML that parses back to the same document, without anchors', () => {
    const yaml = buildArtifacts().get('openapi.yaml') ?? '';
    expect(yaml).not.toMatch(/[:-]\s+[&*]\w+/);
    expect(parse(yaml)).toEqual(doc);
  });

  it('matches the committed openapi.yaml', () => {
    const onDisk = readFileSync(
      new URL('../../../spec/generated/openapi.yaml', import.meta.url),
      'utf8',
    );
    expect(parse(onDisk)).toEqual(doc);
  });
});
