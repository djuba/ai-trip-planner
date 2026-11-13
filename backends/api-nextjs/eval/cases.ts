// Eval cases (WU-18 plan D4): one JSON file per case under eval/cases/<set>/, parsed here at load.
// The request goes through the wire ExtractRequest schema, so a case can't drift from the contract
// (CLAUDE.md §6.1).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExtractRequest, RuleCode } from '@vp/domain-schema/wire';
import { z } from 'zod';

export const CASES_DIR = fileURLToPath(new URL('./cases/', import.meta.url));

/** A JSON Pointer into the response profile, e.g. `/people/2/age`. */
const Pointer = z.string().regex(/^(\/[^/]+)+$/);
const Strings = z.array(z.string().min(1)).min(1);

/**
 * A check on one value of the response profile. String comparisons ignore case.
 * - `equals`: deep equality.
 * - `includesAny`: a string field contains at least one of `values`.
 * - `absent`: the field is missing.
 * - `length`: an array has exactly `value` items.
 * - `contains` / `excludes`: an array has every / none of `values`.
 * - `anyItemIncludes`: some string item of an array contains one of `values`.
 */
export const FieldCheck = z.discriminatedUnion('op', [
  z.strictObject({ path: Pointer, op: z.literal('equals'), value: z.unknown() }),
  z.strictObject({ path: Pointer, op: z.literal('includesAny'), values: Strings }),
  z.strictObject({ path: Pointer, op: z.literal('absent') }),
  z.strictObject({ path: Pointer, op: z.literal('length'), value: z.int().nonnegative() }),
  z.strictObject({ path: Pointer, op: z.literal('contains'), values: Strings }),
  z.strictObject({ path: Pointer, op: z.literal('excludes'), values: Strings }),
  z.strictObject({ path: Pointer, op: z.literal('anyItemIncludes'), values: Strings }),
]);
export type FieldCheck = z.infer<typeof FieldCheck>;

const Status = z.enum(['ready', 'needs_clarification']);

const common = {
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  description: z.string().min(1),
  /** The extraction AC the case draws on, if any. */
  ac: z
    .string()
    .regex(/^AC-[A-Z]+-\d+$/)
    .optional(),
  request: ExtractRequest,
};

export const QualityCase = z.strictObject({
  ...common,
  set: z.literal('quality'),
  expect: z.strictObject({
    status: Status.optional(),
    /** Exact and in order, when given. */
    violationCodes: z.array(RuleCode).optional(),
    fields: z.array(FieldCheck).default([]),
  }),
});
export type QualityCase = z.infer<typeof QualityCase>;

export const ATTACKS = [
  'message-field',
  'message-question',
  'profile-planted',
  'off-topic',
  'over-cap',
  'block-escape',
] as const;
export const Attack = z.enum(ATTACKS);
export type Attack = z.infer<typeof Attack>;

export const AdversarialCase = z.strictObject({
  ...common,
  set: z.literal('adversarial'),
  attack: Attack,
  expect: z.strictObject({
    /** Text the attack asks the model to emit; any appearance in output means it was fooled. */
    canaries: Strings,
    status: Status.optional(),
    fields: z.array(FieldCheck).default([]),
  }),
});
export type AdversarialCase = z.infer<typeof AdversarialCase>;

export const EvalCase = z.discriminatedUnion('set', [QualityCase, AdversarialCase]);
export type EvalCase = z.infer<typeof EvalCase>;
export type EvalSet = EvalCase['set'];
export const EVAL_SETS = ['quality', 'adversarial'] as const satisfies readonly EvalSet[];

export class CaseLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseLoadError';
  }
}

/** Parses one case file's text. `file` names it in errors. */
export function parseCase(file: string, text: string): EvalCase {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new CaseLoadError(`${file}: not JSON (${(error as Error).message})`);
  }
  const result = EvalCase.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new CaseLoadError(`${file}: ${issues}`);
  }
  return result.data;
}

/**
 * Every case under `dir`, sorted by set then id. A case's `set` must match its folder, and ids are
 * unique across sets.
 */
export function loadCases(dir: string = CASES_DIR): EvalCase[] {
  const cases: EvalCase[] = [];
  const seen = new Set<string>();
  for (const set of EVAL_SETS) {
    const folder = join(dir, set);
    const files = readdirSync(folder)
      .filter((name) => name.endsWith('.json'))
      .sort();
    for (const name of files) {
      const file = `${set}/${name}`;
      const evalCase = parseCase(file, readFileSync(join(folder, name), 'utf8'));
      if (evalCase.set !== set) {
        throw new CaseLoadError(`${file}: set is "${evalCase.set}", but it is in ${set}/`);
      }
      if (`${evalCase.id}.json` !== name) {
        throw new CaseLoadError(`${file}: id "${evalCase.id}" must match the file name`);
      }
      if (seen.has(evalCase.id)) throw new CaseLoadError(`${file}: duplicate id ${evalCase.id}`);
      seen.add(evalCase.id);
      cases.push(evalCase);
    }
  }
  return cases;
}
