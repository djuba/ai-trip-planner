// The README demo recording (`pnpm record:demo`) is not a test: it needs ffmpeg, sleeps on purpose
// and writes a committed asset. So no gate may run it, and the journeys' own config never picks
// up its spec.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8');
const NAMES_DEMO = /record:demo|record-demo\.ts|demo\.config\.ts/;

describe('the README demo recording stays out of every gate', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

  it('only the record:demo script names it', () => {
    expect(pkg.scripts['record:demo']).toBe('node scripts/record-demo.ts');
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (name === 'record:demo') continue;
      expect(command, `script ${name}`).not.toMatch(NAMES_DEMO);
    }
  });

  it('neither lefthook.yml nor any CI workflow runs it', () => {
    expect(read('lefthook.yml')).not.toMatch(NAMES_DEMO);
    const dir = '.github/workflows/';
    for (const file of readdirSync(`${root}${dir}`).filter((f) => /\.ya?ml$/.test(f))) {
      expect(read(`${dir}${file}`), file).not.toMatch(NAMES_DEMO);
    }
  });

  it('the journeys config looks only in specs/, and the demo is not a .spec.ts file', () => {
    const config = read('tests/journeys/playwright.config.ts');
    expect(config).toMatch(/testDir:\s*'specs'/);
    expect(config).toMatch(/testMatch:\s*'\*\*\/\*\.spec\.ts'/);
    const demos = readdirSync(`${root}tests/journeys/demo`);
    expect(demos.length).toBeGreaterThan(0);
    for (const name of demos) expect(name, name).not.toMatch(/\.spec\.ts$/);
  });
});
