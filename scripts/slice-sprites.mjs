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

// The reference sheet has no real alpha channel — the checkerboard "transparency"
// preview is baked in as flat grayscale pixels. Chroma-key those out to real alpha
// so autocrop (and the final sprites) are actually transparent.
function removeCheckerboard(image) {
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
    const r = image.bitmap.data[idx];
    const g = image.bitmap.data[idx + 1];
    const b = image.bitmap.data[idx + 2];
    const isGray =
      Math.abs(r - g) < CHECKER_CHANNEL_TOLERANCE &&
      Math.abs(g - b) < CHECKER_CHANNEL_TOLERANCE &&
      Math.abs(r - b) < CHECKER_CHANNEL_TOLERANCE;
    if (isGray && r >= CHECKER_GRAY_MIN && r <= CHECKER_GRAY_MAX) {
      image.bitmap.data[idx + 3] = 0;
    }
  });
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
