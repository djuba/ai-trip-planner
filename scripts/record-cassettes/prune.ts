// Which cassettes `pnpm record:cassettes --prune` deletes (WU-15 plan, WU-08 note R5), as a pure
// function so it can be unit-tested. A cassette goes when no gated suite replayed its key, unless
// its request holds a kept marker: the functional 502 tests copy such a cassette and swap its
// response, so they replay a copy under the same key and the log never names the original.
import { UPSTREAM_FAILURE_MESSAGE } from '../journeys/plan-stack.ts';

/** Strings the functional 502 tests (and journey 4) use to pick their source cassette. */
export const KEPT_MARKERS: readonly string[] = [
  // backends/api-nextjs/tests/functional/extract.test.ts
  'Somewhere warm, maybe.',
  // journey 4's failing first extract
  UPSTREAM_FAILURE_MESSAGE,
];

export interface CassetteFile {
  /** The file name without `.json`. */
  key: string;
  /** `JSON.stringify(request.body)` of the cassette. */
  requestBody: string;
}

export function cassettesToPrune(
  files: readonly CassetteFile[],
  usedKeys: ReadonlySet<string>,
  markers: readonly string[] = KEPT_MARKERS,
): string[] {
  return files
    .filter(
      (file) =>
        !usedKeys.has(file.key) && !markers.some((marker) => file.requestBody.includes(marker)),
    )
    .map((file) => file.key);
}

/**
 * Runs `suites` in order and calls `prune` only when every one exits 0 (review finding 4). The
 * first failure stops the run: later suites don't start, nothing is deleted, and its code is
 * returned, so a usage log from a partial run can never delete a cassette.
 */
export async function afterAllPass(
  suites: readonly (() => Promise<number>)[],
  prune: () => number,
  onFailure: () => void = () => undefined,
): Promise<number> {
  for (const suite of suites) {
    const code = await suite();
    if (code !== 0) {
      onFailure();
      return code;
    }
  }
  return prune();
}
