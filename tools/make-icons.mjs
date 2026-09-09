/**
 * 生成 App 图标（无第三方依赖，手写 PNG 编码器）。
 * 用法: node tools/make-icons.mjs
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- 最小 PNG 编码器 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 绘制 ---------- */
function mix(a, b, t) { return a + (b - a) * t; }
function hex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function heartInside(x, y) {
  // 归一化坐标：x∈[-1,1]，y 向上为正
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y <= 0;
}

function render(size, SS) {
  const N = size * SS;
  const acc = new Float32Array(size * size * 4);
  const top = hex('#FFC2DC');
  const bot = hex('#FF7FAE');
  const mint = hex('#B8E8D0');
  const lav = hex('#C9B6FF');

  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const u = (px + 0.5) / N;
      const v = (py + 0.5) / N;

      // 圆角矩形
      const r = 0.225;
      const dx = Math.max(r - u, 0, u - (1 - r));
      const dy = Math.max(r - v, 0, v - (1 - r));
      const outside = Math.hypot(dx, dy) > r;
      if (outside) continue;

      // 背景渐变
      let R = mix(top[0], bot[0], v), G = mix(top[1], bot[1], v), B = mix(top[2], bot[2], v);

      // 角落柔光
      const glow = Math.max(0, 1 - Math.hypot(u - 0.18, v - 0.14) * 2.2);
      R = mix(R, 255, glow * 0.55); G = mix(G, 255, glow * 0.55); B = mix(B, 255, glow * 0.55);

      // 右上角薄荷小圆点
      const dc = Math.hypot(u - 0.79, v - 0.19);
      if (dc < 0.075) {
        const k = 1 - dc / 0.075;
        R = mix(R, mint[0], Math.min(1, k * 2.2));
        G = mix(G, mint[1], Math.min(1, k * 2.2));
        B = mix(B, mint[2], Math.min(1, k * 2.2));
      }
      // 左下角薰衣草小圆点
      const dl = Math.hypot(u - 0.21, v - 0.81);
      if (dl < 0.06) {
        const k = 1 - dl / 0.06;
        R = mix(R, lav[0], Math.min(1, k * 2.0));
        G = mix(G, lav[1], Math.min(1, k * 2.0));
        B = mix(B, lav[2], Math.min(1, k * 2.0));
      }

      // 爱心
      const hx = (u - 0.5) / 0.30;
      const hy = (0.50 - v) / 0.30;
      if (heartInside(hx, hy * 1.06 - 0.06)) {
        const shade = Math.min(1, Math.max(0, (0.62 - v) * 2.4));
        R = mix(255, 255, 0); G = mix(255, 246 + (255 - 246) * shade, 0); B = 255;
        R = 255; G = 255 - 12 * (1 - shade); B = 255 - 6 * (1 - shade);
      }
      // 爱心高光
      const dgl = Math.hypot(u - 0.395, v - 0.375);
      if (dgl < 0.045 && heartInside((u - 0.5) / 0.30, ((0.50 - v) / 0.30) * 1.06 - 0.06)) {
        R = 255; G = 255; B = 255;
      }

      const o = (Math.floor(py / SS) * size + Math.floor(px / SS)) * 4;
      acc[o] += R; acc[o + 1] += G; acc[o + 2] += B; acc[o + 3] += 255;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const per = SS * SS;
  for (let i = 0; i < size * size; i++) {
    const a = acc[i * 4 + 3] / per;
    out[i * 4] = Math.round(acc[i * 4] / per);
    out[i * 4 + 1] = Math.round(acc[i * 4 + 1] / per);
    out[i * 4 + 2] = Math.round(acc[i * 4 + 2] / per);
    out[i * 4 + 3] = Math.round(a);
  }
  return out;
}

const targets = [
  { name: 'icon-180.png', size: 180, ss: 4 },
  { name: 'icon-512.png', size: 512, ss: 2 },
  { name: 'icon-192.png', size: 192, ss: 3 }
];

for (const t of targets) {
  const rgba = render(t.size, t.ss);
  const png = encodePNG(t.size, t.size, rgba);
  const dest = path.join(root, t.name);
  fs.writeFileSync(dest, png);
  console.log('✓', t.name, png.length + ' bytes');
}
