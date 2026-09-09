import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('petAPI', {
  setIgnoreMouseEvents: (ignore: boolean): void => {
    ipcRenderer.send('set-ignore-mouse-events', ignore);
  },
  onTimerElapsed: (callback: () => void): void => {
    ipcRenderer.on('timer-elapsed', () => callback());
  },
  onCooldownElapsed: (callback: () => void): void => {
    ipcRenderer.on('cooldown-elapsed', () => callback());
  },
  onAlertTimeout: (callback: () => void): void => {
    ipcRenderer.on('alert-timeout', () => callback());
  },
  notifyStretchComplete: (): void => {
    ipcRenderer.send('stretch-complete');
  },
  notifyStretchSkip: (): void => {
    ipcRenderer.send('stretch-skip');
  },
  notifyStretchStart: (): void => {
    ipcRenderer.send('stretch-started');
  },
  getSettings: (): Promise<unknown> => ipcRenderer.invoke('get-settings'),
  showPetContextMenu: (): void => {
    ipcRenderer.send('show-pet-context-menu');
  },
  onForceStretch: (callback: () => void): void => {
    ipcRenderer.on('force-stretch', () => callback());
  },
  onShowSettingsPanel: (callback: (focusMinutes: number) => void): void => {
    ipcRenderer.on('show-settings-panel', (_event, focusMinutes: number) => callback(focusMinutes));
  },
  setFocusMinutes: (minutes: number): void => {
    ipcRenderer.send('set-focus-minutes', minutes);
  },
  getMinutesUntilNextStretch: (): Promise<number | null> =>
    ipcRenderer.invoke('get-minutes-until-next-stretch'),
  onCharacterChanged: (callback: (character: string) => void): void => {
    ipcRenderer.on('character-changed', (_event, character: string) => callback(character));
  },
  onPinnedChanged: (callback: (pinned: boolean) => void): void => {
    ipcRenderer.on('pinned-changed', (_event, pinned: boolean) => callback(pinned));
  },
});
