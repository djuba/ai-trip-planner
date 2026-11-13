// The extract use case over the real adapter with a mock model (CLAUDE.md §6.3): the refusal
// check, the one retry and both safeParses run for real; only the model is fake.
import {
  ClarificationOutput,
  ExtractionSchema,
  ExtractResponse,
  MAX_CLARIFICATION_QUESTION_LENGTH,
  MAX_SHORT_TEXT_LENGTH,
} from '@vp/domain-schema/wire';
import type { Discarded } from '@vp/domain-schema/rules';
import { describe, expect, it } from 'vitest';
import {
  createMockLlmClient,
  mockObject,
  mockRaw,
  mockRefusal,
  type LlmCallLog,
  type MockResponder,
} from '../llm/index.ts';
import { extractTrip } from './extract.ts';
import type { LlmObjectRequest, LlmStage } from './llm-client.ts';
import { CLARIFY_MAX_OUTPUT_TOKENS, EXTRACT_MAX_OUTPUT_TOKENS } from './token-budget.ts';

const REFERENCE_DATE = '2030-01-15';

const EMPTY: ExtractionSchema = {
  departure: null,
  dateRange: null,
  region: null,
  climate: null,
  experiences: null,
  unmappedExperiences: null,
  people: null,
};

const COMPLETE: ExtractionSchema = {
  ...EMPTY,
  departure: { city: 'Minneapolis', mode: 'plane', maxStops: 0 },
  dateRange: { kind: 'fixed', start: '2030-02-10', end: '2030-02-17' },
  region: 'Hawaii',
  experiences: ['beach', 'snorkeling'],
  unmappedExperiences: ['cooking class'],
  people: [
    { userType: 'adult', age: 40, gender: null },
    { userType: 'adult', age: 38, gender: null },
  ],
};

const extraction = (value: ExtractionSchema) => mockObject(ExtractionSchema, value);
const question = (text: string) => mockObject(ClarificationOutput, { question: text });

function setup(responders: Partial<Record<LlmStage, MockResponder>>) {
  const requests: LlmObjectRequest<unknown>[] = [];
  const logs: LlmCallLog[] = [];
  const discarded: Discarded[] = [];
  const recording = Object.fromEntries(
    Object.entries(responders).map(([stage, responder]) => [
      stage,
      (request: LlmObjectRequest<unknown>, attempt: number) => {
        requests.push(request);
        return typeof responder === 'function' ? responder(request, attempt) : responder;
      },
    ]),
  );
  const llm = createMockLlmClient(recording, { log: (entry) => logs.push(entry), now: () => 0 });
  const run = (message = 'A week in Hawaii') =>
    extractTrip(
      { message, referenceDate: REFERENCE_DATE },
      { llm, logDiscarded: (entry) => discarded.push(entry) },
    );
  return { run, requests, logs, discarded };
}

describe('extractTrip', () => {
  it('AC-EXTRACT-01: a complete extraction is ready, with the normalized profile and no clarify call', async () => {
    const { run, requests } = setup({ extract: extraction(COMPLETE) });

    const response = await run();

    expect(response).toEqual({
      status: 'ready',
      profile: {
        departure: { city: 'Minneapolis', mode: 'plane', maxStops: 0 },
        dateRange: { kind: 'fixed', start: '2030-02-10', end: '2030-02-17' },
        region: 'Hawaii',
        experiences: ['beach', 'snorkeling'],
        unmappedExperiences: ['cooking class'],
        people: [
          { userType: 'adult', age: 40 },
          { userType: 'adult', age: 38 },
        ],
      },
    });
    expect(ExtractResponse.safeParse(response).success).toBe(true);
    expect(requests.map((r) => r.stage)).toEqual(['extract']);
  });

  it('AC-EXTRACT-02: a vague extraction needs clarification, with INSUFFICIENT_DETAIL and the question', async () => {
    const { run, requests } = setup({
      extract: extraction({ ...EMPTY, climate: 'warm' }),
      clarify: question('Where would you like to go, when, and who is travelling?'),
    });

    const response = await run('Somewhere warm');

    expect(response).toEqual({
      status: 'needs_clarification',
      profile: { climate: 'warm' },
      violations: [
        { code: 'INSUFFICIENT_DETAIL', path: '', params: { populated: 1, required: 3 } },
      ],
      clarificationQuestion: 'Where would you like to go, when, and who is travelling?',
    });
    // The clarifier sees the violations and the normalized profile.
    expect(requests[1]?.prompt).toContain('INSUFFICIENT_DETAIL');
    expect(requests[1]?.prompt).toContain('{"climate":"warm"}');
  });

  it('AC-EXTRACT-04: an invalid traveler age needs clarification at that traveler', async () => {
    const { run } = setup({
      extract: extraction({
        ...COMPLETE,
        people: [
          { userType: 'adult', age: 40, gender: null },
          { userType: 'child', age: 19, gender: null },
        ],
      }),
      clarify: question('How old is your child?'),
    });

    const response = await run();

    expect(response).toMatchObject({
      status: 'needs_clarification',
      violations: [
        { code: 'CHILD_AGE_RANGE', path: '/people/1/age', params: { age: 19, min: 0, max: 17 } },
      ],
    });
  });

  it('AC-EXTRACT-05: unmapped experiences are kept but do not count as populated', async () => {
    const { run } = setup({
      extract: extraction({ ...EMPTY, region: 'Italy', unmappedExperiences: ['wine tasting'] }),
      clarify: question('When are you going, and who is coming?'),
    });

    const response = await run();

    expect(response).toMatchObject({
      status: 'needs_clarification',
      profile: { region: 'Italy', unmappedExperiences: ['wine tasting'] },
      violations: [{ code: 'INSUFFICIENT_DETAIL', params: { populated: 1, required: 3 } }],
    });
  });

  it('AC-EXTRACT-06: a past date is a needs_clarification response, not an error', async () => {
    const { run } = setup({
      extract: extraction({
        ...COMPLETE,
        dateRange: { kind: 'fixed', start: '2029-12-01', end: '2029-12-08' },
      }),
      clarify: question('Those dates have passed. When would you like to travel?'),
    });

    const response = await run();

    expect(response).toMatchObject({
      status: 'needs_clarification',
      violations: [
        {
          code: 'DATE_NOT_PAST',
          path: '/dateRange/start',
          params: { value: '2029-12-01', referenceDate: REFERENCE_DATE },
        },
      ],
    });
  });

  it('AC-EXTRACT-09: over-cap model output is discarded and logged without its value', async () => {
    const long = 'x'.repeat(MAX_SHORT_TEXT_LENGTH + 1);
    const { run, discarded } = setup({ extract: extraction({ ...COMPLETE, region: long }) });

    const response = await run();

    expect(response.profile.region).toBeUndefined();
    expect(ExtractResponse.safeParse(response).success).toBe(true);
    expect(discarded).toEqual([
      { path: '/region', reason: 'too_long', limit: MAX_SHORT_TEXT_LENGTH, actual: 101 },
    ]);
    expect(JSON.stringify(discarded)).not.toContain(long);
  });

  it('AC-EXTRACT-11: a refused extraction is LLM_REFUSAL', async () => {
    const { run } = setup({ extract: mockRefusal() });
    await expect(run()).rejects.toMatchObject({ name: 'LlmError', code: 'LLM_REFUSAL' });
  });

  it('AC-EXTRACT-11: a refused clarification is LLM_REFUSAL', async () => {
    const { run } = setup({ extract: extraction(EMPTY), clarify: mockRefusal() });
    await expect(run()).rejects.toMatchObject({ code: 'LLM_REFUSAL' });
  });

  it('AC-EXTRACT-12: invalid extraction output twice is LLM_UPSTREAM_ERROR', async () => {
    const { run, logs } = setup({ extract: mockRaw('not json') });
    await expect(run()).rejects.toMatchObject({ code: 'LLM_UPSTREAM_ERROR' });
    expect(logs.map((l) => l.outcome)).toEqual(['retry', 'error']);
  });

  it.each([
    ['empty', ''],
    ['blank', ' \n\t '],
    ['over the cap', 'a'.repeat(MAX_CLARIFICATION_QUESTION_LENGTH + 1)],
  ])('AC-EXTRACT-12: an %s question twice is LLM_UPSTREAM_ERROR', async (_label, text) => {
    const { run, logs } = setup({ extract: extraction(EMPTY), clarify: question(text) });
    await expect(run()).rejects.toMatchObject({ code: 'LLM_UPSTREAM_ERROR' });
    expect(logs.filter((l) => l.stage === 'clarify').map((l) => l.outcome)).toEqual([
      'retry',
      'error',
    ]);
  });

  it('AC-EXTRACT-12: a bad question then a good one is a 200 with the good one, trimmed', async () => {
    const { run } = setup({
      extract: extraction(EMPTY),
      clarify: (_request, attempt) => question(attempt === 1 ? '' : '  Where to?  '),
    });
    await expect(run()).resolves.toMatchObject({ clarificationQuestion: 'Where to?' });
  });

  it('AC-EXTRACT-12: a question at the cap is accepted', async () => {
    const atCap = '\u{1F334}'.repeat(MAX_CLARIFICATION_QUESTION_LENGTH);
    const { run } = setup({ extract: extraction(EMPTY), clarify: question(atCap) });
    const response = await run();
    expect(response).toMatchObject({ clarificationQuestion: atCap });
    expect(ExtractResponse.safeParse(response).success).toBe(true);
  });

  it('AC-EXTRACT-13: both calls use the fast model at low effort with the cap-derived budgets', async () => {
    const { run, requests } = setup({ extract: extraction(EMPTY), clarify: question('Where?') });
    await run('Hi');
    expect(
      requests.map(({ stage, role, effort, maxOutputTokens }) => ({
        stage,
        role,
        effort,
        maxOutputTokens,
      })),
    ).toEqual([
      { stage: 'extract', role: 'fast', effort: 'low', maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS },
      { stage: 'clarify', role: 'fast', effort: 'low', maxOutputTokens: CLARIFY_MAX_OUTPUT_TOKENS },
    ]);
  });
});
