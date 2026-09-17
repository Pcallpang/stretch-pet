import { app } from 'electron';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { BrityMessage, BrityReader } from './reader';

const CHECK_INTERVAL_MS = 20_000;
// pywinauto/comtypes가 남긴 백그라운드 스레드 때문에 파이썬 프로세스가 다
// 끝내고도(표준출력에 결과까지 다 낸 뒤에도) 스스로 종료되지 않는 경우를
// 실제로 확인했다 — 그대로 두면 20초마다 하나씩 파이썬 프로세스가 쌓인다.
// 이 시간 안에 안 끝나면 강제로 정리한다.
const CHILD_TIMEOUT_MS = 15_000;

function stateFilePath(): string {
  // main.ts의 auth.ts/retryQueue.ts와 동일하게, app.getPath()는 실제로
  // 쓰이는 시점(각 실행 주기)에만 지연 호출한다 — 모듈을 불러오는 시점에는
  // 앱이 아직 'ready' 되지 않았을 수 있다.
  return path.join(app.getPath('userData'), 'brity-seen.json');
}

function readerScriptPath(): string {
  // 컴파일 결과 위치(dist/main/brity/realReader.js) 기준 저장소 루트의
  // resources/brity-reader/reader.py를 가리킨다.
  return path.join(__dirname, '..', '..', '..', 'resources', 'brity-reader', 'reader.py');
}

/**
 * 스트림으로 들어오는 텍스트에서 완성된 줄만 뽑아내고, 아직 개행이 오지
 * 않은 나머지는 다음 청크에 이어붙일 수 있게 돌려준다 (자식 프로세스
 * stdout이 JSON 한 줄을 여러 청크로 쪼개 보낼 수 있어서 필요하다).
 */
export function extractCompleteLines(buffer: string): { lines: string[]; remainder: string } {
  const lines: string[] = [];
  let rest = buffer;
  let newlineIndex = rest.indexOf('\n');
  while (newlineIndex >= 0) {
    lines.push(rest.slice(0, newlineIndex));
    rest = rest.slice(newlineIndex + 1);
    newlineIndex = rest.indexOf('\n');
  }
  return { lines, remainder: rest };
}

/**
 * 실제 브리티 메신저를 화면 접근성(Windows UI Automation)으로 읽는 리더.
 * 무거운 읽기 로직은 파이썬(pywinauto)으로 만든 `reader.py`가 담당하고,
 * 이 클래스는 그 스크립트를 주기적으로 자식 프로세스로 실행해 결과를 받는
 * 얇은 다리 역할만 한다.
 *
 * `reader.py`는 이 컴퓨터에 파이썬과 pywinauto가 설치돼 있어야 동작한다
 * (README 참고) — 아직 실행 파일 하나로 묶어 배포하지 않는다.
 */
export function createRealBrityReader(): BrityReader {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let callback: ((msg: BrityMessage) => void) | null = null;
  let childRunning = false;
  let currentChild: ReturnType<typeof spawn> | null = null;

  function runOnce(): void {
    if (childRunning) return; // 이전 실행이 아직 안 끝났으면 겹쳐 돌리지 않는다
    childRunning = true;

    const child = spawn('python', [readerScriptPath(), '--state', stateFilePath()], {
      windowsHide: true,
    });
    currentChild = child;

    const killTimer = setTimeout(() => {
      console.error('[stretch-pet] 브리티 리더가 제시간에 끝나지 않아 강제 종료합니다.');
      child.kill();
    }, CHILD_TIMEOUT_MS);

    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const { lines, remainder } = extractCompleteLines(buffer);
      buffer = remainder;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as { sender: string | null; receivedAt: string; body: string };
          callback?.({ sender: parsed.sender ?? null, receivedAt: parsed.receivedAt, body: parsed.body });
        } catch (e) {
          console.error('[stretch-pet] 브리티 리더 출력 해석 실패:', e);
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      console.error('[stretch-pet] brity-reader:', chunk.toString('utf-8').trim());
    });

    child.on('error', (e) => {
      // 파이썬이 이 컴퓨터에 없을 때 등 — 매 주기 반복해서 시끄럽지 않게
      // 여기서만 로그를 남기고 조용히 다음 주기를 기다린다.
      console.error('[stretch-pet] 브리티 리더 실행 실패(파이썬·pywinauto가 설치돼 있는지 확인 필요):', e.message);
      clearTimeout(killTimer);
      childRunning = false;
      if (currentChild === child) currentChild = null;
    });

    child.on('exit', () => {
      clearTimeout(killTimer);
      childRunning = false;
      if (currentChild === child) currentChild = null;
    });
  }

  return {
    start(onMessage) {
      if (intervalId) return; // 이미 돌고 있으면 중복 시작하지 않는다 (반복 호출 안전)
      callback = onMessage;
      runOnce();
      intervalId = setInterval(runOnce, CHECK_INTERVAL_MS);
    },
    stop() {
      if (!intervalId) return;
      clearInterval(intervalId);
      intervalId = null;
      callback = null;
      if (currentChild) {
        currentChild.kill();
        currentChild = null;
      }
    },
  };
}
