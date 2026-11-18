import { generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ISSUED_AT,
  TEST_ACCOUNT,
  TEST_AUDIENCE,
  testSigner,
  type TestSigner,
} from '../../tests/support/id-token.ts';
import {
  GOOGLE_JWKS_URL,
  createIdTokenVerifier,
  googleIdTokenVerifier,
  looksLikeJwt,
  type IdTokenVerifier,
} from './id-token.ts';

const NOW = (ISSUED_AT + 60) * 1000;

let signer: TestSigner;
let verifier: IdTokenVerifier;

beforeAll(async () => {
  signer = await testSigner();
  verifier = createIdTokenVerifier({ audience: TEST_AUDIENCE, keys: signer.keys });
});

describe('looksLikeJwt', () => {
  it('tells a JWT (three dot-separated parts) from an invite code (base64url, no dot)', () => {
    expect(looksLikeJwt('a.b.c')).toBe(true);
    expect(looksLikeJwt('Ab_-0123456789abcdefghijklmnopqrstuvwxyzABCDE')).toBe(false);
    expect(looksLikeJwt('a.b')).toBe(false);
    expect(looksLikeJwt('a.b.c.d')).toBe(false);
  });
});

describe('createIdTokenVerifier', () => {
  it('AC-GATE-23: a valid Google ID token yields its verified email', async () => {
    await expect(verifier.verify(await signer.sign(), NOW)).resolves.toBe(TEST_ACCOUNT);
  });

  it('AC-GATE-23: accepts both forms of Google’s issuer', async () => {
    const token = await signer.sign({ iss: 'accounts.google.com' });
    await expect(verifier.verify(token, NOW)).resolves.toBe(TEST_ACCOUNT);
  });

  it('AC-GATE-23: tolerates 30 seconds of clock skew at expiry, no more', async () => {
    const token = await signer.sign();
    const expiry = (ISSUED_AT + 3600) * 1000;
    await expect(verifier.verify(token, expiry + 29_000)).resolves.toBe(TEST_ACCOUNT);
    await expect(verifier.verify(token, expiry + 31_000)).resolves.toBeUndefined();
  });

  it.each([
    ['another issuer', { iss: 'https://evil.example' }],
    ['another audience', { aud: 'some-other-service' }],
    ['no expiry', { exp: undefined }],
    ['no issued-at', { iat: undefined }],
    ['an unverified email', { email_verified: false }],
    ['email_verified as a string', { email_verified: 'true' }],
    ['no email', { email: undefined }],
    ['a non-string email', { email: 42 }],
  ])('AC-GATE-24: refuses a token with %s', async (_, claims) => {
    await expect(verifier.verify(await signer.sign(claims), NOW)).resolves.toBeUndefined();
  });

  it('AC-GATE-24: refuses an expired token', async () => {
    const token = await signer.sign({ exp: ISSUED_AT + 10 });
    await expect(verifier.verify(token, (ISSUED_AT + 100) * 1000)).resolves.toBeUndefined();
  });

  it('AC-GATE-24: refuses a token signed by another key, even with the same kid', async () => {
    const other = await testSigner('test-key');
    await expect(verifier.verify(await other.sign(), NOW)).resolves.toBeUndefined();
  });

  it('AC-GATE-24: refuses another algorithm, including an HMAC signed with the public key', async () => {
    const { privateKey } = await generateKeyPair('PS256');
    const ps256 = await new SignJWT({
      iss: 'https://accounts.google.com',
      aud: TEST_AUDIENCE,
      iat: ISSUED_AT,
      exp: ISSUED_AT + 3600,
      email: TEST_ACCOUNT,
      email_verified: true,
    })
      .setProtectedHeader({ alg: 'PS256', kid: 'test-key' })
      .sign(privateKey);
    await expect(verifier.verify(ps256, NOW)).resolves.toBeUndefined();

    const hs256 = await new SignJWT({ aud: TEST_AUDIENCE, email: TEST_ACCOUNT })
      .setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
      .sign(new TextEncoder().encode('a-guessable-secret-of-enough-length!'));
    await expect(verifier.verify(hs256, NOW)).resolves.toBeUndefined();
  });

  it('AC-GATE-24: refuses an unsigned token (alg none)', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'none' })}.${encode({
      iss: 'https://accounts.google.com',
      aud: TEST_AUDIENCE,
      iat: ISSUED_AT,
      exp: ISSUED_AT + 3600,
      email: TEST_ACCOUNT,
      email_verified: true,
    })}.`;
    await expect(verifier.verify(token, NOW)).resolves.toBeUndefined();
  });

  it('AC-GATE-24: refuses malformed and oversized tokens without throwing', async () => {
    await expect(verifier.verify('a.b.c', NOW)).resolves.toBeUndefined();
    const valid = await signer.sign();
    await expect(verifier.verify(`${valid}${'x'.repeat(5000)}`, NOW)).resolves.toBeUndefined();
  });

  it('AC-GATE-24: a key source that fails refuses the token rather than throwing', async () => {
    const failing = createIdTokenVerifier({
      audience: TEST_AUDIENCE,
      keys: () => Promise.reject(new Error('keys unreachable')),
    });
    await expect(failing.verify(await signer.sign(), NOW)).resolves.toBeUndefined();
  });
});

describe('googleIdTokenVerifier', () => {
  it('uses Google’s published keys', () => {
    expect(GOOGLE_JWKS_URL).toBe('https://www.googleapis.com/oauth2/v3/certs');
    expect(googleIdTokenVerifier(TEST_AUDIENCE)).toHaveProperty('verify');
  });
});
