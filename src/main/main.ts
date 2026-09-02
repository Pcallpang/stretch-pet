import { app, BrowserWindow, screen, ipcMain } from 'electron';
import * as path from 'path';
import { TimerScheduler, minutesToMs } from './timerScheduler';
import { getSettings } from './settings';
import { createTray } from './tray';

const COOLDOWN_MINUTES = 2;

let mainWindow: BrowserWindow | null = null;
const focusTimer = new TimerScheduler();
const cooldownTimer = new TimerScheduler();

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
  focusTimer.schedule(minutesToMs(focusMinutes), () => {
    mainWindow?.webContents.send('timer-elapsed');
  });
}

function scheduleCooldownTimer(): void {
  cooldownTimer.schedule(minutesToMs(COOLDOWN_MINUTES), () => {
    mainWindow?.webContents.send('cooldown-elapsed');
    scheduleFocusTimer();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray({ onQuit: () => app.quit() });
  scheduleFocusTimer();
});

ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
  mainWindow?.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('stretch-complete', () => {
  scheduleCooldownTimer();
});

ipcMain.on('stretch-skip', () => {
  scheduleCooldownTimer();
});

ipcMain.handle('get-settings', () => getSettings());

app.on('window-all-closed', () => {
  // no-op: keep running in the tray even if the overlay window closes
});
