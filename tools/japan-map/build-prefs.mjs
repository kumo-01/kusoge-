// 都道府県の「陸の県境」（となりの都道府県と接している線だけ。海岸線・島は含まない）を、
// ゲームの地図の単位に投影・簡略化して src/games/prefBattle/japan-prefs.json に書き出す。
//
//   curl -o japan.topojson https://raw.githubusercontent.com/dataofjapan/land/master/japan.topojson
//   node tools/japan-map/build-prefs.mjs japan.topojson
//
// TopoJSON は境界を「辺（arc）」で持ち、となり合う 2 つの県は同じ辺を共有する。
// 2 つの県が使っている辺 = 陸の県境、1 つの県だけが使っている辺 = 海岸線。
// 出典: 地球地図日本（国土地理院） https://www.gsi.go.jp/kankyochiri/gm_jpn.html （dataofjapan/land が TopoJSON に変換）
import fs from 'node:fs';
import { makeView, project } from './view.mjs';

const src = process.argv[2];
if (!src) throw new Error('usage: node build-prefs.mjs japan.topojson');
const view = makeView();
const TOL = 0.2; // 簡略化の許容（地図の単位、約 0.4km）
const MIN_LEN = 3; // これより短い県境の切れ端（地図の単位、約 6km。島の上の小さな境など）は使わない

const topo = JSON.parse(fs.readFileSync(src, 'utf8'));
const [sx, sy] = topo.transform.scale;
const [tx, ty] = topo.transform.translate;
// 辺を経度・緯度に戻す（差分で詰められている）
const arcs = topo.arcs.map((a) => {
  let x = 0;
  let y = 0;
  return a.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * sx + tx, y * sy + ty];
  });
});
const geoms = Object.values(topo.objects)[0].geometries;
const users = arcs.map(() => new Set()); // 辺ごとに、使っている県
const ringsOf = (g) => (g.type === 'Polygon' ? g.arcs : g.arcs.flat());
for (const g of geoms) for (const ring of ringsOf(g)) for (const i of ring) users[i < 0 ? ~i : i].add(g.properties.id);

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const L = Math.hypot(dx, dy);
    let md = 0;
    let mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = L > 1e-9 ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
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

/** 端がつながる線をつないで、長い線にする */
function chain(lines) {
  const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const out = [];
  const left = lines.map((l) => l.slice());
  while (left.length) {
    let cur = left.pop();
    let grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const l = left[i];
        const [a, b] = [key(cur[0]), key(cur[cur.length - 1])];
        const [c, d] = [key(l[0]), key(l[l.length - 1])];
        if (b === c) cur = cur.concat(l.slice(1));
        else if (b === d) cur = cur.concat(l.slice(0, -1).reverse());
        else if (a === d) cur = l.concat(cur.slice(1));
        else if (a === c) cur = l.slice(1).reverse().concat(cur);
        else continue;
        left.splice(i, 1);
        grown = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}

const prefs = [];
for (const g of geoms) {
  const code = g.properties.id;
  const name = g.properties.nam_ja;
  const all = new Set();
  for (const ring of ringsOf(g)) for (const i of ring) all.add(i < 0 ? ~i : i);
  const borderArcs = [...all].filter((i) => users[i].size >= 2);
  const neighbors = new Set();
  for (const i of borderArcs) for (const c of users[i]) if (c !== code) neighbors.add(c);
  const lines = chain(borderArcs.map((i) => arcs[i]))
    .map((l) => l.map(([lon, lat]) => project(view, lon, lat)))
    .filter((l) => l.reduce((a, p, i) => a + (i ? Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0) >= MIN_LEN)
    .map((l) => simplify(l, TOL));
  // 県全体（海岸線も含む）の外接箱: 答え合わせで映す範囲に使う。小さな離島は除く（本土からの外れ値で広くなりすぎないように）
  const pts = [];
  for (const ring of ringsOf(g)) {
    const r = ring.flatMap((i) => (i < 0 ? arcs[~i].slice().reverse() : arcs[i])).map(([lon, lat]) => project(view, lon, lat));
    let a = 0;
    for (let k = 0, j = r.length - 1; k < r.length; j = k++) a += (r[j][0] + r[k][0]) * (r[j][1] - r[k][1]);
    if (Math.abs(a / 2) >= 2) pts.push(...r);
  }
  const bb = (ps) => [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))].map((v) => Math.round(v * 10) / 10);
  prefs.push({
    code,
    name,
    neighbors: [...neighbors].sort((a, b) => a - b),
    borders: lines.map((l) => l.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)])),
    box: bb(pts.length ? pts : lines.flat()),
    borderBox: lines.length ? bb(lines.flat()) : null,
  });
}
prefs.sort((a, b) => a.code - b.code);
const out = {
  note: '地球地図日本（国土地理院）を加工して作成。borders = となりの都道府県と接している陸の県境（海岸線・島は含まない）。座標は地図の単位 ×10（tools/japan-map/view.mjs）',
  view: { w: view.w, h: Math.round(view.h * 100) / 100, X0: view.X0, Y0: view.Y0, S: view.S, kmPerUnit: Math.round(view.kmPerUnit * 1000) / 1000 },
  prefs,
};
const dest = new URL('../../src/games/prefBattle/japan-prefs.json', import.meta.url);
fs.writeFileSync(dest, JSON.stringify(out));
const n = prefs.reduce((a, p) => a + p.borders.reduce((m, r) => m + r.length / 2, 0), 0);
console.log(`${prefs.length} prefectures, border points ${n}, ${(fs.statSync(dest).size / 1024).toFixed(0)} KB, map ${view.w}x${view.h.toFixed(1)}, 1 unit = ${view.kmPerUnit.toFixed(2)} km`);
console.log('陸の県境がない:', prefs.filter((p) => !p.borders.length).map((p) => p.name).join('・'));
