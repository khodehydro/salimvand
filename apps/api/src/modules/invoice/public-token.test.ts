import { describe, expect, it } from 'vitest';
import { createPublicToken, hashPublicToken, matchesPublicToken } from './public-token';

describe('public invoice token', () => {
  it('creates a high-entropy token and only stores its hash', () => {
    const first = createPublicToken(); const second = createPublicToken();
    expect(first.token).not.toBe(first.hash); expect(first.token.length).toBeGreaterThan(40); expect(first.hash).toMatch(/^[a-f0-9]{64}$/); expect(first.token).not.toBe(second.token);
  });
  it('matches the original token without accepting a different token', () => { const created = createPublicToken(); expect(matchesPublicToken(created.token, created.hash)).toBe(true); expect(matchesPublicToken(`${created.token}x`, created.hash)).toBe(false); });
  it('produces deterministic hashes for database lookup', () => { expect(hashPublicToken('sample')).toBe(hashPublicToken('sample')); expect(hashPublicToken('sample')).not.toBe(hashPublicToken('other')); });
});
