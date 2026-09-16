import { app, BrowserWindow, screen, ipcMain, Menu, dialog } from 'electron';
import * as path from 'path';
import { TimerScheduler, minutesToMs } from './timerScheduler';
import { getSettings, setSettings } from './settings';
import type { PetSettings } from './settings';
import { createTray, refreshTray } from './tray';
import { clampFocusMinutes, computeMinutesUntilNextStretch } from './nextStretch';
import { MessengerAlertService } from './brity/messengerAlertService';
import type { BrityReader } from './brity/reader';
import { createFakeBrityReader } from './brity/fakeReader';
import { sendMessengerAlert } from './brity/ingestClient';
import { loadQueueFile, saveQueueFile } from './brity/retryQueue';
import { login as brityLogin, loadToken, clearToken } from './brity/auth';

const COOLDOWN_MINUTES = 2;
const MIN_FOCUS_MINUTES = 5;
const MAX_FOCUS_MINUTES = 180;
// How long an ALERT notification waits for the user before we assume they're
// away and quietly return the pet to idle/walk + resume the focus timer,
// instead of leaving the window stuck ignoring mouse events forever.
const ALERT_TIMEOUT_MINUTES = 2;

let mainWindow: BrowserWindow | null = null;
const focusTimer = new TimerScheduler();
const cooldownTimer = new TimerScheduler();
const alertTimer = new TimerScheduler();

// Tracked so the renderer can ask "how many minutes until the next
// stretch?" (shown in a speech bubble on click) without duplicating timer
// state in two processes. Exactly one of these is non-null at a time, or
// both are null during 'alert'/'stretch' when there's no next-stretch
// countdown to show.
let focusDeadline: number | null = null;
let cooldownDeadline: number | null = null;
let phase: 'focus' | 'alert' | 'stretch' | 'cooldown' = 'focus';

// 실제 브리티 리더가 준비되면 이 한 줄만 새 구현으로 바꾸면 된다 — 타입은
// BrityReader로만 다루고, 개발용 테스트 트리거는 아래에서 런타임으로 확인한다.
const brityReader: BrityReader = createFakeBrityReader();

/** 리더가 개발용 테스트 트리거를 제공하면 그 함수를, 아니면 undefined를 준다. */
function testMessageTrigger(reader: BrityReader): (() => void) | undefined {
  const candidate = (reader as Partial<{ triggerTestMessage: () => void }>).triggerTestMessage;
  return typeof candidate === 'function' ? () => candidate.call(reader) : undefined;
}

const messengerAlertService = new MessengerAlertService({
  reader: brityReader,
  sendFn: sendMessengerAlert,
  getToken: () => loadToken(),
  loadQueue: () => loadQueueFile(),
  saveQueue: (q) => saveQueueFile(q),
  now: () => Date.now(),
  isEnabled: () => getSettings().messengerAlertEnabled,
  onNewAlert: (count) => {
    mainWindow?.webContents.send('messenger-alert-new', count);
    refreshTray();
  },
  onNeedsLogin: () => {
    // 401이면 토큰이 죽은 것이다 — 토큰을 지우고 감시도 실제로 멈춰야
    // 사용자 모르게 계속 돌거나 바로 또 401을 맞지 않는다.
    clearToken();
    setSettings({ messengerAlertEnabled: false });
    syncMessengerAlertRunning();
    refreshTray();
  },
});

let loginInProgress = false;
let flushIntervalId: NodeJS.Timeout | null = null;

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

function createWindow(): void {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'));
}

function cancelTimers(): void {
  focusTimer.cancel();
  cooldownTimer.cancel();
  alertTimer.cancel();
  focusDeadline = null;
  cooldownDeadline = null;
}

function updateFocusMinutes(minutes: number): void {
  if (!Number.isFinite(minutes)) return;
  setSettings({ focusMinutes: clampFocusMinutes(minutes, MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES) });
  refreshTray();
  if (phase === 'focus') scheduleFocusTimer();
}

function scheduleFocusTimer(): void {
  cancelTimers();
  phase = 'focus';
  const { focusMinutes } = getSettings();
  const ms = minutesToMs(focusMinutes);
  focusDeadline = Date.now() + ms;
  cooldownDeadline = null;
  focusTimer.schedule(ms, () => {
    focusDeadline = null;
    phase = 'alert';
    mainWindow?.webContents.send('timer-elapsed');
    scheduleAlertTimeout();
  });
}

// If the user never responds to the ALERT (doesn't click the pet), don't
// leave the overlay stuck waiting forever — quietly reset to idle/walk and
// resume the focus-timer cycle, same as if the user had skipped.
function scheduleAlertTimeout(): void {
  alertTimer.schedule(minutesToMs(ALERT_TIMEOUT_MINUTES), () => {
    mainWindow?.webContents.send('alert-timeout');
    scheduleFocusTimer();
  });
}

function scheduleCooldownTimer(): void {
  cancelTimers();
  phase = 'cooldown';
  const ms = minutesToMs(COOLDOWN_MINUTES);
  cooldownDeadline = Date.now() + ms;
  cooldownTimer.schedule(ms, () => {
    cooldownDeadline = null;
    mainWindow?.webContents.send('cooldown-elapsed');
    scheduleFocusTimer();
  });
}

app.whenReady().then(() => {
  try {
    createWindow();
  } catch (err) {
    // Without the overlay window the app still has no visible UI, but it
    // must not crash unhandled and leave a zombie process with no way to
    // quit — the tray (attempted next) is the fallback way out.
    console.error('[stretch-pet] failed to create overlay window:', err);
  }

  try {
    createTray({
      onQuit: () => app.quit(),
      onFocusMinutesChange: updateFocusMinutes,
      getUnreadCount: () => messengerAlertService.getUnreadCount(),
      onMessengerAlertLogin: async () => {
        // 두 번 누르면 루프백 서버·브라우저 탭이 두 개 열리고, 먼저 연 쪽이
        // 60초 뒤 "로그인 시간 초과" 오류창을 띄운다 — 진행 중이면 무시한다.
        if (loginInProgress) {
          dialog.showMessageBox({
            type: 'info',
            title: '로그인 진행 중',
            message: '이미 로그인 창이 열려 있습니다. 브라우저에서 로그인을 마쳐 주세요.',
          }).catch(() => { /* 안내창 실패는 무시 */ });
          return;
        }
        loginInProgress = true;
        try {
          await brityLogin();
          syncMessengerAlertRunning();
          refreshTray();
        } catch (e) {
          dialog.showErrorBox('로그인 실패', e instanceof Error ? e.message : '로그인에 실패했습니다.');
        } finally {
          loginInProgress = false;
        }
      },
      onMessengerAlertLogout: () => {
        clearToken();
        setSettings({ messengerAlertEnabled: false });
        // 아직 못 보낸 쪽지를 남겨두면, 같은 PC에 다른 선생님 계정이 로그인했을 때
        // 이전 사용자의 쪽지가 새 계정 플래너로 올라갈 수 있다 — 로그아웃 시 비운다.
        saveQueueFile([]);
        syncMessengerAlertRunning();
        refreshTray();
      },
      onMessengerAlertToggle: async (nextEnabled: boolean) => {
        try {
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
        } catch (e) {
          // 트레이 클릭에서 시작된 비동기 흐름이라 여기서 잡지 않으면
          // 처리되지 않은 프라미스 거부가 된다.
          dialog.showErrorBox('메신저 알리미 설정 실패', e instanceof Error ? e.message : '설정을 바꾸지 못했습니다.');
        }
      },
      onClearUnread: () => {
        messengerAlertService.resetUnreadCount();
        refreshTray();
      },
      onTriggerTestMessage: testMessageTrigger(brityReader),
    });
  } catch (err) {
    // Tray creation can throw on Windows if the icon image fails to load
    // (see tray.ts). Losing the tray means losing the menu-based quit path,
    // so fall back to quitting the app outright rather than leaving it
    // running invisibly with no way to exit.
    console.error('[stretch-pet] failed to create tray icon, quitting:', err);
    app.quit();
    return;
  }

  try {
    scheduleFocusTimer();
  } catch (err) {
    console.error('[stretch-pet] failed to schedule focus timer:', err);
  }

  try {
    syncMessengerAlertRunning();
    void messengerAlertService.flushRetryQueue();
    flushIntervalId = setInterval(() => void messengerAlertService.flushRetryQueue(), 5 * 60 * 1000);
  } catch (err) {
    console.error('[stretch-pet] failed to start messenger alert service:', err);
  }
}).catch((err) => {
  console.error('[stretch-pet] failed to start:', err);
  app.quit();
});

ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
  mainWindow?.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('show-pet-context-menu', () => {
  const menu = Menu.buildFromTemplate([
    {
      label: '지금 스트레칭 하기',
      click: () => {
        if (phase === 'stretch') return;
        cancelTimers();
        phase = 'stretch';
        mainWindow?.webContents.send('force-stretch');
      },
    },
    {
      label: '스트레칭 시간 설정',
      click: () => {
        mainWindow?.webContents.send('show-settings-panel', getSettings().focusMinutes);
      },
    },
    { type: 'separator' },
    {
      label: '캐릭터 변경',
      submenu: ([
        ['miyo', '미요'], ['miyox', '미요X (사춘기)'],
        ['deodeumiyo', '더드미요'], ['godmiyo', '갓미요'],
      ] as const).map(([character, label]) => ({
        label,
        type: 'radio' as const,
        checked: getSettings().character === character,
        click: () => {
          const settings = setSettings({ character: character as PetSettings['character'] });
          mainWindow?.webContents.send('character-changed', settings.character);
        },
      })),
    },
    {
      label: '고정하기',
      type: 'checkbox',
      checked: getSettings().pinned,
      click: (menuItem) => {
        setSettings({ pinned: menuItem.checked });
        mainWindow?.webContents.send('pinned-changed', menuItem.checked);
      },
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  if (mainWindow) menu.popup({ window: mainWindow });
});

ipcMain.on('set-focus-minutes', (_event, minutes: number) => {
  updateFocusMinutes(minutes);
});

ipcMain.on('stretch-started', () => {
  cancelTimers();
  phase = 'stretch';
});

ipcMain.on('stretch-complete', () => {
  if (phase !== 'stretch') return;
  scheduleCooldownTimer();
});

ipcMain.on('stretch-skip', () => {
  if (phase !== 'stretch') return;
  scheduleCooldownTimer();
});

ipcMain.handle('get-settings', () => getSettings());

ipcMain.handle('get-minutes-until-next-stretch', () => {
  const { focusMinutes } = getSettings();
  return computeMinutesUntilNextStretch({
    cooldownDeadline,
    focusDeadline,
    focusMinutes,
    now: Date.now(),
  });
});

app.on('window-all-closed', () => {
  // no-op: keep running in the tray even if the overlay window closes
});

app.on('before-quit', () => {
  cancelTimers();
  if (flushIntervalId) {
    clearInterval(flushIntervalId);
    flushIntervalId = null;
  }
});
app.whenReady().then(() => screen.on('display-metrics-changed', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBounds(screen.getPrimaryDisplay().workArea);
  }
}));
