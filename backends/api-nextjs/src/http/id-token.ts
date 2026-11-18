// Verifies Google-signed ID tokens, which trusted service accounts send in place of an invite code
// (WU-23a plan D4; AC-GATE-23, -24). `jose` checks the signature, algorithm, issuer, audience and
// expiry; this module adds the email checks. The key source and the clock are injected, so tests
// sign with a local key pair and never fetch.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Google's public keys for ID tokens. They rotate; `createRemoteJWKSet` caches and refetches. */
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
/** Far above any Google ID token; a longer value is refused before it is parsed. */
const MAX_TOKEN_LENGTH = 4096;
const CLOCK_TOLERANCE_SECONDS = 30;

/** A JWT has three dot-separated parts; an invite code (base64url) has no dot. */
export const looksLikeJwt = (credential: string): boolean => credential.split('.').length === 3;

export interface IdTokenVerifier {
  /** The token's verified email, or undefined for any token that fails a check. Never throws. */
  verify(token: string, now: number): Promise<string | undefined>;
}

export function createIdTokenVerifier({
  audience,
  keys,
}: {
  audience: string;
  keys: JWTVerifyGetKey;
}): IdTokenVerifier {
  return {
    async verify(token, now) {
      if (token.length > MAX_TOKEN_LENGTH) return undefined;
      try {
        const { payload } = await jwtVerify(token, keys, {
          algorithms: ['RS256'],
          issuer: GOOGLE_ISSUERS,
          audience,
          requiredClaims: ['exp', 'iat'],
          currentDate: new Date(now),
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
        });
        // Google sets email_verified as a boolean for service accounts.
        if (payload.email_verified !== true || typeof payload.email !== 'string') return undefined;
        return payload.email;
      } catch {
        // Bad signature, wrong alg, issuer or audience, expired, malformed, or keys unreachable:
        // all the same 401 (AC-GATE-24).
        return undefined;
      }
    },
  };
}

/** The production verifier: Google's published keys. */
export function googleIdTokenVerifier(audience: string): IdTokenVerifier {
  return createIdTokenVerifier({ audience, keys: createRemoteJWKSet(new URL(GOOGLE_JWKS_URL)) });
}
