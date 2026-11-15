// The profile as labelled rows for the conversation view (AC-CONV-06). Display only: values are
// shown as the profile holds them, never parsed into dates.
import type { RuleViolation, TripProfile } from '@vp/domain-schema/wire';
import { enumLabel } from '../messages.ts';

export interface ProfileRow {
  field: keyof TripProfile;
  label: string;
  values: string[];
  needsAttention: boolean;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const ROWS: readonly { field: keyof TripProfile; label: string }[] = [
  { field: 'departure', label: 'From' },
  { field: 'dateRange', label: 'When' },
  { field: 'region', label: 'Where' },
  { field: 'climate', label: 'Climate' },
  { field: 'experiences', label: 'Experiences' },
  { field: 'unmappedExperiences', label: 'Also asked for' },
  { field: 'people', label: 'Travelers' },
];

function nonBlank(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

function stopsText(maxStops: number): string {
  if (maxStops === 0) return 'non-stop';
  return maxStops === 1 ? 'up to 1 stop' : `up to ${maxStops} stops`;
}

function departureValues(departure: NonNullable<TripProfile['departure']>): string[] {
  const parts: string[] = [];
  const city = nonBlank(departure.city);
  if (city !== null) parts.push(city);
  if (departure.mode != null) parts.push(enumLabel('travelMode', departure.mode));
  if (departure.maxStops != null) parts.push(stopsText(departure.maxStops));
  return parts.length === 0 ? [] : [parts.join(' · ')];
}

function monthName(month: number): string {
  return MONTHS[month - 1] ?? `month ${month}`;
}

function dateRangeValues(range: NonNullable<TripProfile['dateRange']>): string[] {
  if (range.kind === 'fixed') return [`${range.start} to ${range.end}`];
  const parts: string[] = [];
  const month = range.month == null ? null : monthName(range.month);
  if (month !== null && range.year != null) parts.push(`${month} ${range.year}`);
  else if (month !== null) parts.push(month);
  else if (range.year != null) parts.push(String(range.year));
  if (range.durationNights != null) {
    parts.push(range.durationNights === 1 ? '1 night' : `${range.durationNights} nights`);
  }
  const note = nonBlank(range.note);
  if (note !== null) parts.push(note);
  return parts.length === 0 ? [] : [parts.join(', ')];
}

function travelerText(traveler: NonNullable<TripProfile['people']>[number]): string {
  let text = enumLabel('userType', traveler.userType);
  if (traveler.age != null) text += `, ${traveler.age}`;
  const gender = nonBlank(traveler.gender);
  if (gender !== null) text += `, ${gender}`;
  return text;
}

function valuesFor(field: keyof TripProfile, profile: TripProfile): string[] {
  switch (field) {
    case 'departure':
      return profile.departure ? departureValues(profile.departure) : [];
    case 'dateRange':
      return profile.dateRange ? dateRangeValues(profile.dateRange) : [];
    case 'region': {
      const region = nonBlank(profile.region);
      return region === null ? [] : [region];
    }
    case 'climate':
      return profile.climate ? [enumLabel('climate', profile.climate)] : [];
    case 'experiences':
      return (profile.experiences ?? []).map((value) => enumLabel('experience', value));
    case 'unmappedExperiences':
      return (profile.unmappedExperiences ?? []).flatMap((text) => nonBlank(text) ?? []);
    case 'people':
      return (profile.people ?? []).map(travelerText);
  }
}

/** Rows for the fields the profile holds, in a fixed order; a row is flagged when a violation points at it. */
export function summarizeProfile(
  profile: TripProfile | undefined,
  violations: readonly RuleViolation[],
): ProfileRow[] {
  if (profile === undefined) return [];
  const rows: ProfileRow[] = [];
  for (const { field, label } of ROWS) {
    const values = valuesFor(field, profile);
    if (values.length === 0) continue;
    const pointer = `/${field}`;
    const needsAttention = violations.some(
      (violation) => violation.path === pointer || violation.path.startsWith(`${pointer}/`),
    );
    rows.push({ field, label, values, needsAttention });
  }
  return rows;
}
