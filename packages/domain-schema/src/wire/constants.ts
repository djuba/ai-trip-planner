// Shared constants (CLAUDE.md §4.7), also written to generated/constants.json for other backends.

/** Semantic version of the HTTP contract, reported by `GET /v1/health`. */
export const CONTRACT_VERSION = '0.2.0';

/** A profile with fewer populated fields than this yields INSUFFICIENT_DETAIL (§4.7). */
export const MIN_POPULATED_FIELDS = 3;

/** A request body larger than this many bytes gets a 413 `PAYLOAD_TOO_LARGE` (§5). */
export const MAX_REQUEST_BODY_BYTES = 1_048_576;
