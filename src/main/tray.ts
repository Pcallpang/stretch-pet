import { Tray, Menu, app, nativeImage } from 'electron';
import * as path from 'path';
import { getSettings, setSettings } from './settings';

interface TrayCallbacks {
  onQuit: () => void;
}

let tray: Tray | null = null;
let lastCallbacks: TrayCallbacks | null = null;

export function createTray(callbacks: TrayCallbacks): Tray {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '..', '..', 'assets', 'idle', '1.png'),
  );
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('스트레칭펫');
  lastCallbacks = callbacks;
  rebuildMenu(callbacks);
  return tray;
}

// Lets other entry points (e.g. the pet's own right-click menu) that changed
// settings outside the tray's own radio items make the tray label/checks
// reflect the new values, without duplicating the menu-building logic.
export function refreshTray(): void {
  if (tray && lastCallbacks) {
    rebuildMenu(lastCallbacks);
  }
}

function rebuildMenu(callbacks: TrayCallbacks): void {
  if (!tray) return;
  const settings = getSettings();

  const menu = Menu.buildFromTemplate([
    {
      // stretchMinutes is persisted but doesn't actually drive stretch
      // duration (that's the fixed sum of STRETCH_STEPS in renderer.ts) —
      // don't advertise a number the app doesn't act on.
      label: `현재: 집중 ${settings.focusMinutes}분`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '50분 집중 / 5분 스트레칭',
      type: 'radio',
      checked: settings.focusMinutes === 50 && settings.stretchMinutes === 5,
      click: () => {
        setSettings({ focusMinutes: 50, stretchMinutes: 5 });
        rebuildMenu(callbacks);
      },
    },
    {
      label: '25분 집중 / 5분 스트레칭',
      type: 'radio',
      checked: settings.focusMinutes === 25 && settings.stretchMinutes === 5,
      click: () => {
        setSettings({ focusMinutes: 25, stretchMinutes: 5 });
        rebuildMenu(callbacks);
      },
    },
    { type: 'separator' },
    {
      label: '소리',
      type: 'checkbox',
      checked: settings.soundEnabled,
      click: (menuItem) => {
        setSettings({ soundEnabled: menuItem.checked });
      },
    },
    {
      label: '시작 프로그램에 등록',
      type: 'checkbox',
      checked: settings.autoStart,
      click: (menuItem) => {
        setSettings({ autoStart: menuItem.checked });
        app.setLoginItemSettings({ openAtLogin: menuItem.checked });
      },
    },
    { type: 'separator' },
    { label: '종료', click: callbacks.onQuit },
  ]);

  tray.setContextMenu(menu);
}
