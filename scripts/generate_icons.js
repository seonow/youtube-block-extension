/**
 * Generates PNG icons using only Node.js built-ins (no npm packages).
 * Run: node scripts/generate_icons.js
 *
 * Outputs: icons/icon16.png, icons/icon48.png, icons/icon128.png
 * Each is a solid #c0392b (red) square — replace with real artwork later.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dir, "..", "icons");
mkdirSync(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const out = resolve(outDir, `icon${size}.png`);
  writeFileSync(out, makePNG(size, 0xc0, 0x39, 0x2b));
  console.log(`wrote ${out}`);
}

// ---------------------------------------------------------------------------

function makePNG(size, r, g, b) {
  // Build unfiltered RGBA scanlines
  const rowBytes = 1 + size * 4; // 1 filter byte + RGBA per pixel
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0; // filter type = None
    for (let x = 0; x < size; x++) {
      const i = y * rowBytes + 1 + x * 4;
      raw[i] = r; raw[i+1] = g; raw[i+2] = b; raw[i+3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 6; // RGBA colour type
  // bytes 10-12 already 0 (compression=0, filter=0, interlace=0)

  const sig  = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", deflateSync(raw)),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeChunk(type, data) {
  const len  = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const tBuf = Buffer.from(type, "ascii");
  const crc  = Buffer.allocUnsafe(4);
  crc.writeInt32BE(crc32(Buffer.concat([tBuf, data])), 0);
  return Buffer.concat([len, tBuf, data, crc]);
}

function crc32(buf) {
  const t = crcTable();
  let c = 0xffffffff;
  for (const b of buf) c = (c >>> 8) ^ t[(c ^ b) & 0xff];
  return (c ^ 0xffffffff) | 0;
}

function crcTable() {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
}
