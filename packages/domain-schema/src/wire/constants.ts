// Shared constants (CLAUDE.md §4.7), also written to generated/constants.json for other backends.

/** Semantic version of the HTTP contract, reported by `GET /v1/health`. */
export const CONTRACT_VERSION = '0.1.0';

/** A profile with fewer populated fields than this yields INSUFFICIENT_DETAIL (§4.7). */
export const MIN_POPULATED_FIELDS = 3;
