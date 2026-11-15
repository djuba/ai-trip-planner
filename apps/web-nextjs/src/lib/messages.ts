// Display text from the spec's message catalog (spec/messages.md). Presentation only: nothing
// branches on these strings (CLAUDE.md §4.5).
import { EN_MESSAGES, violationArguments } from '@vp/domain-schema/messages';
import type {
  Climate,
  Experience,
  RuleViolation,
  TravelMode,
  UserType,
} from '@vp/domain-schema/wire';
import { IntlMessageFormat } from 'intl-messageformat';

const formatters = new Map<RuleViolation['code'], IntlMessageFormat>();

/** The catalog's sentence for a violation, formatted from its `code`, `path` and `params`. */
export function describeViolation(violation: RuleViolation): string {
  let formatter = formatters.get(violation.code);
  if (formatter === undefined) {
    formatter = new IntlMessageFormat(EN_MESSAGES.violations[violation.code], 'en');
    formatters.set(violation.code, formatter);
  }
  const text = formatter.format(violationArguments(violation));
  if (typeof text !== 'string') {
    throw new Error(`Message for ${violation.code} did not format to a string`);
  }
  return text;
}

interface EnumValues {
  experience: Experience;
  climate: Climate;
  travelMode: TravelMode;
  userType: UserType;
}

/** The catalog's label for a value of one of the closed enums. */
export function enumLabel<K extends keyof EnumValues>(kind: K, value: EnumValues[K]): string {
  // The catalog schema gives every enum value a label, so the lookup cannot miss.
  const labels = EN_MESSAGES.labels[kind] as Record<EnumValues[K], string>;
  return labels[value];
}
