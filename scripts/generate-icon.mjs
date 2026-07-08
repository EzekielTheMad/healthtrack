// Generates the app icons (public/icon.png 256px, icon-192.png, icon-512.png)
// procedurally — no image tooling required, only node:zlib.
//
//   node scripts/generate-icon.mjs
//
// Motif: teal rounded square, white heart, pulse line across it.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// ---------- PNG encoding (RGBA, 8-bit) ----------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- geometry (all in unit coordinates, y down) ----------

// Heart = two circles + triangle.
const HEART = {
  c1: { x: 0.355, y: 0.395, r: 0.155 },
  c2: { x: 0.645, y: 0.395, r: 0.155 },
  tri: [
    { x: 0.208, y: 0.452 },
    { x: 0.792, y: 0.452 },
    { x: 0.5, y: 0.795 },
  ],
};

function inCircle(p, c) {
  const dx = p.x - c.x, dy = p.y - c.y;
  return dx * dx + dy * dy <= c.r * c.r;
}

function inTriangle(p, [a, b, c]) {
  const s = (p1, p2) => (p.x - p2.x) * (p1.y - p2.y) - (p1.x - p2.x) * (p.y - p2.y);
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function inHeart(p) {
  return inCircle(p, HEART.c1) || inCircle(p, HEART.c2) || inTriangle(p, HEART.tri);
}

// Pulse polyline across the icon.
const PULSE = [
  { x: 0.1, y: 0.555 },
  { x: 0.36, y: 0.555 },
  { x: 0.435, y: 0.42 },
  { x: 0.53, y: 0.675 },
  { x: 0.60, y: 0.555 },
  { x: 0.9, y: 0.555 },
];
const PULSE_HALF_WIDTH = 0.022;

function distToSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = p.x - (a.x + t * abx), dy = p.y - (a.y + t * aby);
  return Math.hypot(dx, dy);
}

function onPulse(p) {
  for (let i = 0; i < PULSE.length - 1; i++) {
    if (distToSegment(p, PULSE[i], PULSE[i + 1]) <= PULSE_HALF_WIDTH) return true;
  }
  return false;
}

function inRoundedSquare(p, radius) {
  const x = Math.abs(p.x - 0.5), y = Math.abs(p.y - 0.5);
  const half = 0.5, inner = half - radius;
  if (x > half || y > half) return false;
  if (x <= inner || y <= inner) return true;
  return (x - inner) ** 2 + (y - inner) ** 2 <= radius * radius;
}

// ---------- rasterize ----------

const BG = [0x0f, 0x76, 0x6e]; // teal-700
const WHITE = [0xff, 0xff, 0xff];
const CORNER_RADIUS = 0.18;
const SS = 4; // 4x4 supersampling

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // accumulate subsample coverage per layer
      let cover = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const p = { x: (px + (sx + 0.5) / SS) / size, y: (py + (sy + 0.5) / SS) / size };
          if (!inRoundedSquare(p, CORNER_RADIUS)) continue;
          cover++;
          const heart = inHeart(p);
          const pulse = onPulse(p);
          // heart is white; pulse cuts teal through the heart and reads
          // white outside it
          let col;
          if (pulse) col = heart ? BG : WHITE;
          else col = heart ? WHITE : BG;
          r += col[0]; g += col[1]; b += col[2];
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      if (cover === 0) {
        rgba.writeUInt32BE(0, i);
      } else {
        rgba[i] = Math.round(r / cover);
        rgba[i + 1] = Math.round(g / cover);
        rgba[i + 2] = Math.round(b / cover);
        rgba[i + 3] = Math.round((cover / n) * 255);
      }
    }
  }
  return encodePng(rgba, size);
}

for (const [file, size] of [
  ['icon.png', 256],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  const out = join(PUBLIC_DIR, file);
  writeFileSync(out, render(size));
  console.log(`wrote ${out} (${size}x${size})`);
}
