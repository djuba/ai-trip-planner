import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCases } from './cases.ts';
import {
  appendRecord,
  caseSetHash,
  readRecords,
  RunRecord,
  sha256,
  summarize,
  type SummaryInput,
} from './record.ts';

const HASH = 'a'.repeat(64);

function input(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    date: '2026-11-13T10:00:00.000Z',
    commit: 'abc1234',
    dirty: false,
    models: { fast: 'claude-haiku-5-5', judge: 'claude-sonnet-5-5' },
    promptHash: HASH,
    caseSetHash: HASH,
    repeat: 2,
    judge: true,
    pricingAsOf: '2026-11-03',
    budgetUsd: 5,
    stoppedAtBudget: false,
    costUsd: 0.1234567891,
    scored: [
      {
        caseId: 'q1',
        set: 'quality',
        results: [
          { scorer: 'wireValid', pass: true },
          { scorer: 'expectations', pass: true },
        ],
      },
      {
        caseId: 'q1',
        set: 'quality',
        results: [
          { scorer: 'wireValid', pass: true },
          { scorer: 'expectations', pass: false, detail: 'status' },
        ],
      },
      {
        caseId: 'a1',
        set: 'adversarial',
        results: [{ scorer: 'canaryAbsent', pass: true }],
      },
    ],
    calls: [
      { model: 'claude-haiku-5-5', inputTokens: 100, outputTokens: 10 },
      { model: 'claude-haiku-5-5', inputTokens: 50, outputTokens: undefined },
      { model: 'claude-sonnet-5-5', inputTokens: undefined, outputTokens: 7 },
    ],
    ...overrides,
  };
}

describe('sha256', () => {
  it('AC-EVAL-09: is stable, and changes when any part changes', () => {
    const base = sha256(['system', 'template']);
    expect(sha256(['system', 'template'])).toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(['system!', 'template'])).not.toBe(base);
    expect(sha256(['system', 'template!'])).not.toBe(base);
    expect(sha256(['systemtemplate'])).not.toBe(base);
    expect(sha256(['system', 'template', ''])).not.toBe(base);
  });
});

describe('caseSetHash', () => {
  it('AC-EVAL-09: does not depend on input order, and changes with the cases', () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThan(1);
    const hash = caseSetHash(cases);
    expect(caseSetHash([...cases].reverse())).toBe(hash);
    expect(caseSetHash(cases.slice(1))).not.toBe(hash);
  });
});

describe('summarize', () => {
  it('AC-EVAL-09: has every field of the record', () => {
    const record = summarize(input());
    expect(Object.keys(record).sort()).toEqual(Object.keys(RunRecord.shape).sort());
    expect(record).toMatchObject({
      date: '2026-11-13T10:00:00.000Z',
      commit: 'abc1234',
      dirty: false,
      repeat: 2,
      judge: true,
      pricingAsOf: '2026-11-03',
      budgetUsd: 5,
      stoppedAtBudget: false,
    });
  });

  it('AC-EVAL-09: counts cases, runs, passes and failed scorers', () => {
    const record = summarize(input());
    expect(record.sets).toEqual({
      quality: {
        cases: 1,
        runs: 2,
        passedRuns: 1,
        notJudged: 0,
        scorers: { wireValid: { passed: 2, total: 2 }, expectations: { passed: 1, total: 2 } },
      },
      adversarial: {
        cases: 1,
        runs: 1,
        passedRuns: 1,
        notJudged: 0,
        scorers: { canaryAbsent: { passed: 1, total: 1 } },
      },
    });
    expect(record.cases).toEqual({
      q1: { set: 'quality', runs: 2, passedRuns: 1, notJudged: 0, failed: { expectations: 1 } },
      a1: { set: 'adversarial', runs: 1, passedRuns: 1, notJudged: 0, failed: {} },
    });
  });

  it('AC-EVAL-09: counts a not-judged run, and never counts it as passed', () => {
    const record = summarize(
      input({
        scored: [
          {
            caseId: 'a1',
            set: 'adversarial',
            results: [{ scorer: 'canaryAbsent', pass: true }],
            notJudged: true,
          },
        ],
      }),
    );
    expect(record.sets.adversarial).toMatchObject({ runs: 1, passedRuns: 0, notJudged: 1 });
    expect(record.cases.a1).toMatchObject({ runs: 1, passedRuns: 0, notJudged: 1 });
  });

  it('AC-EVAL-09: counts requests and tokens per model, and rounds the cost', () => {
    const record = summarize(input());
    expect(record.usage).toEqual({
      'claude-haiku-5-5': { requests: 2, inputTokens: 150, outputTokens: 10 },
      'claude-sonnet-5-5': { requests: 1, inputTokens: 0, outputTokens: 7 },
    });
    expect(record.costUsd).toBe(0.123457);
  });

  it('AC-EVAL-09: leaves out a set that did not run', () => {
    const record = summarize(input({ scored: [], calls: [] }));
    expect(record.sets).toEqual({});
    expect(record.cases).toEqual({});
    expect(record.usage).toEqual({});
  });

  it('AC-EVAL-09: refuses a record that does not fit the schema', () => {
    expect(() => summarize(input({ promptHash: 'short' }))).toThrow();
    expect(() => summarize(input({ date: 'today' }))).toThrow();
  });
});

describe('runs.jsonl', () => {
  let dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });
  const tmp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-record-'));
    dirs.push(dir);
    return dir;
  };

  it('AC-EVAL-11: appends one line per record and reads them back', () => {
    const path = join(tmp(), 'nested', 'runs.jsonl');
    const first = summarize(input());
    const second = summarize(input({ commit: 'def5678', stoppedAtBudget: true }));
    appendRecord(path, first);
    appendRecord(path, second);
    expect(readRecords(path)).toEqual([first, second]);
  });

  it('AC-EVAL-11: a missing file has no records', () => {
    expect(readRecords(join(tmp(), 'none.jsonl'))).toEqual([]);
  });

  it('AC-EVAL-11: a bad line is an error that names its line number', () => {
    const path = join(tmp(), 'runs.jsonl');
    appendRecord(path, summarize(input()));
    writeFileSync(path, `${JSON.stringify(summarize(input()))}\n\n{"date":1}\n`);
    expect(() => readRecords(path)).toThrow(/line 3/);
  });

  it('AC-EVAL-11: every committed line of results/runs.jsonl parses as a record', () => {
    const path = fileURLToPath(new URL('./results/runs.jsonl', import.meta.url));
    expect(() => readRecords(path)).not.toThrow();
  });
});
