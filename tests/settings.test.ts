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
      character: 'miyox',
      messengerAlertEnabled: false,
      messengerAlertConsented: false,
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

 describe('character settings', () => {
  it('preserves each supported character and migrates old or invalid settings', () => {
    for (const character of ['miyo', 'miyox', 'deodeumiyo', 'godmiyo'] as const) {
      expect(clampSettings({ character }).character).toBe(character);
    }
    expect(clampSettings({}).character).toBe('miyox');
    expect(clampSettings({ character: '../../oops' } as any).character).toBe('miyox');
  });
});

describe('메신저 알리미 필드', () => {
  it('기본값은 둘 다 꺼짐', () => {
    const s = clampSettings({});
    expect(s.messengerAlertEnabled).toBe(false);
    expect(s.messengerAlertConsented).toBe(false);
  });
  it('유효한 boolean 값은 그대로 유지한다', () => {
    const s = clampSettings({ messengerAlertEnabled: true, messengerAlertConsented: true });
    expect(s.messengerAlertEnabled).toBe(true);
    expect(s.messengerAlertConsented).toBe(true);
  });
  it('잘못된 타입은 기본값으로 되돌린다', () => {
    const s = clampSettings({ messengerAlertEnabled: 'yes' as any, messengerAlertConsented: 1 as any });
    expect(s.messengerAlertEnabled).toBe(false);
    expect(s.messengerAlertConsented).toBe(false);
  });
});
