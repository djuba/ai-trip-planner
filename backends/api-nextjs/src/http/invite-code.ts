// Invite codes: making, hashing and matching them (WU-22 plan D3). The server holds only hashes,
// and a presented code is compared with every one of them in constant time.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { InviteEntry } from './access-config.ts';

const CODE_BYTES = 32;

/** A new random code: 32 bytes, base64url, so it fits a header and a URL unescaped. */
export function newInviteCode(): string {
  return randomBytes(CODE_BYTES).toString('base64url');
}

/** Lowercase hex SHA-256. The codes are random, so a slow password hash would add nothing. */
export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** The code in `Authorization: Bearer <code>`; the scheme is case-insensitive (RFC 7235). */
export function parseBearer(header: string | null): string | undefined {
  const match = /^bearer[ \t]+(\S+)[ \t]*$/i.exec(header ?? '');
  return match?.[1];
}

export type InviteMatch =
  { kind: 'allowed'; label: string } | { kind: 'revoked'; label: string } | { kind: 'unknown' };

/**
 * Compares the code's digest with every entry's, never stopping early, so the timing shows
 * neither whether nor where it matched. Digests have a fixed length, so neither does the code's.
 */
export function matchInviteCode(
  code: string,
  codes: readonly InviteEntry[],
  revoked: readonly InviteEntry[],
): InviteMatch {
  const digest = createHash('sha256').update(code, 'utf8').digest();
  let found: InviteMatch = { kind: 'unknown' };
  const scan = (list: readonly InviteEntry[], kind: 'allowed' | 'revoked') => {
    for (const entry of list) {
      if (timingSafeEqual(digest, Buffer.from(entry.hash, 'hex'))) {
        found = { kind, label: entry.label };
      }
    }
  };
  scan(codes, 'allowed');
  scan(revoked, 'revoked');
  return found;
}
