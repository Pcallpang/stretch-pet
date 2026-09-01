# Desktop Stretch Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Electron desktop pet that wanders the screen, alerts the user on a focus/stretch timer, and walks them through an 8-step chair stretch routine with the '미요-X' character.

**Architecture:** Electron main process owns the transparent always-on-top window, click-through toggling, timers, settings persistence, and tray menu. The renderer process (plain TypeScript + DOM, no framework) owns the FSM-driven character animation, speech bubble, and stretch-sequence UI. Main and renderer talk only through a typed `preload.ts` IPC bridge.

**Tech Stack:** Electron, TypeScript, `electron-store` (settings), Jimp (one-time sprite-slicing script), Vitest (unit tests for all pure logic).

## Global Constraints

- Language: TypeScript throughout (main, preload, renderer, scripts use `.mjs`).
- `electron-store` pinned to `^8.2.0` — later major versions are ESM-only and break under the CommonJS main-process build.
- Sprite slicing uses Node + Jimp, not Python — keeps the whole project single-toolchain.
- Renderer TS compiles to native ES modules (`module: ES2022`, `moduleResolution: Node16`) with **no bundler**, so every relative import between renderer files must include an explicit `.js` extension (e.g. `import { transition } from './fsm.js'`).
- Main/preload TS compiles to CommonJS — relative imports there use plain extensionless specifiers.
- Default timer: 50 min focus / 5 min stretch (from the original request). Cooldown after a stretch session is a fixed 2 minutes, not user-configurable (not part of the original settings list).
- Character dialogue lines are used verbatim as specified by the user; no rewording.
- No sound assets in this iteration — the tray "소리" toggle is wired to settings but has no audio file to play yet.
- Reference art (`미요X 데스크톱펫.png`) has uneven frame spacing, so animation frames are sliced into individual PNGs per frame rather than read from fixed grid coordinates at runtime.

---

## File Structure

```
S04-스트레칭펫(StretchPet)/
  package.json
  tsconfig.base.json
  tsconfig.main.json
  tsconfig.renderer.json
  vitest.config.ts
  scripts/
    slice-sprites.mjs
  src/
    main/
      main.ts
      preload.ts
      settings.ts
      timerScheduler.ts
      tray.ts
    renderer/
      index.html
      style.css
      renderer.ts
      fsm.ts
      spriteAnimator.ts
      dialogues.ts
      dialoguePicker.ts
    types/
      global.d.ts
  tests/
    fsm.test.ts
    spriteAnimator.test.ts
    dialoguePicker.test.ts
    timerScheduler.test.ts
    settings.test.ts
  assets/
    idle/   (1.png, 2.png)
    walk/   (1.png..5.png)
    stretch/ (start.png, neck_tilt.png, shoulder_roll.png, torso_twist.png,
              hip_glute.png, leg_extension.png, spinal_twist.png, deep_breath.png)
  docs/superpowers/specs/2026-09-01-desktop-stretch-pet-design.md
  docs/superpowers/plans/2026-09-01-desktop-stretch-pet.md
  미요X 데스크톱펫.png
  CLAUDE.md
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.main.json`
- Create: `tsconfig.renderer.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

**Interfaces:**
- Produces: `npm run build`, `npm start`, `npm test`, `npm run slice-sprites` scripts that every later task relies on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "stretch-pet",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.main.json && tsc -p tsconfig.renderer.json",
    "start": "npm run build && electron .",
    "test": "vitest run",
    "slice-sprites": "node scripts/slice-sprites.mjs"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "jimp": "^0.22.12"
  },
  "dependencies": {
    "electron-store": "^8.2.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Create `tsconfig.main.json`**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist/main",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/main/**/*.ts"]
}
```

- [ ] **Step 4: Create `tsconfig.renderer.json`**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Node16",
    "outDir": "dist/renderer",
    "lib": ["ES2022", "DOM"],
    "types": []
  },
  "include": ["src/renderer/**/*.ts", "src/types/global.d.ts"]
}
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: exits 0, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json tsconfig.main.json tsconfig.renderer.json vitest.config.ts .gitignore
git commit -m "chore: scaffold Electron/TypeScript project"
```

---

### Task 2: Slice reference art into individual sprite frames

**Files:**
- Create: `scripts/slice-sprites.mjs`
- Create (generated): `assets/idle/1.png`, `assets/idle/2.png`
- Create (generated): `assets/walk/1.png` .. `assets/walk/5.png`
- Create (generated): `assets/stretch/start.png`, `neck_tilt.png`, `shoulder_roll.png`, `torso_twist.png`, `hip_glute.png`, `leg_extension.png`, `spinal_twist.png`, `deep_breath.png`

**Interfaces:**
- Produces: the 15 PNG paths every later renderer task references directly (`assets/idle/1.png` etc.) — file names are the contract, don't rename without updating `renderer.ts` (Task 10).

- [ ] **Step 1: Create the slicing script**

```js
// scripts/slice-sprites.mjs
import Jimp from 'jimp';
import path from 'node:path';
import fs from 'node:fs';

const SOURCE = path.resolve('미요X 데스크톱펫.png');
const OUT_DIR = path.resolve('assets');

// The reference sheet is a 4-row grid: rows 0/2/3 have 4 columns, row 1 (WALK) has 5.
const ROW_HEIGHT = 528; // 2112 / 4 rows
const COL_WIDTH_4 = 496; // 1984 / 4 columns
const COL_WIDTH_5 = Math.floor(1984 / 5);

async function sliceRow(image, rowIndex, colCount, names, outSubdir) {
  const colWidth = colCount === 5 ? COL_WIDTH_5 : COL_WIDTH_4;
  const y = rowIndex * ROW_HEIGHT;
  fs.mkdirSync(path.join(OUT_DIR, outSubdir), { recursive: true });

  for (let i = 0; i < names.length; i++) {
    const x = i * colWidth;
    const cell = image.clone().crop(x, y, colWidth, ROW_HEIGHT);
    cell.autocrop({ cropOnlyFrames: false, tolerance: 0.02 });
    const outPath = path.join(OUT_DIR, outSubdir, `${names[i]}.png`);
    await cell.writeAsync(outPath);
    console.log('wrote', outPath);
  }
}

async function main() {
  const image = await Jimp.read(SOURCE);
  // Row 0 (IDLE/STRETCH header): only the first 2 columns are distinct poses,
  // columns 3-4 duplicate column 1 in the reference sheet — skip them.
  await sliceRow(image, 0, 2, ['1', '2'], 'idle');
  await sliceRow(image, 1, 5, ['1', '2', '3', '4', '5'], 'walk');
  await sliceRow(
    image,
    2,
    4,
    ['start', 'neck_tilt', 'shoulder_roll', 'torso_twist'],
    'stretch',
  );
  await sliceRow(
    image,
    3,
    4,
    ['hip_glute', 'leg_extension', 'spinal_twist', 'deep_breath'],
    'stretch',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the slicer**

Run: `npm run slice-sprites`
Expected: 15 "wrote ..." lines, no errors.

- [ ] **Step 3: Manually verify the frames**

Open every file in `assets/idle/`, `assets/walk/`, `assets/stretch/` in an image viewer. Confirm:
- No frame is missing the character or cut off at an edge.
- No frame bleeds in a sliver of the neighboring pose.

If a frame is clipped or bleeds, adjust `ROW_HEIGHT`/`COL_WIDTH_4`/`COL_WIDTH_5` by ±10-20px and rerun Step 2 before continuing.

- [ ] **Step 4: Commit**

```bash
git add scripts/slice-sprites.mjs assets/
git commit -m "feat: slice reference art into individual sprite frames"
```

---

### Task 3: FSM (state machine) module

**Files:**
- Create: `src/renderer/fsm.ts`
- Test: `tests/fsm.test.ts`

**Interfaces:**
- Produces: `PetState` (`'idle'|'walk'|'alert'|'stretch'|'cooldown'`), `PetEvent`
  (`'wander_start'|'wander_pause'|'timer_elapsed'|'user_start_stretch'|'stretch_complete'|'stretch_skip'|'cooldown_elapsed'`),
  and `transition(state: PetState, event: PetEvent): PetState`. Task 10 (`renderer.ts`) calls
  `transition` directly.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/fsm.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/fsm.test.ts`
Expected: FAIL — `Cannot find module '../src/renderer/fsm'`

- [ ] **Step 3: Implement `fsm.ts`**

```ts
// src/renderer/fsm.ts
export type PetState = 'idle' | 'walk' | 'alert' | 'stretch' | 'cooldown';

export type PetEvent =
  | 'wander_start'
  | 'wander_pause'
  | 'timer_elapsed'
  | 'user_start_stretch'
  | 'stretch_complete'
  | 'stretch_skip'
  | 'cooldown_elapsed';

const TRANSITIONS: Record<PetState, Partial<Record<PetEvent, PetState>>> = {
  idle: { wander_start: 'walk', timer_elapsed: 'alert' },
  walk: { wander_pause: 'idle', timer_elapsed: 'alert' },
  alert: { user_start_stretch: 'stretch' },
  stretch: { stretch_complete: 'cooldown', stretch_skip: 'cooldown' },
  cooldown: { cooldown_elapsed: 'idle' },
};

export function transition(state: PetState, event: PetEvent): PetState {
  return TRANSITIONS[state][event] ?? state;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/fsm.test.ts`
Expected: PASS — 8 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/fsm.ts tests/fsm.test.ts
git commit -m "feat: add pet state machine"
```

---

### Task 4: Sprite animator module

**Files:**
- Create: `src/renderer/spriteAnimator.ts`
- Test: `tests/spriteAnimator.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `class SpriteAnimator { constructor(frames: string[], fps: number, onFrame: (src: string) => void); start(): void; stop(): void; }`. Task 10 instantiates one per animation (idle, walk).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/spriteAnimator.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/spriteAnimator.test.ts`
Expected: FAIL — `Cannot find module '../src/renderer/spriteAnimator'`

- [ ] **Step 3: Implement `spriteAnimator.ts`**

```ts
// src/renderer/spriteAnimator.ts
export class SpriteAnimator {
  private index = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly frames: string[],
    private readonly fps: number,
    private readonly onFrame: (src: string) => void,
  ) {
    if (frames.length === 0) {
      throw new Error('SpriteAnimator requires at least one frame');
    }
  }

  start(): void {
    this.stop();
    this.index = 0;
    this.onFrame(this.frames[this.index]);
    if (this.frames.length === 1) return;
    this.timer = setInterval(() => {
      this.index = (this.index + 1) % this.frames.length;
      this.onFrame(this.frames[this.index]);
    }, 1000 / this.fps);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/spriteAnimator.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/spriteAnimator.ts tests/spriteAnimator.test.ts
git commit -m "feat: add sprite frame animator"
```

---

### Task 5: Dialogue lines and picker

**Files:**
- Create: `src/renderer/dialogues.ts`
- Create: `src/renderer/dialoguePicker.ts`
- Test: `tests/dialoguePicker.test.ts`

**Interfaces:**
- Produces: `DialogueKey` union type and `pickDialogue(key: DialogueKey, random?: () => number): string`. Task 10 calls `pickDialogue` with keys `'alert_start'`, `'stretch_start'`, `'stretch_neck_tilt'`, `'stretch_shoulder_roll'`, `'stretch_torso_twist'`, `'stretch_hip_glute'`, `'stretch_leg_extension'`, `'stretch_spinal_twist'`, `'stretch_deep_breath'`, `'complete'`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/dialoguePicker.test.ts
import { describe, it, expect } from 'vitest';
import { pickDialogue } from '../src/renderer/dialoguePicker';

describe('pickDialogue', () => {
  it('returns the only line when there is exactly one', () => {
    expect(pickDialogue('complete')).toBe('수고했다. 다시 일해라.');
  });

  it('uses the injected random function to choose an index', () => {
    expect(pickDialogue('alert_start', () => 0)).toBe('알빠임? 그래도 척추는 펴라.');
    expect(pickDialogue('alert_start', () => 0.99)).toBe('거북목 상태로 일하면 퇴근도 늦어진다.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/dialoguePicker.test.ts`
Expected: FAIL — `Cannot find module '../src/renderer/dialoguePicker'`

- [ ] **Step 3: Implement `dialogues.ts`**

```ts
// src/renderer/dialogues.ts
export const DIALOGUES = {
  alert_start: [
    '알빠임? 그래도 척추는 펴라.',
    '거북목 상태로 일하면 퇴근도 늦어진다.',
  ],
  stretch_start: ['시작한다. 따라와.'],
  stretch_neck_tilt: ['목 옆으로 당겨, 10초만 버텨.'],
  stretch_shoulder_roll: ['어깨 돌려라. 굳은 거 다 보인다.'],
  stretch_torso_twist: ['허리 비틀어. 삐끗하지 말고.'],
  stretch_hip_glute: ['엉덩이 좀 풀어라. 하루 종일 눌러 앉았잖아.'],
  stretch_leg_extension: ['다리 쭉 뻗어. 시원하지.'],
  stretch_spinal_twist: ['척추도 돌려줘야지.'],
  stretch_deep_breath: ['숨 크게 들이쉬고, 후.'],
  complete: ['수고했다. 다시 일해라.'],
} as const;

export type DialogueKey = keyof typeof DIALOGUES;
```

- [ ] **Step 4: Implement `dialoguePicker.ts`**

```ts
// src/renderer/dialoguePicker.ts
import { DIALOGUES, DialogueKey } from './dialogues.js';

export function pickDialogue(key: DialogueKey, random: () => number = Math.random): string {
  const lines = DIALOGUES[key];
  const index = Math.floor(random() * lines.length);
  return lines[index];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/dialoguePicker.test.ts`
Expected: PASS — 2 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/dialogues.ts src/renderer/dialoguePicker.ts tests/dialoguePicker.test.ts
git commit -m "feat: add 미요-X dialogue lines and picker"
```

---

### Task 6: Timer scheduler (main process)

**Files:**
- Create: `src/main/timerScheduler.ts`
- Test: `tests/timerScheduler.test.ts`

**Interfaces:**
- Produces: `class TimerScheduler { schedule(ms: number, callback: () => void): void; cancel(): void; }` and `minutesToMs(minutes: number): number`. Task 8 (`main.ts`) uses both.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/timerScheduler.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/timerScheduler.test.ts`
Expected: FAIL — `Cannot find module '../src/main/timerScheduler'`

- [ ] **Step 3: Implement `timerScheduler.ts`**

```ts
// src/main/timerScheduler.ts
export class TimerScheduler {
  private timeoutId: NodeJS.Timeout | null = null;

  schedule(ms: number, callback: () => void): void {
    this.cancel();
    this.timeoutId = setTimeout(callback, ms);
  }

  cancel(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}

export function minutesToMs(minutes: number): number {
  return minutes * 60_000;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/timerScheduler.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/timerScheduler.ts tests/timerScheduler.test.ts
git commit -m "feat: add timer scheduler for focus/stretch cycle"
```

---

### Task 7: Settings persistence

**Files:**
- Create: `src/main/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces: `interface PetSettings { focusMinutes: number; stretchMinutes: number; soundEnabled: boolean; autoStart: boolean; }`, `DEFAULT_SETTINGS`, `clampSettings(partial: Partial<PetSettings>): PetSettings`, `getSettings(): PetSettings`, `setSettings(partial: Partial<PetSettings>): PetSettings`. Tasks 8 and 9 call `getSettings`/`setSettings`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/settings.test.ts
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
    });
  });
});
```

Note: this test only imports `clampSettings`/`DEFAULT_SETTINGS`, which must not trigger `electron-store`
construction at import time (see Step 3) — `electron-store` requires a real Electron runtime and would
crash under plain-Node Vitest otherwise.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — `Cannot find module '../src/main/settings'`

- [ ] **Step 3: Implement `settings.ts`**

```ts
// src/main/settings.ts
import Store from 'electron-store';

export interface PetSettings {
  focusMinutes: number;
  stretchMinutes: number;
  soundEnabled: boolean;
  autoStart: boolean;
}

export const DEFAULT_SETTINGS: PetSettings = {
  focusMinutes: 50,
  stretchMinutes: 5,
  soundEnabled: false,
  autoStart: false,
};

export function clampSettings(settings: Partial<PetSettings>): PetSettings {
  return {
    focusMinutes:
      settings.focusMinutes && settings.focusMinutes > 0
        ? settings.focusMinutes
        : DEFAULT_SETTINGS.focusMinutes,
    stretchMinutes:
      settings.stretchMinutes && settings.stretchMinutes > 0
        ? settings.stretchMinutes
        : DEFAULT_SETTINGS.stretchMinutes,
    soundEnabled: settings.soundEnabled ?? DEFAULT_SETTINGS.soundEnabled,
    autoStart: settings.autoStart ?? DEFAULT_SETTINGS.autoStart,
  };
}

// Lazy: electron-store needs a real Electron runtime, so it must not be
// constructed at module-import time (that would break plain-Node unit tests).
let store: Store<PetSettings> | null = null;
function getStore(): Store<PetSettings> {
  if (!store) {
    store = new Store<PetSettings>({ defaults: DEFAULT_SETTINGS });
  }
  return store;
}

export function getSettings(): PetSettings {
  return clampSettings(getStore().store);
}

export function setSettings(partial: Partial<PetSettings>): PetSettings {
  const merged = clampSettings({ ...getStore().store, ...partial });
  getStore().set(merged);
  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Run the full test suite so far**

Run: `npm test`
Expected: PASS — all tests from Tasks 3-7 pass (21 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/settings.ts tests/settings.test.ts
git commit -m "feat: add settings persistence with validation"
```

---

### Task 8: Preload IPC bridge and renderer type declarations

**Files:**
- Create: `src/main/preload.ts`
- Create: `src/types/global.d.ts`

**Interfaces:**
- Produces: `window.petAPI` with `setIgnoreMouseEvents(ignore: boolean): void`, `onTimerElapsed(cb: () => void): void`, `onCooldownElapsed(cb: () => void): void`, `notifyStretchComplete(): void`, `notifyStretchSkip(): void`, `getSettings(): Promise<PetSettings>`. Task 9 (`main.ts`) implements the other end of the IPC channels this defines. Task 10 (`renderer.ts`) calls `window.petAPI.*`.

- [ ] **Step 1: Implement `preload.ts`**

```ts
// src/main/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('petAPI', {
  setIgnoreMouseEvents: (ignore: boolean): void => {
    ipcRenderer.send('set-ignore-mouse-events', ignore);
  },
  onTimerElapsed: (callback: () => void): void => {
    ipcRenderer.on('timer-elapsed', () => callback());
  },
  onCooldownElapsed: (callback: () => void): void => {
    ipcRenderer.on('cooldown-elapsed', () => callback());
  },
  notifyStretchComplete: (): void => {
    ipcRenderer.send('stretch-complete');
  },
  notifyStretchSkip: (): void => {
    ipcRenderer.send('stretch-skip');
  },
  getSettings: (): Promise<unknown> => ipcRenderer.invoke('get-settings'),
});
```

- [ ] **Step 2: Implement `global.d.ts`**

```ts
// src/types/global.d.ts
export interface PetSettings {
  focusMinutes: number;
  stretchMinutes: number;
  soundEnabled: boolean;
  autoStart: boolean;
}

declare global {
  interface Window {
    petAPI: {
      setIgnoreMouseEvents(ignore: boolean): void;
      onTimerElapsed(callback: () => void): void;
      onCooldownElapsed(callback: () => void): void;
      notifyStretchComplete(): void;
      notifyStretchSkip(): void;
      getSettings(): Promise<PetSettings>;
    };
  }
}
```

- [ ] **Step 3: Type-check the main-process config**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/preload.ts src/types/global.d.ts
git commit -m "feat: add preload IPC bridge and renderer type declarations"
```

---

### Task 9: Main process — window, click-through, timers, tray

**Files:**
- Create: `src/main/main.ts`
- Create: `src/main/tray.ts`

**Interfaces:**
- Consumes: `TimerScheduler`, `minutesToMs` (Task 6), `getSettings`, `setSettings` (Task 7).
- Produces: the running Electron main process — IPC channels `set-ignore-mouse-events` (renderer→main), `stretch-complete`/`stretch-skip` (renderer→main), `get-settings` (renderer→main, invoke/handle), `timer-elapsed`/`cooldown-elapsed` (main→renderer, `webContents.send`). Task 10 depends on all of these channel names matching exactly.

- [ ] **Step 1: Implement `tray.ts`**

```ts
// src/main/tray.ts
import { Tray, Menu, app, nativeImage } from 'electron';
import * as path from 'path';
import { getSettings, setSettings } from './settings';

interface TrayCallbacks {
  onQuit: () => void;
}

let tray: Tray | null = null;

export function createTray(callbacks: TrayCallbacks): Tray {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '..', '..', 'assets', 'idle', '1.png'),
  );
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('스트레칭펫');
  rebuildMenu(callbacks);
  return tray;
}

function rebuildMenu(callbacks: TrayCallbacks): void {
  if (!tray) return;
  const settings = getSettings();

  const menu = Menu.buildFromTemplate([
    {
      label: `현재: 집중 ${settings.focusMinutes}분 / 스트레칭 ${settings.stretchMinutes}분`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '50분 집중 / 5분 스트레칭',
      type: 'radio',
      checked: settings.focusMinutes === 50 && settings.stretchMinutes === 5,
      click: () => {
        setSettings({ focusMinutes: 50, stretchMinutes: 5 });
        rebuildMenu(callbacks);
      },
    },
    {
      label: '25분 집중 / 5분 스트레칭',
      type: 'radio',
      checked: settings.focusMinutes === 25 && settings.stretchMinutes === 5,
      click: () => {
        setSettings({ focusMinutes: 25, stretchMinutes: 5 });
        rebuildMenu(callbacks);
      },
    },
    { type: 'separator' },
    {
      label: '소리',
      type: 'checkbox',
      checked: settings.soundEnabled,
      click: (menuItem) => {
        setSettings({ soundEnabled: menuItem.checked });
      },
    },
    {
      label: '시작 프로그램에 등록',
      type: 'checkbox',
      checked: settings.autoStart,
      click: (menuItem) => {
        setSettings({ autoStart: menuItem.checked });
        app.setLoginItemSettings({ openAtLogin: menuItem.checked });
      },
    },
    { type: 'separator' },
    { label: '종료', click: callbacks.onQuit },
  ]);

  tray.setContextMenu(menu);
}
```

- [ ] **Step 2: Implement `main.ts`**

```ts
// src/main/main.ts
import { app, BrowserWindow, screen, ipcMain } from 'electron';
import * as path from 'path';
import { TimerScheduler, minutesToMs } from './timerScheduler';
import { getSettings } from './settings';
import { createTray } from './tray';

const COOLDOWN_MINUTES = 2;

let mainWindow: BrowserWindow | null = null;
const focusTimer = new TimerScheduler();
const cooldownTimer = new TimerScheduler();

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'));
}

function scheduleFocusTimer(): void {
  const { focusMinutes } = getSettings();
  focusTimer.schedule(minutesToMs(focusMinutes), () => {
    mainWindow?.webContents.send('timer-elapsed');
  });
}

function scheduleCooldownTimer(): void {
  cooldownTimer.schedule(minutesToMs(COOLDOWN_MINUTES), () => {
    mainWindow?.webContents.send('cooldown-elapsed');
    scheduleFocusTimer();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray({ onQuit: () => app.quit() });
  scheduleFocusTimer();
});

ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
  mainWindow?.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('stretch-complete', () => {
  scheduleCooldownTimer();
});

ipcMain.on('stretch-skip', () => {
  scheduleCooldownTimer();
});

ipcMain.handle('get-settings', () => getSettings());

app.on('window-all-closed', () => {
  // no-op: keep running in the tray even if the overlay window closes
});
```

- [ ] **Step 3: Type-check the main-process config**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: exits 0, no errors.

(Runtime verification of the window/tray/timers happens in Task 10 Step 6, once `index.html` exists to load.)

- [ ] **Step 4: Commit**

```bash
git add src/main/main.ts src/main/tray.ts
git commit -m "feat: add main process window, click-through, timers, and tray"
```

---

### Task 10: Renderer — character, animation wiring, stretch UI, end-to-end verification

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/style.css`
- Create: `src/renderer/renderer.ts`

**Interfaces:**
- Consumes: `transition` (Task 3), `SpriteAnimator` (Task 4), `pickDialogue` (Task 5), `window.petAPI` (Task 8), IPC channel names and sprite asset paths (Tasks 2, 9).
- Produces: the running UI — nothing else depends on this task, it is the final integration point.

- [ ] **Step 1: Implement `index.html`**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <title>StretchPet</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="speech-bubble" class="hidden"></div>
  <img id="pet" src="" alt="stretch pet" />
  <div id="stretch-panel" class="hidden">
    <div id="stretch-name"></div>
    <div id="stretch-countdown"></div>
    <button id="stretch-skip">다음에 하기</button>
  </div>
  <script type="module" src="../../dist/renderer/renderer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Implement `style.css`**

```css
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  overflow: hidden;
  user-select: none;
}

#pet {
  position: absolute;
  width: 96px;
  height: 96px;
  bottom: 40px;
  left: 100px;
  cursor: pointer;
}

#pet.facing-left {
  transform: scaleX(-1);
}

#speech-bubble {
  position: absolute;
  bottom: 140px;
  left: 60px;
  max-width: 220px;
  padding: 10px 14px;
  background: white;
  border: 2px solid #333;
  border-radius: 12px;
  font-family: sans-serif;
  font-size: 14px;
}

#speech-bubble.hidden {
  display: none;
}

#stretch-panel {
  position: absolute;
  bottom: 160px;
  left: 40px;
  padding: 12px;
  background: rgba(20, 20, 20, 0.85);
  color: white;
  border-radius: 12px;
  font-family: sans-serif;
  text-align: center;
}

#stretch-panel.hidden {
  display: none;
}

#stretch-name {
  font-size: 16px;
  font-weight: bold;
  margin-bottom: 4px;
}

#stretch-countdown {
  font-size: 24px;
  margin-bottom: 8px;
}

#stretch-skip {
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
```

- [ ] **Step 3: Implement `renderer.ts`**

```ts
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
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exits 0, produces `dist/main/*.js` and `dist/renderer/*.js`.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all 21 tests from Tasks 3-7 still pass.

- [ ] **Step 6: Manual end-to-end verification**

1. Temporarily edit `DEFAULT_SETTINGS.focusMinutes` in `src/main/settings.ts` to `0.05` (3 seconds) so the alert fires quickly. Remember to revert this after testing.
2. Run: `npm start`
3. Confirm: a transparent, borderless, always-on-top window covers the screen; the pet is visible near the bottom-left, idle animation blinking between its 2 frames.
4. Move the mouse over other applications' windows — clicks pass through to them (click-through works).
5. Hover the pet — cursor becomes clickable; move the mouse away from the pet while it's idle/walking — click-through re-enables.
6. Wait ~3 seconds — the pet stops, moves toward screen center, and a speech bubble with an alert line appears.
7. Click the pet — the 8-step stretch panel appears, cycling through all 8 named steps with per-step countdowns and dialogue.
8. Click "다음에 하기" mid-sequence on one run to confirm skip works; let another full run finish naturally to confirm the "complete" line and cooldown occur.
9. After the fixed 2-minute cooldown, confirm the pet returns to idle/walk and the alert cycle can fire again.
10. Right-click the tray icon — confirm the interval, sound, autostart, and quit menu items are present and the "종료" item closes the app.
11. Revert the temporary `focusMinutes` edit from Step 1 in `src/main/settings.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/index.html src/renderer/style.css src/renderer/renderer.ts
git commit -m "feat: wire renderer character, animation, and stretch sequence UI"
```

---

## Self-Review Notes

- **Spec coverage:** transparent full-screen overlay + click-through (Task 9 Step 2, Task 10 Step 3)
  · FSM idle/walk/alert/stretch/cooldown (Task 3, Task 10) · 8 named chair-stretch steps with
  10-15s countdowns (Task 10) · 미요-X dialogue verbatim (Task 5) · tray interval/sound/autostart/quit
  (Task 9 Step 1) · individual-PNG sprite slicing (Task 2) — all covered.
- **Placeholder scan:** no TBD/TODO markers; every step has complete code and exact commands.
- **Type consistency:** `PetState`/`PetEvent` (Task 3) match usage in `renderer.ts` (Task 10);
  `PetSettings` shape is identical across `settings.ts` (Task 7) and `global.d.ts` (Task 8); IPC
  channel names (`set-ignore-mouse-events`, `stretch-complete`, `stretch-skip`, `get-settings`,
  `timer-elapsed`, `cooldown-elapsed`) match exactly between `preload.ts` (Task 8), `main.ts`
  (Task 9), and `renderer.ts` (Task 10); sprite file names from Task 2 match the paths built in
  Task 10.
