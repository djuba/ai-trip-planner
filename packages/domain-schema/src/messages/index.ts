// `@vp/domain-schema/messages`: the spec's message catalog as typed data, for TS readers
// (spec/messages.md; CLAUDE.md §4.1, §4.2). The wording lives in spec/messages/, not here.
// Messages are presentation only: never sent on the wire, never branched on (§4.5).
import type { z } from 'zod';
import en from '../../../../spec/messages/en.json' with { type: 'json' };
import type { RuleViolation } from '../wire/models/rule-violation.ts';
import { MessageCatalog } from './catalog-schema.ts';

export { MessageCatalog } from './catalog-schema.ts';

// `satisfies` makes `tsc` report a missing key; `parse` checks the file again when it loads.
export const EN_MESSAGES: MessageCatalog = MessageCatalog.parse(
  en satisfies z.input<typeof MessageCatalog>,
);

/**
 * The `field` argument every client derives the same way: the last reference token of the
 * violation's JSON Pointer `path`, unescaped per RFC 6901 (`~1` → `/`, then `~0` → `~`).
 * `""` (the whole profile) gives `""`.
 */
export function violationField(path: string): string {
  if (path === '') return '';
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last.replaceAll('~1', '/').replaceAll('~0', '~');
}

/**
 * The arguments a template is formatted with: every param as a string, plus `field`
 * (spec/messages.md, Arguments). Strings, so no ICU library applies its own number formatting.
 */
export function violationArguments(violation: RuleViolation): Record<string, string> {
  const args: Record<string, string> = { field: violationField(violation.path) };
  for (const [name, value] of Object.entries(violation.params)) args[name] = String(value);
  return args;
}
