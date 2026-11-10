import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCassetteDir, type Workspace } from './cassette-dir.ts';

const ROOT = resolve('/repo');
const nested: Workspace = {
  cwd: join(ROOT, 'backends', 'api-nextjs'),
  exists: (path) => path === join(ROOT, 'pnpm-workspace.yaml'),
};
const outside: Workspace = { cwd: resolve('/elsewhere'), exists: () => false };

describe('resolveCassetteDir', () => {
  it('AC-LLM-18: defaults to <workspace root>/.llm-cassettes/api-nextjs from a nested cwd', () => {
    expect(resolveCassetteDir(undefined, nested)).toBe(join(ROOT, '.llm-cassettes', 'api-nextjs'));
  });

  it('AC-LLM-18: LLM_CASSETTE_DIR wins, resolved against the cwd', () => {
    expect(resolveCassetteDir('tapes', nested)).toBe(join(ROOT, 'backends', 'api-nextjs', 'tapes'));
    expect(resolveCassetteDir('tapes', outside)).toBe(resolve('/elsewhere', 'tapes'));
  });

  it('AC-LLM-18: no workspace root and no LLM_CASSETTE_DIR is an error naming the variable', () => {
    expect(() => resolveCassetteDir(undefined, outside)).toThrow(/LLM_CASSETTE_DIR/);
  });

  it('AC-LLM-18: the real process workspace resolves to this repo', () => {
    expect(resolveCassetteDir(undefined)).toMatch(/\.llm-cassettes[\\/]api-nextjs$/);
  });
});
