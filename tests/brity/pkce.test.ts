import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, codeChallengeFromVerifier } from '../../src/main/brity/pkce';

describe('pkce', () => {
  it('generateCodeVerifier는 43자 이상의 URL-safe 문자열을 만든다', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('generateCodeVerifier는 매번 다른 값을 만든다', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
  it('codeChallengeFromVerifier는 같은 입력에 같은 값을 낸다', () => {
    const v = generateCodeVerifier();
    expect(codeChallengeFromVerifier(v)).toBe(codeChallengeFromVerifier(v));
  });
  it('codeChallengeFromVerifier 결과는 URL-safe하고 verifier와 다르다', () => {
    const v = generateCodeVerifier();
    const c = codeChallengeFromVerifier(v);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c).not.toBe(v);
  });
});
