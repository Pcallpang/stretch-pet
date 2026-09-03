export function clampFocusMinutes(minutes: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(minutes)));
}

interface MinutesUntilNextStretchInput {
  cooldownDeadline: number | null;
  focusDeadline: number | null;
  focusMinutes: number;
  now: number;
}

export function computeMinutesUntilNextStretch({
  cooldownDeadline,
  focusDeadline,
  focusMinutes,
  now,
}: MinutesUntilNextStretchInput): number | null {
  if (cooldownDeadline !== null) {
    const cooldownMsLeft = Math.max(0, cooldownDeadline - now);
    return Math.max(0, Math.ceil(cooldownMsLeft / 60000)) + focusMinutes;
  }
  if (focusDeadline !== null) {
    return Math.max(0, Math.ceil((focusDeadline - now) / 60000));
  }
  return null;
}
