import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateRules } from '@vp/domain-schema/rules';
import { ATTACKS, CaseLoadError, EVAL_SETS, loadCases, parseCase } from './cases.ts';

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
  mkdirSync(join(dir, 'recommend'));
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

  it('AC-EVAL-12: the recommend set has the four planned cases, all with ready profiles', () => {
    expect(EVAL_SETS).toContain('recommend');
    const recommend = loadCases().filter((c) => c.set === 'recommend');
    expect(recommend.map((c) => c.id).sort()).toEqual([
      'recommend-complete',
      'recommend-gender-url',
      'recommend-region-canary',
      'recommend-unmapped-verified',
    ]);
    for (const c of recommend) {
      expect(evaluateRules(c.request.profile, c.request.referenceDate)).toEqual([]);
      expect(c.kind === 'adversarial').toBe(c.expect.canaries !== undefined);
    }
  });

  it('AC-EVAL-12: an adversarial recommend case needs canaries; minRecommendations defaults to 1', () => {
    const recommend = {
      id: 'r-case',
      set: 'recommend',
      kind: 'adversarial',
      description: 'd',
      request: { profile: {}, referenceDate: '2030-01-15' },
      expect: {},
    };
    expect(() => parseCase('recommend/r-case.json', JSON.stringify(recommend))).toThrow(
      /needs expect\.canaries/,
    );
    const quality = parseCase(
      'recommend/r-case.json',
      JSON.stringify({ ...recommend, kind: 'quality' }),
    );
    expect(quality.set === 'recommend' && quality.expect.minRecommendations).toBe(1);
    const zero = { ...recommend, kind: 'quality', expect: { minRecommendations: 0 } };
    expect(() => parseCase('x.json', JSON.stringify(zero))).toThrow();
  });

  it('AC-EVAL-12: a recommend case must sit in recommend/', () => {
    const recommend = {
      id: 'r-case',
      set: 'recommend',
      kind: 'quality',
      description: 'd',
      request: { profile: {}, referenceDate: '2030-01-15' },
      expect: {},
    };
    expect(() => loadCases(caseDir({ 'quality/r-case.json': recommend }))).toThrow(
      /set is "recommend"/,
    );
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
