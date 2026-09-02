// src/renderer/renderer.ts
import { transition } from './fsm.js';
import type { PetState, PetEvent } from './fsm.js';
import { SpriteAnimator } from './spriteAnimator.js';
import { pickDialogue } from './dialoguePicker.js';
import type { DialogueKey } from './dialogues.js';

const ASSET_BASE = '../../assets';

const IDLE_FRAMES = [`${ASSET_BASE}/idle/1.png`, `${ASSET_BASE}/idle/2.png`];
const WALK_FRAMES = [1, 2, 3, 4, 5].map((n) => `${ASSET_BASE}/walk/${n}.png`);

const STRETCH_STEPS: { name: string; dialogueKey: DialogueKey; seconds: number }[] = [
  { name: '준비', dialogueKey: 'stretch_start', seconds: 10 },
  { name: '목 스트레칭', dialogueKey: 'stretch_neck_tilt', seconds: 10 },
  { name: '어깨 스트레칭', dialogueKey: 'stretch_shoulder_roll', seconds: 15 },
  { name: '상체 비틀기', dialogueKey: 'stretch_torso_twist', seconds: 15 },
  { name: '골반/둔근 스트레칭', dialogueKey: 'stretch_hip_glute', seconds: 15 },
  { name: '다리 뻗기', dialogueKey: 'stretch_leg_extension', seconds: 10 },
  { name: '척추 비틀기', dialogueKey: 'stretch_spinal_twist', seconds: 15 },
  { name: '심호흡/기지개', dialogueKey: 'stretch_deep_breath', seconds: 10 },
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

const idleAnimator = new SpriteAnimator(IDLE_FRAMES, 1, (src) => { petEl.src = src; });
const walkAnimator = new SpriteAnimator(WALK_FRAMES, 6, (src) => { petEl.src = src; });

let walkInterval: ReturnType<typeof setInterval> | null = null;
let countdownInterval: ReturnType<typeof setInterval> | null = null;

function fire(event: PetEvent): void {
  state = transition(state, event);
  onStateEnter(state);
}

function onStateEnter(next: PetState): void {
  idleAnimator.stop();
  walkAnimator.stop();
  if (walkInterval) { clearInterval(walkInterval); walkInterval = null; }
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }

  if (next === 'idle') {
    hideBubble();
    idleAnimator.start();
  } else if (next === 'walk') {
    hideBubble();
    walkAnimator.start();
    walkInterval = setInterval(stepWalk, 50);
  } else if (next === 'alert') {
    const maxX = window.innerWidth - petEl.clientWidth;
    petX = Math.floor(maxX / 2);
    petEl.style.left = `${petX}px`;
    idleAnimator.start();
    showBubble(pickDialogue('alert_start'));
    window.petAPI.setIgnoreMouseEvents(false);
  } else if (next === 'stretch') {
    stretchStepIndex = 0;
    panelEl.classList.remove('hidden');
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

function showBubble(text: string): void {
  bubbleEl.textContent = text;
  bubbleEl.classList.remove('hidden');
}

function hideBubble(): void {
  bubbleEl.classList.add('hidden');
}

function hidePanel(): void {
  panelEl.classList.add('hidden');
}

function runStretchStep(): void {
  const step = STRETCH_STEPS[stretchStepIndex];
  nameEl.textContent = step.name;
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
    showBubble(pickDialogue('complete'));
    window.petAPI.notifyStretchComplete();
    fire('stretch_complete');
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
  if (state === 'idle' || state === 'walk') {
    window.petAPI.setIgnoreMouseEvents(true);
  }
});

petEl.addEventListener('click', () => {
  if (state === 'alert') {
    fire('user_start_stretch');
  }
});

window.petAPI.onTimerElapsed(() => fire('timer_elapsed'));
window.petAPI.onCooldownElapsed(() => fire('cooldown_elapsed'));

setInterval(() => {
  if (state === 'idle') fire('wander_start');
  else if (state === 'walk') fire('wander_pause');
}, 8000);

window.petAPI.setIgnoreMouseEvents(true);
onStateEnter('idle');
