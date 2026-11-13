import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ATTACKS, CaseLoadError, loadCases, parseCase } from './cases.ts';

const valid = {
  id: 'some-case',
  set: 'quality',
  description: 'A case.',
  request: { message: 'Somewhere warm.', referenceDate: '2030-01-15' },
  expect: { status: 'needs_clarification', fields: [{ path: '/climate', op: 'absent' }] },
};

let dirs: string[] = [];
afterEach(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  dirs = [];
});

function caseDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'eval-cases-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'quality'));
  mkdirSync(join(dir, 'adversarial'));
  for (const [path, value] of Object.entries(files)) {
    writeFileSync(join(dir, path), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return dir;
}

describe('eval cases', () => {
  it('AC-EVAL-06: every committed case file parses, with unique ids matching file names', () => {
    const cases = loadCases();
    const quality = cases.filter((c) => c.set === 'quality');
    const adversarial = cases.filter((c) => c.set === 'adversarial');
    expect(quality.length).toBeGreaterThanOrEqual(12);
    expect(adversarial.length).toBeGreaterThanOrEqual(10);
    // Every attack kind has a case, and at least one tries to land over-cap text (WU-09 Note).
    expect(new Set(adversarial.map((c) => c.attack))).toEqual(new Set(ATTACKS));
  });

  it('AC-EVAL-06: every extraction AC from 01 to 06 has a quality case', () => {
    const acs = new Set(loadCases().flatMap((c) => (c.ac ? [c.ac] : [])));
    for (const n of [1, 2, 3, 4, 5, 6]) expect(acs).toContain(`AC-EXTRACT-0${n}`);
  });

  it('AC-EVAL-06: a request the wire rejects fails at load', () => {
    const bad = { ...valid, request: { message: '', referenceDate: 'tomorrow' } };
    expect(() => parseCase('quality/some-case.json', JSON.stringify(bad))).toThrow(CaseLoadError);
  });

  it('AC-EVAL-06: an unknown matcher or field fails at load', () => {
    const bad = { ...valid, expect: { fields: [{ path: '/region', op: 'roughly' }] } };
    expect(() => parseCase('x.json', JSON.stringify(bad))).toThrow(/x\.json/);
    expect(() => parseCase('x.json', JSON.stringify({ ...valid, extra: 1 }))).toThrow();
  });

  it('AC-EVAL-06: text that is not JSON fails at load, naming the file', () => {
    expect(() => parseCase('quality/broken.json', '{')).toThrow(/quality\/broken\.json: not JSON/);
  });

  it('AC-EVAL-06: a case in the wrong folder, a mismatched id or a duplicate id fails', () => {
    expect(() => loadCases(caseDir({ 'adversarial/some-case.json': valid }))).toThrow(
      /set is "quality"/,
    );
    expect(() => loadCases(caseDir({ 'quality/other.json': valid }))).toThrow(
      /match the file name/,
    );
    const twin = { ...valid, set: 'adversarial', attack: 'off-topic', expect: { canaries: ['x'] } };
    expect(() =>
      loadCases(caseDir({ 'quality/some-case.json': valid, 'adversarial/some-case.json': twin })),
    ).toThrow(/duplicate id/);
  });

  it('loads sets in order, files sorted, ignoring non-JSON files', () => {
    const dir = caseDir({
      'quality/b-case.json': { ...valid, id: 'b-case' },
      'quality/a-case.json': { ...valid, id: 'a-case' },
      'quality/notes.txt': 'ignored',
    });
    expect(loadCases(dir).map((c) => c.id)).toEqual(['a-case', 'b-case']);
  });
});
