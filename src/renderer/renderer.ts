// src/renderer/renderer.ts
import { transition } from './fsm.js';
import type { PetState, PetEvent } from './fsm.js';
import { SpriteAnimator } from './spriteAnimator.js';
import { pickDialogue } from './dialoguePicker.js';
import type { DialogueKey } from './dialogues.js';
import {
  clampPosition,
  computeWalkStep,
  exceedsDragThreshold,
  computeDragPosition,
  computeOverlayPosition,
} from './petPosition.js';

const ASSET_BASE = '../../assets';
const PET_SIZE = 96;
const OVERLAY_GAP = 12;

const IDLE_FRAMES = [`${ASSET_BASE}/idle/1.png`, `${ASSET_BASE}/idle/2.png`];
const WALK_FRAMES = [1, 2, 3, 4, 5].map((n) => `${ASSET_BASE}/walk/${n}.png`);

interface StretchStep {
  name: string;
  dialogueKey: DialogueKey;
  seconds: number;
  spriteSrc: string;
  flip: boolean;
}

// "sided" moves are done once per side (왼쪽 then 오른쪽) since a real stretch
// routine works both sides of the body, not just one. The character has a
// single sprite per pose, so the second side reuses the same image mirrored
// horizontally (the existing 'facing-left' CSS class, also used for walking).
const BASE_STEPS: { name: string; dialogueKey: DialogueKey; seconds: number; spriteSrc: string; sided: boolean }[] = [
  { name: '준비', dialogueKey: 'stretch_start', seconds: 10, spriteSrc: `${ASSET_BASE}/stretch/start.png`, sided: false },
  { name: '목 스트레칭', dialogueKey: 'stretch_neck_tilt', seconds: 10, spriteSrc: `${ASSET_BASE}/stretch/neck_tilt.png`, sided: true },
  { name: '어깨 스트레칭', dialogueKey: 'stretch_shoulder_roll', seconds: 15, spriteSrc: `${ASSET_BASE}/stretch/shoulder_roll.png`, sided: false },
  { name: '상체 비틀기', dialogueKey: 'stretch_torso_twist', seconds: 15, spriteSrc: `${ASSET_BASE}/stretch/torso_twist.png`, sided: true },
  { name: '골반/둔근 스트레칭', dialogueKey: 'stretch_hip_glute', seconds: 15, spriteSrc: `${ASSET_BASE}/stretch/hip_glute.png`, sided: true },
  { name: '다리 뻗기', dialogueKey: 'stretch_leg_extension', seconds: 10, spriteSrc: `${ASSET_BASE}/stretch/leg_extension.png`, sided: true },
  { name: '척추 비틀기', dialogueKey: 'stretch_spinal_twist', seconds: 15, spriteSrc: `${ASSET_BASE}/stretch/spinal_twist.png`, sided: true },
  { name: '심호흡/기지개', dialogueKey: 'stretch_deep_breath', seconds: 10, spriteSrc: `${ASSET_BASE}/stretch/deep_breath.png`, sided: false },
];

const STRETCH_STEPS: StretchStep[] = BASE_STEPS.flatMap((step) =>
  step.sided
    ? [
        { name: `${step.name} (왼쪽)`, dialogueKey: step.dialogueKey, seconds: step.seconds, spriteSrc: step.spriteSrc, flip: false },
        { name: `${step.name} (오른쪽)`, dialogueKey: step.dialogueKey, seconds: step.seconds, spriteSrc: step.spriteSrc, flip: true },
      ]
    : [{ name: step.name, dialogueKey: step.dialogueKey, seconds: step.seconds, spriteSrc: step.spriteSrc, flip: false }],
);

let state: PetState = 'idle';
let facingLeft = false;
let petX = 100;
let petY = 0; // set once the window size is known, near the bottom of the screen
const WALK_SPEED = 2;
let stretchStepIndex = 0;

let isDragging = false;
let wasDragged = false;
let dragStartMouseX = 0;
let dragStartMouseY = 0;
let dragStartPetX = 0;
let dragStartPetY = 0;

const petEl = document.getElementById('pet') as HTMLImageElement;
const bubbleEl = document.getElementById('speech-bubble') as HTMLDivElement;
const panelEl = document.getElementById('stretch-panel') as HTMLDivElement;
const nameEl = document.getElementById('stretch-name') as HTMLDivElement;
const stretchDialogueEl = document.getElementById('stretch-dialogue') as HTMLDivElement;
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
let completionTimeout: ReturnType<typeof setTimeout> | null = null;

function fire(event: PetEvent): void {
  const next = transition(state, event);
  if (next === state) return;
  state = next;
  onStateEnter(state);
}

function onStateEnter(next: PetState): void {
  if (completionTimeout) { clearTimeout(completionTimeout); completionTimeout = null; }
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
    petEl.classList.remove('facing-left');
    idleAnimator.start();
    window.petAPI.setIgnoreMouseEvents(true);
  } else if (next === 'walk') {
    hideBubble();
    petEl.classList.toggle('facing-left', facingLeft);
    walkAnimator.start();
    walkInterval = setInterval(stepWalk, 50);
    window.petAPI.setIgnoreMouseEvents(true);
  } else if (next === 'alert') {
    const maxX = window.innerWidth - petEl.clientWidth;
    petX = Math.floor(maxX / 2);
    applyPetPosition();
    petEl.classList.remove('facing-left');
    idleAnimator.start();
    showBubble(pickDialogue('alert_start'));
    // Window stays click-through by default (see the top-level
    // setIgnoreMouseEvents(true) call and the pet's hover handlers below) —
    // only hovering the character itself (or the stretch panel once it's
    // shown) should re-enable mouse events, never the whole alert state.
  } else if (next === 'stretch') {
    hideBubble();
    stretchStepIndex = 0;
    panelEl.classList.remove('hidden');
    window.petAPI.notifyStretchStart();
    runStretchStep();
  } else if (next === 'cooldown') {
    hidePanel();
    hideBubble();
    petEl.classList.remove('facing-left');
    // Without this the pet sat as a frozen still frame for the whole
    // 2-minute cooldown — it looked like it had stopped moving/wandering
    // for good, not just resting between stretches.
    idleAnimator.start();
    window.petAPI.setIgnoreMouseEvents(true);
  }
}

function applyPetPosition(): void {
  petEl.style.left = `${petX}px`;
  petEl.style.top = `${petY}px`;
}

function clampPetPosition(): void {
  const maxX = window.innerWidth - petEl.clientWidth;
  const maxY = window.innerHeight - petEl.clientHeight;
  const clamped = clampPosition(petX, petY, maxX, maxY);
  petX = clamped.x;
  petY = clamped.y;
}

function stepWalk(): void {
  if (isDragging || !settingsPanelEl.classList.contains('hidden')) return;
  const maxX = window.innerWidth - petEl.clientWidth;
  const next = computeWalkStep({ x: petX, facingLeft, maxX, speed: WALK_SPEED });
  petX = next.x;
  facingLeft = next.facingLeft;
  applyPetPosition();
  repositionVisibleOverlays();
  petEl.classList.toggle('facing-left', facingLeft);
}

// Positions an overlay element (speech bubble / stretch panel / settings
// panel) above the pet's current position, tracking it wherever it's been
// dragged to instead of sitting at a fixed screen location. Falls back to
// below the pet if there isn't room above (e.g. pet dragged near the top
// edge), and clamps both axes so the overlay never runs off-screen.
function positionOverlay(el: HTMLElement, xOffset: number): void {
  const { left, top } = computeOverlayPosition({
    petX,
    petY,
    petSize: PET_SIZE,
    gap: OVERLAY_GAP,
    xOffset,
    elWidth: el.offsetWidth,
    elHeight: el.offsetHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function repositionVisibleOverlays(): void {
  if (!bubbleEl.classList.contains('hidden')) positionOverlay(bubbleEl, -20);
  if (!panelEl.classList.contains('hidden')) positionOverlay(panelEl, -40);
  if (!settingsPanelEl.classList.contains('hidden')) positionOverlay(settingsPanelEl, -40);
}

// Bumped on every showBubble() call so a delayed auto-hide (see the
// next-stretch countdown bubble below) can tell whether it's still the
// bubble it scheduled the hide for, or whether something newer (e.g. an
// alert firing) has since taken over the bubble — and skip hiding if so.
let bubbleToken = 0;

function showBubble(text: string): void {
  bubbleToken += 1;
  bubbleEl.textContent = text;
  bubbleEl.classList.remove('hidden');
  positionOverlay(bubbleEl, -20);
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
  positionOverlay(settingsPanelEl, -40);
}

function hideSettingsPanel(): void {
  settingsPanelEl.classList.add('hidden');
  window.petAPI.setIgnoreMouseEvents(!isDragging && !petEl.matches(':hover') &&
    (panelEl.classList.contains('hidden') || !panelEl.matches(':hover')));
}

function runStretchStep(): void {
  const step = STRETCH_STEPS[stretchStepIndex];
  nameEl.textContent = step.name;
  stretchDialogueEl.textContent = pickDialogue(step.dialogueKey);
  petEl.src = step.spriteSrc;
  petEl.classList.toggle('facing-left', step.flip);
  positionOverlay(panelEl, -40);
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
    // Show the completion line immediately (inside the still-visible stretch
    // panel, not a separate bubble — a floating bubble here used to overlap
    // the panel's own countdown text), but delay the state transition (which
    // hides the panel via cooldown's onStateEnter) so it's actually visible
    // for a few seconds instead of being shown and hidden in the same
    // synchronous tick.
    nameEl.textContent = '완료';
    countdownEl.textContent = '';
    stretchDialogueEl.textContent = pickDialogue('complete');
    completionTimeout = setTimeout(() => {
      if (state !== 'stretch') return;
      window.petAPI.notifyStretchComplete();
      fire('stretch_complete');
    }, 3000);
  } else {
    runStretchStep();
  }
}

skipButton.addEventListener('click', () => {
  if (state !== 'stretch') return;
  if (countdownInterval) clearInterval(countdownInterval);
  window.petAPI.notifyStretchSkip();
  fire('stretch_skip');
});

petEl.addEventListener('mouseenter', () => window.petAPI.setIgnoreMouseEvents(false));
petEl.addEventListener('mouseleave', () => {
  // Dragging can carry the cursor faster than the pet visually re-renders,
  // so don't let a transient mouseleave mid-drag re-enable click-through —
  // onDragEnd (or the next real hover) settles it once the drag is done.
  if (isDragging) return;
  // Always re-enable click-through on leave otherwise, regardless of state
  // (e.g. leaving during 'alert' without clicking). idle/walk entry also
  // re-asserts this as a safety net, but this must not be gated on state
  // here — a state-scoped guard is exactly what left the whole desktop
  // permanently non-click-through when the pet was hovered-then-left
  // during 'alert' or 'stretch'.
  window.petAPI.setIgnoreMouseEvents(true);
});

// Pointer capture (not plain mousedown/document-mousemove) is what makes
// this a real press-hold-move-release drag: on this transparent, click-
// through overlay window, a document-level mousemove listener was not a
// reliable way to keep tracking the pointer once the button went down —
// it behaved like two separate clicks ("pick up", then "put down") instead
// of a continuous drag. Capturing the pointer to the pet element forces
// every subsequent pointer event to target it directly until release,
// regardless of where the cursor physically is, which is exactly what a
// drag needs.
petEl.addEventListener('pointerdown', (event) => {
  // Only the primary (left) button starts a drag. The right button also
  // fires 'pointerdown' just before the 'contextmenu' event that opens the
  // right-click menu — without this check, right-clicking left the drag
  // "stuck on" (pointer capture set, isDragging never cleared, since the
  // native context menu swallows the matching pointerup), so any mouse
  // movement afterward — even with no button held — kept yanking the pet to
  // the cursor, which is what looked like the pet auto-grabbing/releasing
  // and "teleporting" all over the screen.
  if (event.button !== 0) return;
  event.preventDefault(); // belt-and-suspenders against the native image drag (see 'dragstart' below and the CSS user-drag:none)
  isDragging = true;
  wasDragged = false;
  dragStartMouseX = event.clientX;
  dragStartMouseY = event.clientY;
  dragStartPetX = petX;
  dragStartPetY = petY;
  petEl.classList.add('dragging');
  petEl.setPointerCapture(event.pointerId);
});

petEl.addEventListener('dragstart', (event) => event.preventDefault());

function cancelDrag(): void {
  // Defensive reset: if capture is lost some other way (e.g. focus moving
  // to a native menu/dialog mid-drag), don't leave isDragging stuck true.
  isDragging = false;
  wasDragged = true;
  petEl.classList.remove('dragging');
  window.petAPI.setIgnoreMouseEvents(!petEl.matches(':hover'));
}
petEl.addEventListener('pointercancel', cancelDrag);
petEl.addEventListener('lostpointercapture', () => { if (isDragging) cancelDrag(); });

petEl.addEventListener('pointermove', (event) => {
  if (!isDragging) return;
  const dx = event.clientX - dragStartMouseX;
  const dy = event.clientY - dragStartMouseY;
  // A few pixels of slop before counting this as a real drag, so a plain
  // click (e.g. to start the stretch routine during 'alert') isn't
  // accidentally swallowed by tiny, unintentional mouse movement.
  if (exceedsDragThreshold(dx, dy, 3)) wasDragged = true;
  const dragged = computeDragPosition({ dragStartX: dragStartPetX, dragStartY: dragStartPetY, dx, dy });
  petX = dragged.x;
  petY = dragged.y;
  clampPetPosition();
  applyPetPosition();
  repositionVisibleOverlays();
});

petEl.addEventListener('pointerup', (event) => {
  if (!isDragging) return;
  isDragging = false;
  petEl.classList.remove('dragging');
  petEl.releasePointerCapture(event.pointerId);
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
  if (wasDragged) {
    wasDragged = false;
    return;
  }
  if (state === 'alert') {
    fire('user_start_stretch');
  } else if (state === 'idle' || state === 'walk' || state === 'cooldown') {
    showNextStretchCountdown();
  }
});

// A quick way to check "how long until the next stretch?" without waiting
// for the alert — shows briefly, then auto-hides so it doesn't linger and
// compete with the pet's normal wandering/speech bubble later.
function showNextStretchCountdown(): void {
  window.petAPI.getMinutesUntilNextStretch().then((minutes) => {
    if (minutes === null || (state !== 'idle' && state !== 'walk' && state !== 'cooldown')) return; // state changed while the request was in flight
    showBubble(minutes <= 0 ? '곧 스트레칭 시간이에요!' : `다음 스트레칭까지 ${minutes}분 남았어요.`);
    const token = bubbleToken;
    setTimeout(() => {
      if (bubbleToken === token) hideBubble();
    }, 4000);
  });
}

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
  if (isDragging || !settingsPanelEl.classList.contains('hidden')) return;
  if (state === 'idle') fire('wander_start');
  else if (state === 'walk') fire('wander_pause');
}, 8000);

window.addEventListener('resize', () => {
  clampPetPosition();
  applyPetPosition();
  repositionVisibleOverlays();
});

petY = window.innerHeight - 40 - PET_SIZE;
applyPetPosition();
window.petAPI.setIgnoreMouseEvents(true);
onStateEnter('idle');
