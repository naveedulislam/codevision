#!/usr/bin/env node
/**
 * Generates a crisp 128x128 PNG icon for the CodePlanner VS Code extension.
 * Pure Node.js — no external dependencies required.
 *
 * Run:  node generate-icon.js
 */
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── Dimensions ───────────────────────────────────────────────────────────────
const W = 128, H = 128;
const rgba = Buffer.alloc(W * H * 4, 0);

// ── Palette ──────────────────────────────────────────────────────────────────
const BG_DARK  = [10,  10,  28];   // deep navy background
const CARD     = [22,  22,  50];   // card surface
const HEADER   = [58,  42, 175];   // indigo header
const GREEN    = [ 0, 220, 130];   // completed task
const ORANGE   = [255, 140,   0];  // in-progress task
const PURPLE   = [160,  80, 255];  // pending task
const WHITE    = [235, 235, 255];  // text/check colour

// ── Fill background ───────────────────────────────────────────────────────────
for (let i = 0; i < W * H; i++) {
  rgba[i*4]   = BG_DARK[0];
  rgba[i*4+1] = BG_DARK[1];
  rgba[i*4+2] = BG_DARK[2];
  rgba[i*4+3] = 255;
}

// ── Alpha-composite a single pixel ───────────────────────────────────────────
function blend(xi, yi, r, g, b, a) {
  xi = Math.round(xi); yi = Math.round(yi);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H || a <= 0) return;
  const i  = (yi * W + xi) * 4;
  const fa = a / 255, ba = rgba[i+3] / 255;
  const oa = fa + ba * (1 - fa);
  rgba[i]   = Math.round((r * fa + rgba[i]   * ba * (1 - fa)) / oa);
  rgba[i+1] = Math.round((g * fa + rgba[i+1] * ba * (1 - fa)) / oa);
  rgba[i+2] = Math.round((b * fa + rgba[i+2] * ba * (1 - fa)) / oa);
  rgba[i+3] = Math.round(oa * 255);
}

// ── Filled rect ───────────────────────────────────────────────────────────────
function fillRect(x1, y1, x2, y2, col, a = 255) {
  for (let y = Math.round(y1); y <= Math.round(y2); y++)
    for (let x = Math.round(x1); x <= Math.round(x2); x++)
      blend(x, y, col[0], col[1], col[2], a);
}

// ── Rounded rect (filled) ─────────────────────────────────────────────────────
function roundRect(x1, y1, x2, y2, r, col) {
  // horizontal middle band
  fillRect(x1 + r, y1, x2 - r, y2, col);
  // left/right bands
  fillRect(x1, y1 + r, x1 + r - 1, y2 - r, col);
  fillRect(x2 - r + 1, y1 + r, x2, y2 - r, col);
  // four corner circles
  for (const [cx, cy] of [[x1+r, y1+r],[x2-r, y1+r],[x1+r, y2-r],[x2-r, y2-r]]) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.sqrt(dx*dx + dy*dy);
      const a = Math.max(0, Math.min(1, r - d + 0.5));
      if (a > 0) blend(cx+dx, cy+dy, col[0], col[1], col[2], Math.round(a * 255));
    }
  }
}

// ── Antialiased filled circle ─────────────────────────────────────────────────
function fillCircle(x0, y0, r, col, alpha = 255) {
  const pad = Math.ceil(r) + 1;
  for (let y = Math.max(0, Math.floor(y0 - pad)); y <= Math.min(H-1, Math.ceil(y0 + pad)); y++) {
    for (let x = Math.max(0, Math.floor(x0 - pad)); x <= Math.min(W-1, Math.ceil(x0 + pad)); x++) {
      const d = Math.sqrt((x - x0) ** 2 + (y - y0) ** 2);
      const a = Math.max(0, Math.min(1, r - d + 0.5));
      if (a > 0) blend(x, y, col[0], col[1], col[2], Math.round(a * alpha));
    }
  }
}

// ── Antialiased stroked circle ────────────────────────────────────────────────
function strokeCircle(x0, y0, r, lw, col, alpha = 255) {
  const hw  = lw / 2;
  const pad = Math.ceil(r + hw) + 1;
  for (let y = Math.max(0, Math.floor(y0 - pad)); y <= Math.min(H-1, Math.ceil(y0 + pad)); y++) {
    for (let x = Math.max(0, Math.floor(x0 - pad)); x <= Math.min(W-1, Math.ceil(x0 + pad)); x++) {
      const d = Math.sqrt((x - x0) ** 2 + (y - y0) ** 2);
      const a = Math.max(0, Math.min(1, hw - Math.abs(d - r) + 0.5));
      if (a > 0) blend(x, y, col[0], col[1], col[2], Math.round(a * alpha));
    }
  }
}

// ── Antialiased line with round caps ─────────────────────────────────────────
function strokeLine(x1, y1, x2, y2, lw, col, alpha = 255) {
  const hw  = lw / 2;
  const dx  = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const pad  = hw + 1;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - pad));
  const maxX = Math.min(W-1, Math.ceil(Math.max(x1, x2) + pad));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - pad));
  const maxY = Math.min(H-1, Math.ceil(Math.max(y1, y2) + pad));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t  = len2 > 0 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2)) : 0;
      const qx = x1 + t * dx - x;
      const qy = y1 + t * dy - y;
      const d  = Math.sqrt(qx * qx + qy * qy);
      const a  = Math.max(0, Math.min(1, hw - d + 0.5));
      if (a > 0) blend(x, y, col[0], col[1], col[2], Math.round(a * alpha));
    }
  }
}

// ── Icon geometry: task planner card ─────────────────────────────────────────

// Card background (rounded rect, navy-blue)
roundRect(8, 8, 119, 119, 12, CARD);

// Header bar (indigo, top of card — square the bottom edge)
roundRect(8, 8, 119, 34, 12, HEADER);
fillRect(8, 22, 119, 34, HEADER);  // square off the bottom of the header

// Three binding holes on the header
for (const hx of [36, 64, 92]) {
  fillCircle(hx, 21, 5, BG_DARK);
  strokeCircle(hx, 21, 5, 1.5, WHITE, 180);
}

// Divider line below header
strokeLine(18, 37, 110, 37, 1, WHITE, 40);

// ── Three task rows ───────────────────────────────────────────────────────────
const TASKS = [
  { y: 58,  col: GREEN,  barFill: 76, done: true  },
  { y: 80,  col: ORANGE, barFill: 52, done: false },
  { y: 102, col: PURPLE, barFill: 30, done: false },
];

const BAR_X = 42, BAR_RIGHT = 111, BAR_H = 7, CIRCLE_X = 22, CIRCLE_R = 9;

for (const t of TASKS) {
  // Bullet circle
  if (t.done) {
    fillCircle(CIRCLE_X, t.y, CIRCLE_R, t.col);
    // Checkmark (two strokes)
    strokeLine(CIRCLE_X - 5, t.y,     CIRCLE_X - 2, t.y + 3.5, 2, WHITE);
    strokeLine(CIRCLE_X - 2, t.y + 3.5, CIRCLE_X + 5, t.y - 3,  2, WHITE);
  } else {
    strokeCircle(CIRCLE_X, t.y, CIRCLE_R, 2.2, t.col);
  }

  // Bar track
  roundRect(BAR_X, t.y - BAR_H/2, BAR_RIGHT, t.y + BAR_H/2, 3, [30, 30, 60]);

  // Bar fill (rounded capsule)
  if (t.barFill > 0) {
    roundRect(BAR_X, t.y - BAR_H/2, BAR_X + t.barFill, t.y + BAR_H/2, 3, t.col);
  }
}

// Subtle outer glow ring
strokeCircle(63.5, 63.5, 57, 3, HEADER, 60);

// ── PNG encoder (pure Node.js) ────────────────────────────────────────────────

// CRC-32 table (pre-computed)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n >>> 0;
    for (let k = 0; k < 8; k++) c = (c & 1) ? ((0xEDB88320 ^ (c >>> 1)) >>> 0) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t  = Buffer.from(type, 'ascii');
  const ln = Buffer.allocUnsafe(4);  ln.writeUInt32BE(data.length);
  const cr = Buffer.allocUnsafe(4);  cr.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([ln, t, data, cr]);
}

// Build raw scanlines: filter-byte=0 (None) + row RGBA
const rows = Buffer.allocUnsafe(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  rows[y * (W * 4 + 1)] = 0; // filter = None
  rgba.copy(rows, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}

const ihdr = Buffer.allocUnsafe(13);
ihdr.writeUInt32BE(W, 0);  // width
ihdr.writeUInt32BE(H, 4);  // height
ihdr[8]  = 8;  // bit depth
ihdr[9]  = 6;  // colour type: RGBA
ihdr[10] = 0;  // compression
ihdr[11] = 0;  // filter
ihdr[12] = 0;  // interlace

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),  // PNG signature
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outPath = path.join(__dirname, 'icon.png');
fs.writeFileSync(outPath, png);
console.log(`✓ Written ${png.length} bytes → ${outPath}`);
