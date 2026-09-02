import Store from 'electron-store';

export interface PetSettings {
  focusMinutes: number;
  stretchMinutes: number;
  soundEnabled: boolean;
  autoStart: boolean;
}

export const DEFAULT_SETTINGS: PetSettings = {
  focusMinutes: 50,
  stretchMinutes: 5,
  soundEnabled: false,
  autoStart: false,
};

export function clampSettings(settings: Partial<PetSettings>): PetSettings {
  return {
    focusMinutes:
      settings.focusMinutes && settings.focusMinutes > 0
        ? settings.focusMinutes
        : DEFAULT_SETTINGS.focusMinutes,
    stretchMinutes:
      settings.stretchMinutes && settings.stretchMinutes > 0
        ? settings.stretchMinutes
        : DEFAULT_SETTINGS.stretchMinutes,
    soundEnabled: settings.soundEnabled ?? DEFAULT_SETTINGS.soundEnabled,
    autoStart: settings.autoStart ?? DEFAULT_SETTINGS.autoStart,
  };
}

// Lazy: electron-store needs a real Electron runtime, so it must not be
// constructed at module-import time (that would break plain-Node unit tests).
let store: Store<PetSettings> | null = null;
function getStore(): Store<PetSettings> {
  if (!store) {
    store = new Store<PetSettings>({ defaults: DEFAULT_SETTINGS });
  }
  return store;
}

export function getSettings(): PetSettings {
  try {
    return clampSettings(getStore().store);
  } catch (err) {
    console.error('Failed to read settings store, falling back to defaults:', err);
    return clampSettings({});
  }
}

export function setSettings(partial: Partial<PetSettings>): PetSettings {
  let current: Partial<PetSettings> = {};
  try {
    current = getStore().store;
  } catch (err) {
    console.error('Failed to read settings store while writing, falling back to defaults:', err);
  }
  const merged = clampSettings({ ...current, ...partial });
  try {
    getStore().set(merged);
  } catch (err) {
    console.error('Failed to persist settings:', err);
  }
  return merged;
}
