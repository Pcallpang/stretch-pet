/**
 * 메신저 알리미가 쓰는 설정값(서버 주소, 구글 데스크톱 클라이언트 ID)을 해석한다.
 *
 * 우선순위:
 *   1) 환경변수(MIYO_SERVER_URL / MIYO_GOOGLE_DESKTOP_CLIENT_ID) — 개발용
 *   2) package.json의 `miyoConfig` — 설치 파일에 함께 구워지는 배포용 기본값
 *
 * native-widget(같은 워크스페이스의 다른 데스크톱 프로그램)과 동일한 서버·클라이언트 ID를
 * 가리켜야 하므로, 같은 환경변수 이름·package.json 키 이름을 그대로 쓴다.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../../package.json');

const fallback: { serverUrl?: string; desktopClientId?: string } = pkg.miyoConfig || {};

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function serverUrl(): string {
  return nonEmpty(process.env.MIYO_SERVER_URL) || nonEmpty(fallback.serverUrl) || 'http://localhost:3001';
}

export function desktopClientId(): string {
  return nonEmpty(process.env.MIYO_GOOGLE_DESKTOP_CLIENT_ID) || nonEmpty(fallback.desktopClientId) || '';
}
