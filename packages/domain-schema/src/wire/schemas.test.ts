import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTRACT_SCHEMAS } from '../../gen/registry.ts';
import { SAMPLES } from '../../tests/support/samples.ts';
import {
  codePointLength,
  DateRange,
  Departure,
  EXPERIENCES,
  ExtractRequest,
  HealthResponse,
  ExtractResponse,
  MAX_CLARIFICATION_QUESTION_LENGTH,
  MAX_DATE_TEXT_LENGTH,
  MAX_EXPERIENCES,
  MAX_MESSAGE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PEOPLE,
  MAX_SHORT_TEXT_LENGTH,
  MAX_UNMAPPED_EXPERIENCES,
  RuleCode,
  RuleViolation,
  Traveler,
  TripProfile,
} from './index.ts';

const ids = Object.keys(CONTRACT_SCHEMAS) as (keyof typeof CONTRACT_SCHEMAS)[];

describe('sample table', () => {
  it('covers every registered schema with at least one valid and one invalid sample', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(SAMPLES[id].valid.length, `${id} valid`).toBeGreaterThanOrEqual(1);
      expect(SAMPLES[id].invalid.length, `${id} invalid`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe.each(ids)('%s', (id) => {
  const schema = CONTRACT_SCHEMAS[id];

  it.each(SAMPLES[id].valid.map((v, i) => [i, v] as const))('accepts valid sample %i', (_i, v) => {
    const result = schema.safeParse(v);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it.each(SAMPLES[id].invalid.map((v, i) => [i, v] as const))(
    'rejects invalid sample %i',
    (_i, v) => {
      expect(schema.safeParse(v).success).toBe(false);
    },
  );
});

describe('contract vocabulary', () => {
  it('HealthResponse has only status and contractVersion (no backend name)', () => {
    expect(Object.keys(HealthResponse.shape)).toEqual(['status', 'contractVersion']);
  });

  it('RuleViolation discriminates on exactly the RuleCode values', () => {
    const codes = RuleViolation.options.map((option) => option.shape.code.value);
    expect([...codes].sort()).toEqual([...RuleCode.options].sort());
  });

  it('Experience is the closed list from CLAUDE.md section 4.3', () => {
    expect([...EXPERIENCES]).toEqual([
      'beach',
      'pool',
      'golf',
      'go-karts',
      'hiking',
      'snorkeling',
      'theme-parks',
      'museums',
      'nightlife',
      'skiing',
    ]);
  });
});

/** Every `maxLength` and `maxItems` value in a field's own JSON Schema (not its children's). */
function capsOf(schema: z.ZodType, keyword: 'maxLength' | 'maxItems'): number[] {
  const found: number[] = [];
  const walk = (node: unknown, top: boolean) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, top));
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    if (typeof record[keyword] === 'number') found.push(record[keyword]);
    // anyOf carries nullable wrappers at the same level; items/properties are children.
    if (Array.isArray(record.anyOf)) walk(record.anyOf, top);
    if (!top) return;
    if (keyword === 'maxLength' && record.items) walk(record.items, false);
  };
  walk(z.toJSONSchema(schema, { io: 'input' }), true);
  return found;
}

const [fixedRange, flexibleRange] = DateRange.options;

describe('AC-LIMITS-04: each cap constant is the maximum on its fields', () => {
  it.each([
    ['ExtractRequest.message', ExtractRequest.shape.message, 'maxLength', MAX_MESSAGE_LENGTH],
    ['TripProfile.region', TripProfile.shape.region, 'maxLength', MAX_SHORT_TEXT_LENGTH],
    ['Departure.city', Departure.shape.city, 'maxLength', MAX_SHORT_TEXT_LENGTH],
    ['Traveler.gender', Traveler.shape.gender, 'maxLength', MAX_SHORT_TEXT_LENGTH],
    ['DateRange(flexible).note', flexibleRange.shape.note, 'maxLength', MAX_NOTE_LENGTH],
    ['DateRange(fixed).start', fixedRange.shape.start, 'maxLength', MAX_DATE_TEXT_LENGTH],
    ['DateRange(fixed).end', fixedRange.shape.end, 'maxLength', MAX_DATE_TEXT_LENGTH],
    ['TripProfile.experiences', TripProfile.shape.experiences, 'maxItems', MAX_EXPERIENCES],
    [
      'TripProfile.unmappedExperiences',
      TripProfile.shape.unmappedExperiences,
      'maxItems',
      MAX_UNMAPPED_EXPERIENCES,
    ],
    [
      'TripProfile.unmappedExperiences[]',
      TripProfile.shape.unmappedExperiences,
      'maxLength',
      MAX_SHORT_TEXT_LENGTH,
    ],
    ['TripProfile.people', TripProfile.shape.people, 'maxItems', MAX_PEOPLE],
    [
      'ExtractResponse.clarificationQuestion',
      ExtractResponse.options[0].shape.clarificationQuestion,
      'maxLength',
      MAX_CLARIFICATION_QUESTION_LENGTH,
    ],
  ] as const)('AC-LIMITS-04: %s has %s %i', (_name, schema, keyword, cap) => {
    expect(capsOf(schema, keyword)).toEqual([cap]);
  });

  it('AC-LIMITS-04: TripProfile uses the shared Departure, Traveler and DateRange', () => {
    // So the field checks above also cover the profile that every request and response carries.
    expect(TripProfile.shape.departure.unwrap().unwrap()).toBe(Departure);
    expect(TripProfile.shape.dateRange.unwrap().unwrap()).toBe(DateRange);
    expect(TripProfile.shape.people.unwrap().element).toBe(Traveler);
  });
});

describe('codePointLength (spec/normalize.md, Definitions)', () => {
  it.each<[string, string, number]>([
    ['empty', '', 0],
    ['ASCII', 'abc', 3],
    ['an astral character (2 UTF-16 units)', '\u{1F334}', 1],
    ['e + combining acute (1 grapheme)', String.fromCodePoint(0x65, 0x301), 2],
    ['a lone high surrogate', '\uD83C', 1],
    ['a lone low surrogate', '\uDF34', 1],
    ['two high surrogates', '\uD83C\uD83C', 2],
    ['a low surrogate before a high one', '\uDF34\uD83C', 2],
  ])('AC-LIMITS-01: %s has length %i', (_name, text, expected) => {
    expect(codePointLength(text)).toBe(expected);
    // The count Zod uses for .max(), so normalize and the wire schema agree.
    expect(z.string().max(expected).safeParse(text).success).toBe(true);
    if (expected > 0)
      expect(
        z
          .string()
          .max(expected - 1)
          .safeParse(text).success,
      ).toBe(false);
  });
});
