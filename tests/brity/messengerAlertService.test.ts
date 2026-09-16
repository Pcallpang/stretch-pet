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
    isEnabled: () => true,
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

  it('401(needsLogin)이면 큐에 먼저 쌓고 그 다음 onNeedsLogin을 부른다 — 콜백이 큐를 비우므로 최종 큐는 비어 있다', async () => {
    // main.ts의 onNeedsLogin은 clearToken() + saveQueueFile([])를 한다.
    // 서비스가 콜백을 먼저 부르면 방금 비워진 큐 파일 위에 이 쪽지가 다시 쓰여
    // 이전 선생님 쪽지가 디스크에 남는다. 이 테스트가 두 문장의 순서를 고정한다.
    let token: string | null = 'fake-token';
    let queueFile: any[] = [];
    const events: string[] = [];
    const onNeedsLogin = vi.fn(() => {
      // 콜백이 불리는 시점에는 이 쪽지가 이미 큐에 들어가 있어야 한다.
      events.push(`onNeedsLogin:queue=${queueFile.length}`);
      token = null; // main.ts: clearToken()
      queueFile = []; // main.ts: saveQueueFile([]) — 세션이 죽으면 큐도 비운다
    });
    const { service, reader } = makeService({
      sendFn: vi.fn().mockResolvedValue({ ok: false, needsLogin: true, error: '다시 로그인해 주세요.' }),
      getToken: () => token,
      loadQueue: () => queueFile,
      saveQueue: (q: any[]) => { events.push(`saveQueue:${q.length}`); queueFile = q; },
      onNeedsLogin,
    });
    service.start();
    reader.triggerTestMessage();
    await vi.waitFor(() => expect(onNeedsLogin).toHaveBeenCalled());
    expect(onNeedsLogin).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['saveQueue:1', 'onNeedsLogin:queue=1']);
    expect(token).toBeNull();
    // 세션 사망 처리로 큐가 비워졌으므로 최종 큐 파일은 비어 있다 —
    // 이 쪽지가 콜백 "뒤에" 쓰여 살아남는 일이 없다.
    expect(queueFile).toEqual([]);
  });

  it('새 쪽지 전송 대기 중 토큰이 다른 계정 것으로 바뀌면 큐에 쓰지도, onNeedsLogin을 부르지도 않는다', async () => {
    // 전송에 타임아웃이 없어 A가 로그아웃하고 B가 로그인할 시간이 생긴다.
    // 뒤늦게 도착한 A의 전송 실패가 B의 큐 파일에 A의 쪽지를 섞어 넣으면 안 된다.
    let token: string | null = 'teacher-A-token';
    let saved: any[] | null = null;
    const sendFn = vi.fn().mockImplementation(async () => {
      token = 'teacher-B-token'; // A 로그아웃 → B 로그인이 전송 대기 중에 끝났다
      return { ok: false, needsLogin: false, error: '네트워크 오류' };
    });
    const { service, reader, onNeedsLogin } = makeService({
      getToken: () => token,
      saveQueue: (q: any[]) => { saved = q; },
      sendFn,
    });
    service.start();
    reader.triggerTestMessage();
    await vi.waitFor(() => expect(sendFn).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(saved).toBeNull(); // B의 큐 파일을 건드리지 않았다
    expect(onNeedsLogin).not.toHaveBeenCalled(); // B의 새 세션을 흔들지도 않았다
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

  it('기능이 꺼져 있으면 전송하지 않지만 만료 정리는 저장한다', async () => {
    const oldItem = { msg: { sender: null, receivedAt: 'x', body: '만료됨' }, firstSeenAt: 0 };
    const freshItem = { msg: { sender: null, receivedAt: 'y', body: '아직 살아있음' }, firstSeenAt: 8 * 24 * 60 * 60 * 1000 };
    const { service, deps, getQueue } = makeService({
      isEnabled: () => false,
      loadQueue: () => [oldItem, freshItem],
      now: () => 8 * 24 * 60 * 60 * 1000, // 8일 후 — oldItem만 만료
    });
    await service.flushRetryQueue();
    expect(deps.sendFn).not.toHaveBeenCalled();
    expect(getQueue()).toEqual([freshItem]);
  });

  it('flush가 진행 중이면 두 번째 flush는 큐를 다시 훑지 않는다', async () => {
    const items = [
      { msg: { sender: null, receivedAt: 'a', body: '1' }, firstSeenAt: 500 },
      { msg: { sender: null, receivedAt: 'b', body: '2' }, firstSeenAt: 500 },
    ];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    const sendFn = vi.fn().mockImplementation(async () => {
      if (first) { first = false; await gate; }
      return { ok: true, stored: true };
    });
    const { service, getQueue } = makeService({ loadQueue: () => items, sendFn });

    const p1 = service.flushRetryQueue();
    await Promise.resolve();
    await service.flushRetryQueue(); // 재진입 — 아무 일도 하지 않고 끝나야 한다
    expect(sendFn).toHaveBeenCalledTimes(1); // 두 번째 flush가 새 전송을 시작하지 않았다
    release();
    await p1;
    expect(sendFn).toHaveBeenCalledTimes(2); // 첫 flush가 항목 2개를 한 번씩만 보냈다
    expect(getQueue()).toHaveLength(0);
  });

  it('flush 도중 로그아웃(토큰 삭제)되면 마지막 저장을 건너뛰어 큐가 되살아나지 않는다', async () => {
    const items = [{ msg: { sender: null, receivedAt: 'a', body: '이전 계정 쪽지' }, firstSeenAt: 500 }];
    let token: string | null = 'fake-token';
    let saved: any[] | null = null;
    const { service } = makeService({
      loadQueue: () => items,
      saveQueue: (q: any[]) => { saved = q; },
      getToken: () => token,
      sendFn: vi.fn().mockImplementation(async () => {
        token = null; // 전송을 기다리는 사이 사용자가 로그아웃
        return { ok: false, needsLogin: false, error: '네트워크 오류' };
      }),
    });
    await service.flushRetryQueue();
    expect(saved).toBeNull(); // 큐 파일을 다시 쓰지 않았다
  });

  it('flush 중 401이면 onNeedsLogin을 한 번만 부르고 남은 항목을 전부 보존한다', async () => {
    const items = [1, 2, 3, 4, 5].map((n) => ({
      msg: { sender: null, receivedAt: `r${n}`, body: `쪽지${n}` },
      firstSeenAt: 500,
    }));
    const sendFn = vi.fn().mockImplementation(async (_t: string, msg: any) =>
      msg.body === '쪽지1'
        ? { ok: true, stored: true }
        : { ok: false, needsLogin: true, error: '다시 로그인해 주세요.' },
    );
    const { service, onNeedsLogin, getQueue } = makeService({ loadQueue: () => items, sendFn });
    await service.flushRetryQueue();
    expect(sendFn).toHaveBeenCalledTimes(2); // 1번 성공, 2번에서 401 → 중단
    expect(onNeedsLogin).toHaveBeenCalledTimes(1);
    expect(getQueue()).toEqual(items.slice(1)); // 401난 2번 + 시도조차 안 한 3·4·5번
  });

  it('flush 도중 토큰이 다른 계정 것으로 바뀌면 마지막 저장을 건너뛴다', async () => {
    // 전송에 타임아웃이 없어 A가 로그아웃하고 B가 로그인할 시간이 생긴다.
    // 토큰이 null이 아니라 "다른 값"으로 바뀌는 경우 — null 검사로는 못 잡는다.
    const items = [{ msg: { sender: null, receivedAt: 'a', body: 'A선생님 쪽지' }, firstSeenAt: 500 }];
    let token: string | null = 'teacher-A-token';
    let saved: any[] | null = null;
    const { service } = makeService({
      loadQueue: () => items,
      saveQueue: (q: any[]) => { saved = q; },
      getToken: () => token,
      sendFn: vi.fn().mockImplementation(async () => {
        token = 'teacher-B-token'; // A 로그아웃 → B 로그인이 전송 대기 중에 끝났다
        return { ok: false, needsLogin: false, error: '네트워크 오류' };
      }),
    });
    await service.flushRetryQueue();
    expect(saved).toBeNull(); // A의 쪽지가 B의 큐 파일로 되살아나지 않았다
  });

  it('401 시 saveQueue가 onNeedsLogin보다 먼저 일어난다(main.ts 동작 그대로 재현)', async () => {
    // main.ts의 onNeedsLogin은 clearToken() + saveQueueFile([])를 한다.
    // 서비스가 saveQueue와 onNeedsLogin의 순서를 뒤바꾸면
    //   ① 세션 검사가 401을 "세션 교체"로 오인하거나
    //   ② 비워진 큐 파일 위에 remaining이 다시 쓰여 이전 계정 쪽지가 되살아난다.
    // 이 테스트는 두 문장의 순서를 고정한다.
    const items = [1, 2, 3, 4, 5].map((n) => ({
      msg: { sender: null, receivedAt: `r${n}`, body: `쪽지${n}` },
      firstSeenAt: 500,
    }));
    let token: string | null = 'fake-token';
    let queueFile: any[] = items;
    const events: string[] = [];
    const onNeedsLogin = vi.fn(() => {
      events.push('onNeedsLogin');
      token = null; // main.ts: clearToken()
      queueFile = []; // main.ts: saveQueueFile([]) — 세션이 죽으면 큐도 비운다
    });
    const sendFn = vi.fn().mockImplementation(async (_t: string, msg: any) =>
      msg.body === '쪽지1'
        ? { ok: true, stored: true }
        : { ok: false, needsLogin: true, error: '다시 로그인해 주세요.' },
    );
    const { service } = makeService({
      loadQueue: () => queueFile,
      saveQueue: (q: any[]) => { events.push(`saveQueue:${q.length}`); queueFile = q; },
      getToken: () => token,
      sendFn,
      onNeedsLogin,
    });
    await service.flushRetryQueue();
    expect(onNeedsLogin).toHaveBeenCalledTimes(1);
    // 401난 2번 + 시도조차 못 한 3·4·5번이 먼저 저장되고, 그 다음에 콜백이 불렸다.
    expect(events).toEqual(['saveQueue:4', 'onNeedsLogin']);
    expect(token).toBeNull();
    // main.ts가 세션 사망 처리로 큐를 비웠으므로 최종 큐 파일은 비어 있다 —
    // 이전 선생님 쪽지가 남아 다음 로그인 계정으로 올라가지 않는다.
    expect(queueFile).toEqual([]);
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
