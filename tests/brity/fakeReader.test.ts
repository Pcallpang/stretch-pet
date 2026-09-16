import { describe, it, expect, vi } from 'vitest';
import { createFakeBrityReader } from '../../src/main/brity/fakeReader';

describe('createFakeBrityReader', () => {
  it('start 이후 triggerTestMessage를 호출하면 콜백이 한 번 불린다', () => {
    const reader = createFakeBrityReader();
    const onMessage = vi.fn();
    reader.start(onMessage);
    reader.triggerTestMessage();
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0]).toMatchObject({ sender: expect.any(String), body: expect.any(String) });
  });
  it('start 전에 트리거하면 아무 일도 일어나지 않는다', () => {
    const reader = createFakeBrityReader();
    expect(() => reader.triggerTestMessage()).not.toThrow();
  });
  it('stop 이후 트리거하면 콜백이 불리지 않는다', () => {
    const reader = createFakeBrityReader();
    const onMessage = vi.fn();
    reader.start(onMessage);
    reader.stop();
    reader.triggerTestMessage();
    expect(onMessage).not.toHaveBeenCalled();
  });
});
