import type { BrityMessage, BrityReader } from './reader';

export function createFakeBrityReader(): BrityReader & { triggerTestMessage(): void } {
  let callback: ((msg: BrityMessage) => void) | null = null;

  return {
    start(onMessage) {
      callback = onMessage;
    },
    stop() {
      callback = null;
    },
    triggerTestMessage() {
      if (!callback) return;
      callback({
        sender: '테스트 발신자',
        receivedAt: new Date().toISOString(),
        body: '[테스트] 다음 주 화요일 15시 3층 회의실에서 학년부 협의회가 있습니다.',
      });
    },
  };
}
