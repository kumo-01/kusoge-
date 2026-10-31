// 地図の下地（日本全体の 1 枚の画像）を、国土地理院の色別標高図タイルから作る。
// ゲームでは、拡大に合わせて同じタイルを細かい段階で読み込んで重ねる（この画像は、読み込み中・通信できないときの下地）。
//
//   node tools/japan-map/render-base.mjs <タイルを置くフォルダ>
//
// 出力: src/games/prefBattle/japan-base.jpg（範囲の幅 1000 単位 = 1250 画素）
// 出典: 国土地理院 色別標高図 https://maps.gsi.go.jp/development/ichiran.html#relief
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { makeView, EXTENT, mercX, mercY } from './view.mjs';

const { chromium } = createRequire(import.meta.url)('playwright'); // 開発用（Playwright が入っている環境で動かす）
const cache = process.argv[2];
if (!cache) throw new Error('usage: node render-base.mjs <tile cache dir>');
fs.mkdirSync(cache, { recursive: true });
const view = makeView();
const K = 1.25;
const W = Math.round(view.w * K);
const H = Math.round(view.h * K);
const Z = 7;
const n = 2 ** Z;
const tiles = {};
for (let x = Math.floor(mercX(EXTENT.lon0) * n); x <= Math.floor(mercX(EXTENT.lon1) * n); x++) {
  for (let y = Math.floor(mercY(EXTENT.latTop) * n); y <= Math.floor(mercY(EXTENT.latBottom) * n); y++) {
    const f = path.join(cache, `relief-${Z}-${x}-${y}.png`);
    if (!fs.existsSync(f)) {
      try {
        execFileSync('curl', ['-sf', '-m', '30', '-o', f, `https://cyberjapandata.gsi.go.jp/xyz/relief/${Z}/${x}/${y}.png`]);
      } catch {
        fs.writeFileSync(f, ''); // データのない所（遠い海など）
      }
    }
    const buf = fs.readFileSync(f);
    if (buf.length) tiles[`${x}/${y}`] = buf.toString('base64');
  }
}
console.log(`tiles ${Object.keys(tiles).length} → ${W}x${H}`);
const browser = await chromium.launch();
const page = await browser.newPage();
const jpg = await page.evaluate(
  async ({ tiles, view, W, H, K, Z }) => {
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#2f6fc4'; // データのない遠い海
    g.fillRect(0, 0, W, H);
    const n = 2 ** Z;
    for (const [key, b64] of Object.entries(tiles)) {
      const [x, y] = key.split('/').map(Number);
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const px = (x / n - view.X0) * view.S * K;
      const py = (y / n - view.Y0) * view.S * K;
      const size = (view.S * K) / n;
      g.drawImage(img, px, py, size, size);
    }
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
    return btoa(s);
  },
  { tiles, view, W, H, K, Z },
);
await browser.close();
const dest = new URL('../../src/games/prefBattle/japan-base.jpg', import.meta.url);
fs.writeFileSync(dest, Buffer.from(jpg, 'base64'));
console.log(`wrote ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
