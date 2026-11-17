import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KEPT_MARKERS, afterAllPass, cassettesToPrune, type CassetteFile } from './prune.ts';

const DIR = fileURLToPath(new URL('../../.llm-cassettes/api-nextjs/', import.meta.url));

describe('cassettesToPrune', () => {
  const files: CassetteFile[] = [
    { key: 'used', requestBody: '"a"' },
    { key: 'unused', requestBody: '"b"' },
    { key: 'marked', requestBody: '"say Somewhere warm, maybe. please"' },
  ];

  it('AC-JOURNEY-09: deletes only cassettes that are neither replayed nor marked', () => {
    expect(cassettesToPrune(files, new Set(['used']), ['Somewhere warm, maybe.'])).toEqual([
      'unused',
    ]);
  });

  it('AC-JOURNEY-09: deletes everything unused when there are no markers', () => {
    expect(cassettesToPrune(files, new Set(), [])).toEqual(['used', 'unused', 'marked']);
  });

  it('AC-JOURNEY-09: keeps every committed cassette that matches a kept marker', () => {
    const real: CassetteFile[] = readdirSync(DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({
        key: name.slice(0, -'.json'.length),
        requestBody: JSON.stringify(
          (JSON.parse(readFileSync(join(DIR, name), 'utf8')) as { request: { body: unknown } })
            .request.body,
        ),
      }));
    const matching = real.filter((f) => KEPT_MARKERS.some((m) => f.requestBody.includes(m)));
    expect(matching.length).toBeGreaterThan(0);
    const pruned = cassettesToPrune(real, new Set());
    for (const file of matching) expect(pruned).not.toContain(file.key);
  });
});

describe('afterAllPass', () => {
  it('AC-JOURNEY-09: prunes only after every suite exits 0', async () => {
    const ran: string[] = [];
    const suite = (name: string, code: number) => () => {
      ran.push(name);
      return Promise.resolve(code);
    };
    const prune = () => {
      ran.push('prune');
      return 0;
    };
    await expect(afterAllPass([suite('a', 0), suite('b', 0)], prune)).resolves.toBe(0);
    expect(ran).toEqual(['a', 'b', 'prune']);
  });

  it('AC-JOURNEY-09: a failed suite deletes nothing, stops the run and returns its code', async () => {
    const ran: string[] = [];
    let failures = 0;
    const suite = (name: string, code: number) => () => {
      ran.push(name);
      return Promise.resolve(code);
    };
    const prune = () => {
      ran.push('prune');
      return 0;
    };
    const code = await afterAllPass([suite('a', 0), suite('b', 3), suite('c', 0)], prune, () => {
      failures += 1;
    });
    expect(code).toBe(3);
    expect(ran).toEqual(['a', 'b']);
    expect(failures).toBe(1);
  });
});
