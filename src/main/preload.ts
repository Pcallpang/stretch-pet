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
  notifyStretchComplete: (): void => {
    ipcRenderer.send('stretch-complete');
  },
  notifyStretchSkip: (): void => {
    ipcRenderer.send('stretch-skip');
  },
  getSettings: (): Promise<unknown> => ipcRenderer.invoke('get-settings'),
});
