// Draws assets/icon.png: the app's orange-pink gradient with a white envelope. Run: node scripts/make-icon.cjs
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const N = 1024, SS = 3;
const C0 = [255, 143, 63], C1 = [222, 50, 90]; // top-left -> bottom-right, same as the previous icon
const bg = (x, y) => { const t = Math.min(1, Math.max(0, (x + y) / (2 * (N - 1)))); return C0.map((c, i) => c + (C1[i] - c) * t); };

// envelope body: rounded rectangle
const BX0 = 176, BY0 = 288, BX1 = 848, BY1 = 736, R = 64;
const inBody = (x, y) => {
  if (x < BX0 || x > BX1 || y < BY0 || y > BY1) return false;
  const cx = x < BX0 + R ? BX0 + R : x > BX1 - R ? BX1 - R : x;
  const cy = y < BY0 + R ? BY0 + R : y > BY1 - R ? BY1 - R : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
};
const dSeg = (x, y, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)); };
// flap: a V from the top corners down to the middle, drawn in the background colour (a cut-out line)
const FLAP = 20; // half stroke width
const inFlap = (x, y) => dSeg(x, y, BX0 + 40, BY0 + 52, 512, 548, ) <= FLAP || dSeg(x, y, BX1 - 40, BY0 + 52, 512, 548) <= FLAP;
// lower folds: two short diagonals from the bottom corners
const inFold = (x, y) => dSeg(x, y, BX0 + 40, BY1 - 44, 380, 500) <= 14 || dSeg(x, y, BX1 - 40, BY1 - 44, 644, 500) <= 14;

const png = new PNG({ width: N, height: N });
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  let r = 0, g = 0, b = 0;
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
    const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
    const base = bg(px, py);
    const white = inBody(px, py) && !inFlap(px, py) && !inFold(px, py);
    const c = white ? [255, 255, 255] : base;
    r += c[0]; g += c[1]; b += c[2];
  }
  const i = (y * N + x) * 4, k = SS * SS;
  png.data[i] = Math.round(r / k); png.data[i + 1] = Math.round(g / k); png.data[i + 2] = Math.round(b / k); png.data[i + 3] = 255;
}
const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(out, PNG.sync.write(png));
console.log('wrote', out);
