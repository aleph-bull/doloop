// Cuts the phone out of the owner's mockup photo (2026-10-29) for public/phone-frame.webp: the
// grey backdrop and the white screen become transparent (soft edges, colours unmixed from what
// was behind them), and the shadow is cropped off. Prints where the screen sits inside the
// frame, which the .device rules in styles.css use.
// Run: node scripts/cut-phone.mjs <mockup.jpg> design/phone-frame.png public/phone-frame.webp
import { createRequire } from 'node:module';
const sharp = createRequire(new URL('../../../package.json', import.meta.url))('sharp');
const [src, outPng, outWebp] = process.argv.slice(2);
const CROP = { left: 570, top: 130, width: 871, height: 1737 };
const { data, info } = await sharp(src).extract(CROP).raw().toBuffer({ resolveWithObject: true });
const W = info.width,
  H = info.height;
const BG = [239, 238, 236],
  WHITE = [255, 255, 255],
  RIM = [91, 73, 89],
  BEZEL = [29, 29, 27];
const at = (x, y) => (y * W + x) * 3;
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const px = (x, y) => {
  const i = at(x, y);
  return [data[i], data[i + 1], data[i + 2]];
};
const region = new Uint8Array(W * H); // 0 phone, 1 outside, 2 screen
const flood = (seeds, ref, mark) => {
  const stack = [...seeds];
  while (stack.length) {
    const k = stack.pop();
    if (region[k]) continue;
    const x = k % W,
      y = (k / W) | 0;
    if (dist(px(x, y), ref) > 30) continue;
    region[k] = mark;
    if (x > 0) stack.push(k - 1);
    if (x < W - 1) stack.push(k + 1);
    if (y > 0) stack.push(k - W);
    if (y < H - 1) stack.push(k + W);
  }
};
const border = [];
for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
flood(border, BG, 1);
flood([((H / 2) | 0) * W + ((W / 2) | 0)], WHITE, 2);
const out = Buffer.alloc(W * H * 4);
let sx0 = W,
  sy0 = H,
  sx1 = 0,
  sy1 = 0;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const k = y * W + x,
      o = k * 4,
      p = px(x, y);
    if (region[k] === 2) {
      if (x < sx0) sx0 = x;
      if (x > sx1) sx1 = x;
      if (y < sy0) sy0 = y;
      if (y > sy1) sy1 = y;
    }
    if (region[k]) {
      out[o + 3] = 0;
      continue;
    }
    // Near a cut-out region: partly see-through, by how far the colour is from what was behind.
    let near = 0;
    for (let dy = -2; dy <= 2 && !near; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx,
          yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const r = region[yy * W + xx];
        if (r) {
          near = r;
          break;
        }
      }
    let a = 1,
      c = p;
    if (near) {
      const B = near === 1 ? BG : WHITE,
        F = near === 1 ? RIM : BEZEL;
      a = Math.min(1, dist(p, B) / dist(F, B));
      if (a < 1 && a > 0.02)
        c = p.map((v, i) => Math.max(0, Math.min(255, Math.round((v - (1 - a) * B[i]) / a))));
    }
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = Math.round(a * 255);
  }
const img = sharp(out, { raw: { width: W, height: H, channels: 4 } });
await img.clone().png().toFile(outPng);
await img
  .clone()
  .resize({ width: 640 })
  .webp({ quality: 90, alphaQuality: 100, effort: 6 })
  .toFile(outWebp);
console.log(
  JSON.stringify({
    frame: { w: W, h: H },
    screen: { x: sx0, y: sy0, w: sx1 - sx0 + 1, h: sy1 - sy0 + 1 },
  }),
);
