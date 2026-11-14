import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import { hashInviteCode, matchInviteCode, newInviteCode, parseBearer } from './invite-code.ts';

vi.mock('node:crypto', { spy: true });

const entry = (label: string, code: string) => ({ label, hash: hashInviteCode(code) });

describe('parseBearer', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['BEARER\tabc  ', 'abc'],
  ])('AC-GATE-02: %j carries a code (scheme case-insensitive)', (header, code) => {
    expect(parseBearer(header)).toBe(code);
  });

  it.each([null, '', 'Bearer', 'Bearer ', 'Basic abc', 'Bearerabc', 'Bearer a b', 'abc'])(
    'AC-GATE-02: %j carries no code',
    (header) => {
      expect(parseBearer(header)).toBeUndefined();
    },
  );
});

describe('matchInviteCode', () => {
  const codes = [entry('alice', 'code-a'), entry('bob', 'code-b')];
  const revoked = [entry('carol', 'code-c')];

  it('AC-GATE-05: any configured code matches, by its label', () => {
    expect(matchInviteCode('code-a', codes, revoked)).toEqual({ kind: 'allowed', label: 'alice' });
    expect(matchInviteCode('code-b', codes, revoked)).toEqual({ kind: 'allowed', label: 'bob' });
  });

  it('AC-GATE-02: a revoked code is recognized as revoked, and an unknown one as unknown', () => {
    expect(matchInviteCode('code-c', codes, revoked)).toEqual({ kind: 'revoked', label: 'carol' });
    expect(matchInviteCode('code-z', codes, revoked)).toEqual({ kind: 'unknown' });
    expect(matchInviteCode('code-a', [], [])).toEqual({ kind: 'unknown' });
  });

  it('AC-GATE-05: compares with every entry in constant time, even after a match', () => {
    const compare = vi.mocked(crypto.timingSafeEqual);
    compare.mockClear();
    matchInviteCode('code-a', codes, revoked);
    expect(compare).toHaveBeenCalledTimes(3);
    for (const [a, b] of compare.mock.calls) {
      expect((a as Buffer).length).toBe(32);
      expect((b as Buffer).length).toBe(32);
    }
  });
});

describe('newInviteCode', () => {
  it('AC-GATE-15: makes distinct 256-bit base64url codes that their own hash matches', () => {
    const a = newInviteCode();
    const b = newInviteCode();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parseBearer(`Bearer ${a}`)).toBe(a);
    expect(matchInviteCode(a, [entry('new', a)], [])).toEqual({ kind: 'allowed', label: 'new' });
  });

  it('hashes to lowercase hex SHA-256', () => {
    expect(hashInviteCode('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
