import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimerScheduler, minutesToMs } from '../src/main/timerScheduler';

describe('minutesToMs', () => {
  it('converts minutes to milliseconds', () => {
    expect(minutesToMs(1)).toBe(60000);
    expect(minutesToMs(50)).toBe(3000000);
  });
});

describe('TimerScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('calls the callback after the scheduled delay', () => {
    const scheduler = new TimerScheduler();
    const callback = vi.fn();
    scheduler.schedule(1000, callback);
    vi.advanceTimersByTime(999);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('cancels a previously scheduled callback when scheduling again', () => {
    const scheduler = new TimerScheduler();
    const first = vi.fn();
    const second = vi.fn();
    scheduler.schedule(1000, first);
    scheduler.schedule(2000, second);
    vi.advanceTimersByTime(2000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancel() stops a pending callback', () => {
    const scheduler = new TimerScheduler();
    const callback = vi.fn();
    scheduler.schedule(1000, callback);
    scheduler.cancel();
    vi.advanceTimersByTime(2000);
    expect(callback).not.toHaveBeenCalled();
  });
});
