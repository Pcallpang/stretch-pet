import { describe, it, expect } from 'vitest';
import { clampFocusMinutes, computeMinutesUntilNextStretch } from '../src/main/nextStretch';

describe('clampFocusMinutes', () => {
  it('keeps a value already inside the range', () => {
    expect(clampFocusMinutes(30, 5, 180)).toBe(30);
  });

  it('rounds a fractional value', () => {
    expect(clampFocusMinutes(30.6, 5, 180)).toBe(31);
  });

  it('floors a value below the minimum', () => {
    expect(clampFocusMinutes(1, 5, 180)).toBe(5);
  });

  it('caps a value above the maximum', () => {
    expect(clampFocusMinutes(999, 5, 180)).toBe(180);
  });
});

describe('computeMinutesUntilNextStretch', () => {
  const now = 1_000_000;

  it('returns null when neither timer is running (mid-alert/mid-stretch)', () => {
    expect(
      computeMinutesUntilNextStretch({ cooldownDeadline: null, focusDeadline: null, focusMinutes: 50, now }),
    ).toBeNull();
  });

  it('reports minutes left on the focus timer, rounded up', () => {
    expect(
      computeMinutesUntilNextStretch({
        cooldownDeadline: null,
        focusDeadline: now + 90_000, // 1.5 minutes
        focusMinutes: 50,
        now,
      }),
    ).toBe(2);
  });

  it('clamps a past focus deadline to 0 instead of going negative', () => {
    expect(
      computeMinutesUntilNextStretch({
        cooldownDeadline: null,
        focusDeadline: now - 5_000,
        focusMinutes: 50,
        now,
      }),
    ).toBe(0);
  });

  it('during cooldown, adds remaining cooldown minutes plus a full focus interval', () => {
    expect(
      computeMinutesUntilNextStretch({
        cooldownDeadline: now + 60_000, // 1 minute left
        focusDeadline: null,
        focusMinutes: 50,
        now,
      }),
    ).toBe(51);
  });

  it('prefers the cooldown deadline when both are somehow set', () => {
    expect(
      computeMinutesUntilNextStretch({
        cooldownDeadline: now + 30_000,
        focusDeadline: now + 999_000,
        focusMinutes: 25,
        now,
      }),
    ).toBe(26);
  });
});
