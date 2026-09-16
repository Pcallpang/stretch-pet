import type { BrityMessage, BrityReader } from './reader';
import type { IngestResult } from './ingestClient';
import { enqueue, pruneExpired, MAX_AGE_MS, type QueuedMessage } from './retryQueue';

export interface MessengerAlertServiceDeps {
  reader: BrityReader;
  sendFn: (token: string, msg: BrityMessage) => Promise<IngestResult>;
  getToken: () => string | null;
  loadQueue: () => QueuedMessage[];
  saveQueue: (q: QueuedMessage[]) => void;
  now: () => number;
  /** 메신저 알리미가 "켜짐" 상태인지 — 꺼져 있으면 큐를 밖으로 전송하지 않는다. */
  isEnabled: () => boolean;
  onNewAlert: (count: number) => void; // 성공적으로 저장된 쪽지가 생길 때마다 누적 미확인 건수를 알림
  onNeedsLogin: () => void; // 401 응답을 받으면 호출 (재로그인 유도용)
}

export class MessengerAlertService {
  private unreadCount = 0;
  private running = false;
  // flushRetryQueue는 5분 간격 타이머에서 호출된다. 네트워크가 느리면 이전 flush가
  // 끝나기 전에 다음 flush가 시작돼 같은 항목을 두 번 보내고 큐 파일을 서로
  // 덮어쓸 수 있으므로, 진행 중이면 그냥 건너뛴다.
  private flushing = false;

  constructor(private readonly deps: MessengerAlertServiceDeps) {}

  // start/stop은 시작·로그인·로그아웃·토글 등 여러 경로에서 반복 호출되므로
  // 멱등해야 한다(이미 시작된 리더를 또 start 하지 않는다).
  start(): void {
    if (this.running) return;
    // reader.start가 실패(예외)하면 감시기가 없는데도 running이 true로 남아
    // 이후 start 호출이 전부 무시된다 — 성공한 뒤에만 플래그를 올린다.
    this.deps.reader.start((msg) => {
      if (this.running) void this.handleNewMessage(msg);
    });
    this.running = true;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.deps.reader.stop();
  }

  getUnreadCount(): number {
    return this.unreadCount;
  }

  resetUnreadCount(): void {
    this.unreadCount = 0;
  }

  private async handleNewMessage(msg: BrityMessage): Promise<void> {
    const token = this.deps.getToken();
    if (!token) {
      this.queueForRetry(msg);
      return;
    }
    const result = await this.deps.sendFn(token, msg);
    if (result.ok) {
      if (result.stored) {
        this.unreadCount += 1;
        this.deps.onNewAlert(this.unreadCount);
      }
      return;
    }
    if (result.needsLogin) this.deps.onNeedsLogin();
    this.queueForRetry(msg);
  }

  private queueForRetry(msg: BrityMessage): void {
    const queue = this.deps.loadQueue();
    this.deps.saveQueue(enqueue(queue, msg, this.deps.now()));
  }

  /**
   * 큐에 쌓인 항목을 다시 보내본다 — 만료된 항목은 시도 없이 버린다.
   * 기능이 꺼져 있으면 아무것도 전송하지 않는다(만료 정리는 계속 수행해서
   * 큐가 영원히 남지 않게 한다).
   */
  async flushRetryQueue(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const now = this.deps.now();
      const fresh = pruneExpired(this.deps.loadQueue(), now, MAX_AGE_MS);
      const token = this.deps.getToken();
      if (!token || !this.deps.isEnabled()) {
        this.deps.saveQueue(fresh);
        return;
      }
      const remaining: QueuedMessage[] = [];
      let needsLogin = false;
      for (let i = 0; i < fresh.length; i += 1) {
        const item = fresh[i];
        const result = await this.deps.sendFn(token, item.msg);
        if (result.ok) {
          if (result.stored) {
            this.unreadCount += 1;
            this.deps.onNewAlert(this.unreadCount);
          }
          continue; // 성공했으니 큐에서 제외
        }
        if (result.needsLogin) {
          // 토큰이 죽었다 — 남은 항목을 같은 토큰으로 계속 보내봐야 전부 401이고
          // onNeedsLogin도 항목 수만큼 반복 호출된다. 한 번만 알리고 멈춘다.
          needsLogin = true;
          remaining.push(...fresh.slice(i)); // 실패한 항목 + 아직 시도 못 한 항목 전부 보존
          break;
        }
        remaining.push(item); // 실패했으니 큐에 남긴다
      }
      // 느린 전송을 기다리는 사이에 사용자가 로그아웃했다면(로그아웃은 토큰을 지우고
      // 큐 파일을 비운다) 여기서 remaining을 쓰면 이전 계정의 쪽지가 되살아나
      // 다음 사용자의 플래너로 올라간다 — 세션이 바뀌었으면 저장을 건너뛴다.
      if (this.deps.getToken() === null) return;
      this.deps.saveQueue(remaining);
      // onNeedsLogin은 토큰을 지우므로(main.ts) 위 세션 검사 뒤에 호출해야
      // 정상적인 401 처리가 "로그아웃"으로 오인되지 않는다.
      if (needsLogin) this.deps.onNeedsLogin();
    } finally {
      this.flushing = false;
    }
  }
}
