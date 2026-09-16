# 메신저 알리미 (StretchPet 저장소) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스트레칭펫(데스크톱 펫 프로그램)이 미요플래너 계정에 로그인한 뒤, 브리티 메신저의
새 쪽지를 감지하면 말풍선으로 알리고 미요플래너 서버(`/api/messenger-alert/ingest`,
planner 저장소에 이미 구현됨)로 전송해 웹의 "메신저 알리미" 메뉴에 확인 카드로 쌓이게 한다.

**Architecture:** 브리티를 실제로 읽는 부분(Windows 접근성 API)은 이번 환경에서 검증할
방법이 없어(브리티 메신저 미설치, 실제 화면 접근 불가) **이번 단계에서는 만들지 않는다** —
사용자와 합의된 범위 결정이다. 대신 `BrityReader`라는 작은 인터페이스를 정의하고, 지금은
트레이 메뉴의 "테스트 쪽지 보내기"를 눌러야만 메시지를 하나 만들어내는 `FakeBrityReader`로
그 자리를 채운다. 나머지 전체 파이프라인 — 미요플래너 계정 로그인(구글 PKCE), 켜기/끄기
설정과 최초 동의, 전화번호 마스킹, 서버 전송과 실패 시 로컬 재시도 큐, 트레이 상태 표시,
말풍선 알림 — 은 이번에 전부 완성하고 테스트한다. 나중에 `FakeBrityReader`를 실제 브리티
읽기 구현으로 교체하는 것은 `BrityReader` 인터페이스 뒤에서만 일어나는 일이라, 이번에 만든
나머지 코드는 전혀 손대지 않아도 된다.

**Tech Stack:** Electron 33 (메인 프로세스, TypeScript, CommonJS) + `electron-store` +
`vitest`. 새 코드는 모두 `src/main/brity/` 아래에 둔다.

## Global Constraints

- **자동으로 캘린더/To-Do/회의록에 등록하는 로직을 절대 추가하지 않는다** — 이 프로그램은
  서버로 쪽지를 전달만 한다. 확인·등록은 항상 미요플래너 웹 화면에서 사람이 한다
  (planner 저장소 쪽에서 이미 이렇게 구현됨).
- **브리티를 조작하는 코드(답장·전달·삭제)는 만들지 않는다.** 이번 단계는 애초에 브리티를
  읽지도 않으므로 해당 없음 — 나중에 실제 리더를 넣을 때도 지켜야 하는 제약으로 기록해 둔다.
- 메신저 알리미 기능은 **기본값 꺼짐**이며, 사용자가 트레이 메뉴에서 직접 켜야 한다. 로그인
  돼 있지 않으면 켤 수 없다(로그인 먼저 요구).
- **최초로 켤 때 반드시 동의 확인**을 거친다 — "브리티 쪽지 내용이 요약을 위해 외부 AI로
  전송됩니다"라는 안내에 동의해야 실제로 켜진다. 한 번 동의하면 이후 껐다 켜도 다시 묻지
  않는다(설정에 동의 여부를 저장).
- 서버로 보내는 모든 쪽지 본문·발신자 문자열은 **전송 직전에 전화번호를 마스킹**한다
  (010-****-**78 형태) — 서버도 방어적으로 마스킹하지만, 이 프로그램 쪽에서도 원문이
  네트워크에 나가지 않도록 한 번 더 가린다.
- 이 저장소의 테스트 관례: **Electron API(app/Tray/BrowserWindow/ipcMain/safeStorage 등)를
  직접 건드리는 코드는 테스트하지 않는다** — 순수 함수만 `tests/**/*.test.ts`로 테스트한다
  (기존 `settings.test.ts`가 `clampSettings`만 테스트하고 `getSettings`/`setSettings`는
  테스트하지 않는 것과 동일한 패턴).
- 커밋마다 `npm test`(vitest)가 전부 통과해야 한다.
- 미요플래너 서버와의 통신 방식은 이미 같은 워크스페이스의 `native-widget`(파일:
  `C:\Pcall\R02-창작자(Creator)\D01-앱 개발\P01-교육진로웹앱(EdTech)\planner\native-widget\electron\`)이
  검증해 둔 패턴을 그대로 재사용한다 — 구글 PKCE 데스크톱 로그인 → `/api/auth/native-login`
  → 세션 토큰을 `safeStorage`로 암호화해 로컬 파일에 저장 → 이후 요청은
  `Cookie: session=<토큰>` 헤더를 직접 실어 보낸다(실제 브라우저 쿠키가 아니라 헤더로
  흉내내는 것 — Node/Electron 어디서든 동작).

---

## 파일 구조 개요

| 파일 | 설명 |
|---|---|
| `src/main/brity/masking.ts` | 전화번호 마스킹 (server의 `messengerAlerts.js`와 동일 로직, 독립 구현) |
| `src/main/brity/pkce.ts` | PKCE 코드 검증자/챌린지 생성 (native-widget의 `pkce.js` 이식) |
| `src/main/brity/config.ts` | 서버 주소·구글 데스크톱 클라이언트 ID 해석 (native-widget의 `config.js` 이식) |
| `src/main/brity/auth.ts` | 구글 PKCE 로그인, 토큰 저장/로드/삭제 (native-widget의 `auth.js` 이식) |
| `src/main/brity/ingestClient.ts` | 서버로 쪽지 전송 (`POST /api/messenger-alert/ingest`) |
| `src/main/brity/retryQueue.ts` | 전송 실패한 쪽지를 로컬에 쌓아두는 재시도 큐 (7일 만료) |
| `src/main/brity/reader.ts` | `BrityMessage`/`BrityReader` 타입과 인터페이스 |
| `src/main/brity/fakeReader.ts` | 테스트용 가짜 리더 (트레이 메뉴로 수동 트리거) |
| `src/main/brity/messengerAlertService.ts` | 위 조각들을 엮는 오케스트레이터 |
| `src/main/settings.ts` | `messengerAlertEnabled`/`messengerAlertConsented` 필드 추가 (기존 파일 수정) |
| `src/main/tray.ts` | "미요플래너 연동" 메뉴 섹션 추가 (기존 파일 수정) |
| `src/main/main.ts` | 서비스 기동, IPC 핸들러 추가 (기존 파일 수정) |
| `src/main/preload.ts` | 새 IPC 브리지 메서드 추가 (기존 파일 수정) |
| `src/renderer/renderer.ts` | 말풍선 알림 수신·표시 추가 (기존 파일 수정) |
| `package.json` | `miyoConfig`(serverUrl/desktopClientId) 필드 추가 |
| `.env.example` | 개발용 환경변수 예시 추가 |

---

### Task 1: 전화번호 마스킹 (순수 함수)

**Files:**
- Create: `src/main/brity/masking.ts`
- Test: `tests/brity/masking.test.ts`

**Interfaces:**
- Produces: `maskPhoneNumbers(text: string): string` — Task 6(ingestClient)이 전송 직전에 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/brity/masking.test.ts
import { describe, it, expect } from 'vitest';
import { maskPhoneNumbers } from '../../src/main/brity/masking';

describe('maskPhoneNumbers', () => {
  it('하이픈 있는 번호를 가린다', () => {
    expect(maskPhoneNumbers('연락처 010-1234-5678 입니다')).toBe('연락처 010-****-**78 입니다');
  });
  it('하이픈 없는 번호도 가린다', () => {
    expect(maskPhoneNumbers('01012345678로 연락주세요')).toBe('010-****-**78로 연락주세요');
  });
  it('번호가 없으면 그대로 반환한다', () => {
    expect(maskPhoneNumbers('내일 회의 있습니다')).toBe('내일 회의 있습니다');
  });
  it('빈 문자열/undefined 입력을 안전하게 처리한다', () => {
    expect(maskPhoneNumbers('')).toBe('');
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/brity/masking.test.ts`
Expected: FAIL (`Cannot find module '../../src/main/brity/masking'`)

- [ ] **Step 3: 구현**

```ts
// src/main/brity/masking.ts
const PHONE_RE = /01([0-9])[-.\s]?(\d{3,4})[-.\s]?(\d{4})/g;

/** 010-1234-5678 / 01012345678 형태를 010-****-**78 로 가린다. */
export function maskPhoneNumbers(text: string): string {
  if (typeof text !== 'string') return text;
  return text.replace(PHONE_RE, (_match, carrier: string, mid: string, last: string) =>
    `01${carrier}-${'*'.repeat(mid.length)}-**${last.slice(-2)}`);
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/brity/masking.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/main/brity/masking.ts tests/brity/masking.test.ts
git commit -m "feat: 브리티 쪽지 전화번호 마스킹 함수 추가"
```

---

### Task 2: PKCE 함수 (순수 함수, native-widget 이식)

**Files:**
- Create: `src/main/brity/pkce.ts`
- Test: `tests/brity/pkce.test.ts`

**Interfaces:**
- Produces: `generateCodeVerifier(): string`, `codeChallengeFromVerifier(verifier: string): string` —
  Task 5(auth.ts)가 로그인 URL 생성에 사용.

이 파일은 `planner/native-widget/electron/pkce.js`의 로직을 TypeScript로 그대로 이식한다
(CommonJS `require`/`module.exports` 대신 ES 모듈 `import`/`export` 문법만 다르고, 동작은
완전히 동일해야 한다). 참고로 원본의 테스트
(`planner/native-widget/electron/pkce.test.js`)를 먼저 읽어 이식 방향을 확인해도 좋다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/brity/pkce.test.ts
import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, codeChallengeFromVerifier } from '../../src/main/brity/pkce';

describe('pkce', () => {
  it('generateCodeVerifier는 43자 이상의 URL-safe 문자열을 만든다', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('generateCodeVerifier는 매번 다른 값을 만든다', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
  it('codeChallengeFromVerifier는 같은 입력에 같은 값을 낸다', () => {
    const v = generateCodeVerifier();
    expect(codeChallengeFromVerifier(v)).toBe(codeChallengeFromVerifier(v));
  });
  it('codeChallengeFromVerifier 결과는 URL-safe하고 verifier와 다르다', () => {
    const v = generateCodeVerifier();
    const c = codeChallengeFromVerifier(v);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c).not.toBe(v);
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/brity/pkce.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: 구현**

```ts
// src/main/brity/pkce.ts
import * as crypto from 'crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(64));
}

export function codeChallengeFromVerifier(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/brity/pkce.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/main/brity/pkce.ts tests/brity/pkce.test.ts
git commit -m "feat: PKCE 코드 검증자·챌린지 함수 추가 (native-widget 이식)"
```

---

### Task 3: 설정에 메신저 알리미 필드 추가

**Files:**
- Modify: `src/main/settings.ts`
- Modify: `tests/settings.test.ts`

**Interfaces:**
- Produces: `PetSettings.messengerAlertEnabled: boolean`, `PetSettings.messengerAlertConsented: boolean`
  (둘 다 기본값 `false`) — Task 9(오케스트레이터)와 Task 10(main.ts 통합)이 사용.

- [ ] **Step 1: 실패하는 테스트 추가 (기존 `tests/settings.test.ts`에 추가)**

```ts
// tests/settings.test.ts 안, 기존 describe 블록들 옆에 추가
describe('메신저 알리미 필드', () => {
  it('기본값은 둘 다 꺼짐', () => {
    const s = clampSettings({});
    expect(s.messengerAlertEnabled).toBe(false);
    expect(s.messengerAlertConsented).toBe(false);
  });
  it('유효한 boolean 값은 그대로 유지한다', () => {
    const s = clampSettings({ messengerAlertEnabled: true, messengerAlertConsented: true });
    expect(s.messengerAlertEnabled).toBe(true);
    expect(s.messengerAlertConsented).toBe(true);
  });
  it('잘못된 타입은 기본값으로 되돌린다', () => {
    const s = clampSettings({ messengerAlertEnabled: 'yes' as any, messengerAlertConsented: 1 as any });
    expect(s.messengerAlertEnabled).toBe(false);
    expect(s.messengerAlertConsented).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL (`s.messengerAlertEnabled`가 `undefined`라 `toBe(false)` 불일치, 또는 필드 없음으로 실패)

- [ ] **Step 3: `src/main/settings.ts` 수정**

`PetSettings` 인터페이스에 두 필드 추가:
```ts
export interface PetSettings {
  focusMinutes: number;
  stretchMinutes: number;
  soundEnabled: boolean;
  autoStart: boolean;
  pinned: boolean;
  character: 'miyo' | 'miyox' | 'deodeumiyo' | 'godmiyo';
  messengerAlertEnabled: boolean;
  messengerAlertConsented: boolean;
}
```
`DEFAULT_SETTINGS`에 추가:
```ts
export const DEFAULT_SETTINGS: PetSettings = {
  focusMinutes: 50,
  stretchMinutes: 5,
  soundEnabled: false,
  autoStart: false,
  pinned: false,
  character: 'miyox',
  messengerAlertEnabled: false,
  messengerAlertConsented: false,
};
```
`clampSettings` 함수의 반환 객체에 추가:
```ts
    messengerAlertEnabled:
      typeof settings.messengerAlertEnabled === 'boolean' ? settings.messengerAlertEnabled : DEFAULT_SETTINGS.messengerAlertEnabled,
    messengerAlertConsented:
      typeof settings.messengerAlertConsented === 'boolean' ? settings.messengerAlertConsented : DEFAULT_SETTINGS.messengerAlertConsented,
```
(다른 필드들 옆, 객체 리터럴 안에 나란히 추가 — 기존 필드 순서/스타일 그대로 따른다.)

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 5: 커밋**

```bash
git add src/main/settings.ts tests/settings.test.ts
git commit -m "feat: 설정에 메신저 알리미 켜기/동의 필드 추가"
```

---

### Task 4: 서버 주소·구글 클라이언트 ID 해석 (native-widget 이식)

**Files:**
- Create: `src/main/brity/config.ts`

**Interfaces:**
- Produces: `serverUrl(): string`, `desktopClientId(): string` — Task 5(auth.ts), Task 6(ingestClient.ts)가 사용.
- 이 파일은 테스트하지 않는다 (native-widget의 `config.js`도 테스트가 없음 — `package.json`
  읽기 + `process.env` 읽기뿐인 얇은 설정 해석 계층이라 이 저장소 관례상 제외).

- [ ] **Step 1: 구현**

```ts
// src/main/brity/config.ts
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
```

(`require('../../../package.json')`의 상대 경로는 빌드 결과물 위치 `dist/main/brity/config.js`
기준으로 저장소 루트의 `package.json`을 가리킨다 — `tsconfig.main.json`의 `outDir: dist/main`과
일치하는지 반드시 확인한다. 빌드 후 실제 파일 위치가 다르면 상대 경로 깊이를 맞게 고친다.)

- [ ] **Step 2: 컴파일 확인**

Run: `npm run build`
Expected: 에러 없음 (`tsc -p tsconfig.main.json`이 통과해야 함)

- [ ] **Step 3: 커밋**

```bash
git add src/main/brity/config.ts
git commit -m "feat: 메신저 알리미 서버 설정 해석 (native-widget config.js 이식)"
```

---

### Task 5: 구글 PKCE 로그인 (native-widget auth.js 이식)

**Files:**
- Create: `src/main/brity/auth.ts`

**Interfaces:**
- Consumes: Task 2의 `generateCodeVerifier`/`codeChallengeFromVerifier`, Task 4의 `serverUrl`/`desktopClientId`.
- Produces: `login(): Promise<{ token: string; user: { email: string; name: string } }>`,
  `saveToken(token: string): void`, `loadToken(): string | null`, `clearToken(): void`.
  Task 10(main.ts)이 IPC 핸들러에서 이 함수들을 호출한다.
- native-widget의 `electron/auth.js`(파일: `C:\Pcall\R02-창작자(Creator)\D01-앱 개발\P01-교육진로웹앱(EdTech)\planner\native-widget\electron\auth.js`)를
  먼저 읽고, `login`/`saveToken`/`loadToken`/`clearToken` 부분만 이식한다 (`getAutoStartChoice`/
  `setAutoStartChoice`는 스트레칭펫에 필요 없다 — 스트레칭펫은 이미 `tray.ts`에서 자체
  `autoStart` 설정으로 `app.setLoginItemSettings`를 쓰고 있으므로 가져오지 않는다).
- 이 파일은 테스트하지 않는다 (native-widget의 `auth.js`도 테스트가 없음 — 실제 브라우저를
  열고 로컬 루프백 서버를 띄우는 코드라 자동 테스트 대상이 아님. `pkce.ts`처럼 순수 로직만
  분리된 부분은 이미 Task 2에서 테스트했다).

- [ ] **Step 1: 구현**

```ts
// src/main/brity/auth.ts
import { app, shell, safeStorage } from 'electron';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateCodeVerifier, codeChallengeFromVerifier } from './pkce';
import { serverUrl, desktopClientId } from './config';

function tokenFilePath(): string {
  return path.join(app.getPath('userData'), 'messenger-alert-session.token');
}

export function saveToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 컴퓨터에서는 로그인 정보를 안전하게 저장할 수 없습니다.');
  }
  fs.writeFileSync(tokenFilePath(), safeStorage.encryptString(token));
}

export function loadToken(): string | null {
  try {
    return safeStorage.decryptString(fs.readFileSync(tokenFilePath()));
  } catch {
    return null;
  }
}

export function clearToken(): void {
  try {
    fs.unlinkSync(tokenFilePath());
  } catch {
    /* 이미 없으면 무시 */
  }
}

interface LoginResult {
  token: string;
  user: { email: string; name: string };
}

/** 루프백 서버를 열어 구글 로그인 리디렉션을 받고, 성공하면 세션 토큰을 저장한다. */
export function login(): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    const verifier = generateCodeVerifier();
    const challenge = codeChallengeFromVerifier(verifier);
    const state = crypto.randomBytes(16).toString('hex');
    let settled = false;
    let port: number;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      reject(new Error('로그인 시간이 초과되었습니다.'));
    }, 60_000);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const err = url.searchParams.get('error');

      const replyPage = (heading: string, body: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:sans-serif;padding:40px"><h2>${heading}</h2><p>${body}</p></body></html>`);
      };

      if (settled) {
        replyPage('이미 처리된 요청입니다', '이 창은 닫아도 됩니다.');
        return;
      }
      settled = true;
      clearTimeout(timeout);
      server.close();

      if (err || !code || returnedState !== state) {
        replyPage('로그인하지 못했어요', '로그인이 취소되었거나 실패했습니다. 이 창을 닫고 다시 시도해 주세요.');
        reject(new Error('로그인이 취소되었거나 실패했습니다.'));
        return;
      }
      replyPage('로그인 완료', '이 창은 닫아도 됩니다.');

      const redirectUri = `http://127.0.0.1:${port}/callback`;
      fetch(`${serverUrl()}/api/auth/native-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirectUri, codeVerifier: verifier }),
      })
        .then(async (resp) => {
          const body = await resp.json();
          if (!resp.ok) throw new Error(body.error || '로그인에 실패했습니다.');
          saveToken(body.token);
          resolve(body as LoginResult);
        })
        .catch(reject);
    });

    server.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(e);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      port = typeof address === 'object' && address ? address.port : 0;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', desktopClientId());
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'openid email profile');
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      shell.openExternal(authUrl.toString());
    });
  });
}
```

- [ ] **Step 2: 컴파일 확인**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/main/brity/auth.ts
git commit -m "feat: 구글 PKCE 데스크톱 로그인 추가 (native-widget auth.js 이식)"
```

---

### Task 6: 서버 전송 클라이언트

**Files:**
- Create: `src/main/brity/ingestClient.ts`
- Test: `tests/brity/ingestClient.test.ts`

**Interfaces:**
- Consumes: Task 1의 `maskPhoneNumbers`, Task 4의 `serverUrl`.
- Produces:
  - `buildIngestPayload(msg: BrityMessage): { sender: string | null; receivedAt: string; body: string }`
    (순수 함수 — 마스킹만 적용, 네트워크 호출 없음. 테스트 대상.)
  - `sendMessengerAlert(token: string, msg: BrityMessage): Promise<IngestResult>` (네트워크 호출 —
    테스트하지 않음, native-widget의 `dataFetch.js`와 동일한 관례).
  - `type IngestResult = { ok: true; stored: boolean; reason?: string } | { ok: false; needsLogin: boolean; error: string }`
- Task 9(오케스트레이터)가 `sendMessengerAlert`를 사용한다. `BrityMessage` 타입은 Task 8에서
  정의되므로, 이 태스크에서는 아래처럼 로컬로 최소 형태를 먼저 선언해 두고 Task 8에서 실제
  `reader.ts`의 타입으로 옮겨 합친다(타입 이름과 필드는 동일하게 유지 — `sender: string | null`,
  `receivedAt: string`, `body: string`).

- [ ] **Step 1: 실패하는 테스트 작성 (순수 함수만)**

```ts
// tests/brity/ingestClient.test.ts
import { describe, it, expect } from 'vitest';
import { buildIngestPayload } from '../../src/main/brity/ingestClient';

describe('buildIngestPayload', () => {
  it('본문의 전화번호를 마스킹한다', () => {
    const payload = buildIngestPayload({
      sender: '교무실', receivedAt: '2026-09-16T09:00:00+09:00', body: '010-1234-5678로 연락주세요',
    });
    expect(payload.body).toBe('010-****-**78로 연락주세요');
  });
  it('발신자의 전화번호도 마스킹한다', () => {
    const payload = buildIngestPayload({
      sender: '김OO(010-1234-5678)', receivedAt: '2026-09-16T09:00:00+09:00', body: '안녕하세요',
    });
    expect(payload.sender).toBe('김OO(010-****-**78)');
  });
  it('발신자가 없으면 null로 둔다', () => {
    const payload = buildIngestPayload({ sender: null, receivedAt: '2026-09-16T09:00:00+09:00', body: '안녕하세요' });
    expect(payload.sender).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/brity/ingestClient.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: 구현**

```ts
// src/main/brity/ingestClient.ts
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
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, needsLogin: false, error: body.error || `서버 응답 오류: ${res.status}` };
    }
    return { ok: true, stored: Boolean(body.stored), reason: body.reason };
  } catch (e) {
    return { ok: false, needsLogin: false, error: e instanceof Error ? e.message : '네트워크 오류' };
  }
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/brity/ingestClient.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/main/brity/ingestClient.ts tests/brity/ingestClient.test.ts
git commit -m "feat: 메신저 알리미 서버 전송 클라이언트 추가"
```

---

### Task 7: 로컬 재시도 큐 (전송 실패한 쪽지 보관)

**Files:**
- Create: `src/main/brity/retryQueue.ts`
- Test: `tests/brity/retryQueue.test.ts`

**Interfaces:**
- Consumes: Task 6의 `BrityMessage` 타입.
- Produces (순수 함수, 파일 입출력 없음 — 배열을 받아 새 배열을 돌려준다):
  - `type QueuedMessage = { msg: BrityMessage; firstSeenAt: number }`
  - `enqueue(queue: QueuedMessage[], msg: BrityMessage, now: number): QueuedMessage[]`
  - `pruneExpired(queue: QueuedMessage[], now: number, maxAgeMs: number): QueuedMessage[]`
  - `MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000` (7일, 설계 문서 §7과 동일)
- 파일 저장/로드(`loadQueueFile()`/`saveQueueFile()`, `fs` + `app.getPath('userData')` 사용)는
  이 태스크에서 같은 파일에 추가하되 테스트하지 않는다 (Electron `app` API에 의존 — 저장소
  관례). Task 9(오케스트레이터)가 순수 함수 쪽만 가져다 쓰고, 파일 입출력은 main.ts 통합
  단계(Task 10)에서 주기적으로 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/brity/retryQueue.test.ts
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/brity/retryQueue.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: 구현**

```ts
// src/main/brity/retryQueue.ts
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BrityMessage } from './ingestClient';

export interface QueuedMessage {
  msg: BrityMessage;
  firstSeenAt: number;
}

export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function enqueue(queue: QueuedMessage[], msg: BrityMessage, now: number): QueuedMessage[] {
  return [...queue, { msg, firstSeenAt: now }];
}

export function pruneExpired(queue: QueuedMessage[], now: number, maxAgeMs: number): QueuedMessage[] {
  return queue.filter((item) => now - item.firstSeenAt < maxAgeMs);
}

function queueFilePath(): string {
  return path.join(app.getPath('userData'), 'messenger-alert-retry-queue.json');
}

export function loadQueueFile(): QueuedMessage[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(queueFilePath(), 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveQueueFile(queue: QueuedMessage[]): void {
  try {
    fs.writeFileSync(queueFilePath(), JSON.stringify(queue));
  } catch (err) {
    console.error('[stretch-pet] 재시도 큐 저장 실패:', err);
  }
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/brity/retryQueue.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/main/brity/retryQueue.ts tests/brity/retryQueue.test.ts
git commit -m "feat: 전송 실패 쪽지 로컬 재시도 큐 추가"
```

---

### Task 8: BrityReader 인터페이스 + 가짜 구현

**Files:**
- Create: `src/main/brity/reader.ts`
- Create: `src/main/brity/fakeReader.ts`
- Test: `tests/brity/fakeReader.test.ts`

**Interfaces:**
- Produces (`reader.ts`):
  ```ts
  export interface BrityMessage { sender: string | null; receivedAt: string; body: string; }
  export interface BrityReader {
    start(onMessage: (msg: BrityMessage) => void): void;
    stop(): void;
  }
  ```
  (이 `BrityMessage`가 정식 정의다 — Task 6의 `ingestClient.ts`는 이 파일에서
  `import type { BrityMessage } from './reader'`로 바꿔 가져오도록 이 태스크에서 함께 수정한다.
  Task 7의 `retryQueue.ts`도 동일하게 import 경로를 `./reader`로 바꾼다.)
- Produces (`fakeReader.ts`): `createFakeBrityReader(): BrityReader & { triggerTestMessage(): void }`
  — `start()`가 호출된 뒤 `triggerTestMessage()`를 호출하면 그 순간 등록된 콜백에 미리 정해진
  테스트 메시지를 하나 전달한다. `start()` 전에 호출하거나 `stop()` 후에 호출하면 아무 일도
  일어나지 않는다(콜백이 없으니 조용히 무시).

- [ ] **Step 1: `reader.ts` 작성 (테스트 없음 — 타입/인터페이스 선언뿐)**

```ts
// src/main/brity/reader.ts
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
  start(onMessage: (msg: BrityMessage) => void): void;
  stop(): void;
}
```

- [ ] **Step 2: `src/main/brity/ingestClient.ts` 수정 — 자체 `BrityMessage` 선언을 지우고 import로 교체**

`ingestClient.ts` 상단의 `export interface BrityMessage { ... }` 블록을 삭제하고, 대신:
```ts
import type { BrityMessage } from './reader';
```
를 다른 import들 옆에 추가한다. `buildIngestPayload`/`sendMessengerAlert`의 시그니처는
그대로 둔다(타입 이름과 필드가 동일하므로 함수 본문은 수정할 필요 없음).

- [ ] **Step 3: `src/main/brity/retryQueue.ts`의 import도 동일하게 확인**

이미 `import type { BrityMessage } from './ingestClient';`로 되어 있던 것을
`import type { BrityMessage } from './reader';`로 바꾼다.

- [ ] **Step 4: `npm run build`로 두 파일 수정 후 컴파일 에러 없는지 확인**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 5: 실패하는 테스트 작성 (fakeReader)**

```ts
// tests/brity/fakeReader.test.ts
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
```

- [ ] **Step 6: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/brity/fakeReader.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 7: 구현**

```ts
// src/main/brity/fakeReader.ts
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
```

- [ ] **Step 8: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/brity/fakeReader.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: 전체 테스트 실행해 회귀 없는지 확인**

Run: `npx vitest run`
Expected: 모든 테스트 PASS (Task 1~7 것 포함)

- [ ] **Step 10: 커밋**

```bash
git add src/main/brity/reader.ts src/main/brity/fakeReader.ts src/main/brity/ingestClient.ts \
        src/main/brity/retryQueue.ts tests/brity/fakeReader.test.ts
git commit -m "feat: BrityReader 인터페이스와 테스트용 가짜 리더 추가"
```

---

### Task 9: 오케스트레이터 (MessengerAlertService)

**Files:**
- Create: `src/main/brity/messengerAlertService.ts`
- Test: `tests/brity/messengerAlertService.test.ts`

**Interfaces:**
- Consumes: `BrityReader`/`BrityMessage`(Task 8), `sendMessengerAlert`/`IngestResult`(Task 6),
  `enqueue`/`pruneExpired`/`MAX_AGE_MS`(Task 7).
- Produces:
  ```ts
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
    constructor(deps: MessengerAlertServiceDeps);
    start(): void;
    stop(): void;
    flushRetryQueue(): Promise<void>; // 큐에 쌓인 항목을 다시 보내본다
    getUnreadCount(): number;
    resetUnreadCount(): void;
  }
  ```
  Task 10(main.ts)이 이 클래스를 실제 `FakeBrityReader`/`sendMessengerAlert`/`auth.loadToken` 등과
  함께 인스턴스화한다. 의존성을 전부 생성자로 주입하는 이유는, 테스트에서 진짜 네트워크·진짜
  파일 시스템 없이 오케스트레이션 로직(수신 → 전송 시도 → 성공/실패 분기 → 큐잉/알림)만 검증하기
  위해서다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/brity/messengerAlertService.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MessengerAlertService } from '../../src/main/brity/messengerAlertService';
import { createFakeBrityReader } from '../../src/main/brity/fakeReader';

function makeService(overrides: Partial<Parameters<typeof MessengerAlertService.prototype.constructor>[0]> = {}) {
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/brity/messengerAlertService.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: 구현**

```ts
// src/main/brity/messengerAlertService.ts
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
  onNewAlert: (count: number) => void;
  onNeedsLogin: () => void;
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
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/brity/messengerAlertService.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 전체 테스트 실행해 회귀 없는지 확인**

Run: `npx vitest run`
Expected: 모든 테스트 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/main/brity/messengerAlertService.ts tests/brity/messengerAlertService.test.ts
git commit -m "feat: 메신저 알리미 오케스트레이터(MessengerAlertService) 추가"
```

---

### Task 10: Electron 통합 (main.ts / preload.ts / tray.ts / renderer.ts)

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/main/tray.ts`
- Modify: `src/renderer/renderer.ts`

**Interfaces:**
- Consumes: Task 5의 `login`/`loadToken`/`clearToken`, Task 6의 `sendMessengerAlert`, Task 7의
  `loadQueueFile`/`saveQueueFile`, Task 8의 `createFakeBrityReader`, Task 9의 `MessengerAlertService`,
  Task 3의 `PetSettings.messengerAlertEnabled`/`messengerAlertConsented`.
- 이 태스크는 UI/Electron 배선이라 자동 테스트가 없다(저장소 관례) — `npm run build` +
  `npm start`로 직접 켜서 트레이 메뉴와 말풍선을 눈으로 확인한다.

**주의(중요, 순서 지킬 것):** 동의 확인 다이얼로그는 Electron의 `dialog.showMessageBox`(운영체제
기본 확인창)를 쓴다. 이 프로그램은 별도의 HTML 동의 모달을 만들 여력이 없으므로, 가장 간단하고
확실한 네이티브 다이얼로그로 대체한다 — 나중에 더 예쁜 UI로 바꾸고 싶으면 이 부분만 교체하면 된다.

- [ ] **Step 1: `src/main/main.ts` 수정**

파일 상단 import 블록에 추가:
```ts
import { dialog } from 'electron'; // 기존 'electron' import에 dialog 추가 (한 줄로 합친다)
import { MessengerAlertService } from './brity/messengerAlertService';
import { createFakeBrityReader } from './brity/fakeReader';
import { sendMessengerAlert } from './brity/ingestClient';
import { loadQueueFile, saveQueueFile } from './brity/retryQueue';
import { login as brityLogin, loadToken, clearToken } from './brity/auth';
```
(기존 첫 줄 `import { app, BrowserWindow, screen, ipcMain, Menu } from 'electron';`을
`import { app, BrowserWindow, screen, ipcMain, Menu, dialog } from 'electron';`로 바꿔 합친다.)

`let mainWindow` 선언 아래에 서비스 인스턴스와 트레이 콜백에 넘길 헬퍼를 추가:
```ts
const brityReader = createFakeBrityReader();
const messengerAlertService = new MessengerAlertService({
  reader: brityReader,
  sendFn: sendMessengerAlert,
  getToken: () => loadToken(),
  loadQueue: () => loadQueueFile(),
  saveQueue: (q) => saveQueueFile(q),
  now: () => Date.now(),
  onNewAlert: (count) => {
    mainWindow?.webContents.send('messenger-alert-new', count);
    refreshTray();
  },
  onNeedsLogin: () => {
    setSettings({ messengerAlertEnabled: false });
    refreshTray();
  },
});

/** 로그인 상태 + 켜짐 상태일 때만 실제로 감시를 시작한다. */
function syncMessengerAlertRunning(): void {
  const settings = getSettings();
  const shouldRun = settings.messengerAlertEnabled && Boolean(loadToken());
  if (shouldRun) {
    messengerAlertService.start();
  } else {
    messengerAlertService.stop();
  }
}
```

`app.whenReady().then(...)` 블록 안, `scheduleFocusTimer()` 호출 다음 줄에 추가:
```ts
  try {
    syncMessengerAlertRunning();
    void messengerAlertService.flushRetryQueue();
    setInterval(() => void messengerAlertService.flushRetryQueue(), 5 * 60 * 1000);
  } catch (err) {
    console.error('[stretch-pet] failed to start messenger alert service:', err);
  }
```

새 IPC 핸들러들을 기존 `ipcMain.handle('get-minutes-until-next-stretch', ...)` 블록 아래에 추가:
```ts
ipcMain.handle('messenger-alert-login', async () => {
  try {
    const result = await brityLogin();
    return { ok: true, email: result.user.email };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '로그인에 실패했습니다.' };
  }
});

ipcMain.handle('messenger-alert-status', () => {
  const settings = getSettings();
  return {
    loggedIn: Boolean(loadToken()),
    enabled: settings.messengerAlertEnabled,
    unreadCount: messengerAlertService.getUnreadCount(),
  };
});
```

트레이 콜백(`onSetMessengerAlertEnabled`, `onLogin`, `onLogout`, `onTriggerTestMessage`)을
`createTray(...)` 호출부에 추가한다. 기존 호출:
```ts
createTray({ onQuit: () => app.quit(), onFocusMinutesChange: updateFocusMinutes });
```
를 아래로 교체:
```ts
createTray({
  onQuit: () => app.quit(),
  onFocusMinutesChange: updateFocusMinutes,
  onMessengerAlertLogin: async () => {
    try {
      await brityLogin();
      syncMessengerAlertRunning();
      refreshTray();
    } catch (e) {
      dialog.showErrorBox('로그인 실패', e instanceof Error ? e.message : '로그인에 실패했습니다.');
    }
  },
  onMessengerAlertLogout: () => {
    clearToken();
    setSettings({ messengerAlertEnabled: false });
    syncMessengerAlertRunning();
    refreshTray();
  },
  onMessengerAlertToggle: async (nextEnabled: boolean) => {
    if (nextEnabled && !loadToken()) {
      dialog.showErrorBox('로그인이 필요합니다', '먼저 미요플래너 계정으로 로그인해 주세요.');
      refreshTray();
      return;
    }
    if (nextEnabled && !getSettings().messengerAlertConsented) {
      const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['취소', '동의하고 켜기'],
        defaultId: 1,
        cancelId: 0,
        title: '메신저 알리미 켜기',
        message: '브리티 쪽지 내용이 요약을 위해 외부 AI(Gemini)로 전송됩니다. 계속할까요?',
      });
      if (response !== 1) {
        refreshTray();
        return;
      }
      setSettings({ messengerAlertConsented: true });
    }
    setSettings({ messengerAlertEnabled: nextEnabled });
    syncMessengerAlertRunning();
    refreshTray();
  },
  onTriggerTestMessage: () => brityReader.triggerTestMessage(),
});
```

- [ ] **Step 2: `src/main/tray.ts` 수정**

`TrayCallbacks` 인터페이스에 추가:
```ts
interface TrayCallbacks {
  onQuit: () => void;
  onFocusMinutesChange: (minutes: number) => void;
  onMessengerAlertLogin: () => void;
  onMessengerAlertLogout: () => void;
  onMessengerAlertToggle: (enabled: boolean) => void;
  onTriggerTestMessage: () => void;
}
```

`rebuildMenu` 함수 안, 두 번째 `{ type: 'separator' }` (소리/시작프로그램 섹션 시작 전) 바로
앞에 새 섹션을 추가한다. `loadToken`을 가져와야 하므로 파일 상단 import에 추가:
```ts
import { loadToken } from './brity/auth';
```
메뉴 템플릿 배열 안에 삽입할 항목들(정확한 위치: `settings.autoStart` 체크박스 다음,
마지막 구분선(`{ type: 'separator' }`, '종료' 버튼 앞) 이전):
```ts
    { type: 'separator' },
    {
      label: loadToken() ? '미요플래너 로그아웃' : '미요플래너 로그인',
      click: loadToken() ? callbacks.onMessengerAlertLogout : callbacks.onMessengerAlertLogin,
    },
    {
      label: settings.messengerAlertEnabled
        ? `메신저 알리미: 켜짐${messengerAlertService.getUnreadCount() > 0 ? ` (확인 대기 ${messengerAlertService.getUnreadCount()}건)` : ''}`
        : '메신저 알리미: 꺼짐',
      type: 'checkbox',
      checked: settings.messengerAlertEnabled,
      enabled: Boolean(loadToken()),
      click: (menuItem) => callbacks.onMessengerAlertToggle(menuItem.checked),
    },
    ...(settings.messengerAlertEnabled
      ? [{ label: '테스트 쪽지 보내기 (개발용)', click: callbacks.onTriggerTestMessage }]
      : []),
```

**주의:** `messengerAlertService.getUnreadCount()`를 `tray.ts`에서 직접 참조하면 `main.ts`의
인스턴스를 가져와야 해서 순환 의존이 생긴다. 대신 `TrayCallbacks`에 `getUnreadCount: () => number`
필드를 추가해 `main.ts`가 `() => messengerAlertService.getUnreadCount()`를 넘기도록 하고,
`tray.ts`에서는 `callbacks.getUnreadCount()`를 쓴다 (Step 1의 `createTray(...)` 호출에도
`getUnreadCount: () => messengerAlertService.getUnreadCount(),`를 추가해야 한다는 뜻이다 —
Step 1을 이 방식에 맞춰 함께 수정한다).

`setTooltip` 갱신도 추가 — `rebuildMenu` 함수의 `tray.setContextMenu(menu);` 바로 앞에:
```ts
  const unread = callbacks.getUnreadCount();
  tray.setToolTip(unread > 0 ? `스트레칭펫 · 확인 대기 ${unread}건` : '스트레칭펫');
```

- [ ] **Step 3: `src/main/preload.ts` 수정**

기존 `contextBridge.exposeInMainWorld('petAPI', { ... })` 객체 안, `onPinnedChanged` 다음에 추가:
```ts
  onMessengerAlertNew: (callback: (count: number) => void): void => {
    ipcRenderer.on('messenger-alert-new', (_event, count: number) => callback(count));
  },
```

- [ ] **Step 4: `src/renderer/renderer.ts` 수정**

파일 하단, `window.petAPI.onPinnedChanged(...)` 블록 바로 아래에 추가:
```ts
window.petAPI.onMessengerAlertNew((count) => {
  if (state !== 'idle' && state !== 'walk' && state !== 'cooldown') return; // alert/stretch 중엔 방해하지 않는다
  showBubble(count > 1 ? '새로운 대화가 있어요!' : '새로운 쪽지가 있어요!');
  const token = bubbleToken;
  setTimeout(() => {
    if (bubbleToken === token) hideBubble();
  }, 5000);
});
```

- [ ] **Step 5: 컴파일 확인**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 6: 수동 확인 (실제 실행)**

```bash
npm start
```
- 트레이 아이콘 우클릭 → "미요플래너 로그인" 클릭 → 브라우저가 열리고 구글 로그인 진행 →
  성공하면 트레이 메뉴가 "미요플래너 로그아웃"으로 바뀌는지 확인. (배포된 미요플래너 서버
  또는 로컬로 띄운 서버 중 `package.json`의 `miyoConfig.serverUrl`/`desktopClientId`가
  가리키는 서버가 실제로 응답 가능해야 한다 — Task 11에서 이 값을 채운다.)
- 로그인 후 "메신저 알리미: 꺼짐" 체크박스 클릭 → 동의 확인 창이 뜨는지, 동의하면
  "메신저 알리미: 켜짐"으로 바뀌고 "테스트 쪽지 보내기 (개발용)" 항목이 나타나는지 확인.
- "테스트 쪽지 보내기" 클릭 → 펫 캐릭터가 idle/walk 상태일 때 말풍선 "새로운 쪽지가
  있어요!"가 뜨는지, 잠시 후 사라지는지 확인.
- 미요플래너 웹 화면(같은 계정으로 로그인)의 "메신저 알리미" 메뉴를 열어 방금 보낸 테스트
  쪽지가 확인 카드로 나타나는지 확인 (Gemini 키가 서버에 설정돼 있어야 함).
- 스트레칭 중(펫을 클릭해 'stretch' 상태로 만든 뒤)에 "테스트 쪽지 보내기"를 눌러도 말풍선이
  끼어들지 않는지 확인.
- 로그아웃 → "메신저 알리미"가 자동으로 꺼지고 체크박스가 비활성화(눌러도 반응 없음)되는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add src/main/main.ts src/main/preload.ts src/main/tray.ts src/renderer/renderer.ts
git commit -m "feat: 메신저 알리미를 트레이·말풍선·IPC에 연결"
```

---

### Task 11: 배포 설정값 자리 채우기

**Files:**
- Modify: `package.json`
- Create: `.env.example`

**Interfaces:**
- Consumes: 없음 (설정 값일 뿐).
- native-widget의 `package.json`에 있는 `miyoConfig` 블록과 `.env.example`을 참고해 동일한
  키 이름으로 채운다 — 실제 배포 시에는 native-widget과 **같은 값**(같은 서버 주소, 같은
  구글 데스크톱 OAuth 클라이언트 ID)을 넣어야 한다. 지금은 native-widget의 실제 값을 그대로
  복사해 넣거나, 값을 모르면 native-widget의 `package.json`에서 사람이 직접 값을 확인해
  채워야 한다 — 이 스텝만은 코드가 아니라 "사람이 실제 값을 넣는" 스텝이므로, 구현자는
  실제 값을 모르면 플레이스홀더를 넣고 보고서에 "실제 값은 native-widget의 package.json을
  참고해 사람이 채워야 함"이라고 명시한다.

- [ ] **Step 1: `package.json`에 `miyoConfig` 블록 추가**

`"build": { ... }` 블록 앞(또는 뒤, 같은 레벨)에 추가:
```json
  "miyoConfig": {
    "serverUrl": "https://YOUR-PLANNER-DOMAIN.example.com",
    "desktopClientId": "YOUR-GOOGLE-DESKTOP-CLIENT-ID"
  },
```
(native-widget의 `package.json`을 열어 실제 배포된 `serverUrl`/`desktopClientId` 값이 있으면
그 값을 그대로 옮겨 적는다 — 같은 구글 클라우드 프로젝트의 같은 "데스크톱 앱" OAuth 클라이언트를
공유해야 하므로. 값을 확인할 수 없으면 위 placeholder를 그대로 두고 보고서에 기록한다.)

- [ ] **Step 2: `.env.example` 생성**

```dotenv
# 개발 중에는 이 값들이 package.json의 miyoConfig보다 우선 적용된다.
# 실제 파일 이름은 .env로 만들고, 이 예시 파일 자체는 커밋해도 된다(값이 없으므로).
MIYO_SERVER_URL=http://localhost:3001
MIYO_GOOGLE_DESKTOP_CLIENT_ID=
```

- [ ] **Step 3: 커밋**

```bash
git add package.json .env.example
git commit -m "chore: 메신저 알리미 서버 설정값 자리 추가 (실제 배포값은 native-widget과 동일하게 채워야 함)"
```

---

### Task 12: README에 사용법·다음 단계 기록

**Files:**
- Modify: `README.md` (파일이 없으면 새로 만든다 — 저장소 루트에 `README.md`가 있는지 먼저
  확인하고, 있으면 관련 섹션을 추가하는 형태로, 없으면 최소한의 섹션만 새로 만든다)

- [ ] **Step 1: "메신저 알리미" 섹션 추가**

다음 내용을 담아 작성한다 (기존 README 스타일이 있다면 그 톤에 맞춘다):
- 트레이 메뉴에서 로그인 → 동의 후 켜기 → "테스트 쪽지 보내기"로 동작 확인하는 방법.
- **지금은 브리티를 실제로 읽지 않는다** — `src/main/brity/fakeReader.ts`가 자리를 채우고
  있으며, 실제 브리티 읽기(Windows 접근성 API, meum 프로젝트 참고)는 다음 단계에서
  `src/main/brity/reader.ts`의 `BrityReader` 인터페이스를 구현하는 새 클래스로 추가하고,
  `main.ts`에서 `createFakeBrityReader()`를 그 새 구현으로 바꿔치기만 하면 된다는 점을 명시.
- `.env`/`package.json`의 `miyoConfig` 설정 방법(Task 11 참고).

- [ ] **Step 2: 커밋**

```bash
git add README.md
git commit -m "docs: 메신저 알리미 사용법과 다음 단계(실제 브리티 읽기) 기록"
```

---

## Self-Review 결과

- **스펙 커버리지:** 설계 문서(planner 저장소) 4.2절(StretchPet Electron 통합)·5절(알림)을
  Task 3~10이 구현한다. 4.1절(브리티리더)은 사용자와 합의한 대로 이번 범위에서 제외하고
  `BrityReader` 인터페이스(Task 8)로 자리만 만들어 둔다 — Goal/Architecture에 명시.
- **플레이스홀더 없음:** Task 11의 `miyoConfig` 실제 값만 예외로, 사람이 채워야 함을 태스크
  안에서 명시적으로 밝혔다(코드 로직의 플레이스홀더가 아니라 배포 설정값이므로 다름).
- **타입 일관성:** `BrityMessage`는 Task 8에서 `reader.ts`에 정식 정의되고, Task 6
  (`ingestClient.ts`)·Task 7(`retryQueue.ts`)·Task 9(`messengerAlertService.ts`)가 전부
  그 정의를 import해 쓰도록 Task 8의 Step 2~3에서 명시적으로 정리했다.
- **범위 밖:** 실제 브리티 읽기(Windows UI Automation), GOE 메신저, 트레이 아이콘 자체에
  숫자 오버레이 그리기(대신 툴팁 텍스트와 메뉴 라벨로 대체) — 모두 Goal/Architecture에서
  범위 밖으로 명시했다.
