// Signs Google-style ID tokens with a local key pair, so the ID-token path is tested without
// fetching Google's keys (WU-23a plan D4). Test-only.
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

export const TEST_AUDIENCE = 'ai-trip-planner-api';
export const TEST_ACCOUNT = 'deploy@test-project.iam.gserviceaccount.com';
/** A fixed instant, in seconds, that test tokens are issued at. */
export const ISSUED_AT = 1_800_000_000;

export interface TestSigner {
  /** The verifier's key source: this signer's public key, as Google's JWKS would hold it. */
  keys: JWTVerifyGetKey;
  /** A token with valid defaults for every claim, overridable one by one. */
  sign(
    claims?: JWTPayload & { email?: unknown; email_verified?: unknown },
    header?: { alg?: string; kid?: string },
  ): Promise<string>;
}

export async function testSigner(kid = 'test-key'): Promise<TestSigner> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return {
    keys: createLocalJWKSet({ keys: [jwk] }),
    sign: (claims = {}, header = {}) =>
      new SignJWT({
        iss: 'https://accounts.google.com',
        aud: TEST_AUDIENCE,
        iat: ISSUED_AT,
        exp: ISSUED_AT + 3600,
        email: TEST_ACCOUNT,
        email_verified: true,
        ...claims,
      })
        .setProtectedHeader({ alg: header.alg ?? 'RS256', kid: header.kid ?? kid })
        .sign(privateKey),
  };
}
