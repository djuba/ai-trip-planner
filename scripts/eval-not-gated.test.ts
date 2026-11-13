import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const NAMES_EVAL = /\bpnpm\s+(run\s+)?eval\b|eval\/run\.ts/;

describe('the eval stays out of every gate', () => {
  const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('AC-EVAL-10: only the eval script names the runner', () => {
    expect(pkg.scripts.eval).toBe('node backends/api-nextjs/eval/run.ts');
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (name === 'eval') continue;
      expect(command, `script ${name}`).not.toMatch(NAMES_EVAL);
    }
  });

  it('AC-EVAL-10: lefthook.yml does not run it', () => {
    expect(readFileSync(`${root}lefthook.yml`, 'utf8')).not.toMatch(NAMES_EVAL);
  });

  it('AC-EVAL-10: no CI workflow runs it', () => {
    const dir = `${root}.github/workflows/`;
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(`${dir}${file}`, 'utf8'), file).not.toMatch(NAMES_EVAL);
    }
  });
});
