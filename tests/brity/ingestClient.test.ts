import { describe, it, expect } from 'vitest';
import { buildIngestPayload } from '../../src/main/brity/ingestClient';

describe('buildIngestPayload', () => {
  it('본문의 전화번호를 마스킹한다', () => {
    const payload = buildIngestPayload({
      sender: '교무실', receivedAt: '2026-09-16T09:00:00+09:00', body: '010-1234-5678로 연락주세요',
    });
    expect(payload.body).toBe('010-****-**78로 연락주세요');
  });
  it('발신자의 전화번호도 마스킹한다', () => {
    const payload = buildIngestPayload({
      sender: '김OO(010-1234-5678)', receivedAt: '2026-09-16T09:00:00+09:00', body: '안녕하세요',
    });
    expect(payload.sender).toBe('김OO(010-****-**78)');
  });
  it('발신자가 없으면 null로 둔다', () => {
    const payload = buildIngestPayload({ sender: null, receivedAt: '2026-09-16T09:00:00+09:00', body: '안녕하세요' });
    expect(payload.sender).toBeNull();
  });
});
