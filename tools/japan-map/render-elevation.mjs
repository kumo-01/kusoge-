// 標高で色分けした日本地図（陰影つき）を作る。国土地理院の標高タイル（dem_png）を集めて、県境と同じ投影で描く。
//
//   node tools/japan-map/render-elevation.mjs <タイルを置くフォルダ>
//
// 出力: src/games/prefBattle/japan-elev.jpg（本土の幅 1000 単位 = 1250 画素）
// 出典: 国土地理院 標高タイル https://maps.gsi.go.jp/development/demtile.html
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { makeView, MAIN, INSET, mercX, mercY } from './view.mjs';

const { chromium } = createRequire(import.meta.url)('playwright'); // 開発用（Playwright が入っている環境で動かす）

const cache = process.argv[2];
if (!cache) throw new Error('usage: node render-elevation.mjs <tile cache dir>');
fs.mkdirSync(cache, { recursive: true });
const view = makeView();
const K = 1.25; // 画素 / 地図の単位
const W = Math.round(view.w * K);
const H = Math.round(view.h * K);

// 必要なタイル（本土はズーム 7、沖縄の枠はズーム 8）
const tiles = [];
const addRange = (b, z) => {
  const n = 2 ** z;
  for (let x = Math.floor(mercX(b.lon0) * n); x <= Math.floor(mercX(b.lon1) * n); x++)
    for (let y = Math.floor(mercY(b.latTop) * n); y <= Math.floor(mercY(b.latBottom) * n); y++) tiles.push({ z, x, y });
};
addRange(MAIN, 7);
addRange(INSET, 8);
const data = {};
for (const t of tiles) {
  const f = path.join(cache, `${t.z}-${t.x}-${t.y}.png`);
  if (!fs.existsSync(f)) {
    try {
      execFileSync('curl', ['-sf', '-m', '30', '-o', f, `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${t.z}/${t.x}/${t.y}.png`]);
    } catch {
      fs.writeFileSync(f, ''); // 404: 全部が海
    }
  }
  const buf = fs.readFileSync(f);
  if (buf.length) data[`${t.z}/${t.x}/${t.y}`] = buf.toString('base64');
}
console.log(`tiles ${tiles.length}（陸あり ${Object.keys(data).length}）→ ${W}x${H}`);

const browser = await chromium.launch();
const page = await browser.newPage();
const jpg = await page.evaluate(
  async ({ data, view, W, H, K }) => {
    // タイルを読み、標高（m、海は NaN）の配列にする
    const dem = {};
    for (const [key, b64] of Object.entries(data)) {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(256, 256);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, 256, 256).data;
      const e = new Float32Array(256 * 256);
      for (let i = 0; i < e.length; i++) {
        const v = px[i * 4] * 65536 + px[i * 4 + 1] * 256 + px[i * 4 + 2];
        e[i] = v === 8388608 ? NaN : (v < 8388608 ? v : v - 16777216) * 0.01;
      }
      dem[key] = e;
    }
    const sample = (z, X, Y) => {
      // ウェブメルカトル座標 X, Y（0〜1）の標高（近いタイル画素 4 つから補間）
      const n = 2 ** z * 256;
      const fx = X * n - 0.5;
      const fy = Y * n - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      let s = 0;
      let wsum = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const px = x0 + dx;
        const py = y0 + dy;
        const t = dem[`${z}/${Math.floor(px / 256)}/${Math.floor(py / 256)}`];
        const v = t ? t[(py & 255) * 256 + (px & 255)] : NaN;
        const w = (dx ? fx - x0 : 1 - (fx - x0)) * (dy ? fy - y0 : 1 - (fy - y0));
        if (!Number.isNaN(v)) {
          s += v * w;
          wsum += w;
        }
      }
      return wsum > 0.25 ? s / wsum : NaN;
    };
    const E = new Float32Array(W * H);
    const ins = view.inset;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const u = (px + 0.5) / K;
        const v = (py + 0.5) / K;
        const inInset = u >= ins.ox && u <= ins.ox + ins.w && v >= ins.oy && v <= ins.oy + ins.h;
        const vp = inInset ? ins : view.main;
        const X = (u - (vp.ox || 0)) / vp.S + vp.X0;
        const Y = (v - (vp.oy || 0)) / vp.S + vp.Y0;
        E[py * W + px] = sample(inInset ? 8 : 7, X, Y);
      }
    }
    // 色（標高の段彩）と陰影（北西からの光）
    const stops = [
      [0, [104, 172, 96]],
      [80, [132, 188, 102]],
      [250, [178, 205, 116]],
      [500, [216, 207, 128]],
      [900, [206, 170, 108]],
      [1400, [182, 134, 92]],
      [2100, [160, 122, 106]],
      [2700, [236, 232, 226]],
    ];
    const color = (h) => {
      if (h <= stops[0][0]) return stops[0][1];
      for (let i = 1; i < stops.length; i++) {
        if (h <= stops[i][0]) {
          const [a, ca] = stops[i - 1];
          const [b, cb] = stops[i];
          const f = (h - a) / (b - a);
          return ca.map((c, k) => c + (cb[k] - c) * f);
        }
      }
      return stops[stops.length - 1][1];
    };
    // 湖: 湖面は標高がまったく平ら。まわり 5×5 画素の差が 0.3m 未満の所を種にして、同じ高さ（±1.2m）の所へ広げる
    const lake = new Uint8Array(W * H);
    const queue = [];
    for (let py = 2; py < H - 2; py++) {
      for (let px = 2; px < W - 2; px++) {
        const h0 = E[py * W + px];
        if (Number.isNaN(h0) || h0 < 0.5 || lake[py * W + px]) continue;
        let flat = true;
        for (let dy = -2; dy <= 2 && flat; dy++) for (let dx = -2; dx <= 2; dx++) {
          const q = E[(py + dy) * W + px + dx];
          if (Number.isNaN(q) || Math.abs(q - h0) > 0.3) { flat = false; break; }
        }
        if (!flat) continue;
        queue.push(py * W + px);
        lake[py * W + px] = 1;
        while (queue.length) {
          const j = queue.pop();
          const x = j % W;
          const y = (j / W) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const k = ny * W + nx;
            const q = E[k];
            if (lake[k] || Number.isNaN(q) || Math.abs(q - h0) > 1.2) continue;
            lake[k] = 1;
            queue.push(k);
          }
        }
      }
    }
    const out = new ImageData(W, H);
    const cellM = (1000 * 1.78) / K; // 1 画素のおよその大きさ（m）
    const L = [-0.6, -0.6, 0.55]; // 光の向き（北西・上）
    const ln = Math.hypot(...L);
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const i = py * W + px;
        const h = E[i];
        let r, g, b;
        if (lake[i]) {
          [r, g, b] = [120, 178, 226];
        } else if (Number.isNaN(h)) {
          // 海: 岸の近くは少し明るく
          let near = false;
          for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
            const q = E[Math.min(H - 1, Math.max(0, py + dy)) * W + Math.min(W - 1, Math.max(0, px + dx))];
            if (!Number.isNaN(q)) { near = true; break; }
          }
          [r, g, b] = near ? [150, 200, 232] : [96, 158, 212];
        } else {
          const at = (x, y) => {
            const q = E[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
            return Number.isNaN(q) ? 0 : q;
          };
          const ex = 2.2; // 起伏の強調
          const dzdx = ((at(px + 1, py) - at(px - 1, py)) / (2 * cellM)) * ex;
          const dzdy = ((at(px, py + 1) - at(px, py - 1)) / (2 * cellM)) * ex;
          const n = [-dzdx, -dzdy, 1];
          const nl = Math.hypot(...n);
          const shade = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / (nl * ln));
          const f = 0.62 + 0.55 * shade;
          [r, g, b] = color(Math.max(0, h)).map((c) => Math.min(255, c * f));
        }
        out.data.set([r, g, b, 255], i * 4);
      }
    }
    const c = new OffscreenCanvas(W, H);
    c.getContext('2d').putImageData(out, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.84 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
    return btoa(s);
  },
  { data, view, W, H, K },
);
await browser.close();
const dest = new URL('../../src/games/prefBattle/japan-elev.jpg', import.meta.url);
fs.writeFileSync(dest, Buffer.from(jpg, 'base64'));
console.log(`wrote ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
