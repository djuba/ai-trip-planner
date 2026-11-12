// Valid and invalid payloads for every contract schema. Zod and the generated JSON Schema must
// agree on each one (parity.test.ts). Rule-checked values (child aged 18, month 13, a date that
// does not exist) are VALID on the wire: they are rule violations, not contract violations (D1).
import type { ContractSchemaId } from '../../gen/registry.ts';

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

// Astral characters (emoji) are two UTF-16 units; a length cap would disagree across languages.
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
  RecommendationSet: {
    valid: [{ recommendations: [] }, { recommendations: [recommendation] }],
    invalid: [{}, { recommendations: [{ id: 'x' }] }, { recommendations: 'none' }, null],
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
      { message: longMessage, referenceDate: ref }, // no length cap; astral characters
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
