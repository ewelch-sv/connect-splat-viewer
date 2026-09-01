import zlib from "node:zlib";
import fs from "node:fs";

const size = 48;
const data = Buffer.alloc((size * 3 + 1) * size);
for (let y = 0; y < size; y++) {
  data[y * (size * 3 + 1)] = 0;
  for (let x = 0; x < size; x++) {
    const i = y * (size * 3 + 1) + 1 + x * 3;
    const dx = x - 24;
    const dy = y - 24;
    data[i] = 27;
    data[i + 1] = 42;
    data[i + 2] = 58;
    const blobs = [
      [18, 20, 7, 110, 198, 255],
      [30, 18, 6, 255, 209, 102],
      [26, 30, 8, 123, 211, 137],
      [14, 32, 4, 244, 166, 193],
    ];
    for (const [cx, cy, r, red, g, b] of blobs) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) {
        const a = 1 - d / r;
        data[i] = Math.round(data[i] * (1 - a) + red * a);
        data[i + 1] = Math.round(data[i + 1] * (1 - a) + g * a);
        data[i + 2] = Math.round(data[i + 2] * (1 - a) + b * a);
      }
    }
  }
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const head = Buffer.from(type);
  const crc = crc32(Buffer.concat([head, body]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc);
  return Buffer.concat([len, head, body, crcBuf]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(data)),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync("public/icon.png", png);
console.log("wrote public/icon.png", png.length);
