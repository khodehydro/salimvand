import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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
