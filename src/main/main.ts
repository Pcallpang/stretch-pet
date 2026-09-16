import { app, BrowserWindow, screen, ipcMain, Menu, dialog } from 'electron';
import * as path from 'path';
import { TimerScheduler, minutesToMs } from './timerScheduler';
import { getSettings, setSettings } from './settings';
import type { PetSettings } from './settings';
import { createTray, refreshTray } from './tray';
import { clampFocusMinutes, computeMinutesUntilNextStretch } from './nextStretch';
import { MessengerAlertService } from './brity/messengerAlertService';
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
    setInterval(() => void messengerAlertService.flushRetryQueue(), 5 * 60 * 1000);
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

app.on('window-all-closed', () => {
  // no-op: keep running in the tray even if the overlay window closes
});

app.on('before-quit', cancelTimers);
app.whenReady().then(() => screen.on('display-metrics-changed', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBounds(screen.getPrimaryDisplay().workArea);
  }
}));
