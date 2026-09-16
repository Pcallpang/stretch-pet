import { describe, it, expect } from 'vitest';
import { maskPhoneNumbers } from '../../src/main/brity/masking';

describe('maskPhoneNumbers', () => {
  it('하이픈 있는 번호를 가린다', () => {
    expect(maskPhoneNumbers('연락처 010-1234-5678 입니다')).toBe('연락처 010-****-**78 입니다');
  });
  it('하이픈 없는 번호도 가린다', () => {
    expect(maskPhoneNumbers('01012345678로 연락주세요')).toBe('010-****-**78로 연락주세요');
  });
  it('번호가 없으면 그대로 반환한다', () => {
    expect(maskPhoneNumbers('내일 회의 있습니다')).toBe('내일 회의 있습니다');
  });
  it('빈 문자열/undefined 입력을 안전하게 처리한다', () => {
    expect(maskPhoneNumbers('')).toBe('');
  });
});
