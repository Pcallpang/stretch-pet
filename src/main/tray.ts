import { Tray, Menu, app, nativeImage } from 'electron';
import * as path from 'path';
import { getSettings, setSettings } from './settings';

interface TrayCallbacks {
  onQuit: () => void;
}

let tray: Tray | null = null;

export function createTray(callbacks: TrayCallbacks): Tray {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '..', '..', 'assets', 'idle', '1.png'),
  );
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('스트레칭펫');
  rebuildMenu(callbacks);
  return tray;
}

function rebuildMenu(callbacks: TrayCallbacks): void {
  if (!tray) return;
  const settings = getSettings();

  const menu = Menu.buildFromTemplate([
    {
      label: `현재: 집중 ${settings.focusMinutes}분 / 스트레칭 ${settings.stretchMinutes}분`,
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
