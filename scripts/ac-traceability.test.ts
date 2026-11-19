// Every acceptance criterion in docs/features/ is proven by a test, and every AC a test names is
// defined there (CLAUDE.md §6.2; docs/features/docs.md, AC-DOCS-03/04, which says what counts).
// Files only: it reads the files git tracks or would track (not ignored), and runs no test.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const DEFINITION = /^(?:- )?\*\*(AC-[A-Z]+-\d+)(?:[:.]\*\*|\*\*)/;
const OUTSIDE_MARKER = /_\(Proven outside the test suite: .+\)_\s*$/;
// A number that runs into `${` is a template, such as `AC-X-0${n}`, and names no AC.
const ID = /\bAC-[A-Z]+-\d+(?![\d$])/g;
const isTest = (f: string): boolean =>
  !f.startsWith('spikes/') &&
  (/\.(test|spec)\.tsx?$/.test(f) ||
    /^(?:(?:.+\/)?tests\/(?:.+\/)?support|scripts\/test-support)\/.+\.tsx?$/.test(f));

/** The ACs a feature doc defines, and whether each is marked as proven outside the suite. */
function definitions(markdown: string): { id: string; outside: boolean }[] {
  return markdown.split('\n').flatMap((line) => {
    const id = DEFINITION.exec(line)?.[1];
    return id === undefined ? [] : [{ id, outside: OUTSIDE_MARKER.test(line) }];
  });
}

/** The AC IDs in TS source once block comments and whole-line `//` comments are dropped. */
function namedInSource(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  return code.match(ID) ?? [];
}

const git = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
const files = execFileSync('git', git, { cwd: root, encoding: 'utf8' }).split('\0');
const read = (file: string): string => readFileSync(resolve(root, file), 'utf8');

const defined = files
  .filter((f) => /^docs\/features\/[^/]+\.md$/.test(f))
  .flatMap((file) => definitions(read(file)).map((d) => ({ ...d, file })));
const named = new Map<string, string>();
for (const file of files.filter(isTest)) {
  for (const id of namedInSource(read(file))) named.set(id, file);
}
for (const file of files.filter((f) => /^spec\/fixtures\/rules\/[^/]+\.json$/.test(f))) {
  for (const { ac } of JSON.parse(read(file)) as { ac?: string }[]) if (ac) named.set(ac, file);
}

describe('acceptance-criteria traceability', () => {
  it('AC-DOCS-03: the feature docs define ACs, each ID once', () => {
    expect(defined.length).toBeGreaterThan(200);
    const ids = defined.map((d) => d.id);
    expect(defined.filter((d, i) => ids.indexOf(d.id) !== i)).toEqual([]);
  });

  it('AC-DOCS-03: every AC in docs/features/ is proven by a test, or marked as proven outside it', () => {
    expect(defined.filter((d) => !d.outside && !named.has(d.id))).toEqual([]);
  });

  it('AC-DOCS-03: no AC marked as proven outside the test suite is named by a test', () => {
    expect(defined.filter((d) => d.outside && named.has(d.id))).toEqual([]);
  });

  it('AC-DOCS-04: every AC a test or rule fixture names is defined in docs/features/', () => {
    const ids = new Set(defined.map((d) => d.id));
    expect([...named].filter(([id]) => !ids.has(id)).map(([id, f]) => `${id} (${f})`)).toEqual([]);
  });

  it('AC-DOCS-03: the scanner reads definitions and markers, and skips comments', () => {
    // Sample IDs are spelled with `_` and fixed up here, so this file's own scan doesn't see them.
    const ac = (text: string): string => text.replaceAll('AC_', 'AC-');
    const doc = '- **AC_A-01:** x.\n**AC_A-02.** x _(Proven outside the test suite: y.)_\nAC_A-03';
    expect(definitions(ac(doc))).toEqual([
      { id: ac('AC_A-01'), outside: false },
      { id: ac('AC_A-02'), outside: true },
    ]);
    const source = "// AC_B-01\n/* AC_B-02 */\nit('AC_B-03: t', f); // AC_B-04\n`AC_B-0${n}`";
    expect(namedInSource(ac(source))).toEqual([ac('AC_B-03'), ac('AC_B-04')]);
  });
});
