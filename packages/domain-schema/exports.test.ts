import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('package.json exports (CLAUDE.md §4.2)', () => {
  it('exposes exactly ./wire and ./rules', () => {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
      exports: unknown;
    };
    expect(pkg.exports).toEqual({
      './wire': './src/wire/index.ts',
      './rules': './src/rules/index.ts',
    });
  });
});
