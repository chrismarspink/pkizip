/**
 * PWA 아이콘 생성 스크립트
 * usage: node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { writeFileSync } from 'fs';

const SIZES = [48, 72, 96, 128, 144, 192, 256, 384, 512];

// 방패+체크 SVG (PKIZIP 브랜드)
function makeSvg(size) {
  const s = size;
  const cx = s / 2, cy = s / 2 - s * 0.02;
  const sh = s * 0.38; // shield half-size
  const r = s * 0.18;  // corner radius
  const lw = s * 0.035;
  const fs = s * 0.075;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${r}" fill="#1DC078"/>
  <path d="M${cx},${cy - sh} C${cx - sh * 1.1},${cy - sh * 0.85} ${cx - sh * 1.2},${cy + sh * 0.1} ${cx},${cy + sh * 1.15} C${cx + sh * 1.2},${cy + sh * 0.1} ${cx + sh * 1.1},${cy - sh * 0.85} ${cx},${cy - sh}Z" fill="white"/>
  <polyline points="${cx - sh * 0.28},${cy + sh * 0.1} ${cx - sh * 0.04},${cy + sh * 0.38} ${cx + sh * 0.35},${cy - sh * 0.2}" fill="none" stroke="#1DC078" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="${cx}" y="${s * 0.93}" text-anchor="middle" fill="white" font-family="-apple-system,sans-serif" font-weight="700" font-size="${fs}">PKIZIP</text>
</svg>`;
}

for (const size of SIZES) {
  const svg = makeSvg(size);
  const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  const filename = `public/icon-${size}.png`;
  writeFileSync(filename, buf);
  console.log(`✓ ${filename} (${buf.length} bytes)`);
}

// maskable icon (패딩 추가 — 안전 영역 80%)
for (const size of [192, 512]) {
  const innerSize = Math.round(size * 0.8);
  const padding = Math.round(size * 0.1);
  const svg = makeSvg(innerSize);

  const inner = await sharp(Buffer.from(svg)).resize(innerSize, innerSize).png().toBuffer();
  const buf = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 29, g: 192, b: 120, alpha: 1 } }
  })
    .composite([{ input: inner, left: padding, top: padding }])
    .png()
    .toBuffer();

  const filename = `public/icon-${size}-maskable.png`;
  writeFileSync(filename, buf);
  console.log(`✓ ${filename} maskable (${buf.length} bytes)`);
}

console.log('\nDone! All icons generated in public/');
