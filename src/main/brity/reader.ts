export interface BrityMessage {
  sender: string | null;
  receivedAt: string;
  body: string;
}

/**
 * 브리티 메신저에서 새 쪽지를 읽어오는 소스의 인터페이스.
 * 지금은 FakeBrityReader(수동 트리거)만 있고, 실제 Windows 접근성 기반 구현은
 * 다음 단계에서 이 인터페이스 뒤에 추가된다 — 이 인터페이스 사용처(orchestrator, main.ts)는
 * 그때 손댈 필요가 없다.
 */
export interface BrityReader {
  /**
   * 감시를 시작한다. 구현체는 `start`/`stop`이 여러 번 반복 호출돼도 안전해야 한다
   * (이미 시작된 상태에서 다시 `start`가 불려도 감시기를 중복 생성하지 않고,
   * 이미 멈춘 상태에서 `stop`이 불려도 오류 없이 넘어가야 한다).
   */
  start(onMessage: (msg: BrityMessage) => void): void;
  stop(): void;
}
