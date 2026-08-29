import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function createPublicShortCode(length = 10): { code: string; hash: string } {
  const bytes = randomBytes(length);
  const code = Array.from(
    bytes,
    (byte) => SHORT_CODE_ALPHABET[byte % SHORT_CODE_ALPHABET.length],
  ).join('');
  return { code, hash: hashPublicToken(code) };
}

export function createPublicToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashPublicToken(token) };
}

export function hashPublicToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function matchesPublicToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPublicToken(token), 'utf8');
  const expected = Buffer.from(expectedHash, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
