// src/renderer/renderer.ts
import { transition } from './fsm.js';
import type { PetState, PetEvent } from './fsm.js';
import { SpriteAnimator } from './spriteAnimator.js';
import { pickDialogue } from './dialoguePicker.js';
import type { DialogueKey } from './dialogues.js';

const ASSET_BASE = '../../assets';

const IDLE_FRAMES = [`${ASSET_BASE}/idle/1.png`, `${ASSET_BASE}/idle/2.png`];
const WALK_FRAMES = [1, 2, 3, 4, 5].map((n) => `${ASSET_BASE}/walk/${n}.png`);

const STRETCH_STEPS: { name: string; dialogueKey: DialogueKey; seconds: number; spriteSrc: string }[] = [
  { name: '준비', dialogueKey: 'stretch_start', seconds: 10, spriteSrc: `${ASSET_BASE}/stretch/start.png` },
  { name: '목 스트레칭', dialogueKey: 'stretch_neck_tilt', seconds: 10, spriteSrc: `${ASSET_BASE}/stretch/neck_tilt.png` },
  { name: '어깨 스트레칭', dialogueKey: 'stretch_shoulder_roll', seconds: 15, spriteSrc: `${ASSET_BASE}/stretch/shoulder_roll.png` },
  { name: '상체 비틀기', dialogueKey: 'stretch_torso_twist', seconds: 15, spriteSrc: `${ASSET_BASE}/stretch/torso_twist.png` },
  { name: '골반/둔근 스트레칭', dialogueKey: 'stretch_hip_glute', seconds: 15, spriteSrc: `${ASSET_BASE}/stretch/hip_glute.png` },
  { name: '다리 뻗기', dialogueKey: 'stretch_leg_extension', seconds: 10, spriteSrc: `${ASSET_BASE}/stretch/leg_extension.png` },
  { name: '척추 비틀기', dialogueKey: 'stretch_spinal_twist', seconds: 15, spriteSrc: `${ASSET_BASE}/stretch/spinal_twist.png` },
  { name: '심호흡/기지개', dialogueKey: 'stretch_deep_breath', seconds: 10, spriteSrc: `${ASSET_BASE}/stretch/deep_breath.png` },
];

let state: PetState = 'idle';
let facingLeft = false;
let petX = 100;
const WALK_SPEED = 2;
let stretchStepIndex = 0;

const petEl = document.getElementById('pet') as HTMLImageElement;
const bubbleEl = document.getElementById('speech-bubble') as HTMLDivElement;
const panelEl = document.getElementById('stretch-panel') as HTMLDivElement;
const nameEl = document.getElementById('stretch-name') as HTMLDivElement;
const countdownEl = document.getElementById('stretch-countdown') as HTMLDivElement;
const skipButton = document.getElementById('stretch-skip') as HTMLButtonElement;
const settingsPanelEl = document.getElementById('settings-panel') as HTMLDivElement;
const settingsMinutesInput = document.getElementById('settings-minutes-input') as HTMLInputElement;
const settingsConfirmButton = document.getElementById('settings-confirm') as HTMLButtonElement;
const settingsCancelButton = document.getElementById('settings-cancel') as HTMLButtonElement;

const idleAnimator = new SpriteAnimator(IDLE_FRAMES, 1, (src) => { petEl.src = src; });
const walkAnimator = new SpriteAnimator(WALK_FRAMES, 6, (src) => { petEl.src = src; });

let walkInterval: ReturnType<typeof setInterval> | null = null;
let countdownInterval: ReturnType<typeof setInterval> | null = null;

function fire(event: PetEvent): void {
  const next = transition(state, event);
  if (next === state) return;
  state = next;
  onStateEnter(state);
}

function onStateEnter(next: PetState): void {
  idleAnimator.stop();
  walkAnimator.stop();
  if (walkInterval) { clearInterval(walkInterval); walkInterval = null; }
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  // A state change (including a manually-triggered "지금 스트레칭 하기") always
  // supersedes an open settings panel, so it never lingers on top of the
  // stretch UI or a walking pet.
  hideSettingsPanel();

  if (next === 'idle') {
    hideBubble();
    idleAnimator.start();
    window.petAPI.setIgnoreMouseEvents(true);
  } else if (next === 'walk') {
    hideBubble();
    walkAnimator.start();
    walkInterval = setInterval(stepWalk, 50);
    window.petAPI.setIgnoreMouseEvents(true);
  } else if (next === 'alert') {
    const maxX = window.innerWidth - petEl.clientWidth;
    petX = Math.floor(maxX / 2);
    petEl.style.left = `${petX}px`;
    idleAnimator.start();
    showBubble(pickDialogue('alert_start'));
    // Window stays click-through by default (see the top-level
    // setIgnoreMouseEvents(true) call and the pet's hover handlers below) —
    // only hovering the character itself (or the stretch panel once it's
    // shown) should re-enable mouse events, never the whole alert state.
  } else if (next === 'stretch') {
    stretchStepIndex = 0;
    panelEl.classList.remove('hidden');
    window.petAPI.notifyStretchStart();
    runStretchStep();
  } else if (next === 'cooldown') {
    hidePanel();
    hideBubble();
    window.petAPI.setIgnoreMouseEvents(true);
  }
}

function stepWalk(): void {
  petX += facingLeft ? -WALK_SPEED : WALK_SPEED;
  const maxX = window.innerWidth - petEl.clientWidth;
  if (petX <= 0) { petX = 0; facingLeft = false; }
  if (petX >= maxX) { petX = maxX; facingLeft = true; }
  petEl.style.left = `${petX}px`;
  petEl.classList.toggle('facing-left', facingLeft);
}

// Positions an overlay element (speech bubble / stretch panel) horizontally
// so it tracks the pet's current position instead of sitting at a fixed CSS
// left, clamped so it never runs off either edge of the screen.
function trackPetX(el: HTMLElement, offset: number): void {
  const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth);
  const left = Math.max(0, Math.min(petX - offset, maxLeft));
  el.style.left = `${left}px`;
}

function showBubble(text: string): void {
  bubbleEl.textContent = text;
  bubbleEl.classList.remove('hidden');
  trackPetX(bubbleEl, -20);
}

function hideBubble(): void {
  bubbleEl.classList.add('hidden');
}

function hidePanel(): void {
  panelEl.classList.add('hidden');
}

function showSettingsPanel(currentFocusMinutes: number): void {
  settingsMinutesInput.value = String(currentFocusMinutes);
  settingsPanelEl.classList.remove('hidden');
  trackPetX(settingsPanelEl, -40);
}

function hideSettingsPanel(): void {
  settingsPanelEl.classList.add('hidden');
}

function runStretchStep(): void {
  const step = STRETCH_STEPS[stretchStepIndex];
  nameEl.textContent = step.name;
  petEl.src = step.spriteSrc;
  trackPetX(panelEl, -40);
  showBubble(pickDialogue(step.dialogueKey));
  let remaining = step.seconds;
  countdownEl.textContent = String(remaining);
  countdownInterval = setInterval(() => {
    remaining -= 1;
    countdownEl.textContent = String(remaining);
    if (remaining <= 0) {
      if (countdownInterval) clearInterval(countdownInterval);
      advanceStretchStep();
    }
  }, 1000);
}

function advanceStretchStep(): void {
  stretchStepIndex += 1;
  if (stretchStepIndex >= STRETCH_STEPS.length) {
    // Show the completion line immediately, but delay the state transition
    // (which hides the bubble via cooldown's onStateEnter) so it's actually
    // visible for a few seconds instead of being shown and hidden in the
    // same synchronous tick.
    showBubble(pickDialogue('complete'));
    setTimeout(() => {
      window.petAPI.notifyStretchComplete();
      fire('stretch_complete');
    }, 3000);
  } else {
    runStretchStep();
  }
}

skipButton.addEventListener('click', () => {
  if (countdownInterval) clearInterval(countdownInterval);
  window.petAPI.notifyStretchSkip();
  fire('stretch_skip');
});

petEl.addEventListener('mouseenter', () => window.petAPI.setIgnoreMouseEvents(false));
petEl.addEventListener('mouseleave', () => {
  // Always re-enable click-through on leave, regardless of state (e.g.
  // leaving during 'alert' without clicking). idle/walk entry also
  // re-asserts this as a safety net, but this must not be gated on state
  // here — a state-scoped guard is exactly what left the whole desktop
  // permanently non-click-through when the pet was hovered-then-left
  // during 'alert' or 'stretch'.
  window.petAPI.setIgnoreMouseEvents(true);
});

// Same hover-scoped enable/disable pattern as the pet itself, so the user
// can click the skip button / interact with the panel during 'stretch'
// without the rest of the screen losing click-through.
panelEl.addEventListener('mouseenter', () => window.petAPI.setIgnoreMouseEvents(false));
panelEl.addEventListener('mouseleave', () => {
  if (state === 'stretch') {
    window.petAPI.setIgnoreMouseEvents(true);
  }
});

petEl.addEventListener('click', () => {
  if (state === 'alert') {
    fire('user_start_stretch');
  }
});

petEl.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.petAPI.showPetContextMenu();
});

settingsPanelEl.addEventListener('mouseenter', () => window.petAPI.setIgnoreMouseEvents(false));
settingsPanelEl.addEventListener('mouseleave', () => window.petAPI.setIgnoreMouseEvents(true));

settingsConfirmButton.addEventListener('click', () => {
  const minutes = Number(settingsMinutesInput.value);
  if (Number.isFinite(minutes) && minutes > 0) {
    window.petAPI.setFocusMinutes(minutes);
  }
  hideSettingsPanel();
});

settingsCancelButton.addEventListener('click', () => {
  hideSettingsPanel();
});

window.petAPI.onTimerElapsed(() => fire('timer_elapsed'));
window.petAPI.onCooldownElapsed(() => fire('cooldown_elapsed'));
window.petAPI.onAlertTimeout(() => fire('alert_timeout'));
window.petAPI.onForceStretch(() => fire('force_start_stretch'));
window.petAPI.onShowSettingsPanel((focusMinutes) => showSettingsPanel(focusMinutes));

setInterval(() => {
  if (state === 'idle') fire('wander_start');
  else if (state === 'walk') fire('wander_pause');
}, 8000);

window.petAPI.setIgnoreMouseEvents(true);
onStateEnter('idle');
