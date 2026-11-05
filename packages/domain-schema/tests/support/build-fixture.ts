// CLAUDE.md §6.1: every mock or fixture payload is built through this helper, so a payload that
// drifts from the contract fails where it is built rather than deep inside a test.
import type { z } from 'zod';

export function buildFixture<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `  ${where}: ${issue.message}`;
    })
    .join('\n');
  throw new Error(`Fixture does not match the contract:\n${issues}`);
}
