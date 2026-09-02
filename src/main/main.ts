import { app, BrowserWindow, screen, ipcMain, Menu } from 'electron';
import * as path from 'path';
import { TimerScheduler, minutesToMs } from './timerScheduler';
import { getSettings, setSettings } from './settings';
import { createTray, refreshTray } from './tray';

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

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
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
    },
  });

  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'));
}

function scheduleFocusTimer(): void {
  const { focusMinutes } = getSettings();
  const ms = minutesToMs(focusMinutes);
  focusDeadline = Date.now() + ms;
  cooldownDeadline = null;
  focusTimer.schedule(ms, () => {
    focusDeadline = null;
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
    createTray({ onQuit: () => app.quit() });
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
        // Cancel whatever the normal focus/alert cycle was waiting on — the
        // manual stretch takes over, and the usual stretch-complete/skip
        // handlers below already reschedule the focus timer for the
        // configured interval, counting from when this stretch finishes.
        focusTimer.cancel();
        alertTimer.cancel();
        focusDeadline = null;
        cooldownDeadline = null;
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
    { label: '종료', click: () => app.quit() },
  ]);
  if (mainWindow) menu.popup({ window: mainWindow });
});

ipcMain.on('set-focus-minutes', (_event, minutes: number) => {
  const clamped = Math.min(MAX_FOCUS_MINUTES, Math.max(MIN_FOCUS_MINUTES, Math.round(minutes)));
  setSettings({ focusMinutes: clamped });
  refreshTray();
  // The new interval takes effect immediately: the next automatic stretch
  // fires this many minutes from now, not from whenever the old timer was
  // going to fire.
  scheduleFocusTimer();
});

ipcMain.on('stretch-started', () => {
  alertTimer.cancel();
});

ipcMain.on('stretch-complete', () => {
  alertTimer.cancel();
  scheduleCooldownTimer();
});

ipcMain.on('stretch-skip', () => {
  alertTimer.cancel();
  scheduleCooldownTimer();
});

ipcMain.handle('get-settings', () => getSettings());

ipcMain.handle('get-minutes-until-next-stretch', () => {
  if (cooldownDeadline !== null) {
    // Mid-cooldown, the next focus timer hasn't started yet — the real wait
    // is however much cooldown is left, plus a full focus interval after it.
    const { focusMinutes } = getSettings();
    const cooldownMsLeft = Math.max(0, cooldownDeadline - Date.now());
    return Math.max(0, Math.ceil(cooldownMsLeft / 60000)) + focusMinutes;
  }
  if (focusDeadline !== null) {
    return Math.max(0, Math.ceil((focusDeadline - Date.now()) / 60000));
  }
  // No countdown running right now (mid-alert or mid-stretch).
  return null;
});

app.on('window-all-closed', () => {
  // no-op: keep running in the tray even if the overlay window closes
});
