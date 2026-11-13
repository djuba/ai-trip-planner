import { describe, expect, it } from 'vitest';
import { EvalPlanError, planEval } from './plan.ts';

const env = { npm_lifecycle_event: 'eval', ANTHROPIC_API_KEY: 'sk-test' };

describe('planEval', () => {
  it('AC-EVAL-01: defaults to 3 repeats, both sets, all cases, judged', () => {
    expect(planEval(['--budget', '5'], env)).toEqual({
      budgetUsd: 5,
      repeat: 3,
      sets: ['quality', 'adversarial'],
      caseIds: [],
      judge: true,
    });
  });

  it('AC-EVAL-01: reads every flag, in both value forms', () => {
    expect(
      planEval(
        [
          '--budget=0.5',
          '--repeat',
          '2',
          '--set=adversarial',
          '--case',
          'a',
          '--case=b',
          '--no-judge',
        ],
        env,
      ),
    ).toEqual({
      budgetUsd: 0.5,
      repeat: 2,
      sets: ['adversarial'],
      caseIds: ['a', 'b'],
      judge: false,
    });
  });

  it('AC-EVAL-01: --set repeats and keeps the EVAL_SETS order', () => {
    expect(
      planEval(['--budget', '1', '--set', 'adversarial', '--set', 'quality'], env).sets,
    ).toEqual(['quality', 'adversarial']);
  });

  it('AC-EVAL-01: refuses a run that is not `pnpm eval`', () => {
    expect(() => planEval(['--budget', '5'], { ANTHROPIC_API_KEY: 'k' })).toThrow(/pnpm eval/);
    expect(() =>
      planEval(['--budget', '5'], { ANTHROPIC_API_KEY: 'k', npm_lifecycle_event: 'test' }),
    ).toThrow(EvalPlanError);
  });

  it('AC-EVAL-01: refuses a missing budget', () => {
    expect(() => planEval([], env)).toThrow(/--budget/);
    expect(() => planEval(['--budget'], env)).toThrow(/--budget/);
  });

  it.each(['0', '-1', 'abc', 'NaN', 'Infinity'])('AC-EVAL-01: refuses the budget %s', (value) => {
    expect(() => planEval(['--budget', value], env)).toThrow(/positive number/);
  });

  it('AC-EVAL-01: refuses a missing or blank API key', () => {
    expect(() => planEval(['--budget', '5'], { npm_lifecycle_event: 'eval' })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() =>
      planEval(['--budget', '5'], { npm_lifecycle_event: 'eval', ANTHROPIC_API_KEY: '  ' }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it.each(['0', '-2', '1.5', 'x'])('AC-EVAL-01: refuses --repeat %s', (value) => {
    expect(() => planEval(['--budget', '5', '--repeat', value], env)).toThrow(/--repeat/);
  });

  it('AC-EVAL-01: refuses an unknown set, a bare --case, unknown flags and stray arguments', () => {
    expect(() => planEval(['--budget', '5', '--set', 'other'], env)).toThrow(/--set/);
    expect(() => planEval(['--budget', '5', '--set'], env)).toThrow(/--set/);
    expect(() => planEval(['--budget', '5', '--case'], env)).toThrow(/--case/);
    expect(() => planEval(['--budget', '5', '--live'], env)).toThrow(/unknown argument/);
    expect(() => planEval(['--budget', '5', 'extra'], env)).toThrow(/unknown argument/);
    expect(() => planEval(['--budget', '5', '--no-judge=1'], env)).toThrow(/unknown argument/);
  });
});
