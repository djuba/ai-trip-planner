// The one place the web app learns where the backend is (CLAUDE.md §5, §9). Read lazily, so a
// build never depends on the variable.
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * The API base URL without a trailing slash. The default argument references the literal
 * `process.env.NEXT_PUBLIC_API_BASE_URL` so Next inlines it into the browser bundle.
 */
export function apiBaseUrl(
  value: string | undefined = process.env.NEXT_PUBLIC_API_BASE_URL,
): string {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    throw new ConfigError('NEXT_PUBLIC_API_BASE_URL is not set');
  }
  return trimmed.replace(/\/+$/, '');
}
