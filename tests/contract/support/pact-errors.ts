// pact-core swallows the native library's load error and later fails on an undefined binding with
// a TypeError like "Cannot read properties of undefined (reading 'pactffiInitWithLogLevel')". On
// Windows the usual cause is a missing Visual C++ runtime (VCRUNTIME140.dll; WU-07 plan X1).

const NATIVE_LOAD_FAILURE = /reading 'pactffi\w+'/;

export const NATIVE_HINT =
  'The Pact native library failed to load. On Windows, install the Microsoft Visual C++ ' +
  '2015-2022 Redistributable (x64): winget install Microsoft.VCRedist.2015+.x64. See README ' +
  'Prerequisites.';

/** Returns an error with an install hint for a native load failure, or the error unchanged. */
export function explainPactError(error: unknown): unknown {
  if (error instanceof TypeError && NATIVE_LOAD_FAILURE.test(error.message)) {
    return new Error(`${NATIVE_HINT}\nOriginal error: ${error.message}`, { cause: error });
  }
  return error;
}
