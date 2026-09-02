export type PetState = 'idle' | 'walk' | 'alert' | 'stretch' | 'cooldown';

export type PetEvent =
  | 'wander_start'
  | 'wander_pause'
  | 'timer_elapsed'
  | 'user_start_stretch'
  | 'stretch_complete'
  | 'stretch_skip'
  | 'cooldown_elapsed'
  | 'alert_timeout'
  | 'force_start_stretch';

const TRANSITIONS: Record<PetState, Partial<Record<PetEvent, PetState>>> = {
  idle: { wander_start: 'walk', timer_elapsed: 'alert', force_start_stretch: 'stretch' },
  walk: { wander_pause: 'idle', timer_elapsed: 'alert', force_start_stretch: 'stretch' },
  alert: { user_start_stretch: 'stretch', alert_timeout: 'idle', force_start_stretch: 'stretch' },
  stretch: { stretch_complete: 'cooldown', stretch_skip: 'cooldown' },
  cooldown: { cooldown_elapsed: 'idle', force_start_stretch: 'stretch' },
};

export function transition(state: PetState, event: PetEvent): PetState {
  return TRANSITIONS[state][event] ?? state;
}
