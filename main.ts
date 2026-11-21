// VELMARA — The Poster for a Place That Isn't There
// A program (Node 22, standard library only, no network) that procedurally
// paints a 1024x1024 travel poster for a place that does not exist and writes
// it to /output/entry.png (MAKEFUN_OUTPUT_DIR stands in outside the grader).
//
// The place: VELMARA, the floating isles of the Amber Sea — islands that drift
// above a golden sea at dusk, waterfalls falling into the sky. Painted pixel by
// pixel with a tiny built-in PNG encoder (node:zlib + hand-rolled CRC32) and a
// 5x7 bitmap font defined in code, so the poster needs no assets at all.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// ---------------------------------------------------------------- palette
type RGB = [number, number, number];
const INK: RGB = [26, 22, 46]; // deep indigo
const CREAM: RGB = [255, 244, 214];
const GOLD: RGB = [242, 183, 92];
const PALE_GOLD: RGB = [255, 233, 176];
const AMBER: RGB = [238, 150, 74];
const TEAL: RGB = [28, 84, 96];
const DEEP_TEAL: RGB = [14, 48, 62];
const ROCK: RGB = [58, 44, 84];
const ROCK_DARK: RGB = [38, 28, 58];
const GRASS: RGB = [126, 164, 96];
const WATER: RGB = [196, 226, 232];

// ---------------------------------------------------------------- pixels
const px = new Uint8Array(W * H * 3);

function set(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// deterministic rng so the poster is identical on every run
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261121);

function vgrad(y0: number, y1: number, top: RGB, bot: RGB): void {
  for (let y = y0; y <= y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0);
    const c = mix(top, bot, t);
    for (let x = 0; x < W; x++) set(x, y, c);
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    const dx = Math.floor(Math.sqrt(r * r - y * y));
    for (let x = -dx; x <= dx; x++) set(cx + x, cy + y, c);
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let y = -ry; y <= ry; y++) {
    const dx = Math.floor(rx * Math.sqrt(1 - (y * y) / (ry * ry)));
    for (let x = -dx; x <= dx; x++) set(cx + x, cy + y, c);
  }
}

function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  // Round first: Bresenham only terminates on integer endpoints (a fractional
  // y1, e.g. from the birds' wing tips, never equals an integer-stepped y).
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    set(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
  for (let ox = -w; ox <= w; ox++)
    for (let oy = -w; oy <= w; oy++) line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, c);
}

// scanline polygon fill
function fillPoly(pts: Array<[number, number]>, c: RGB): void {
  let minY = H;
  let maxY = 0;
  for (const [, y] of pts) {
    minY = Math.min(minY, Math.floor(y));
    maxY = Math.max(maxY, Math.ceil(y));
  }
  for (let y = Math.max(0, minY); y <= Math.min(H - 1, maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) set(x, y, c);
    }
  }
}

// ---------------------------------------------------------------- 5x7 font
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
};

function textWidth(s: string, scale: number, tracking: number): number {
  return s.length * (5 * scale + tracking) - tracking;
}

function drawText(s: string, cx: number, y: number, scale: number, c: RGB, tracking: number): void {
  let x = Math.round(cx - textWidth(s, scale, tracking) / 2);
  for (const ch of s.toUpperCase()) {
    const g = FONT[ch] ?? FONT[' '];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === '1') {
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) set(x + col * scale + dx, y + r * scale + dy, c);
        }
      }
    }
    x += 5 * scale + tracking;
  }
}

// ---------------------------------------------------------------- painting
// Sky: deep indigo dusk melting into amber at the horizon.
vgrad(0, 660, [24, 28, 64], [244, 164, 88]);

// Stars in the upper sky.
for (let i = 0; i < 160; i++) {
  const x = Math.floor(rand() * W);
  const y = Math.floor(rand() * 300);
  const b = 150 + Math.floor(rand() * 105);
  const s = rand() < 0.12 ? 2 : 1;
  for (let dy = 0; dy < s; dy++)
    for (let dx = 0; dx < s; dx++) set(x + dx, y + dy, [b, b, Math.min(255, b + 20)]);
}

// Art-deco sun rays behind the sun.
const SUN_X = 512;
const SUN_Y = 452;
for (let a = 0; a < 24; a++) {
  const ang = (a / 24) * Math.PI * 2;
  const len = a % 2 === 0 ? 330 : 260;
  const x1 = SUN_X + Math.cos(ang) * 130;
  const y1 = SUN_Y + Math.sin(ang) * 130;
  const x2 = SUN_X + Math.cos(ang) * len;
  const y2 = SUN_Y + Math.sin(ang) * len;
  thickLine(Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2), 2, mix(GOLD, [244, 164, 88], 0.55));
}

// The sun itself, pale gold with a bright core.
fillCircle(SUN_X, SUN_Y, 118, mix(PALE_GOLD, AMBER, 0.25));
fillCircle(SUN_X, SUN_Y, 104, PALE_GOLD);
fillCircle(SUN_X, SUN_Y, 78, [255, 246, 205]);

// Far mountain ridge, purple against the amber sky.
function ridge(base: number, amp: number, f1: number, f2: number, ph: number, c: RGB): void {
  const pts: Array<[number, number]> = [[0, H]];
  for (let x = 0; x <= W; x += 8) {
    const y = base - Math.abs(Math.sin(x * f1 + ph)) * amp - Math.abs(Math.sin(x * f2 + ph * 2)) * amp * 0.4;
    pts.push([x, y]);
  }
  pts.push([W, H]);
  fillPoly(pts, c);
}
ridge(648, 90, 0.006, 0.017, 1.3, [74, 52, 104]);
ridge(668, 60, 0.009, 0.023, 4.1, [52, 36, 82]);

// Floating islands: grassy caps, rock undersides, waterfalls into the sky.
function island(cx: number, cy: number, w: number, h: number): void {
  const top: Array<[number, number]> = [];
  for (let x = -w; x <= w; x += 8) {
    const t = x / w;
    top.push([cx + x, cy - 8 + Math.sin(t * Math.PI) * 6 - (1 - t * t) * 4]);
  }
  // rock underside tapering to a point
  const rock: Array<[number, number]> = [
    [cx - w, cy - 6],
    ...top,
    [cx + w, cy - 6],
    [cx + w * 0.55, cy + h * 0.55],
    [cx, cy + h],
    [cx - w * 0.55, cy + h * 0.55],
  ];
  fillPoly(rock, ROCK);
  // grassy cap
  const cap: Array<[number, number]> = [
    [cx - w, cy - 6],
    ...top,
    [cx + w, cy - 6],
    [cx + w, cy + 6],
    [cx - w, cy + 6],
  ];
  fillPoly(cap, GRASS);
  // a few pine silhouettes on the cap
  for (let i = 0; i < 4; i++) {
    const tx = cx - w * 0.6 + i * w * 0.4 + (rand() - 0.5) * 20;
    const th = 18 + rand() * 14;
    fillPoly(
      [
        [tx, cy - 10 - th],
        [tx - 9, cy - 8],
        [tx + 9, cy - 8],
      ],
      INK,
    );
  }
  // waterfalls spilling off the edges
  for (const side of [-1, 1]) {
    const wx = cx + side * w * 0.72;
    const len = 70 + rand() * 60;
    for (let k = 0; k < 3; k++) {
      const ox = (k - 1) * 4;
      for (let y = 0; y < len; y++) {
        const drift = Math.sin(y * 0.09) * 3;
        set(Math.round(wx + ox + drift), Math.round(cy + 4 + y), WATER);
      }
    }
    fillEllipse(Math.round(wx), Math.round(cy + 8 + len), 16, 5, mix(WATER, CREAM, 0.4));
  }
}
island(215, 330, 150, 120);
island(790, 285, 185, 150);
island(540, 205, 110, 90);

// Birds.
function bird(x: number, y: number, s: number): void {
  line(x - s, y, x, y - s * 0.6, INK);
  line(x, y - s * 0.6, x + s, y, INK);
}
bird(330, 150, 9);
bird(365, 128, 7);
bird(660, 170, 8);
bird(700, 140, 6);
bird(150, 210, 7);

// The Amber Sea: gold at the horizon cooling to deep teal.
vgrad(660, H, [246, 178, 96], DEEP_TEAL);

// Sun reflection: a glittering column of gold dashes on the water.
for (let y = 668; y < 1000; y += 9) {
  const spread = 30 + (y - 668) * 0.22;
  const wHalf = Math.min(190, spread);
  const x0 = SUN_X - wHalf + rand() * wHalf * 0.4;
  const len = 24 + rand() * (wHalf * 0.9);
  const fade = 1 - (y - 668) / 340;
  const c = mix(GOLD, TEAL, 1 - fade * 0.85);
  for (let x = 0; x < len; x++) set(Math.round(x0 + x), y, c);
  for (let x = 0; x < len * 0.6; x++) set(Math.round(x0 + x + 10), y + 1, c);
}

// Dark foreground headlands framing the bottom corners.
fillPoly(
  [
    [0, 1024],
    [0, 930],
    [120, 900],
    [260, 950],
    [300, 1024],
  ],
  [20, 26, 48],
);
fillPoly(
  [
    [1024, 1024],
    [1024, 920],
    [900, 895],
    [760, 945],
    [720, 1024],
  ],
  [20, 26, 48],
);

// Art-deco double border, gold on the dark edge.
for (const [inset, w] of [
  [22, 3],
  [34, 1],
] as const) {
  for (let k = 0; k < w; k++) {
    for (let x = inset + k; x < W - inset - k; x++) {
      set(x, inset + k, GOLD);
      set(x, H - 1 - inset - k, GOLD);
    }
    for (let y = inset + k; y < H - inset - k; y++) {
      set(inset + k, y, GOLD);
      set(W - 1 - inset - k, y, GOLD);
    }
  }
}

// ---------------------------------------------------------------- lettering
// Title with a soft shadow so it reads against the sky.
drawText('VELMARA', 512 + 4, 92 + 4, 13, [120, 70, 30], 14);
drawText('VELMARA', 512, 92, 13, CREAM, 14);
drawText('THE FLOATING ISLES', 512, 208, 5, PALE_GOLD, 6);
drawText('WHERE THE SKY RESTS ON THE AMBER SEA', 512, 852, 3, CREAM, 4);
drawText('VISIT THE IMPOSSIBLE', 512, 890, 3, GOLD, 4);

// ---------------------------------------------------------------- PNG encode
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Scanlines with the Up filter (great for smooth gradients) keep the file small.
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  const rowStart = y * (1 + W * 3);
  raw[rowStart] = y === 0 ? 0 : 2;
  for (let x = 0; x < W * 3; x++) {
    const v = px[y * W * 3 + x];
    const up = y === 0 ? 0 : px[(y - 1) * W * 3 + x];
    raw[rowStart + 1 + x] = (v - up) & 0xff;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(OUT, { recursive: true });
const outPath = join(OUT, 'entry.png');
writeFileSync(outPath, png);
console.log(`wrote ${outPath}: ${png.length} bytes, ${W}x${H}`);
if (png.length > 1048576) {
  console.error('ERROR: entry.png exceeds the 1,048,576 byte cap');
  process.exit(1);
}
