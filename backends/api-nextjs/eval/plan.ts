// Decides whether and how `pnpm eval` runs, as a pure function so it can be unit-tested
// (WU-18 plan D3, D8). It builds no client and reads no files.
import { EVAL_SETS, type EvalSet } from './cases.ts';

export interface EvalPlan {
  budgetUsd: number;
  repeat: number;
  sets: EvalSet[];
  caseIds: string[];
  judge: boolean;
}

export class EvalPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalPlanError';
  }
}

function isSet(value: string): value is EvalSet {
  return (EVAL_SETS as readonly string[]).includes(value);
}

/**
 * The sets a plain `pnpm eval` runs. A recommend run's worst case is about US$2.80 (12 Sonnet calls
 * at their `maxOutputTokens`), so that set runs only when named with `--set`, or by `--case` id.
 */
export const DEFAULT_EVAL_SETS: readonly EvalSet[] = ['quality', 'adversarial'];

export function planEval(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): EvalPlan {
  if (env.npm_lifecycle_event !== 'eval') {
    throw new EvalPlanError('the eval calls a live model and costs money: run it as `pnpm eval`');
  }

  let budget: string | undefined;
  let repeat = 3;
  const chosen = new Set<EvalSet>();
  const caseIds: string[] = [];
  let judge = true;

  /** Value of `--name value` or `--name=value`; advances past the value in the first form. */
  const take = (arg: string, name: string, i: number): { value: string | undefined; i: number } =>
    arg === name ? { value: argv[i + 1], i: i + 1 } : { value: arg.slice(name.length + 1), i };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const name = arg.startsWith('--') ? (arg.split('=')[0] as string) : arg;
    if (arg === '--no-judge') {
      judge = false;
    } else if (name === '--budget') {
      const t = take(arg, name, i);
      i = t.i;
      budget = t.value;
    } else if (name === '--repeat') {
      const t = take(arg, name, i);
      i = t.i;
      if (t.value === undefined || !/^[1-9]\d*$/.test(t.value)) {
        throw new EvalPlanError(
          `--repeat must be a positive integer (got ${t.value ?? 'nothing'})`,
        );
      }
      repeat = Number(t.value);
    } else if (name === '--set') {
      const t = take(arg, name, i);
      i = t.i;
      if (t.value === undefined || !isSet(t.value)) {
        throw new EvalPlanError(
          `--set must be one of ${EVAL_SETS.join(', ')} (got ${t.value ?? 'nothing'})`,
        );
      }
      chosen.add(t.value);
    } else if (name === '--case') {
      const t = take(arg, name, i);
      i = t.i;
      if (t.value === undefined || t.value === '') {
        throw new EvalPlanError('--case needs a case id');
      }
      caseIds.push(t.value);
    } else {
      throw new EvalPlanError(`unknown argument: ${arg}`);
    }
  }

  if (budget === undefined || budget.trim() === '') {
    throw new EvalPlanError('--budget <usd> is required: the most the run may spend');
  }
  const budgetUsd = Number(budget);
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    throw new EvalPlanError(`--budget must be a positive number of dollars (got ${budget})`);
  }
  if (!env.ANTHROPIC_API_KEY?.trim()) {
    throw new EvalPlanError('ANTHROPIC_API_KEY is not set');
  }

  return {
    budgetUsd,
    repeat,
    sets: EVAL_SETS.filter((set) =>
      chosen.size > 0 ? chosen.has(set) : caseIds.length > 0 || DEFAULT_EVAL_SETS.includes(set),
    ),
    caseIds,
    judge,
  };
}
