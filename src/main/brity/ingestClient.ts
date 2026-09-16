import { maskPhoneNumbers } from './masking';
import { serverUrl } from './config';

export interface BrityMessage {
  sender: string | null;
  receivedAt: string;
  body: string;
}

export type IngestResult =
  | { ok: true; stored: boolean; reason?: string }
  | { ok: false; needsLogin: boolean; error: string };

/** 전송 직전에 전화번호를 마스킹한 요청 본문을 만든다 (네트워크 호출 없음, 순수 함수). */
export function buildIngestPayload(msg: BrityMessage): { sender: string | null; receivedAt: string; body: string } {
  return {
    sender: msg.sender ? maskPhoneNumbers(msg.sender) : null,
    receivedAt: msg.receivedAt,
    body: maskPhoneNumbers(msg.body),
  };
}

/** 미요플래너 서버로 쪽지를 전송한다. 실패해도 예외를 던지지 않고 결과 객체로 알린다. */
export async function sendMessengerAlert(token: string, msg: BrityMessage): Promise<IngestResult> {
  try {
    const res = await fetch(`${serverUrl()}/api/messenger-alert/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `session=${token}` },
      body: JSON.stringify(buildIngestPayload(msg)),
    });
    if (res.status === 401) {
      return { ok: false, needsLogin: true, error: '다시 로그인해 주세요.' };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, needsLogin: false, error: (body.error as string) || `서버 응답 오류: ${res.status}` };
    }
    return { ok: true, stored: Boolean(body.stored), reason: body.reason as string | undefined };
  } catch (e) {
    return { ok: false, needsLogin: false, error: e instanceof Error ? e.message : '네트워크 오류' };
  }
}
