// scripts/slice-sprites.mjs
import Jimp from 'jimp';
import path from 'node:path';
import fs from 'node:fs';

const SOURCE = path.resolve('미요X 데스크톱펫.png');
const OUT_DIR = path.resolve('assets');

// NOTE on deviations from the plan's original coarse-grid script:
//
// 1) The source sheet has NO real alpha transparency (every pixel is alpha=255) —
//    the "transparent" checkerboard look is baked directly into the pixels as two
//    grayscale shades (~148 and ~201). Jimp's autocrop relies on alpha/border-color
//    detection, so without first converting that checkerboard to real transparency,
//    autocrop cannot tighten crops and the output PNGs would not actually be
//    transparent (breaking the stated goal: "individual transparent PNG frames",
//    and Task 10's renderer which composites these directly onto the desktop).
//    `removeCheckerboard()` below chroma-keys those two shades to alpha=0 before
//    cropping.
//
// 2) The plan's uniform ROW_HEIGHT=528 (2112/4) puts the row2/row3 boundary at
//    y=1584, but pixel inspection showed row 2's chair/shadow content actually
//    extends to y≈1614 before a true transparent gap (1614-1644) separates it from
//    row 3's label text. A boundary at 1584 therefore clipped the bottoms of the
//    row-2 chair stretch poses AND fed a sliver of that clipped content into every
//    row-3 frame. ROW_BOUNDS below moves that one boundary into the real gap
//    (y=1628); the other row boundaries (528, 1056) already fell inside real gaps
//    and needed no change.
//
// 3) Every cell also has caption text baked in above the character (row-0/row-1
//    column 0 carry section titles "IDLE"/"WALK"; every stretch column carries its
//    own pose name, and column 0 additionally carries the wide "CHAIR STRETCH"
//    title, which is wide enough to spill a sliver of its own letters into column
//    1's cell). Per-column LABEL_SKIP values (measured from the pixel data) crop
//    the top of each cell past its caption(s) before autocropping, so the sprite
//    frames show only the character, not floating text.
const ROW_BOUNDS = [0, 528, 1056, 1628, 2112];
const COL_WIDTH_4 = 496; // 1984 / 4 columns
const COL_WIDTH_5 = Math.floor(1984 / 5);

// How far down (from each row's top) to start cropping, per column, to skip past
// caption text. Row 0/1 only carry a caption in column 0; row 2/3 carry one in
// every column (row 2's column 1 also catches a sliver of row 2 column 0's wide
// "CHAIR STRETCH" title, hence the larger skip there).
const LABEL_SKIP = {
  0: [100, 100],
  1: [105, 80, 80, 80, 80],
  2: [190, 195, 140, 140],
  3: [55, 55, 55, 55],
};

const CHECKER_GRAY_MIN = 130;
const CHECKER_GRAY_MAX = 220;
const CHECKER_CHANNEL_TOLERANCE = 6;

// Second, looser threshold used ONLY to decide whether the flood-fill may
// *traverse through* a pixel — it never by itself causes a pixel to be cleared.
// The purple "aura" glow around each character is a gradient that blends from
// checkerboard gray into purple; a lot of that gradient's midtones fall outside
// isCheckerGray's tight tolerance (they're gray-ish but not gray enough, or have
// a slight purple tint), which made that gradient ring an impassable wall for a
// single-threshold BFS: any background patch beyond the ring (farther from the
// character than the aura) is genuinely connected to the border in the source
// image, but the walk could never reach it once it hit the ring, so it was left
// fully opaque as a visible gray rectangle in every output frame.
//
// This is the "hysteresis" trick from Canny edge detection's double threshold:
// use a wide, permissive test to decide connectivity/traversal, but a narrow,
// strict test to decide what actually gets an alpha of 0. That lets the search
// walk *across* the thin aura gradient (which passes the loose test even where
// it fails the strict one) to reach real background on the far side, while still
// only ever clearing pixels that are unambiguously checkerboard gray — character
// interior pixels (which are neither near-gray nor low-saturation) still can't
// be reached or cleared.
const CHECKER_LOOSE_GRAY_MIN = 90;
const CHECKER_LOOSE_GRAY_MAX = 235;
const CHECKER_LOOSE_MAX_SATURATION = 40; // max channel spread (max-min) to count as "near-gray"

// The reference sheet has no real alpha channel — the checkerboard "transparency"
// preview is baked in as flat grayscale pixels. Chroma-key those out to real alpha
// so autocrop (and the final sprites) are actually transparent.
//
// This is a flood-fill (connected-component) chroma key, not a global color-band
// threshold: it only clears alpha for gray-band pixels that are reachable, via a
// 4-connected walk through other gray-band pixels, from a seed point on the image's
// outer border (which is guaranteed to be checkerboard background — the character
// never touches the sheet edge). A gray-ish pixel that happens to sit inside the
// character's silhouette (e.g. a shadow tone that falls in the same band as the
// background) is never touched unless it is actually connected to the background
// region, and a background fleck just outside the band is still reached and cleared
// as long as it is enclosed by connected in-band neighbors on its way from an edge
// seed. This avoids the false-positive/false-negative edge speckle a purely global
// threshold produces at antialiased aura edges.
function isCheckerGray(data, idx) {
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  const isGray =
    Math.abs(r - g) < CHECKER_CHANNEL_TOLERANCE &&
    Math.abs(g - b) < CHECKER_CHANNEL_TOLERANCE &&
    Math.abs(r - b) < CHECKER_CHANNEL_TOLERANCE;
  return isGray && r >= CHECKER_GRAY_MIN && r <= CHECKER_GRAY_MAX;
}

// Loose "may traverse" test — see comment above CHECKER_LOOSE_* constants.
// Deliberately does not require the pixel to actually be cleared; it only has to
// look plausibly like part of the gray->purple aura gradient or dim background,
// so the BFS can step across the aura ring without ever marking those pixels
// themselves as background.
function isCheckerGrayLoose(data, idx) {
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max - min;
  return (
    saturation <= CHECKER_LOOSE_MAX_SATURATION &&
    max >= CHECKER_LOOSE_GRAY_MIN &&
    max <= CHECKER_LOOSE_GRAY_MAX
  );
}

function removeCheckerboard(image) {
  const { width, height, data } = image.bitmap;
  const visited = new Uint8Array(width * height);
  // Queue of pixel indices (x + y*width) to visit. Typed array used as a ring-free
  // growable stack (BFS order doesn't matter for correctness here).
  const queue = new Int32Array(width * height);
  let queueLen = 0;

  const trySeed = (x, y) => {
    const px = y * width + x;
    if (visited[px]) return;
    const idx = px * 4;
    // Traversal uses the loose test so the walk can cross the aura's gradient
    // ring; only pixels that also pass the strict test get their alpha cleared
    // (see removeCheckerboard's main loop below).
    if (isCheckerGrayLoose(data, idx)) {
      visited[px] = 1;
      queue[queueLen++] = px;
    }
  };

  // Seed from every pixel on the four outer edges — guaranteed background, since
  // the character/aura art never touches the sheet's border.
  for (let x = 0; x < width; x++) {
    trySeed(x, 0);
    trySeed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    trySeed(0, y);
    trySeed(width - 1, y);
  }

  let head = 0;
  while (head < queueLen) {
    const px = queue[head++];
    const x = px % width;
    const y = (px / width) | 0;
    const idx = px * 4;
    // Only clear alpha for pixels that pass the STRICT test — the loose test
    // only earned this pixel a place in the walk, not automatic clearing. This
    // guarantees the aura gradient itself (which is often loose-only) stays
    // opaque, and genuine character-interior pixels are never cleared even if a
    // traversal path happened to reach adjacent to them.
    if (isCheckerGray(data, idx)) {
      data[idx + 3] = 0;
    }

    // 4-connected neighbors
    if (x > 0) trySeed(x - 1, y);
    if (x < width - 1) trySeed(x + 1, y);
    if (y > 0) trySeed(x, y - 1);
    if (y < height - 1) trySeed(x, y + 1);
  }

  return image;
}

async function sliceRow(image, rowIndex, colCount, names, outSubdir) {
  const colWidth = colCount === 5 ? COL_WIDTH_5 : COL_WIDTH_4;
  const rowTop = ROW_BOUNDS[rowIndex];
  const rowHeight = ROW_BOUNDS[rowIndex + 1] - rowTop;
  fs.mkdirSync(path.join(OUT_DIR, outSubdir), { recursive: true });

  for (let i = 0; i < names.length; i++) {
    const x = i * colWidth;
    const skip = LABEL_SKIP[rowIndex][i];
    const y = rowTop + skip;
    const height = rowHeight - skip;
    const cell = image.clone().crop(x, y, colWidth, height);
    cell.autocrop({ cropOnlyFrames: false, tolerance: 0.02 });
    const outPath = path.join(OUT_DIR, outSubdir, `${names[i]}.png`);
    await cell.writeAsync(outPath);
    console.log('wrote', outPath);
  }
}

async function main() {
  const image = await Jimp.read(SOURCE);
  removeCheckerboard(image);
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
