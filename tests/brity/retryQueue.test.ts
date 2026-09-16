import { describe, it, expect } from 'vitest';
import { enqueue, pruneExpired, MAX_AGE_MS } from '../../src/main/brity/retryQueue';

const sampleMsg = { sender: null, receivedAt: '2026-09-16T09:00:00+09:00', body: '테스트' };

describe('enqueue', () => {
  it('빈 큐에 항목을 추가한다', () => {
    const q = enqueue([], sampleMsg, 1000);
    expect(q).toEqual([{ msg: sampleMsg, firstSeenAt: 1000 }]);
  });
  it('기존 큐 뒤에 추가한다(기존 항목 보존)', () => {
    const existing = [{ msg: sampleMsg, firstSeenAt: 500 }];
    const q = enqueue(existing, sampleMsg, 1000);
    expect(q).toHaveLength(2);
    expect(q[0].firstSeenAt).toBe(500);
  });
});

describe('pruneExpired', () => {
  it('MAX_AGE_MS보다 오래된 항목을 제거한다', () => {
    const q = [{ msg: sampleMsg, firstSeenAt: 0 }];
    expect(pruneExpired(q, MAX_AGE_MS + 1, MAX_AGE_MS)).toEqual([]);
  });
  it('아직 만료되지 않은 항목은 남긴다', () => {
    const q = [{ msg: sampleMsg, firstSeenAt: 0 }];
    expect(pruneExpired(q, MAX_AGE_MS - 1, MAX_AGE_MS)).toEqual(q);
  });
});
