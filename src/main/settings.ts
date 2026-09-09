import Store from 'electron-store';

export interface PetSettings {
  focusMinutes: number;
  stretchMinutes: number;
  soundEnabled: boolean;
  autoStart: boolean;
  pinned: boolean;
  character: 'miyo' | 'miyox' | 'deodeumiyo' | 'godmiyo';
}

export const DEFAULT_SETTINGS: PetSettings = {
  focusMinutes: 50,
  stretchMinutes: 5,
  soundEnabled: false,
  autoStart: false,
  pinned: false,
  character: 'miyox',
};

export function clampSettings(settings: Partial<PetSettings>): PetSettings {
  return {
    character: ['miyo', 'miyox', 'deodeumiyo', 'godmiyo'].includes(settings.character as string)
      ? settings.character! : DEFAULT_SETTINGS.character,
    focusMinutes:
      Number.isFinite(settings.focusMinutes) && typeof settings.focusMinutes === 'number' && settings.focusMinutes > 0
        ? Math.min(180, Math.max(5, Math.round(settings.focusMinutes)))
        : DEFAULT_SETTINGS.focusMinutes,
    stretchMinutes:
      Number.isFinite(settings.stretchMinutes) && typeof settings.stretchMinutes === 'number' && settings.stretchMinutes > 0
        ? settings.stretchMinutes
        : DEFAULT_SETTINGS.stretchMinutes,
    soundEnabled: typeof settings.soundEnabled === 'boolean' ? settings.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    autoStart: typeof settings.autoStart === 'boolean' ? settings.autoStart : DEFAULT_SETTINGS.autoStart,
    pinned: typeof settings.pinned === 'boolean' ? settings.pinned : DEFAULT_SETTINGS.pinned,
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
