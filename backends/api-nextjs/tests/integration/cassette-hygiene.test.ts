// Cassettes are committed to a public repo, so none may carry key material or account identifiers
// (CLAUDE.md §8.2, §9; WU-08 DoD). Runs on every `pnpm verify`, so later recordings stay clean too.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CASSETTE_RESPONSE_HEADERS } from '../../src/llm/cassette-fetch.ts';

const ROOT = fileURLToPath(new URL('../../../../.llm-cassettes/', import.meta.url));
const FORBIDDEN = [
  /sk-ant-/i,
  /x-api-key/i,
  /anthropic-organization-id/i,
  /anthropic-workspace-id/i,
  /authorization/i,
];

function files(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

const cassettes = files(ROOT);

describe('cassette hygiene', () => {
  it('AC-LLM-15: there is at least one committed cassette to check', () => {
    expect(cassettes.length).toBeGreaterThan(0);
  });

  it.each(cassettes.map((file) => [relative(ROOT, file), file]))(
    'AC-LLM-15: %s holds no key material, account IDs or non-allowlisted headers',
    (_, file) => {
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern);

      const cassette = JSON.parse(text) as {
        request: Record<string, unknown>;
        response: { headers: Record<string, string> };
      };
      expect(cassette.request).not.toHaveProperty('headers');
      for (const name of Object.keys(cassette.response.headers)) {
        expect(CASSETTE_RESPONSE_HEADERS).toContain(name.toLowerCase());
      }
    },
  );
});
