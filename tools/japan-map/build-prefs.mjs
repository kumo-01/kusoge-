// 都道府県の境界（地球地図日本を GeoJSON にした dataofjapan/land の japan.geojson）を、
// ゲームの地図の単位に投影・簡略化して src/games/prefBattle/japan-prefs.json に書き出す。
//
//   curl -o japan.geojson https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson
//   node tools/japan-map/build-prefs.mjs japan.geojson
//
// 出典: 地球地図日本（国土地理院） https://www.gsi.go.jp/kankyochiri/gm_jpn.html
import fs from 'node:fs';
import { makeView, project, MAIN, INSET } from './view.mjs';

const src = process.argv[2];
if (!src) throw new Error('usage: node build-prefs.mjs japan.geojson');
const view = makeView();
const MIN_AREA = 3; // これより小さい島（地図の単位²、約 8km²）は省く（その県のいちばん大きい陸地は残す）
const TOL = 0.35; // 簡略化の許容（地図の単位、約 0.6km）
const FAR = 70; // いちばん大きい陸地からこれ（地図の単位、約 120km）より離れた島は省く（東京都の八丈島など。描くお題として不自然なので）

const inBox = (b, x) => x.every(([lon, lat]) => lon >= b.lon0 && lon <= b.lon1 && lat <= b.latTop && lat >= b.latBottom);
const area = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
};
/** 閉じた輪（始点 = 終点）は、始点からいちばん遠い点で 2 つに分けて簡略化する */
function simplifyRing(pts, tol) {
  let m = 1;
  let md = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > md) {
      md = d;
      m = i;
    }
  }
  return [...simplify(pts.slice(0, m + 1), tol).slice(0, -1), ...simplify(pts.slice(m), tol)];
}
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const L = Math.hypot(dx, dy) || 1e-9;
    let md = 0;
    let mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > tol && mi > 0) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const gj = JSON.parse(fs.readFileSync(src, 'utf8'));
const prefs = [];
for (const f of gj.features) {
  const code = f.properties.id;
  const name = f.properties.nam_ja;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  for (const poly of polys) {
    const outer = poly[0];
    const vp = inBox(MAIN, outer) ? 'main' : code === 47 && inBox(INSET, outer) ? 'inset' : null;
    if (!vp) continue;
    const pts = outer.map(([lon, lat]) => project(view, vp, lon, lat));
    rings.push({ vp, pts, a: area(pts) });
  }
  if (!rings.length) throw new Error(`no rings for ${name}`);
  const big = Math.max(...rings.map((r) => r.a));
  const bb = (pts) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  const mainBox = bb(rings.find((r) => r.a === big).pts);
  const gap = (b) => Math.hypot(Math.max(0, mainBox[0] - b[2], b[0] - mainBox[2]), Math.max(0, mainBox[1] - b[3], b[1] - mainBox[3]));
  const kept = rings.filter((r) => r.a === big || (r.a >= MIN_AREA && gap(bb(r.pts)) <= FAR)).map((r) => simplifyRing(r.pts, TOL));
  const flat = kept.map((pts) => pts.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]));
  const all = kept.flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  prefs.push({ code, name, rings: flat, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v)) });
}
prefs.sort((a, b) => a.code - b.code);
const out = {
  note: '地球地図日本（国土地理院）を加工して作成。座標は地図の単位 ×10（tools/japan-map/view.mjs）',
  view: { w: view.w, h: Math.round(view.h * 100) / 100, inset: { x: view.inset.ox, y: view.inset.oy, w: Math.round(view.inset.w * 100) / 100, h: Math.round(view.inset.h * 100) / 100 } },
  prefs,
};
const dest = new URL('../../src/games/prefBattle/japan-prefs.json', import.meta.url);
fs.writeFileSync(dest, JSON.stringify(out));
const pts = prefs.reduce((n, p) => n + p.rings.reduce((m, r) => m + r.length / 2, 0), 0);
console.log(`${prefs.length} prefectures, ${pts} points, ${(fs.statSync(dest).size / 1024).toFixed(0)} KB, map ${view.w}x${view.h.toFixed(1)}`);
