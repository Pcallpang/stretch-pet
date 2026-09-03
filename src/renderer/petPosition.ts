export interface Position {
  x: number;
  y: number;
}

export function clampPosition(x: number, y: number, maxX: number, maxY: number): Position {
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  };
}

interface WalkStepInput {
  x: number;
  facingLeft: boolean;
  maxX: number;
  speed: number;
}

interface WalkStepResult {
  x: number;
  facingLeft: boolean;
}

export function computeWalkStep({ x, facingLeft, maxX, speed }: WalkStepInput): WalkStepResult {
  let nextX = x + (facingLeft ? -speed : speed);
  let nextFacingLeft = facingLeft;
  if (nextX <= 0) {
    nextX = 0;
    nextFacingLeft = false;
  }
  if (nextX >= maxX) {
    nextX = maxX;
    nextFacingLeft = true;
  }
  return { x: nextX, facingLeft: nextFacingLeft };
}

// A few pixels of slop before pointer movement counts as a real drag, so a
// plain click isn't accidentally swallowed by tiny, unintentional movement.
export function exceedsDragThreshold(dx: number, dy: number, threshold: number): boolean {
  return Math.abs(dx) > threshold || Math.abs(dy) > threshold;
}

interface DragPositionInput {
  dragStartX: number;
  dragStartY: number;
  dx: number;
  dy: number;
}

export function computeDragPosition({ dragStartX, dragStartY, dx, dy }: DragPositionInput): Position {
  return { x: dragStartX + dx, y: dragStartY + dy };
}

interface OverlayPositionInput {
  petX: number;
  petY: number;
  petSize: number;
  gap: number;
  xOffset: number;
  elWidth: number;
  elHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface OverlayPositionResult {
  left: number;
  top: number;
}

// Positions an overlay element (speech bubble / stretch panel / settings
// panel) above the pet's current position. Falls back to below the pet if
// there isn't room above (e.g. pet dragged near the top edge), and clamps
// both axes so the overlay never runs off-screen.
export function computeOverlayPosition({
  petX,
  petY,
  petSize,
  gap,
  xOffset,
  elWidth,
  elHeight,
  viewportWidth,
  viewportHeight,
}: OverlayPositionInput): OverlayPositionResult {
  const maxLeft = Math.max(0, viewportWidth - elWidth);
  const left = Math.max(0, Math.min(petX - xOffset, maxLeft));

  const above = petY - elHeight - gap;
  const top = above >= 0 ? above : petY + petSize + gap;
  const maxTop = Math.max(0, viewportHeight - elHeight);

  return { left, top: Math.max(0, Math.min(top, maxTop)) };
}
