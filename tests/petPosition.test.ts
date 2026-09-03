import { describe, it, expect } from 'vitest';
import {
  clampPosition,
  computeWalkStep,
  exceedsDragThreshold,
  computeDragPosition,
  computeOverlayPosition,
} from '../src/renderer/petPosition';

describe('clampPosition', () => {
  it('keeps a position already inside bounds', () => {
    expect(clampPosition(50, 50, 200, 200)).toEqual({ x: 50, y: 50 });
  });

  it('clamps negative coordinates to 0', () => {
    expect(clampPosition(-10, -5, 200, 200)).toEqual({ x: 0, y: 0 });
  });

  it('clamps coordinates past the max', () => {
    expect(clampPosition(300, 300, 200, 150)).toEqual({ x: 200, y: 150 });
  });
});

describe('computeWalkStep', () => {
  it('moves right by speed when not facing left', () => {
    expect(computeWalkStep({ x: 10, facingLeft: false, maxX: 100, speed: 2 })).toEqual({
      x: 12,
      facingLeft: false,
    });
  });

  it('moves left by speed when facing left', () => {
    expect(computeWalkStep({ x: 10, facingLeft: true, maxX: 100, speed: 2 })).toEqual({
      x: 8,
      facingLeft: true,
    });
  });

  it('bounces off the right edge', () => {
    expect(computeWalkStep({ x: 99, facingLeft: false, maxX: 100, speed: 2 })).toEqual({
      x: 100,
      facingLeft: true,
    });
  });

  it('bounces off the left edge', () => {
    expect(computeWalkStep({ x: 1, facingLeft: true, maxX: 100, speed: 2 })).toEqual({
      x: 0,
      facingLeft: false,
    });
  });
});

describe('exceedsDragThreshold', () => {
  it('is false for tiny movement', () => {
    expect(exceedsDragThreshold(1, -2, 3)).toBe(false);
  });

  it('is true once either axis exceeds the threshold', () => {
    expect(exceedsDragThreshold(4, 0, 3)).toBe(true);
    expect(exceedsDragThreshold(0, -4, 3)).toBe(true);
  });
});

describe('computeDragPosition', () => {
  it('offsets the drag-start position by the pointer delta', () => {
    expect(
      computeDragPosition({ dragStartX: 100, dragStartY: 50, dx: 15, dy: -5 }),
    ).toEqual({ x: 115, y: 45 });
  });
});

describe('computeOverlayPosition', () => {
  it('places the overlay above the pet when there is room', () => {
    expect(
      computeOverlayPosition({
        petX: 100,
        petY: 200,
        petSize: 96,
        gap: 12,
        xOffset: -20,
        elWidth: 220,
        elHeight: 60,
        viewportWidth: 1920,
        viewportHeight: 1080,
      }),
    ).toEqual({ left: 120, top: 128 });
  });

  it('falls back to below the pet when there is no room above', () => {
    expect(
      computeOverlayPosition({
        petX: 100,
        petY: 0,
        petSize: 96,
        gap: 12,
        xOffset: -20,
        elWidth: 220,
        elHeight: 60,
        viewportWidth: 1920,
        viewportHeight: 1080,
      }),
    ).toEqual({ left: 120, top: 108 });
  });

  it('clamps both axes so the overlay never runs off-screen', () => {
    expect(
      computeOverlayPosition({
        petX: 10,
        petY: 10,
        petSize: 96,
        gap: 12,
        xOffset: -20,
        elWidth: 220,
        elHeight: 60,
        viewportWidth: 200,
        viewportHeight: 50,
      }),
    ).toEqual({ left: 0, top: 0 });
  });
});
