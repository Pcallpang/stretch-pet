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
          const body = (await resp.json()) as LoginResult & { error?: string };
          if (!resp.ok) throw new Error(body.error || '로그인에 실패했습니다.');
          saveToken(body.token);
          resolve(body);
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
