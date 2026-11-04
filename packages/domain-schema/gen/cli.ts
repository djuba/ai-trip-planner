// `gen` writes generated/ from the wire schemas; `gen --check` is the drift check in `pnpm verify`
// (WU-04 plan D12). The check compares in memory, so it needs no git and changes nothing.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArtifacts } from './artifacts.ts';

export const GENERATED_DIR = fileURLToPath(new URL('../generated/', import.meta.url));

export interface Drift {
  missing: string[];
  changed: string[];
  stale: string[];
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function diffGenerated(dir: string, expected: Map<string, string>): Promise<Drift> {
  const onDisk = new Set(await listFiles(dir));
  const drift: Drift = { missing: [], changed: [], stale: [] };
  for (const [name, content] of expected) {
    if (!onDisk.has(name)) drift.missing.push(name);
    else if ((await readFile(join(dir, name), 'utf8')) !== content) drift.changed.push(name);
  }
  drift.stale = [...onDisk].filter((name) => !expected.has(name)).sort();
  return drift;
}

export const hasDrift = (d: Drift): boolean =>
  d.missing.length + d.changed.length + d.stale.length > 0;

export async function writeGenerated(dir: string, expected: Map<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const name of await listFiles(dir)) {
    if (!expected.has(name)) await rm(join(dir, name));
  }
  for (const [name, content] of expected) await writeFile(join(dir, name), content, 'utf8');
}

export function formatDrift(d: Drift): string {
  const lines = [
    ...d.missing.map((n) => `  missing: ${n}`),
    ...d.changed.map((n) => `  changed: ${n}`),
    ...d.stale.map((n) => `  stale:   ${n}`),
  ];
  return `generated/ is out of date with src/wire:\n${lines.join('\n')}\nRun \`pnpm --filter @vp/domain-schema gen\` and commit the result.`;
}

async function main(argv: readonly string[]): Promise<number> {
  const expected = buildArtifacts();
  if (argv.includes('--check')) {
    const drift = await diffGenerated(GENERATED_DIR, expected);
    if (hasDrift(drift)) {
      console.error(formatDrift(drift));
      return 1;
    }
    console.log(`generated/ is up to date (${expected.size} files).`);
    return 0;
  }
  await writeGenerated(GENERATED_DIR, expected);
  console.log(`Wrote ${expected.size} files to generated/.`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
