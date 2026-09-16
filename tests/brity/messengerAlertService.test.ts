import { describe, it, expect, vi } from 'vitest';
import { MessengerAlertService } from '../../src/main/brity/messengerAlertService';
import { createFakeBrityReader } from '../../src/main/brity/fakeReader';

function makeService(overrides: Partial<ConstructorParameters<typeof MessengerAlertService>[0]> = {}) {
  const reader = createFakeBrityReader();
  const onNewAlert = vi.fn();
  const onNeedsLogin = vi.fn();
  let queue: any[] = [];
  const deps = {
    reader,
    sendFn: vi.fn().mockResolvedValue({ ok: true, stored: true }),
    getToken: () => 'fake-token',
    loadQueue: () => queue,
    saveQueue: (q: any[]) => { queue = q; },
    now: () => 1000,
    onNewAlert,
    onNeedsLogin,
    ...overrides,
  };
  const service = new MessengerAlertService(deps as any);
  return { service, reader, deps, onNewAlert, onNeedsLogin, getQueue: () => queue };
}

describe('MessengerAlertService', () => {
  it('전송 성공 시 미확인 건수를 1 늘리고 onNewAlert를 호출한다', async () => {
    const { service, reader, onNewAlert } = makeService();
    service.start();
    reader.triggerTestMessage();
    await vi.waitFor(() => expect(onNewAlert).toHaveBeenCalled());
    expect(service.getUnreadCount()).toBe(1);
    expect(onNewAlert).toHaveBeenLastCalledWith(1);
  });

  it('stored:false(중복/일정없음)면 미확인 건수를 늘리지 않는다', async () => {
    const { service, reader, onNewAlert } = makeService({
      sendFn: vi.fn().mockResolvedValue({ ok: true, stored: false, reason: 'duplicate' }),
    });
    service.start();
    reader.triggerTestMessage();
    await new Promise((r) => setTimeout(r, 10));
    expect(onNewAlert).not.toHaveBeenCalled();
    expect(service.getUnreadCount()).toBe(0);
  });

  it('토큰이 없으면 전송을 시도하지 않고 큐에 쌓는다', async () => {
    const { service, reader, deps, getQueue } = makeService({ getToken: () => null });
    service.start();
    reader.triggerTestMessage();
    await new Promise((r) => setTimeout(r, 10));
    expect(deps.sendFn).not.toHaveBeenCalled();
    expect(getQueue()).toHaveLength(1);
  });

  it('전송 실패(네트워크 오류)면 큐에 쌓는다', async () => {
    const { service, reader, getQueue } = makeService({
      sendFn: vi.fn().mockResolvedValue({ ok: false, needsLogin: false, error: '네트워크 오류' }),
    });
    service.start();
    reader.triggerTestMessage();
    await new Promise((r) => setTimeout(r, 10));
    expect(getQueue()).toHaveLength(1);
  });

  it('401(needsLogin)이면 onNeedsLogin을 부르고 큐에 쌓는다', async () => {
    const { service, reader, onNeedsLogin, getQueue } = makeService({
      sendFn: vi.fn().mockResolvedValue({ ok: false, needsLogin: true, error: '다시 로그인해 주세요.' }),
    });
    service.start();
    reader.triggerTestMessage();
    await new Promise((r) => setTimeout(r, 10));
    expect(onNeedsLogin).toHaveBeenCalledTimes(1);
    expect(getQueue()).toHaveLength(1);
  });

  it('flushRetryQueue는 큐에 있던 항목을 다시 보내고, 성공하면 큐에서 지운다', async () => {
    const existingQueueItem = { msg: { sender: null, receivedAt: 'x', body: '재시도용' }, firstSeenAt: 500 };
    const { service, deps, getQueue } = makeService({
      loadQueue: () => [existingQueueItem],
    });
    await service.flushRetryQueue();
    expect(deps.sendFn).toHaveBeenCalledWith('fake-token', existingQueueItem.msg);
    expect(getQueue()).toHaveLength(0);
  });

  it('flushRetryQueue는 7일 넘은 항목은 전송 시도 없이 버린다', async () => {
    const oldItem = { msg: { sender: null, receivedAt: 'x', body: '너무 오래됨' }, firstSeenAt: 0 };
    const { service, deps, getQueue } = makeService({
      loadQueue: () => [oldItem],
      now: () => 8 * 24 * 60 * 60 * 1000, // 8일 후
    });
    await service.flushRetryQueue();
    expect(deps.sendFn).not.toHaveBeenCalled();
    expect(getQueue()).toHaveLength(0);
  });

  it('stop 이후에는 더 이상 새 쪽지를 처리하지 않는다', async () => {
    const { service, reader, onNewAlert } = makeService();
    service.start();
    service.stop();
    reader.triggerTestMessage();
    await new Promise((r) => setTimeout(r, 10));
    expect(onNewAlert).not.toHaveBeenCalled();
  });

  it('resetUnreadCount는 건수를 0으로 되돌린다', async () => {
    const { service, reader } = makeService();
    service.start();
    reader.triggerTestMessage();
    await vi.waitFor(() => expect(service.getUnreadCount()).toBe(1));
    service.resetUnreadCount();
    expect(service.getUnreadCount()).toBe(0);
  });
});
