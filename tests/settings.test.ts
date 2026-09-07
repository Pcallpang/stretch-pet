import { describe, it, expect } from 'vitest';
import { clampSettings, DEFAULT_SETTINGS } from '../src/main/settings';

describe('clampSettings', () => {
  it('fills in defaults for missing fields', () => {
    expect(clampSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults for zero or negative minute values', () => {
    expect(clampSettings({ focusMinutes: 0, stretchMinutes: -5 })).toEqual(
      expect.objectContaining({ focusMinutes: 50, stretchMinutes: 5 }),
    );
  });

  it('keeps valid overrides', () => {
    expect(clampSettings({ focusMinutes: 25, soundEnabled: true })).toEqual({
      focusMinutes: 25,
      stretchMinutes: 5,
      soundEnabled: true,
      autoStart: false,
      pinned: false,
    });
  });

  it('keeps a valid pinned override', () => {
    expect(clampSettings({ pinned: true })).toEqual(
      expect.objectContaining({ pinned: true }),
    );
  });
});


describe('invalid persisted settings', () => {
  it('rejects non-finite and wrongly typed stored values', () => {
    expect(clampSettings({ focusMinutes: Infinity, stretchMinutes: NaN,
      soundEnabled: 'false', autoStart: 1, pinned: 'yes' } as any)).toEqual(DEFAULT_SETTINGS);
  });
  it('normalizes the supported focus range and integer precision', () => {
    expect(clampSettings({ focusMinutes: 999 }).focusMinutes).toBe(180);
    expect(clampSettings({ focusMinutes: 1 }).focusMinutes).toBe(5);
    expect(clampSettings({ focusMinutes: 25.6 }).focusMinutes).toBe(26);
  });
});
