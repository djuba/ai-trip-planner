// Valid and invalid payloads for every contract schema. Zod and the generated JSON Schema must
// agree on each one (parity.test.ts). Rule-checked values (child aged 18, month 13, a date that
// does not exist) are VALID on the wire: they are rule violations, not contract violations (D1).
import type { ContractSchemaId } from '../../gen/registry.ts';
import {
  MAX_CLAIM_LENGTH,
  MAX_CLAIMS,
  MAX_CLARIFICATION_QUESTION_LENGTH,
  MAX_CRITIQUE_ISSUE_LENGTH,
  MAX_RECOMMENDATIONS,
  MAX_SUMMARY_LENGTH,
  MAX_UNRESOLVED_ISSUES,
  MAX_DATE_TEXT_LENGTH,
  MAX_EXPERIENCES,
  MAX_MESSAGE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PEOPLE,
  MAX_SHORT_TEXT_LENGTH,
  MAX_UNMAPPED_EXPERIENCES,
} from '../../src/wire/index.ts';

export interface SampleSet {
  valid: unknown[];
  invalid: unknown[];
}

const ref = '2027-03-01';

const adult = { userType: 'adult', age: 34, gender: 'female' };
const child = { userType: 'child', age: 8 };

const claim = { kind: 'flight', statement: 'Nonstop service from MSP', verification: 'fixture' };
const recommendation = {
  id: 'rec-1',
  destination: 'Maui, Hawaii',
  summary: 'Beaches and snorkeling.',
  matchedExperiences: ['beach', 'snorkeling'],
  claims: [claim],
};
const draft = {
  destination: 'Maui, Hawaii',
  summary: 'Beaches and snorkeling.',
  matchedExperiences: ['beach'],
  bestMonths: [1, 2, 3],
  adultsOnly: false,
  claims: [
    { kind: 'flight', statement: 'Non-stop MSP to OGG', nonstopRoute: { from: 'MSP', to: 'OGG' } },
  ],
};
const card = {
  recommendationId: 'rec-1',
  title: 'Maui',
  blurb: 'Sun and surf.',
  highlights: ['Snorkel at Molokini'],
  claims: [claim],
};
const profile = {
  departure: { city: 'Minneapolis', mode: 'plane', maxStops: 0 },
  dateRange: { kind: 'fixed', start: '2027-06-01', end: '2027-06-08' },
  experiences: ['beach'],
  people: [adult, child],
};
const extraction = {
  departure: null,
  dateRange: null,
  region: null,
  climate: null,
  experiences: null,
  unmappedExperiences: null,
  people: null,
};
const extractionMissingField: Record<string, unknown> = { ...extraction };
delete extractionMissingField.people;

const violation = (code: string, params: unknown) => ({ code, path: '/x', params });
const ageParams = { age: 18, min: 0, max: 17 };

// 1000 code points, 1990 UTF-16 units: under MAX_MESSAGE_LENGTH however it is counted.
const longMessage = `${'🌴'.repeat(990)}${'a'.repeat(10)}`;

export const SAMPLES: Record<ContractSchemaId, SampleSet> = {
  Experience: { valid: ['beach', 'skiing', 'go-karts'], invalid: ['bungee', '', null, 1] },
  Climate: { valid: ['tropical', 'cold'], invalid: ['hot', null, ''] },
  UserType: { valid: ['adult', 'child'], invalid: ['senior', null] },
  TravelMode: { valid: ['plane', 'car', 'train'], invalid: ['boat', '', null] },
  RuleCode: {
    valid: ['CHILD_AGE_RANGE', 'INSUFFICIENT_DETAIL', 'MAX_STOPS_RANGE'],
    invalid: ['child_age_range', 'MONTH_RANGE', 1],
  },
  ErrorCode: {
    valid: [
      'UNAUTHORIZED',
      'RATE_LIMITED',
      'QUOTA_EXHAUSTED',
      'PAYLOAD_TOO_LARGE',
      'VALIDATION_FAILED',
      'LLM_REFUSAL',
      'LLM_UPSTREAM_ERROR',
      'INTERNAL_ERROR',
    ],
    invalid: ['NOT_FOUND', null],
  },
  ClaimKind: { valid: ['flight', 'other'], invalid: ['hotel', null] },
  Verification: { valid: ['unverified', 'fixture'], invalid: ['verified', null] },
  Departure: {
    valid: [
      {},
      { city: 'Minneapolis', mode: 'plane', maxStops: 0 },
      { city: null, mode: null, maxStops: null },
      { maxStops: -1 }, // MAX_STOPS_RANGE is a rule
      { mode: 'car', maxStops: 0 }, // stops are ignored unless flying; not a contract error
      { city: 'Minneapolis', airport: 'extra keys are tolerated' },
    ],
    invalid: [
      null,
      'Minneapolis',
      { city: 5 },
      { mode: 'boat' },
      { maxStops: 1.5 },
      { maxStops: '0' },
    ],
  },
  Traveler: {
    valid: [
      adult,
      child,
      { userType: 'adult' },
      { userType: 'adult', age: null, gender: null },
      { userType: 'child', age: 18 }, // CHILD_AGE_RANGE is a rule
      { userType: 'adult', age: 150 }, // ADULT_AGE_RANGE is a rule
      { userType: 'adult', age: 30, nickname: 'extra keys are tolerated' },
    ],
    invalid: [
      {},
      { age: 30 },
      { userType: 'senior' },
      { userType: 'adult', age: 30.5 },
      { userType: 'adult', age: '30' },
      { userType: 'adult', gender: 5 },
      null,
    ],
  },
  DateRange: {
    valid: [
      { kind: 'fixed', start: '2027-06-01', end: '2027-06-08' },
      { kind: 'fixed', start: '2027-02-30', end: '2027-02-31' }, // DATE_VALID is a rule
      { kind: 'fixed', start: '2027-06-08', end: '2027-06-01' }, // DATE_ORDER is a rule
      { kind: 'flexible' },
      { kind: 'flexible', month: 7, year: 2027, durationNights: 7, note: 'school holidays' },
      { kind: 'flexible', month: 13 },
      { kind: 'flexible', year: 1999 },
      { kind: 'flexible', durationNights: 0 },
    ],
    invalid: [
      {},
      { kind: 'fixed', start: '2027-06-01' },
      { kind: 'fixed', end: '2027-06-08' },
      { kind: 'fixed', start: 20270601, end: '2027-06-08' },
      { kind: 'flexible', month: 'July' },
      { kind: 'flexible', month: 6.5 },
      { kind: 'flexible', note: 7 },
      { kind: 'open' },
      null,
    ],
  },
  TripProfile: {
    valid: [
      {},
      profile,
      { departure: null, dateRange: null, region: null, climate: null },
      { departure: { maxStops: -1 } },
      { climate: 'warm', unmappedExperiences: ['whale watching'], experiences: [] },
      { people: [{ userType: 'child', age: 18 }] },
      { people: [{ userType: 'adult', age: 150 }] },
      { dateRange: { kind: 'flexible', month: 13, year: 1999, durationNights: 0 } },
      { dateRange: { kind: 'fixed', start: '2027-02-30', end: '2027-01-01' } },
      { region: 'Caribbean', extra: true },
    ],
    invalid: [
      null,
      'profile',
      { climate: 'hot' },
      { experiences: ['bungee'] },
      { experiences: 'beach' },
      { people: [{ age: 4 }] },
      { people: 'two adults' },
      { dateRange: { kind: 'fixed' } },
      { departure: 'Minneapolis' },
      { departure: { mode: 'boat' } },
    ],
  },
  ExtractionSchema: {
    valid: [
      extraction,
      {
        departure: { city: 'Minneapolis', mode: 'plane', maxStops: 1 },
        dateRange: { kind: 'fixed', start: '2027-06-01', end: '2027-06-08' },
        region: 'Caribbean',
        climate: 'tropical',
        experiences: ['beach', 'pool'],
        unmappedExperiences: ['whale watching'],
        people: [
          { userType: 'adult', age: 40, gender: null },
          { userType: 'child', age: 18, gender: 'male' },
        ],
      },
      {
        ...extraction,
        dateRange: { kind: 'flexible', month: 13, year: 1999, durationNights: 0, note: null },
      },
      { ...extraction, experiences: [], people: [] },
    ],
    invalid: [
      extractionMissingField, // required-but-nullable: absent is not null
      {},
      { ...extraction, climate: 'hot' },
      { ...extraction, people: [{ userType: 'adult', age: 30 }] }, // gender missing
      { ...extraction, dateRange: { kind: 'flexible', month: 7 } }, // sub-fields missing
      { ...extraction, experiences: ['bungee'] },
      null,
    ],
  },
  RuleViolation: {
    valid: [
      violation('CHILD_AGE_RANGE', ageParams),
      violation('ADULT_AGE_RANGE', { age: 150, min: 18, max: 120 }),
      violation('DATE_ORDER', { start: '2027-06-08', end: '2027-06-01' }),
      violation('DATE_NOT_PAST', { value: '2020-01-01', referenceDate: ref }),
      violation('DATE_NOT_PAST', { value: '2020-01', referenceDate: ref }),
      violation('DATE_NOT_PAST', { value: '2020', referenceDate: ref }),
      violation('DATE_VALID', { value: '2027-02-30' }),
      violation('DATE_VALID', { value: 13 }),
      violation('PARTY_HAS_ADULT', {}),
      { code: 'PARTY_HAS_ADULT', path: '', params: {} },
      violation('MAX_STOPS_RANGE', { value: -1 }),
      violation('INSUFFICIENT_DETAIL', { populated: 1, required: 3 }),
    ],
    invalid: [
      violation('CHILD_AGE_RANGE', { start: 'a', end: 'b' }), // params of another code
      violation('CHILD_AGE_RANGE', { age: 18, min: 0 }),
      violation('CHILD_AGE_RANGE', { age: '18', min: 0, max: 17 }),
      violation('DATE_ORDER', ageParams),
      violation('DATE_NOT_PAST', { value: '2020-01-01' }),
      violation('DATE_VALID', { value: true }),
      violation('DATE_VALID', {}),
      violation('INSUFFICIENT_DETAIL', { populated: 1 }),
      violation('MONTH_RANGE', { value: 13 }),
      violation('MAX_STOPS_RANGE', { value: '-1' }),
      { code: 'PARTY_HAS_ADULT', params: {} }, // path missing
      { code: 'PARTY_HAS_ADULT', path: '/people' }, // params missing
      { code: 'PARTY_HAS_ADULT', path: 5, params: {} },
      { path: '/x', params: {} },
      null,
    ],
  },
  FactualClaim: {
    valid: [claim, { kind: 'price', statement: 'Around $500', verification: 'unverified' }],
    invalid: [
      { kind: 'flight', statement: 'x' },
      { kind: 'hotel', statement: 'x', verification: 'unverified' },
      { kind: 'flight', statement: 'x', verification: 'verified' },
      { kind: 'flight', statement: 5, verification: 'fixture' },
      null,
    ],
  },
  Recommendation: {
    valid: [
      recommendation,
      { ...recommendation, matchedExperiences: [], claims: [] },
      { ...recommendation, note: 'extra keys are tolerated' },
    ],
    invalid: [
      { ...recommendation, id: undefined },
      { ...recommendation, matchedExperiences: ['bungee'] },
      { ...recommendation, claims: [{ kind: 'flight' }] },
      { ...recommendation, destination: 5 },
      {},
      null,
    ],
  },
  ClarificationOutput: {
    valid: [{ question: 'How old is the child?' }, { question: '' }],
    invalid: [{}, { question: null }, { question: 5 }, null],
  },
  RecommendationSet: {
    valid: [
      { recommendations: [] },
      { recommendations: [draft] },
      // Unconstrained (ADR 0001 Q3): bad months and long text are critic issues, not parse errors.
      {
        recommendations: [{ ...draft, bestMonths: [0, 13], summary: 'x'.repeat(5000), claims: [] }],
      },
      {
        recommendations: [
          { ...draft, claims: [{ kind: 'price', statement: 'From $500', nonstopRoute: null }] },
        ],
      },
    ],
    invalid: [
      {},
      { recommendations: [recommendation] }, // a wire recommendation is not a draft
      { recommendations: [{ ...draft, adultsOnly: undefined }] },
      { recommendations: [{ ...draft, bestMonths: [1.5] }] },
      { recommendations: [{ ...draft, claims: [{ kind: 'flight', statement: 'x' }] }] },
      { recommendations: 'none' },
      null,
    ],
  },
  CritiqueResult: {
    valid: [
      { pass: true, issues: [] },
      { pass: false, issues: [{ recommendationId: 'rec-1', issue: 'Too cold in July' }] },
      { pass: false, issues: [{ recommendationId: null, issue: 'x'.repeat(5000) }] },
    ],
    invalid: [
      { pass: true },
      { issues: [] },
      { pass: 'yes', issues: [] },
      { pass: false, issues: [{ issue: 'x' }] },
      null,
    ],
  },
  CritiqueIssue: {
    valid: [
      { recommendationId: 'rec-1', issue: 'Unsupported price claim' },
      { recommendationId: null, issue: 'Too few options' },
    ],
    invalid: [{ issue: 'x' }, { recommendationId: 'rec-1' }, { recommendationId: 1, issue: 'x' }],
  },
  PresentationCard: {
    valid: [card, { ...card, highlights: [], claims: [] }],
    invalid: [
      { ...card, recommendationId: undefined },
      { ...card, highlights: 'one' },
      { ...card, claims: [{ kind: 'x' }] },
      {},
      null,
    ],
  },
  PresentationModel: {
    valid: [
      { headline: 'Your trip', intro: 'Here are ideas.', cards: [card] },
      { headline: '', intro: '', cards: [] },
    ],
    invalid: [
      {}, // an empty partial stream is not a finished model
      { headline: 'Your trip', intro: 'Here are ideas.' },
      { headline: 'Your trip', intro: 'x', cards: [{ title: 'only a title' }] },
      { headline: 5, intro: 'x', cards: [] },
      null,
    ],
  },
  ExtractRequest: {
    valid: [
      { message: 'A week in the sun', referenceDate: ref },
      { message: 'x', currentProfile: profile, referenceDate: '2028-02-29' },
      { message: 'x', currentProfile: {}, referenceDate: ref },
      {
        message: 'x',
        referenceDate: ref,
        currentProfile: {
          people: [
            { userType: 'child', age: 18 },
            { userType: 'adult', age: 150 },
          ],
          dateRange: { kind: 'fixed', start: '2027-02-30', end: '2027-01-01' },
        },
      },
      {
        message: 'x',
        referenceDate: ref,
        currentProfile: {
          dateRange: { kind: 'flexible', month: 13, year: 1999, durationNights: 0 },
        },
      },
      { message: longMessage, referenceDate: ref }, // astral characters under the cap
      { message: 'x', referenceDate: ref, clientVersion: '1.2.3' }, // open object
    ],
    invalid: [
      { message: '', referenceDate: ref },
      { referenceDate: ref },
      { message: 'x' },
      { message: 'x', referenceDate: '2027-02-30' },
      { message: 'x', referenceDate: '2027-2-3' },
      { message: 'x', referenceDate: '03/01/2027' },
      { message: 'x', referenceDate: 20270301 },
      { message: 5, referenceDate: ref },
      { message: 'x', referenceDate: ref, currentProfile: { climate: 'hot' } },
      { message: 'x', referenceDate: ref, currentProfile: null },
      null,
    ],
  },
  ExtractResponse: {
    valid: [
      { status: 'ready', profile },
      { status: 'ready', profile: {} },
      {
        status: 'needs_clarification',
        profile: { people: [{ userType: 'child', age: 18 }] },
        violations: [violation('CHILD_AGE_RANGE', ageParams)],
        clarificationQuestion: 'How old is the child?',
      },
      {
        status: 'needs_clarification',
        profile,
        violations: [violation('PARTY_HAS_ADULT', {}), violation('DATE_VALID', { value: 13 })],
        clarificationQuestion: 'Who is travelling?',
      },
    ],
    invalid: [
      {
        status: 'needs_clarification',
        profile,
        violations: [],
        clarificationQuestion: 'Anything else?',
      },
      {
        status: 'needs_clarification',
        profile,
        violations: [violation('PARTY_HAS_ADULT', {})],
        clarificationQuestion: '',
      },
      { status: 'needs_clarification', profile, violations: [violation('PARTY_HAS_ADULT', {})] },
      { status: 'needs_clarification', profile, clarificationQuestion: 'x' },
      {
        status: 'needs_clarification',
        profile,
        violations: [violation('MONTH_RANGE', { value: 13 })],
        clarificationQuestion: 'x',
      },
      { status: 'ready' },
      { status: 'done', profile },
      { profile },
      null,
    ],
  },
  RecommendRequest: {
    valid: [
      { profile, referenceDate: ref },
      { profile: {}, referenceDate: ref },
    ],
    invalid: [
      { profile },
      { referenceDate: ref },
      { profile, referenceDate: '2027-02-30' },
      { profile, referenceDate: '2027-2-3' },
      { profile: { climate: 'hot' }, referenceDate: ref },
      { profile: null, referenceDate: ref },
    ],
  },
  RecommendResponse: {
    valid: [
      { recommendations: [], critique: { pass: true, unresolved: [] } },
      {
        recommendations: [recommendation],
        critique: {
          pass: false,
          unresolved: [{ recommendationId: null, issue: 'Unverified price' }],
        },
      },
    ],
    invalid: [
      { recommendations: [] },
      { critique: { pass: true, unresolved: [] } },
      { recommendations: [], critique: { pass: 'yes', unresolved: [] } },
      { recommendations: [], critique: { pass: true } },
      { recommendations: [], critique: { pass: true, unresolved: [{ issue: 'x' }] } },
    ],
  },
  PresentRequest: {
    valid: [
      { profile, recommendations: [recommendation] },
      { profile: {}, recommendations: [] },
    ],
    invalid: [
      { profile },
      { recommendations: [] },
      { profile, recommendations: [{ id: 'x' }] },
      { profile: { climate: 'hot' }, recommendations: [] },
    ],
  },
  HealthResponse: {
    valid: [
      { status: 'ok', contractVersion: '0.1.0' },
      { status: 'ok', contractVersion: '1.0.0' },
    ],
    invalid: [
      { status: 'degraded', contractVersion: '0.1.0' },
      { status: 'ok', contractVersion: '' },
      { status: 'ok' },
      { contractVersion: '0.1.0' },
    ],
  },
  ErrorResponse: {
    valid: [
      { error: { code: 'VALIDATION_FAILED', message: 'message is required' } },
      { error: { code: 'LLM_REFUSAL', message: '' } },
      { error: { code: 'INTERNAL_ERROR', message: 'boom', detail: 'extra keys tolerated' } },
    ],
    invalid: [
      { error: { code: 'NOT_FOUND', message: 'x' } },
      { error: { message: 'x' } },
      { error: { code: 'LLM_REFUSAL' } },
      { code: 'LLM_REFUSAL', message: 'x' },
      {},
      null,
    ],
  },
};

// ---------- Cap boundaries (ADR 0004, docs/features/input-limits.md) ----------
// Each case is checked against Zod and the generated JSON Schema (parity.test.ts), and its title
// carries its AC ID. Lengths count code points, so the astral and combining cases pin the counting.

export interface BoundaryCase {
  ac: string;
  label: string;
  schema: ContractSchemaId;
  value: unknown;
  valid: boolean;
}

const PALM = '🌴'; // 1 code point, 2 UTF-16 units
// Built from code points so no editor or formatter can precompose it into U+00E9.
const E_ACUTE = String.fromCodePoint(0x65, 0x301); // e + combining acute: 2 code points, 1 grapheme
if ([...E_ACUTE].length !== 2) throw new Error('E_ACUTE must be two code points');
const LONE_SURROGATE = '\uD83C';

const ascii = (n: number) => 'a'.repeat(n);
const astral = (n: number) => PALM.repeat(n);

/** One capped wire value. String values are built from astral characters, so a cap counted in UTF-16 units fails. */
interface CappedField {
  name: string;
  cap: number;
  /** Builds a profile whose capped value has `n` code points or items. */
  profile: (n: number) => Record<string, unknown>;
}

export const CAPPED_FIELDS: CappedField[] = [
  { name: 'region', cap: MAX_SHORT_TEXT_LENGTH, profile: (n) => ({ region: astral(n) }) },
  {
    name: 'departure.city',
    cap: MAX_SHORT_TEXT_LENGTH,
    profile: (n) => ({ departure: { city: astral(n) } }),
  },
  {
    name: 'people[].gender',
    cap: MAX_SHORT_TEXT_LENGTH,
    profile: (n) => ({ people: [{ userType: 'adult', gender: astral(n) }] }),
  },
  {
    name: 'dateRange.note',
    cap: MAX_NOTE_LENGTH,
    profile: (n) => ({ dateRange: { kind: 'flexible', note: astral(n) } }),
  },
  {
    name: 'dateRange.start',
    cap: MAX_DATE_TEXT_LENGTH,
    profile: (n) => ({ dateRange: { kind: 'fixed', start: astral(n), end: '2027-06-08' } }),
  },
  {
    name: 'dateRange.end',
    cap: MAX_DATE_TEXT_LENGTH,
    profile: (n) => ({ dateRange: { kind: 'fixed', start: '2027-06-01', end: astral(n) } }),
  },
  {
    name: 'unmappedExperiences[] item',
    cap: MAX_SHORT_TEXT_LENGTH,
    profile: (n) => ({ unmappedExperiences: ['sailing', astral(n)] }),
  },
  {
    name: 'experiences count',
    cap: MAX_EXPERIENCES,
    profile: (n) => ({ experiences: Array.from({ length: n }, () => 'beach') }),
  },
  {
    name: 'unmappedExperiences count',
    cap: MAX_UNMAPPED_EXPERIENCES,
    profile: (n) => ({ unmappedExperiences: Array.from({ length: n }, (_, i) => `x${i}`) }),
  },
  {
    name: 'people count',
    cap: MAX_PEOPLE,
    profile: (n) => ({ people: Array.from({ length: n }, () => ({ userType: 'adult' })) }),
  },
];

/** Every request or response schema that carries a `TripProfile`, and how it wraps one. */
const PROFILE_CARRIERS: { schema: ContractSchemaId; wrap: (p: unknown) => unknown }[] = [
  { schema: 'TripProfile', wrap: (p) => p },
  {
    schema: 'ExtractRequest',
    wrap: (p) => ({ message: 'x', currentProfile: p, referenceDate: ref }),
  },
  { schema: 'ExtractResponse', wrap: (p) => ({ status: 'ready', profile: p }) },
  { schema: 'RecommendRequest', wrap: (p) => ({ profile: p, referenceDate: ref }) },
  { schema: 'PresentRequest', wrap: (p) => ({ profile: p, recommendations: [] }) },
];

const counting: BoundaryCase[] = [
  {
    ac: 'AC-LIMITS-01',
    label: `region of ${MAX_SHORT_TEXT_LENGTH} astral code points (${2 * MAX_SHORT_TEXT_LENGTH} UTF-16 units)`,
    schema: 'TripProfile',
    value: { region: astral(MAX_SHORT_TEXT_LENGTH) },
    valid: true,
  },
  {
    ac: 'AC-LIMITS-01',
    label: `region of ${MAX_SHORT_TEXT_LENGTH} lone surrogates`,
    schema: 'TripProfile',
    value: { region: LONE_SURROGATE.repeat(MAX_SHORT_TEXT_LENGTH) },
    valid: true,
  },
  {
    ac: 'AC-LIMITS-01',
    label: `region of ${MAX_SHORT_TEXT_LENGTH / 2 + 1} graphemes that are ${MAX_SHORT_TEXT_LENGTH + 2} code points`,
    schema: 'TripProfile',
    value: { region: E_ACUTE.repeat(MAX_SHORT_TEXT_LENGTH / 2 + 1) },
    valid: false,
  },
  {
    ac: 'AC-LIMITS-01',
    label: `region of ${MAX_SHORT_TEXT_LENGTH + 1} lone surrogates`,
    schema: 'TripProfile',
    value: { region: LONE_SURROGATE.repeat(MAX_SHORT_TEXT_LENGTH + 1) },
    valid: false,
  },
];

const message: BoundaryCase[] = [
  [ascii(MAX_MESSAGE_LENGTH), 'ASCII', true],
  [ascii(MAX_MESSAGE_LENGTH + 1), 'ASCII', false],
  [astral(MAX_MESSAGE_LENGTH), 'astral', true],
  [astral(MAX_MESSAGE_LENGTH + 1), 'astral', false],
].map(([text, kind, valid]) => ({
  ac: 'AC-LIMITS-02',
  label: `message of ${valid ? 'exactly' : 'one over'} MAX_MESSAGE_LENGTH ${kind} code points`,
  schema: 'ExtractRequest' as const,
  value: { message: text, referenceDate: ref },
  valid: valid as boolean,
}));

const profileFields: BoundaryCase[] = CAPPED_FIELDS.flatMap((field) =>
  PROFILE_CARRIERS.flatMap(({ schema, wrap }) =>
    [field.cap, field.cap + 1].map((n) => ({
      ac: 'AC-LIMITS-03',
      label: `${schema}: ${field.name} at ${n === field.cap ? 'the cap' : 'the cap + 1'} (${n})`,
      schema,
      value: wrap(field.profile(n)),
      valid: n === field.cap,
    })),
  ),
);

const clarificationQuestion: BoundaryCase[] = [
  [ascii(MAX_CLARIFICATION_QUESTION_LENGTH), 'ASCII', true],
  [ascii(MAX_CLARIFICATION_QUESTION_LENGTH + 1), 'ASCII', false],
  [astral(MAX_CLARIFICATION_QUESTION_LENGTH), 'astral', true],
  [astral(MAX_CLARIFICATION_QUESTION_LENGTH + 1), 'astral', false],
].map(([text, kind, valid]) => ({
  ac: 'AC-LIMITS-12',
  label: `clarificationQuestion of ${valid ? 'exactly' : 'one over'} MAX_CLARIFICATION_QUESTION_LENGTH ${kind} code points`,
  schema: 'ExtractResponse' as const,
  value: {
    status: 'needs_clarification',
    profile: {},
    violations: [{ code: 'INSUFFICIENT_DETAIL', path: '', params: { populated: 0, required: 3 } }],
    clarificationQuestion: text,
  },
  valid: valid as boolean,
}));

/** AC-LIMITS-13: recommendation and critique output caps (WU-10 plan D2). */
const critique = (unresolved: unknown[]) => ({ pass: false, unresolved });
const withRecommendation = (patch: Record<string, unknown>) => ({
  recommendations: [{ ...recommendation, ...patch }],
  critique: { pass: true, unresolved: [] },
});
const outputCaps: { name: string; cap: number; value: (n: number) => unknown }[] = [
  {
    name: 'Recommendation.id',
    cap: MAX_SHORT_TEXT_LENGTH,
    value: (n) => withRecommendation({ id: astral(n) }),
  },
  {
    name: 'Recommendation.destination',
    cap: MAX_SHORT_TEXT_LENGTH,
    value: (n) => withRecommendation({ destination: astral(n) }),
  },
  {
    name: 'Recommendation.summary',
    cap: MAX_SUMMARY_LENGTH,
    value: (n) => withRecommendation({ summary: astral(n) }),
  },
  {
    name: 'Recommendation.matchedExperiences count',
    cap: MAX_EXPERIENCES,
    value: (n) =>
      withRecommendation({ matchedExperiences: Array.from({ length: n }, () => 'beach') }),
  },
  {
    name: 'Recommendation.claims count',
    cap: MAX_CLAIMS,
    value: (n) => withRecommendation({ claims: Array.from({ length: n }, () => claim) }),
  },
  {
    name: 'FactualClaim.statement',
    cap: MAX_CLAIM_LENGTH,
    value: (n) => withRecommendation({ claims: [{ ...claim, statement: astral(n) }] }),
  },
  {
    name: 'recommendations count',
    cap: MAX_RECOMMENDATIONS,
    value: (n) => ({
      recommendations: Array.from({ length: n }, (_, i) => ({
        ...recommendation,
        id: `rec-${i + 1}`,
      })),
      critique: { pass: true, unresolved: [] },
    }),
  },
  {
    name: 'CritiqueIssue.issue',
    cap: MAX_CRITIQUE_ISSUE_LENGTH,
    value: (n) => ({
      recommendations: [],
      critique: critique([{ recommendationId: null, issue: astral(n) }]),
    }),
  },
  {
    name: 'CritiqueIssue.recommendationId',
    cap: MAX_SHORT_TEXT_LENGTH,
    value: (n) => ({
      recommendations: [],
      critique: critique([{ recommendationId: astral(n), issue: 'x' }]),
    }),
  },
  {
    name: 'critique.unresolved count',
    cap: MAX_UNRESOLVED_ISSUES,
    value: (n) => ({
      recommendations: [],
      critique: critique(Array.from({ length: n }, () => ({ recommendationId: null, issue: 'x' }))),
    }),
  },
];
const recommendationOutput: BoundaryCase[] = outputCaps.flatMap((field) =>
  [field.cap, field.cap + 1].map((n) => ({
    ac: 'AC-LIMITS-13',
    label: `RecommendResponse: ${field.name} at ${n === field.cap ? 'the cap' : 'the cap + 1'} (${n})`,
    schema: 'RecommendResponse' as const,
    value: field.value(n),
    valid: n === field.cap,
  })),
);
const presentRecommendations: BoundaryCase[] = [MAX_RECOMMENDATIONS, MAX_RECOMMENDATIONS + 1].map(
  (n) => ({
    ac: 'AC-LIMITS-13',
    label: `PresentRequest: recommendations count at ${n === MAX_RECOMMENDATIONS ? 'the cap' : 'the cap + 1'} (${n})`,
    schema: 'PresentRequest' as const,
    value: { profile: {}, recommendations: Array.from({ length: n }, () => recommendation) },
    valid: n === MAX_RECOMMENDATIONS,
  }),
);

export const BOUNDARY_CASES: BoundaryCase[] = [
  ...counting,
  ...message,
  ...clarificationQuestion,
  ...recommendationOutput,
  ...presentRecommendations,
  ...profileFields,
];
