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
  onNewAlert: (count: number) => void; // 성공적으로 저장된 쪽지가 생길 때마다 누적 미확인 건수를 알림
  onNeedsLogin: () => void; // 401 응답을 받으면 호출 (재로그인 유도용)
}

export class MessengerAlertService {
  private unreadCount = 0;
  private running = false;

  constructor(private readonly deps: MessengerAlertServiceDeps) {}

  start(): void {
    this.running = true;
    this.deps.reader.start((msg) => {
      if (this.running) void this.handleNewMessage(msg);
    });
  }

  stop(): void {
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
    if (!this.running) return; // stop() 이후 도착한 응답은 반영하지 않는다
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

  /** 큐에 쌓인 항목을 다시 보내본다 — 만료된 항목은 시도 없이 버린다. */
  async flushRetryQueue(): Promise<void> {
    const now = this.deps.now();
    const fresh = pruneExpired(this.deps.loadQueue(), now, MAX_AGE_MS);
    const token = this.deps.getToken();
    if (!token) {
      this.deps.saveQueue(fresh);
      return;
    }
    const remaining: QueuedMessage[] = [];
    for (const item of fresh) {
      const result = await this.deps.sendFn(token, item.msg);
      if (result.ok) {
        if (result.stored) {
          this.unreadCount += 1;
          this.deps.onNewAlert(this.unreadCount);
        }
        continue; // 성공했으니 큐에서 제외
      }
      if (result.needsLogin) this.deps.onNeedsLogin();
      remaining.push(item); // 실패했으니 큐에 남긴다
    }
    this.deps.saveQueue(remaining);
  }
}
