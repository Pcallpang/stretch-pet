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
    });
  });
});
