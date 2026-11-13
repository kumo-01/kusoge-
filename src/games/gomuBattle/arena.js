// 会場（犬から見た屋外）。ラウンドごとに 公園 → 砂浜 → キャンプ場。まわりは柵（越えられない）。
// 家具は「箱」の集まりで、当たり判定も見た目もこの箱から作る。
// 箱: { x0, x1, z0, z1, y0, y1, c: 色, k: 見た目の種類 }。y0 > 0 の箱（テーブルの天板など）は下をくぐれる
//
// 広さ: 下の配置は「52 × 40 の部屋」の座標で書き、SCALE 倍に広げて使う（家具の大きさはそのまま、置き場所だけ離れる）。

import { wasmSegmentHit } from './collide.js';

/**
 * 配置を広げる倍率。2026-11-13 に 1.5 倍、さらに広さ（面積）を 2 倍に（縦横それぞれ √2 倍。52 × 40 の部屋の 4.5 倍の広さ。約 110 × 85 m）
 */
export const SCALE = 1.5 * Math.SQRT2;

/** 部屋の広さ（x: -W/2〜W/2、z: -D/2〜D/2） */
export const ROOM = { W: 52 * SCALE, D: 40 * SCALE, WALL: 9 };


let sc = SCALE; // いま作っている家具の置き場所の倍率（grp の中では 1 = 家具の中の位置）

/** 中心 (cx, cz)・幅 w・奥行き d・下の高さ y0・高さ h の箱 */
function box(cx, cz, w, d, y0, h, c, k = 'wood') {
  const x = cx * sc;
  const z = cz * sc;
  return { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0, y1: y0 + h, c, k };
}

/** いくつかの箱でできた家具（make の中は (cx, cz) からの位置で書く。広げても形はくずれない） */
function grp(cx, cz, make) {
  const prev = sc;
  sc = 1;
  const list = make().flat();
  sc = prev;
  const dx = cx * sc;
  const dz = cz * sc;
  for (const b of list) {
    b.x0 += dx;
    b.x1 += dx;
    b.z0 += dz;
    b.z1 += dz;
  }
  return list;
}

/** 天板と 4 本の脚のテーブル（天板の下は高さ top まで空いている） */
function table(cx, cz, w, d, top, c, leg = 0.3, thick = 0.18, k = 'wood') {
  return grp(cx, cz, () => {
    const out = [box(0, 0, w, d, top, thick, c, k)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box(sx * (w / 2 - leg), sz * (d / 2 - leg), leg, leg, 0, top, c, k));
    return out;
  });
}

/** いす（座面の下は伏せでくぐれる）。back: 背もたれの側（'n' = z の -、's' = z の +、'w' = x の -、'e' = x の +） */
function chair(cx, cz, s, seat, c, back = 's') {
  return grp(cx, cz, () => {
    const out = table(0, 0, s, s, seat, c, 0.2, 0.15);
    const t = 0.2;
    const h = 1.5;
    if (back === 'n' || back === 's') out.push(box(0, (back === 's' ? 1 : -1) * (s / 2 - t / 2), s, t, seat + 0.15, h, c));
    else out.push(box((back === 'e' ? 1 : -1) * (s / 2 - t / 2), 0, t, s, seat + 0.15, h, c));
    return out;
  });
}

/** おもちゃのトンネル（伏せてくぐる）。ns: 南北向き */
function tunnel(cx, cz, len, c1, c2, ns = false) {
  return grp(cx, cz, () =>
    ns
      ? [box(-1.1, 0, 0.25, len, 0, 0.95, c1, 'toy'), box(1.1, 0, 0.25, len, 0, 0.95, c1, 'toy'), box(0, 0, 2.45, len, 0.78, 0.2, c2, 'toy')]
      : [box(0, -1.1, len, 0.25, 0, 0.95, c1, 'toy'), box(0, 1.1, len, 0.25, 0, 0.95, c1, 'toy'), box(0, 0, len, 2.45, 0.78, 0.2, c2, 'toy')],
  );
}

/** 木（幹は当たる箱、葉は見た目だけ）。幹の位置を返す（葉は decor に足す） */
const trunk = (cx, cz, h = 4.2) => box(cx, cz, 1.2, 1.2, 0, h, 0x8a5a3b, 'trunk');
const leaves = (cx, cz, h = 4.2, r = 2.8) => ({ type: 'leaves', x: cx, z: cz, y: h, r });

/** 生け垣（犬より高い。輪ゴムをさえぎる） */
const hedge = (cx, cz, w, d, h = 1.7) => box(cx, cz, w, d, 0, h, 0x4f9a4a, 'hedge');

/** 岩 */
const rock = (cx, cz, s, h, c = 0x9aa0a6) => box(cx, cz, s, s * 0.85, 0, h, c, 'rock');

/** 階段（dir: 上る向き 'e' / 'w' / 'n' / 's'）。n 段、1 段の高さ rise、幅 w。(cx, cz) はいちばん低い段 */
function stairs(cx, cz, dir, n, rise, w, c) {
  return grp(cx, cz, () => {
    const out = [];
    const [dx, dz] = { e: [1, 0], w: [-1, 0], n: [0, -1], s: [0, 1] }[dir];
    for (let i = 0; i < n; i++) {
      const along = i * 1.0;
      out.push(box(dx * along, dz * along, dx ? 1.0 : w, dz ? 1.0 : w, 0, rise * (i + 1), c, 'step'));
    }
    return out;
  });
}

/** ベンチ（座面の下は伏せでくぐれる）。ns: 南北向き */
function bench(cx, cz, len, back, c = 0x9c6b3f) {
  const ns = back === 'w' || back === 'e';
  return grp(cx, cz, () => {
    const out = table(0, 0, ns ? 1.4 : len, ns ? len : 1.4, 0.85, c, 0.2, 0.18);
    const sg = back === 'n' || back === 'w' ? -1 : 1;
    if (ns) out.push(box(sg * 0.6, 0, 0.2, len, 1.03, 1.2, c));
    else out.push(box(0, sg * 0.6, len, 0.2, 1.03, 1.2, c));
    return out;
  });
}

/** パラソル（柱と大きな傘。傘の下は歩ける） */
const parasol = (cx, cz, c) => grp(cx, cz, () => [box(0, 0, 0.25, 0.25, 0, 3.2, 0xeeeeee, 'metal'), box(0, 0, 4.6, 4.6, 3.0, 0.3, c, 'umbrella')]);

/** 見張り台（高い台と階段。上から遠くを狙える） */
function lookout(cx, cz, top, c, dir = 'e') {
  const rise = (top + 0.25) / 6;
  const [sx, sz] = { e: [-1.3 - 6, 0], w: [1.3 + 6, 0], s: [0, -1.3 - 6], n: [0, 1.3 + 6] }[dir];
  return grp(cx, cz, () => [...table(0, 0, 2.6, 2.6, top, c, 0.3, 0.25), ...stairs(sx + (dir === 'e' ? 0.5 : dir === 'w' ? -0.5 : 0), sz + (dir === 's' ? 0.5 : dir === 'n' ? -0.5 : 0), dir, 6, rise, 1.4, c)]);
}

/**
 * スナイパー向けの高台: 歩いて上れる段々の丘（1 段 0.45）と、上のふちの土のうの壁。
 * 壁は高さ 0.72: 伏せると隠れて、立つと上から撃てる。face: 壁を置く向き（会場の真ん中の方）
 * 上の広さは w - 2(L-1) × d - 1.6(L-1)、高さは 0.45 × L
 */
function hill(cx, cz, w, d, face, L = 4, c = 0x7fb069) {
  return grp(cx, cz, () => {
    const out = [];
    for (let i = 0; i < L; i++) out.push(box(0, 0, w - i * 2, d - i * 1.6, 0, 0.45 * (i + 1), c, 'hill'));
    const tw = w - (L - 1) * 2;
    const td = d - (L - 1) * 1.6;
    const top = 0.45 * L;
    const bag = 0xc2a878;
    // 壁はふちの真ん中だけ（両はしは空けて、上り下りできるように）
    if (face === 'e' || face === 'w') out.push(box((face === 'e' ? 1 : -1) * (tw / 2 - 0.3), 0, 0.6, Math.max(1.2, td - 1.8), top, 0.72, bag, 'sandbag'));
    else out.push(box(0, (face === 's' ? 1 : -1) * (td / 2 - 0.3), Math.max(1.2, tw - 1.8), 0.6, top, 0.72, bag, 'sandbag'));
    return out;
  });
}

/**
 * 体当たりで押して動かせるもの（木箱・バケツ・ビーチボールなど）。{ x, z, w, d, h, c, k }
 * 位置は試合の状態に入る（ラウンドの始めにここへ戻る）
 */
const mov = (x, z, w, d, h, c, k = 'cardboard') => ({ x: x * SCALE, z: z * SCALE, w, d, h, c, k });

/** 出発地点・アイテムの箱・飾りの位置を、広げた部屋に合わせる */
function spread(a) {
  a.spawns = a.spawns.map(([x, z, yaw]) => [x * SCALE, z * SCALE, yaw]);
  a.items = a.items.map(([x, z, y]) => [x * SCALE, z * SCALE, y]);
  a.decor = a.decor.map((d) => ({
    ...d,
    ...(d.x != null ? { x: d.x * SCALE } : {}),
    ...(d.z != null ? { z: d.z * SCALE } : {}),
    ...(d.type === 'rug' || d.type === 'water' ? { w: d.w * SCALE, d: d.d * SCALE } : {}),
  }));
  // トランポリン（真ん中寄りの空いた所に 3 つ）
  a.tramps = freeSpots(a, 3, { R: 2.2, inner: 0.62 }).map(([x, z]) => ({ x0: x - 1.2, x1: x + 1.2, z0: z - 1.2, z1: z + 1.2, y0: 0, y1: 0.45, c: 0x2f80ed, k: 'tramp' }));
  a.boxes = [...a.boxes, ...a.tramps];
  // 丘とくぼみ（家具・押せるもの・道・水のない所に、なだらかな地形）
  a.terrain = terrainSpots(a);
  a.terrainTop = Math.max(0, ...a.terrain.map((f) => f.h));
  a.floorY = Math.min(0, ...a.terrain.map((f) => f.h)); // いちばん低い地面（くぼみの底）
  // 出発地点を 20 か所足す（家具を避け、会場の真ん中を向く）
  const more = freeSpots(a, 20, { R: 1.6, avoid: a.items, gap: 6 }).map(([x, z]) => [x, z, Math.atan2(-x, -z)]);
  a.spawns = [...a.spawns, ...more];
  // 見た目は元の箱のまま（draw）、当たり判定は形に合わせた箱の組（boxes）
  a.draw = a.boxes;
  a.boxes = a.boxes.flatMap(hitParts);
  // 地面に置くものの高さは、地形に合わせる
  const onGround = ([x, z, y]) => [x, z, y + groundY(a, x, z)];
  a.items = a.items.map(([x, z, y]) => (y === 0 ? onGround([x, z, 0]) : [x, z, y]));
  a.heals = freeSpots(a, 8).map(onGround);
  // 補給箱が落ちてくる所（おやつ・トランポリンを避けた空いた所）
  a.drops = freeSpots(a, 10, { R: 1.6, avoid: a.heals }).map(onGround);
  // 風船の的（空中。地面からの高さは 2.2〜3.6 で決まった順）
  a.balloons = freeSpots(a, 6, { R: 1.4, inner: 0.85, avoid: [...a.heals, ...a.drops] }).map(([x, z], k) => [x, z, 2.2 + ((k * 0.53) % 1.4) + groundY(a, x, z)]);
  // 水（入ると遅くなる）
  a.water = (a.decor || []).filter((d) => d.type === 'water').map((d) => ({ x0: d.x - d.w / 2, x1: d.x + d.w / 2, z0: d.z - d.d / 2, z1: d.z + d.d / 2 }));
  return a;
}

/**
 * 空いた地面の場所を n か所（毎回同じ）。家具・押せるもの・水に重ならない、出発地点・アイテムの箱・avoid から 3 以上離れた所を、
 * できるだけ離して選ぶ（1 つ目は真ん中にいちばん近い所、そのあとは選んだ所からいちばん遠い所）。
 * R: 空けておく半径、inner: 会場の真ん中寄りだけ（幅・奥行きのこの割合の中）
 */
function freeSpots(a, n, { R = 1.1, inner = 1, avoid = [], gap = 3 } = {}) {
  const blocked = (x, z) =>
    a.boxes.some((b) => b.y0 < 1.6 && x + R > b.x0 && x - R < b.x1 && z + R > b.z0 && z - R < b.z1) ||
    (a.movables || []).some((m) => Math.abs(x - m.x) < m.w / 2 + R + 0.5 && Math.abs(z - m.z) < m.d / 2 + R + 0.5) ||
    (a.decor || []).some((d) => d.type === 'water' && Math.abs(x - d.x) < d.w / 2 + R && Math.abs(z - d.z) < d.d / 2 + R); // 水の上には置かない
  const near = (x, z, list, d) => list.some(([px, pz]) => Math.hypot(px - x, pz - z) < d);
  const cand = [];
  for (let x = -ROOM.W / 2 + 3; x <= ROOM.W / 2 - 3; x += 2) {
    for (let z = -ROOM.D / 2 + 3; z <= ROOM.D / 2 - 3; z += 2) {
      if (Math.abs(x) > (ROOM.W / 2) * inner || Math.abs(z) > (ROOM.D / 2) * inner) continue;
      if (!blocked(x, z) && !near(x, z, a.spawns, gap) && !near(x, z, a.items, 3) && !near(x, z, avoid, 3)) cand.push([x, z]);
    }
  }
  const out = [];
  let first = cand[0];
  for (const c of cand) if (Math.hypot(c[0], c[1]) < Math.hypot(first[0], first[1])) first = c;
  if (first) out.push(first);
  while (out.length < n && out.length < cand.length) {
    let best = null;
    let bd = -1;
    for (const c of cand) {
      const d = Math.min(...out.map(([x, z]) => Math.hypot(x - c[0], z - c[1])));
      if (d > bd) {
        bd = d;
        best = c;
      }
    }
    out.push(best);
  }
  return out.map(([x, z]) => [x, z, 0]);
}

/**
 * 丘とくぼみの場所（毎回同じ）。{ x, z, r: 半径, h: 高さ（くぼみは -） }。
 * 形は (1 + cos(π d / r)) / 2 のなだらかな山（いちばん急な所で 20° くらい。歩いて上り下りできる）。
 * 家具・押せるもの・道（rug）・水・柵から離れた所を、できるだけ離して選ぶ（丘 → くぼみ → 丘 … の順）
 */
function terrainSpots(a) {
  const KINDS = [
    [8.5, 2.4],
    [6.5, -1.7],
    [9, 2.0],
    [7, -1.6],
    [7.5, 2.6],
    [6, -1.5],
    [8, 1.8],
  ];
  const boxDist = (b, x, z) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));
  const out = [];
  for (const [r, h] of KINDS) {
    let best = null;
    let bd = -1;
    for (let x = -ROOM.W / 2 + r + 2; x <= ROOM.W / 2 - r - 2; x += 1.5) {
      for (let z = -ROOM.D / 2 + r + 2; z <= ROOM.D / 2 - r - 2; z += 1.5) {
        if (a.boxes.some((b) => boxDist(b, x, z) < r + 0.8)) continue;
        if ((a.movables || []).some((m) => Math.hypot(m.x - x, m.z - z) < r + Math.max(m.w, m.d) / 2 + 1)) continue;
        if ((a.decor || []).some((d) => (d.type === 'rug' || d.type === 'water') && Math.hypot(Math.max(Math.abs(x - d.x) - d.w / 2, 0), Math.max(Math.abs(z - d.z) - d.d / 2, 0)) < r + 0.5)) continue;
        if (out.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + r + 3)) continue;
        // 選んだ所から遠く（はじめは真ん中寄り）
        const d = out.length ? Math.min(...out.map((f) => Math.hypot(f.x - x, f.z - z))) : 1000 - Math.hypot(x, z);
        if (d > bd) {
          bd = d;
          best = [x, z];
        }
      }
    }
    if (best) out.push({ x: best[0], z: best[1], r, h });
  }
  return out;
}

/** 地面の高さ（丘・くぼみ。何もない所は 0） */
export function groundY(a, x, z) {
  const T = a.terrain;
  if (!T || !T.length) return 0;
  let y = 0;
  for (const f of T) {
    const dx = x - f.x;
    const dz = z - f.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= f.r * f.r) continue;
    y += (f.h * (1 + Math.cos((Math.PI * Math.sqrt(d2)) / f.r))) / 2;
  }
  return y;
}

/** 地面の傾き (dy/dx, dy/dz) */
export function groundSlope(a, x, z) {
  let gx = 0;
  let gz = 0;
  for (const f of a.terrain || []) {
    const dx = x - f.x;
    const dz = z - f.z;
    const d = Math.hypot(dx, dz);
    if (d >= f.r || d < 1e-6) continue;
    const k = (-f.h * Math.PI * Math.sin((Math.PI * d) / f.r)) / (2 * f.r) / d;
    gx += k * dx;
    gz += k * dz;
  }
  return [gx, gz];
}

/**
 * 線分 a → b（太さ r）が、地形（丘・くぼみ・平らな地面）に最初に当たる割合（tmax まで。当たらなければ 1）。
 * 細かく区切って地面の下に入る所を探し、そこから半分ずつ詰める。out に当たった面の向き
 */
export function terrainHit(a, ax, ay, az, bx, by, bz, r, tmax = 1, out = null) {
  if (!a.terrain || !a.terrain.length) return 1;
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  // 地形のいちばん高い所より上を通るだけなら当たらない
  if (Math.min(ay, ay + dy * tmax) - r > a.terrainTop + 1e-6) return 1;
  const f = (t) => ay + dy * t - r - groundY(a, ax + dx * t, az + dz * t);
  if (f(0) < 0) return 1; // 地面の中から出発（ありえないが、出られなくならないように）
  const len = Math.hypot(dx, dy, dz) * tmax;
  const n = Math.max(1, Math.ceil(len / 0.35));
  let lo = 0;
  for (let i = 1; i <= n; i++) {
    const t = (tmax * i) / n;
    if (f(t) >= 0) {
      lo = t;
      continue;
    }
    let hi = t;
    for (let k = 0; k < 10; k++) {
      const m = (lo + hi) / 2;
      if (f(m) >= 0) lo = m;
      else hi = m;
    }
    if (out) {
      const [gx, gz] = groundSlope(a, ax + dx * lo, az + dz * lo);
      const l = Math.hypot(gx, 1, gz);
      out.t = lo;
      out.nx = -gx / l;
      out.ny = 1 / l;
      out.nz = -gz / l;
    }
    return lo;
  }
  return 1;
}

/**
 * 見た目が箱でないもの（テントの三角・車の屋根・パラソルの円すい・岩・丸太・木の幹）の当たり判定を、
 * 見た目に合わせた箱の組にする。ほかの箱はそのまま。world.js の見た目の作り方と同じ寸法で作る
 */
export function hitParts(b) {
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  const h = b.y1 - b.y0;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  // (cx, cz) からの半幅 hx・hz、高さ y0〜y1 の箱
  const part = (hx, hz, y0, y1, ox = 0) => ({ x0: cx + ox - hx, x1: cx + ox + hx, z0: cz - hz, z1: cz + hz, y0, y1, c: b.c, k: b.k, part: true });
  switch (b.k) {
    case 'tent': {
      // 横から見て三角（底の幅 w、てっぺんは真ん中）。高さを 5 つに分けて、上ほど細い箱
      const n = 5;
      return Array.from({ length: n }, (_, j) => part((w / 2) * (1 - (j + 0.5) / n), d / 2, b.y0 + (h * j) / n, b.y0 + (h * (j + 1)) / n));
    }
    case 'car':
      // 車体（下 0.575）と、少し後ろ寄りの細い屋根（窓）
      return [part(w / 2, d / 2, b.y0, b.y0 + h * 0.575), part(w * 0.275, d * 0.46, b.y0 + h * 0.575, b.y1, -w * 0.05)];
    case 'umbrella': {
      // 円すい（底の半径 R、高さ 1.1。下は空いているので、柱の上の傘の部分だけ）。3 つに分けて上ほど細い
      const R = Math.max(w, d) / 2 + 0.3;
      const lo = cy - 0.55;
      const n = 3;
      return Array.from({ length: n }, (_, j) => {
        const r = R * (1 - (j + 0.5) / n) * 0.88; // 円に近い四角
        return part(r, r, lo + (1.1 * j) / n, lo + (1.1 * (j + 1)) / n);
      });
    }
    case 'rock':
      // でこぼこの玉: 細い芯と、真ん中のふくらみ
      return [part(w * 0.31, d * 0.31, b.y0, b.y1), part(w * 0.45, d * 0.45, b.y0 + h * 0.25, b.y0 + h * 0.75)];
    case 'log': {
      // 寝かせた丸太（半径 r = 細い方と高さの小さい方の半分）。十字の 2 つの箱で丸に近づける
      const along = w >= d;
      const r = Math.min(along ? d : w, h) / 2;
      const len = (along ? w : d) / 2;
      const mk = (ha, hb) => (along ? part(len, ha, cy - hb, cy + hb) : part(ha, len, cy - hb, cy + hb));
      return [mk(r, r * 0.7), mk(r * 0.7, r)];
    }
    case 'trunk':
    case 'stump': {
      // 立てた丸太（円柱）。十字の 2 つの箱
      const r = Math.min(w, d) / 2;
      return [part(r * 0.72, r, b.y0, b.y1), part(r, r * 0.72, b.y0, b.y1)];
    }
    default:
      return [b];
  }
}

// ---- 公園 ----
const PARK_TREES = [[-20, -14], [-8, -16.5], [6, -16], [20, -12], [-22, 6], [22, 10], [-7, 15], [13, 16]];
const PARK = spread({
  id: 'park',
  name: '公園',
  outdoor: true,
  sky: 0x9fd8ff,
  ground: 'grass',
  floor: 0x8cc66a,
  fence: 'wood',
  boxes: [
    ...PARK_TREES.map(([x, z]) => trunk(x, z)),
    hedge(-14, -4, 7, 1.4),
    hedge(8, -7, 1.4, 6),
    hedge(0, 10, 8, 1.4),
    // スナイパー向けの高台（両はし。真ん中の広場を見わたせる）
    ...hill(-20.8, 9.8, 10, 8, 'e'),
    ...hill(21.2, -7.35, 10, 8, 'w'),
    // すべり台: 階段で上の台へ（上から遠くまで見渡せる）。反対側もすべり台の段
    ...grp(16, -1, () => [box(0, 0, 2.4, 2.4, 0, 2.4, 0xe76f51, 'play'), ...stairs(-6.7, 0, 'e', 5, 0.42, 1.6, 0xf4a261), ...stairs(5.7, 0, 'w', 5, 0.42, 1.6, 0x2a9d8f)]),
    // 砂場（低いふち）
    ...grp(-12, 10, () => [box(0, -3, 8, 0.4, 0, 0.4, 0xb08968), box(0, 3, 8, 0.4, 0, 0.4, 0xb08968), box(-4, 0, 0.4, 6.4, 0, 0.4, 0xb08968), box(4, 0, 0.4, 6.4, 0, 0.4, 0xb08968)]),
    // 噴水（池のふちに乗れる。真ん中の柱は高い）
    ...grp(0, -4, () => [box(0, 0, 5, 5, 0, 0.45, 0xc9c9c9, 'pond'), box(0, 0, 1, 1, 0.45, 2.2, 0xdedede, 'stone')]),
    ...bench(-4, -11, 4, 'n'),
    ...bench(8, 12.5, 4, 's'),
    ...bench(-23, -4, 4, 'w'),
    // 遊具のトンネル（伏せてくぐる）
    ...tunnel(4, 5, 6, 0x3a86ff, 0x4361ee),
    rock(22, -17.5, 2.2, 1.4),
    rock(-23.5, 16.5, 2.4, 1.6),
  ],
  movables: [mov(-6, 2, 1.6, 1.6, 1.2, 0xc8a165), mov(6, -12, 1.6, 1.6, 1.2, 0xc8a165), mov(-16, -10, 1.8, 1.8, 1.1, 0xffbe0b, 'toybox'), mov(18, 14, 1.6, 1.6, 1.2, 0xc8a165), mov(2, 16, 1.6, 1.6, 1.0, 0xa8dadc, 'basket'), mov(-18, 2, 1.6, 1.6, 1.2, 0xc8a165)],
  decor: [
    { type: 'rug', x: 0, z: 0, w: 46, d: 2.6, c: 0xe2c799 },
    { type: 'rug', x: 0, z: 0, w: 2.6, d: 34, c: 0xe2c799 },
    { type: 'rug', x: -12, z: 10, w: 7.6, d: 5.6, c: 0xf1dca7 },
    ...PARK_TREES.map(([x, z]) => leaves(x, z)),
  ],
  spawns: [
    [-24, -18, Math.PI * 0.25],
    [24, -18.5, -Math.PI * 0.25],
    [-24.5, 18, Math.PI * 0.75],
    [24, 18, -Math.PI * 0.75],
    [-25, 0, Math.PI * 0.5],
    [25, 4, -Math.PI * 0.5],
    [-1, -18.5, 0],
    [3, 18.5, Math.PI],
    [-10, -8, 0],
    [10, 8, Math.PI],
  ],
  items: [
    [16, -1, 2.4], // すべり台の上
    [4, 5, 0], // トンネルの中
    [-12, 10, 0], // 砂場
    [0, -9, 0],
    [-18, -1, 0],
    [17, -14, 0],
    [-3, 17, 0],
    [24, 3, 0],
    [-22, -12, 0],
    [12, -6, 0],
    [-10, 2, 0],
  ],
});

// ---- 砂浜 ----
const BEACH = spread({
  id: 'beach',
  name: '砂浜',
  outdoor: true,
  sky: 0x8ed1fc,
  ground: 'sand',
  floor: 0xf1dca7,
  fence: 'rope',
  boxes: [
    rock(-20, -13, 3, 1.8),
    rock(-16.5, -15, 2, 1.2),
    rock(18, -13.5, 3.4, 2.2),
    rock(21.5, -10, 2, 1.3),
    rock(0, -16, 2.4, 1.5),
    ...parasol(-10, -4, 0xef476f),
    ...parasol(6, -7, 0x118ab2),
    ...parasol(-4, 8, 0xffd166),
    ...parasol(15, 10, 0x06d6a0),
    // 砂のお城
    ...grp(-14, 6, () => [box(0, 0, 3, 3, 0, 1.2, 0xe9c46a, 'sand'), box(-1.1, -1.1, 0.9, 0.9, 1.2, 1, 0xe9c46a, 'sand'), box(1.1, 1.1, 0.9, 0.9, 1.2, 1, 0xe9c46a, 'sand')]),
    ...grp(10, 2, () => [box(0, 0, 2.6, 2.6, 0, 1.1, 0xe9c46a, 'sand'), box(0, 0, 1, 1, 1.1, 1.1, 0xe9c46a, 'sand')]),
    // 砂の上のボート
    box(21, 1, 2.6, 6.4, 0, 1.4, 0xf8f9fa, 'boat'),
    // 流木
    box(-2, 0, 6, 0.9, 0, 0.7, 0xa47148, 'log'),
    box(-21, 14, 0.9, 6, 0, 0.7, 0xa47148, 'log'),
    box(7, 16, 5, 0.9, 0, 0.7, 0xa47148, 'log'),
    // 監視台（階段で上る）
    ...lookout(0, 13, 2.6, 0xf8f9fa, 'e'),
    // スナイパー向けの砂丘（両はし）
    ...hill(-21.2, 8.6, 10, 7, 'e', 3, 0xe9c46a),
    ...hill(21.6, 13.3, 9, 6.5, 'w', 3, 0xe9c46a),
  ],
  movables: [mov(-6, -10, 1.6, 1.6, 1.6, 0xff006e, 'toybox'), mov(12, -2, 1.6, 1.6, 1.6, 0x3a86ff, 'toybox'), mov(-17, 0, 1.8, 1.4, 1.0, 0xffffff, 'basket'), mov(16, 15, 1.6, 1.6, 1.2, 0xc8a165), mov(-10, 15, 1.6, 1.6, 1.2, 0xc8a165), mov(4, -12, 1.8, 1.4, 1.0, 0x48cae4, 'basket')],
  decor: [
    { type: 'water', x: 0, z: -18, w: 52, d: 4, c: 0x48cae4 },
    { type: 'rug', x: -8, z: 12, w: 3, d: 1.8, c: 0xff8fab },
    { type: 'rug', x: 13, z: -2, w: 3, d: 1.8, c: 0x90e0ef },
  ],
  spawns: [
    [-24, -11, Math.PI * 0.5],
    [24, -16, -Math.PI * 0.25],
    [-24.5, 18, Math.PI * 0.75],
    [24.5, 17, -Math.PI * 0.75],
    [-24, 4, Math.PI * 0.5],
    [25, -4, -Math.PI * 0.5],
    [-8, -17, 0],
    [12, 18.5, Math.PI],
    [-10, 0, 0],
    [8, -2, Math.PI],
  ],
  items: [
    [0, 13, 2.85], // 監視台の上
    [-9, -4, 0], // パラソルの下
    [7, -7, 0],
    [-3, 8, 0],
    [16, 10, 0],
    [-20, -8, 0],
    [20, -6, 0],
    [-3, -5, 0],
    [3, 4, 0],
    [-14, 12, 0],
    [24, 10, 0],
  ],
});

// ---- キャンプ場 ----
const CAMP_TREES = [[-22, -16], [-12, -17.5], [10, -17.5], [22, -15], [-23.5, 4], [23.5, 7], [-18, 17], [17, 17.5]];
const CAMP = spread({
  id: 'camp',
  name: 'キャンプ場',
  outdoor: true,
  sky: 0xb9e2f5,
  ground: 'dirt',
  floor: 0xb5a17e,
  fence: 'wood',
  boxes: [
    ...CAMP_TREES.map(([x, z]) => trunk(x, z, 4.6)),
    // テント
    box(-14, -8, 4.6, 3.6, 0, 2.4, 0xf4a261, 'tent'),
    box(14, -6, 4.6, 3.6, 0, 2.4, 0x2a9d8f, 'tent'),
    box(-6, 12, 3.6, 4.6, 0, 2.4, 0xe76f51, 'tent'),
    // たき火と、まわりの丸太（丸太はジャンプで越える）
    box(0, 0, 1.4, 1.4, 0, 0.35, 0x6d4c41, 'fire'),
    box(0, -3.2, 4, 0.9, 0, 0.6, 0xa47148, 'log'),
    box(0, 3.2, 4, 0.9, 0, 0.6, 0xa47148, 'log'),
    box(-3.2, 0, 0.9, 4, 0, 0.6, 0xa47148, 'log'),
    box(3.2, 0, 0.9, 4, 0, 0.6, 0xa47148, 'log'),
    // ピクニックテーブル（立ったままくぐれる）とベンチ
    ...grp(-15, 7, () => [...table(0, 0, 6, 3, 1.6, 0xa0522d), ...bench(0, -2.6, 6, 'n', 0xa0522d), ...bench(0, 2.6, 6, 's', 0xa0522d)]),
    // 車
    box(16, 8, 5.4, 2.6, 0, 1.8, 0xe63946, 'car'),
    // 見張り台
    ...lookout(-2, -12, 3, 0xb08968, 'e'),
    // スナイパー向けの高台（両はし）
    ...hill(-21.2, -2.04, 10, 7, 'e', 3),
    ...hill(21.2, 11.2, 10, 5.4, 'w', 3),
    // 切り株・岩・まき
    box(8, -10, 1.4, 1.4, 0, 0.6, 0x9c6644, 'stump'),
    box(-8, -2, 1.4, 1.4, 0, 0.6, 0x9c6644, 'stump'),
    box(20, -3, 1.4, 1.4, 0, 0.6, 0x9c6644, 'stump'),
    rock(21, 14, 2.6, 1.6),
    rock(-22, -6, 2.2, 1.4),
    box(8, 13, 3, 1.6, 0, 1.4, 0xa47148, 'log'),
  ],
  movables: [mov(-8, 6, 1.6, 1.6, 1.2, 0xc8a165), mov(8, 4, 1.8, 1.3, 1.0, 0x48cae4, 'basket'), mov(-18, -14, 1.6, 1.6, 1.2, 0xc8a165), mov(18, -11, 1.6, 1.6, 1.2, 0xc8a165), mov(2, 16, 1.8, 1.3, 1.0, 0xe63946, 'basket'), mov(-23, 11, 1.6, 1.6, 1.2, 0xc8a165)],
  decor: [
    { type: 'rug', x: 0, z: 0, w: 11, d: 11, c: 0x9c8462, round: true },
    { type: 'rug', x: 0, z: 10, w: 2.4, d: 20, c: 0xc8b48f },
    { type: 'fire', x: 0, z: 0, y: 0.35 },
    ...CAMP_TREES.map(([x, z]) => leaves(x, z, 4.6, 3)),
  ],
  spawns: [
    [-24.5, -11, Math.PI * 0.5],
    [24.5, -11, -Math.PI * 0.5],
    [-24.5, 15, Math.PI * 0.75],
    [24.5, 18, -Math.PI * 0.75],
    [-8, -18, 0],
    [6, -18, 0],
    [-11, 18.5, Math.PI],
    [10, 18.5, Math.PI],
    [-6, -6, Math.PI * 0.25],
    [8, -2, -Math.PI * 0.5],
  ],
  items: [
    [-2, -12, 3.25], // 見張り台の上
    [-15, 7, 0], // テーブルの下
    [0, -6, 0],
    [-6, 4, 0],
    [6, 7, 0],
    [-21.2, -2.04, 1.35], // 高台の上
    [19, 2, 0],
    [12, -14, 0],
    [-12, 16, 0],
    [22, -6, 0],
    [-4, -16, 0],
  ],
});

export const ARENAS = [PARK, BEACH, CAMP];


/** 点 (x, z) が箱の水平の範囲に、太さ r で重なるか */
export const overlapXZ = (b, x, z, r) => x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1;

/**
 * 線分 a → b（3D）が、最初に何かに当たる割合 t（0〜1）。当たらなければ 1。
 * 当たったものは out に { t, nx, ny, nz }（当たった面の向き）。床・壁・天井・箱
 */
export function segmentHit(arena, ax, ay, az, bx, by, bz, r = 0, out = null) {
  // Rust（WebAssembly）が使えればそちらで（collide.js）。結果は下の JavaScript と同じ
  let t = wasmSegmentHit(arena.boxes, ROOM.W, ROOM.D, ax, ay, az, bx, by, bz, r, out, arena.floorY || 0);
  if (t === null) t = segmentHitJs(arena, ax, ay, az, bx, by, bz, r, out);
  // 丘・くぼみ（箱・柵より手前で当たれば、そちら）
  if (arena.terrain?.length) {
    const tt = terrainHit(arena, ax, ay, az, bx, by, bz, r, t, out ? terOut : null);
    if (tt < t) {
      t = tt;
      if (out) Object.assign(out, terOut);
    }
  }
  return t;
}
const terOut = { t: 1, nx: 0, ny: 1, nz: 0 };

/** segmentHit の JavaScript 版（Rust 版と同じ計算） */
export function segmentHitJs(arena, ax, ay, az, bx, by, bz, r = 0, out = null) {
  let best = 1;
  let n = [0, 0, 0];
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  // 床・壁
  const planes = [
    [dy, (arena.floorY || 0) + r - ay, 0, 1, 0, -1], // 床 y = r（下向きに越える。くぼみがあれば、いちばん深い所）
    [dx, -ROOM.W / 2 + r - ax, 1, 0, 0, -1],
    [dx, ROOM.W / 2 - r - ax, -1, 0, 0, 1],
    [dz, -ROOM.D / 2 + r - az, 0, 0, 1, -1],
    [dz, ROOM.D / 2 - r - az, 0, 0, -1, 1],
  ];
  for (const [d, dist, nx, ny, nz, sign] of planes) {
    if (d * sign <= 0) continue; // 離れる向き
    const t = dist / d;
    if (t >= 0 && t < best) {
      best = t;
      n = [nx, ny, nz];
    }
  }
  // 箱（太さ r だけ広げた箱と線分のスラブ法）
  for (const b of arena.boxes) {
    let t0 = 0;
    let t1 = best;
    let hitN = null;
    let ok = true;
    for (let ax2 = 0; ax2 < 3 && ok; ax2++) {
      const o = ax2 === 0 ? ax : ax2 === 1 ? ay : az;
      const d = ax2 === 0 ? dx : ax2 === 1 ? dy : dz;
      const lo = (ax2 === 0 ? b.x0 : ax2 === 1 ? b.y0 : b.z0) - r;
      const hi = (ax2 === 0 ? b.x1 : ax2 === 1 ? b.y1 : b.z1) + r;
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) ok = false;
        continue;
      }
      let ta = (lo - o) / d;
      let tb = (hi - o) / d;
      let sgn = -1;
      if (ta > tb) {
        [ta, tb] = [tb, ta];
        sgn = 1;
      }
      if (ta > t0) {
        t0 = ta;
        hitN = [0, 0, 0];
        hitN[ax2] = sgn;
      }
      if (tb < t1) t1 = tb;
      if (t0 > t1) ok = false;
    }
    if (ok && hitN && t0 < best) {
      best = t0;
      n = hitN;
    }
  }
  if (out) {
    out.t = best;
    [out.nx, out.ny, out.nz] = n;
  }
  return best;
}

/** a から b が見通せるか（家具や壁にさえぎられないか） */
export function canSee(arena, ax, ay, az, bx, by, bz) {
  return segmentHit(arena, ax, ay, az, bx, by, bz) >= 0.999;
}
