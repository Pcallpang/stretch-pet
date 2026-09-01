import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpriteAnimator } from '../src/renderer/spriteAnimator';

describe('SpriteAnimator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('calls onFrame with the first frame immediately on start', () => {
    const onFrame = vi.fn();
    const animator = new SpriteAnimator(['a.png', 'b.png'], 2, onFrame);
    animator.start();
    expect(onFrame).toHaveBeenCalledWith('a.png');
    animator.stop();
  });

  it('cycles through frames at the given fps', () => {
    const onFrame = vi.fn();
    const animator = new SpriteAnimator(['a.png', 'b.png'], 2, onFrame);
    animator.start();
    vi.advanceTimersByTime(500);
    expect(onFrame).toHaveBeenLastCalledWith('b.png');
    vi.advanceTimersByTime(500);
    expect(onFrame).toHaveBeenLastCalledWith('a.png');
    animator.stop();
  });

  it('stop() halts further frame updates', () => {
    const onFrame = vi.fn();
    const animator = new SpriteAnimator(['a.png', 'b.png'], 2, onFrame);
    animator.start();
    animator.stop();
    onFrame.mockClear();
    vi.advanceTimersByTime(1000);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('throws when constructed with no frames', () => {
    expect(() => new SpriteAnimator([], 2, () => {})).toThrow();
  });
});
