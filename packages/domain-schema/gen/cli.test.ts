import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildArtifacts } from './artifacts.ts';
import { diffGenerated, formatDrift, hasDrift, writeGenerated } from './cli.ts';

describe('gen drift check', () => {
  const expected = buildArtifacts();
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vp-gen-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const someFile = (): string => [...expected.keys()][0] ?? '';

  it('reports no drift after writeGenerated', async () => {
    await writeGenerated(dir, expected);
    const drift = await diffGenerated(dir, expected);
    expect(drift).toEqual({ missing: [], changed: [], stale: [] });
    expect(hasDrift(drift)).toBe(false);
  });

  it('reports a changed file', async () => {
    await writeGenerated(dir, expected);
    await writeFile(join(dir, someFile()), 'hand edit\n', 'utf8');
    const drift = await diffGenerated(dir, expected);
    expect(drift.changed).toEqual([someFile()]);
    expect(hasDrift(drift)).toBe(true);
  });

  it('reports a deleted file as missing', async () => {
    await writeGenerated(dir, expected);
    await rm(join(dir, someFile()));
    expect((await diffGenerated(dir, expected)).missing).toEqual([someFile()]);
  });

  it('reports an extra file as stale, and writeGenerated removes it', async () => {
    await writeGenerated(dir, expected);
    await writeFile(join(dir, 'Old.schema.json'), '{}\n', 'utf8');
    expect((await diffGenerated(dir, expected)).stale).toEqual(['Old.schema.json']);
    await writeGenerated(dir, expected);
    expect(await readdir(dir)).not.toContain('Old.schema.json');
    expect(hasDrift(await diffGenerated(dir, expected))).toBe(false);
  });

  it('ignores subdirectories when listing', async () => {
    await writeGenerated(dir, expected);
    await mkdir(join(dir, 'sub'));
    expect(hasDrift(await diffGenerated(dir, expected))).toBe(false);
  });

  it('reports everything missing for a nonexistent directory', async () => {
    const drift = await diffGenerated(join(dir, 'nope'), expected);
    expect(drift.missing.sort()).toEqual([...expected.keys()].sort());
    expect(drift.changed).toEqual([]);
    expect(drift.stale).toEqual([]);
  });

  it('formats drift naming each file and the fix command', () => {
    const text = formatDrift({ missing: ['a.json'], changed: ['b.json'], stale: ['c.json'] });
    for (const name of ['a.json', 'b.json', 'c.json']) expect(text).toContain(name);
    expect(text).toContain('pnpm --filter @vp/domain-schema gen');
  });
});
