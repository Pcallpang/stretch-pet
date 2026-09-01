import { describe, it, expect } from 'vitest';
import { transition } from '../src/renderer/fsm';

describe('transition', () => {
  it('idle -> alert on timer_elapsed', () => {
    expect(transition('idle', 'timer_elapsed')).toBe('alert');
  });

  it('walk -> alert on timer_elapsed', () => {
    expect(transition('walk', 'timer_elapsed')).toBe('alert');
  });

  it('alert -> stretch on user_start_stretch', () => {
    expect(transition('alert', 'user_start_stretch')).toBe('stretch');
  });

  it('stretch -> cooldown on stretch_complete', () => {
    expect(transition('stretch', 'stretch_complete')).toBe('cooldown');
  });

  it('stretch -> cooldown on stretch_skip', () => {
    expect(transition('stretch', 'stretch_skip')).toBe('cooldown');
  });

  it('cooldown -> idle on cooldown_elapsed', () => {
    expect(transition('cooldown', 'cooldown_elapsed')).toBe('idle');
  });

  it('idle <-> walk wander toggle', () => {
    expect(transition('idle', 'wander_start')).toBe('walk');
    expect(transition('walk', 'wander_pause')).toBe('idle');
  });

  it('ignores an event that has no transition for the current state', () => {
    expect(transition('idle', 'stretch_complete')).toBe('idle');
  });
});
