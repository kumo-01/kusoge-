// 会場（犬から見た屋外）。ラウンドごとに 公園 → 砂浜 → キャンプ場。まわりは柵（越えられない）。
// 家具は「箱」の集まりで、当たり判定も見た目もこの箱から作る。
// 箱: { x0, x1, z0, z1, y0, y1, c: 色, k: 見た目の種類 }。y0 > 0 の箱（テーブルの天板など）は下をくぐれる
//
// 広さ: 下の配置は「52 × 40 の部屋」の座標で書き、SCALE 倍に広げて使う（家具の大きさはそのまま、置き場所だけ離れる）。

import { wasmSegmentHit } from './collide.js';
import { GIMMICK } from './constants.js';

/**
 * 配置を広げる倍率。2026-11-13 に 1.5 倍、さらに広さ（面積）を 2 倍に（縦横それぞれ √2 倍。52 × 40 の部屋の 4.5 倍の広さ。約 110 × 85 m）
 */
export const SCALE = 1.5 * Math.SQRT2;

/** 部屋の広さ（x: -W/2〜W/2、z: -D/2〜D/2） */
/** CEIL: 見えない天井の高さ（雲より少し上。まわりの見えない壁と同じく、輪ゴム・爆弾・犬は越えられない） */
export const ROOM = { W: 52 * SCALE, D: 40 * SCALE, WALL: 9, CEIL: 38 };


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
  // 障害物 10 種（街灯・ドラム缶・コンテナ・土管・タイヤの山・干し草ロール・自動販売機・石垣・物置小屋・木箱の山）
  a.boxes = [...a.boxes, ...placeObstacles(a, a.obstacles || OBSTACLES)];
  // ワープ土管（2 本で 1 組。低いので歩いて乗れる）
  a.pipes = [];
  const pipeSpots = freeSpots(a, GIMMICK.WARP_PAIRS * 2, { R: 2, inner: 0.9, gap: 5, minR: 12 }); // 真ん中の広場は空けておく
  for (let k = 0; k + 1 < pipeSpots.length; k += 2) {
    const [ax, az] = pipeSpots[k];
    const [bx, bz] = pipeSpots[k + 1];
    const A = { ...box(0, 0, 1.7, 1.7, 0, 0.42, 0x2fbf4a, 'warp'), pair: a.pipes.length };
    const B = { ...box(0, 0, 1.7, 1.7, 0, 0.42, 0x2fbf4a, 'warp'), pair: a.pipes.length };
    for (const [o, x, z] of [[A, ax, az], [B, bx, bz]]) Object.assign(o, { x0: x - 0.85, x1: x + 0.85, z0: z - 0.85, z1: z + 0.85 });
    A.warp = { x: bx, z: bz };
    B.warp = { x: ax, z: az };
    a.pipes.push({ a: [ax, az], b: [bx, bz] });
    a.boxes.push(A, B);
  }
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
  // 加速パネル（平らな地面に。向きは会場の真ん中へ）・間欠泉
  const flat = (list) => list.filter(([x, z]) => Math.abs(groundY(a, x, z)) < 1e-9 && a.terrain.every((f) => Math.hypot(f.x - x, f.z - z) > f.r + 2));
  a.pads = flat(freeSpots(a, GIMMICK.PADS + 6, { R: 1.8, gap: 4, minR: 10 })).slice(0, GIMMICK.PADS).map(([x, z]) => ({ x, z, yaw: Math.atan2(-x, -z) }));
  a.geysers = flat(freeSpots(a, GIMMICK.GEYSERS + 6, { R: 1.8, avoid: a.pads.map((p) => [p.x, p.z]), gap: 4, minR: 10 }))
    .slice(0, GIMMICK.GEYSERS)
    .map(([x, z]) => ({ x, z }));
  // 地面に置くものの高さは、地形に合わせる
  const onGround = ([x, z, y]) => [x, z, y + groundY(a, x, z)];
  a.items = a.items.map(([x, z, y]) => (y === 0 ? onGround([x, z, 0]) : [x, z, y]));
  const gim = [...a.pads.map((p) => [p.x, p.z]), ...a.geysers.map((g) => [g.x, g.z])];
  a.heals = freeSpots(a, 8, { avoid: gim }).map(onGround);
  // 補給箱が落ちてくる所（おやつ・トランポリンを避けた空いた所）
  a.drops = freeSpots(a, 10, { R: 1.6, avoid: [...a.heals, ...gim] }).map(onGround);
  // 風船の的（空中。地面からの高さは 2.2〜3.6 で決まった順）
  a.balloons = freeSpots(a, 6, { R: 1.4, inner: 0.85, avoid: [...a.heals, ...a.drops] }).map(([x, z], k) => [x, z, 2.2 + ((k * 0.53) % 1.4) + groundY(a, x, z)]);
  // 水（入ると遅くなる）
  a.water = (a.decor || []).filter((d) => d.type === 'water').map((d) => ({ x0: d.x - d.w / 2, x1: d.x + d.w / 2, z0: d.z - d.d / 2, z1: d.z + d.d / 2 }));
  return a;
}

/**
 * 四角（x0, x1, z0, z1）の置き場所の索引（8 m のますに分けて、近くのものだけ調べる）。
 * 会場づくりで「ここに置けるか」を何十万回も調べるので、全部の箱を毎回見ると 1 秒以上かかっていた
 */
class RectIndex {
  constructor(cell = 8) {
    this.cell = cell;
    this.map = new Map();
    this.n = 0;
  }
  add(b) {
    const c = this.cell;
    const tag = this.n++;
    for (let i = Math.floor(b.x0 / c); i <= Math.floor(b.x1 / c); i++) {
      for (let j = Math.floor(b.z0 / c); j <= Math.floor(b.z1 / c); j++) {
        const k = i * 4096 + j;
        let l = this.map.get(k);
        if (!l) this.map.set(k, (l = []));
        l.push(b);
      }
    }
    return tag;
  }
  /** 範囲に重なる四角があるか（test があれば、それも満たすもの） */
  any(x0, x1, z0, z1, test = null) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const l = this.map.get(i * 4096 + j);
        if (!l) continue;
        for (let n = 0; n < l.length; n++) {
          const b = l[n];
          if (x1 > b.x0 && x0 < b.x1 && z1 > b.z0 && z0 < b.z1 && (!test || test(b))) return true;
        }
      }
    }
    return false;
  }
}
/** a.boxes の索引（箱が増えたら作り直す） */
function boxIndex(a) {
  if (a._bi && a._biN === a.boxes.length) return a._bi;
  const ix = new RectIndex();
  for (const b of a.boxes) ix.add(b);
  a._bi = ix;
  a._biN = a.boxes.length;
  return ix;
}

/**
 * 障害物 10 種（2026-11-13）。{ k: 種類, w, d, h, n: 数, c: 色 }。置き場所は placeObstacles が決める（毎回同じ）
 */
const OBSTACLES = [
  { k: 'lamp', w: 0.34, d: 0.34, h: 4.6, n: 16, c: 0x3d4148 }, // 街灯（夜は明かりがつく）
  { k: 'drum', w: 0.95, d: 0.95, h: 1.25, n: 8, c: 0x2a6f97 }, // ドラム缶
  { k: 'container', w: 6.2, d: 2.5, h: 2.7, n: 3, c: 0xc44536 }, // コンテナ
  { k: 'pipe', w: 4.2, d: 2.2, h: 2.2, n: 3, c: 0xa8a8a8 }, // 土管（中を通れる）
  { k: 'tires', w: 1.5, d: 1.5, h: 1.15, n: 5, c: 0x2b2b2b }, // タイヤの山
  { k: 'hay', w: 1.7, d: 1.9, h: 1.7, n: 4, c: 0xe9c46a }, // 干し草ロール
  { k: 'vending', w: 1.2, d: 0.95, h: 2.0, n: 3, c: 0xf1f3f5 }, // 自動販売機
  { k: 'wall', w: 6.5, d: 0.8, h: 1.05, n: 5, c: 0x9a9184 }, // 石垣（伏せると隠れる）
  { k: 'shed', w: 3.4, d: 2.6, h: 2.6, n: 2, c: 0x8d6e63 }, // 物置小屋
  { k: 'crates', w: 2.4, d: 1.3, h: 2.1, n: 4, c: 0xb08968 }, // 木箱の山
];
export const OBSTACLE_KINDS = OBSTACLES.map((o) => o.k);

/**
 * 障害物を空いた所に置く。家具・押せるもの・道・水・出発地点・アイテムの箱から離し、障害物どうしもできるだけ離す。
 * 向きは 1 つおきに縦横を入れかえる
 */
function placeObstacles(a, list) {
  const placed = [];
  const out = [];
  const rugs = (a.decor || []).filter((d) => d.type === 'rug' || d.type === 'water').map((r) => ({ type: r.type, x0: r.x - r.w / 2, x1: r.x + r.w / 2, z0: r.z - r.d / 2, z1: r.z + r.d / 2 }));
  const movs = (a.movables || []).map((m) => ({ x0: m.x - m.w / 2 - 1, x1: m.x + m.w / 2 + 1, z0: m.z - m.d / 2 - 1, z1: m.z + m.d / 2 + 1 }));
  const pts = [...a.spawns, ...a.items];
  const bi = boxIndex(a);
  const oi = new RectIndex();
  const staticOk = new Map();
  let seq = 0;
  for (const o of list) {
    for (let i = 0; i < o.n; i++) {
      const turn = (seq++ % 2 === 1) !== (o.k === 'wall' && i % 2 === 0);
      const w = turn ? o.d : o.w;
      const d = turn ? o.w : o.d;
      const M = o.k === 'lamp' ? 0.6 : 1.4; // まわりに空ける幅
      // 動かないもの（家具・押せるもの・道・水・出発地点・箱）に重ならない場所は、大きさごとに 1 回だけ調べて覚えておく
      const key = `${w}|${d}|${M}|${o.k === 'lamp' ? 1 : 0}`;
      let cands = staticOk.get(key);
      if (!cands) {
        cands = [];
        for (let x = -ROOM.W / 2 + w / 2 + 2.5; x <= ROOM.W / 2 - w / 2 - 2.5; x += 1.5) {
          for (let z = -ROOM.D / 2 + d / 2 + 2.5; z <= ROOM.D / 2 - d / 2 - 2.5; z += 1.5) {
            if (Math.hypot(x, z) < 12) continue; // 真ん中の広場は空けておく
            const x0 = x - w / 2 - M;
            const x1 = x + w / 2 + M;
            const z0 = z - d / 2 - M;
            const z1 = z + d / 2 + M;
            if (bi.any(x0, x1, z0, z1)) continue;
            let bad = false;
            for (let n = 0; n < movs.length && !bad; n++) {
              const b = movs[n];
              bad = x1 > b.x0 && x0 < b.x1 && z1 > b.z0 && z0 < b.z1;
            }
            for (let n = 0; n < rugs.length && !bad; n++) {
              const b = rugs[n];
              if (o.k === 'lamp' && b.type !== 'water') continue; // 街灯は道の上にも立てる（水の中はだめ）
              bad = x1 > b.x0 && x0 < b.x1 && z1 > b.z0 && z0 < b.z1;
            }
            for (let n = 0; n < pts.length && !bad; n++) {
              const px = pts[n][0];
              const pz = pts[n][1];
              bad = px > x0 - 1.6 && px < x1 + 1.6 && pz > z0 - 1.6 && pz < z1 + 1.6;
            }
            if (!bad) cands.push(x, z);
          }
        }
        staticOk.set(key, cands);
      }
      let best = null;
      let bd = -1;
      for (let c = 0; c < cands.length; c += 2) {
        {
          const x = cands[c];
          const z = cands[c + 1];
          if (oi.any(x - w / 2 - M, x + w / 2 + M, z - d / 2 - M, z + d / 2 + M)) continue;
          // 同じ種類からは遠く、ほかの障害物からもなるべく遠く
          // （距離は 2 乗のまま比べて、最後に平方根。Math.hypot は遅く、ブラウザによって最後のけたが違うことがある）
          let sSame = Infinity;
          let sAll = Infinity;
          for (let n = 0; n < placed.length; n++) {
            const q = placed[n];
            const dd = (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z);
            if (dd < sAll) sAll = dd;
            if (q.k === o.k && dd < sSame) sSame = dd;
          }
          const dAll = placed.length ? Math.sqrt(sAll) : 100;
          const dSame = sSame === Infinity ? 200 - Math.sqrt(x * x + z * z) * 0.5 : Math.sqrt(sSame);
          const score = dSame + Math.min(dAll, 12) * 0.8;
          if (score > bd) {
            bd = score;
            best = [x, z];
          }
        }
      }
      if (!best) continue;
      const [x, z] = best;
      placed.push({ k: o.k, x, z });
      const nb = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: 0, y1: o.h, c: o.c, k: o.k };
      out.push(nb);
      oi.add(nb);
    }
  }
  return out;
}

/**
 * 空いた地面の場所を n か所（毎回同じ）。家具・押せるもの・水に重ならない、出発地点・アイテムの箱・avoid から 3 以上離れた所を、
 * できるだけ離して選ぶ（1 つ目は真ん中にいちばん近い所、そのあとは選んだ所からいちばん遠い所）。
 * R: 空けておく半径、inner: 会場の真ん中寄りだけ（幅・奥行きのこの割合の中）
 */
function freeSpots(a, n, { R = 1.1, inner = 1, avoid = [], gap = 3, minR = 0 } = {}) {
  const bi = boxIndex(a);
  const low = (b) => b.y0 < 1.6;
  const blocked = (x, z) =>
    bi.any(x - R, x + R, z - R, z + R, low) ||
    (a.movables || []).some((m) => Math.abs(x - m.x) < m.w / 2 + R + 0.5 && Math.abs(z - m.z) < m.d / 2 + R + 0.5) ||
    (a.decor || []).some((d) => d.type === 'water' && Math.abs(x - d.x) < d.w / 2 + R && Math.abs(z - d.z) < d.d / 2 + R); // 水の上には置かない
  const near = (x, z, list, d) => {
    for (let k = 0; k < list.length; k++) {
      const dx = list[k][0] - x;
      const dz = list[k][1] - z;
      if (dx * dx + dz * dz < d * d) return true;
    }
    return false;
  };
  const cand = [];
  for (let x = -ROOM.W / 2 + 3; x <= ROOM.W / 2 - 3; x += 2) {
    for (let z = -ROOM.D / 2 + 3; z <= ROOM.D / 2 - 3; z += 2) {
      if (Math.abs(x) > (ROOM.W / 2) * inner || Math.abs(z) > (ROOM.D / 2) * inner || Math.hypot(x, z) < minR) continue;
      if (!blocked(x, z) && !near(x, z, a.spawns, gap) && !near(x, z, a.items, 3) && !near(x, z, avoid, 3)) cand.push([x, z]);
    }
  }
  const out = [];
  let first = cand[0];
  for (const c of cand) if (Math.hypot(c[0], c[1]) < Math.hypot(first[0], first[1])) first = c;
  if (first) out.push(first);
  // いちばん近い選んだ所までの距離を、候補ごとに覚えておく（選ぶたびに全部計算し直さない）
  const near1 = new Float64Array(cand.length).fill(Infinity);
  const upd = (p) => {
    for (let k = 0; k < cand.length; k++) {
      const dx = p[0] - cand[k][0];
      const dz = p[1] - cand[k][1];
      const d = dx * dx + dz * dz; // 2 乗のまま比べる
      if (d < near1[k]) near1[k] = d;
    }
  };
  if (first) upd(first);
  while (out.length < n && out.length < cand.length) {
    let best = null;
    let bd = -1;
    for (let k = 0; k < cand.length; k++) {
      if (near1[k] > bd) {
        bd = near1[k];
        best = cand[k];
      }
    }
    upd(best);
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
  const bi = boxIndex(a);
  const out = [];
  for (const [r, h] of KINDS) {
    let best = null;
    let bd = -1;
    for (let x = -ROOM.W / 2 + r + 2; x <= ROOM.W / 2 - r - 2; x += 1.5) {
      for (let z = -ROOM.D / 2 + r + 2; z <= ROOM.D / 2 - r - 2; z += 1.5) {
        const rr = r + 0.8;
        if (bi.any(x - rr, x + rr, z - rr, z + rr, (b) => boxDist(b, x, z) < rr)) continue;
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

const TG = 4; // 地形の升目の大きさ（m）
const tGrids = new WeakMap();
/** 丘・くぼみの升目の索引（地形ごとに 1 回だけ作る） */
function terrainGrid(T) {
  let G = tGrids.get(T);
  if (G) return G;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const f of T) {
    x0 = Math.min(x0, f.x - f.r);
    x1 = Math.max(x1, f.x + f.r);
    z0 = Math.min(z0, f.z - f.r);
    z1 = Math.max(z1, f.z + f.r);
  }
  const nx = Math.max(1, Math.ceil((x1 - x0) / TG));
  const nz = Math.max(1, Math.ceil((z1 - z0) / TG));
  const cells = Array.from({ length: nx * nz }, () => []);
  for (const f of T) {
    const i0 = Math.max(0, Math.floor((f.x - f.r - x0) / TG));
    const i1 = Math.min(nx - 1, Math.floor((f.x + f.r - x0) / TG));
    const j0 = Math.max(0, Math.floor((f.z - f.r - z0) / TG));
    const j1 = Math.min(nz - 1, Math.floor((f.z + f.r - z0) / TG));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * nx + i].push(f);
  }
  G = { x0, z0, nx, nz, cells };
  tGrids.set(T, G);
  return G;
}

/** 地面の高さ（丘・くぼみ。何もない所は 0） */
export function groundY(a, x, z) {
  const T = a.terrain;
  if (!T || !T.length) return 0;
  // その場所の升目にかかる丘・くぼみだけを見る（並びは元のまま。かからないものは足しても 0 なので、結果は同じ）
  const G = terrainGrid(T);
  const cx = Math.floor((x - G.x0) / TG);
  const cz = Math.floor((z - G.z0) / TG);
  if (cx < 0 || cz < 0 || cx >= G.nx || cz >= G.nz) return 0;
  const L = G.cells[cz * G.nx + cx];
  let y = 0;
  for (let k = 0; k < L.length; k++) {
    const f = L[k];
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

const nearT = [];

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
  // この線分の通る範囲にかかる丘・くぼみだけを先に選んでおく（全部の丘を毎回見ない。結果は同じ）
  const T = a.terrain;
  const x0 = Math.min(ax, ax + dx * tmax);
  const x1 = Math.max(ax, ax + dx * tmax);
  const z0 = Math.min(az, az + dz * tmax);
  const z1 = Math.max(az, az + dz * tmax);
  let nf = 0;
  for (let k = 0; k < T.length; k++) {
    const g = T[k];
    if (g.x + g.r <= x0 || g.x - g.r >= x1 || g.z + g.r <= z0 || g.z - g.r >= z1) continue;
    nearT[nf++] = g;
  }
  if (nf === 0 && Math.min(ay, ay + dy * tmax) - r > 1e-6) return 1; // 近くは平らな地面（高さ 0）で、その上を通るだけ
  const gy = (x, z) => {
    let y = 0;
    for (let k = 0; k < nf; k++) {
      const g = nearT[k];
      const ex = x - g.x;
      const ez = z - g.z;
      const d2 = ex * ex + ez * ez;
      if (d2 >= g.r * g.r) continue;
      y += (g.h * (1 + Math.cos((Math.PI * Math.sqrt(d2)) / g.r))) / 2;
    }
    return y;
  };
  const f = (t) => ay + dy * t - r - gy(ax + dx * t, az + dz * t);
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
    case 'pipe': {
      // 寝かせた土管: 左右の壁と天井（中は立ったまま通れる。床は地面）
      const along = w >= d;
      const len = (along ? w : d) / 2;
      const R = (along ? d : w) / 2;
      const t = 0.28;
      const side = (s) => (along ? part(len, t / 2, b.y0, b.y0 + h * 0.75, 0) : part(t / 2, len, b.y0, b.y0 + h * 0.75));
      const out = [];
      for (const sg of [-1, 1]) {
        const p = side(sg);
        if (along) {
          p.z0 += sg * (R - t / 2);
          p.z1 += sg * (R - t / 2);
        } else {
          p.x0 += sg * (R - t / 2);
          p.x1 += sg * (R - t / 2);
        }
        out.push(p);
      }
      out.push(along ? part(len, R, b.y1 - 0.45, b.y1) : part(R, len, b.y1 - 0.45, b.y1));
      return out;
    }
    case 'shed':
      // 物置小屋: 箱と、少し小さい屋根
      return [part(w / 2, d / 2, b.y0, b.y0 + h * 0.8), part(w / 2 + 0.15, d * 0.3, b.y0 + h * 0.8, b.y1)];
    case 'crates':
      // 木箱の山: 下に 2 つ、上に 1 つ（片側に寄せる）
      return w >= d
        ? [part(w / 2, d / 2, b.y0, b.y0 + h / 2), part(w / 4, d / 2, b.y0 + h / 2, b.y1, -w / 4)]
        : [part(w / 2, d / 2, b.y0, b.y0 + h / 2), { ...part(w / 2, d / 4, b.y0 + h / 2, b.y1), z0: cz - d / 2, z1: cz }];
    case 'hay': {
      // 干し草ロール（寝かせた太い円柱）
      const along = w >= d;
      const r = Math.min(along ? d : w, h) / 2;
      const len = (along ? w : d) / 2;
      const mk = (ha, hb) => (along ? part(len, ha, cy - hb, cy + hb) : part(ha, len, cy - hb, cy + hb));
      return [mk(r, r * 0.7), mk(r * 0.7, r)];
    }
    case 'drum':
    case 'tires':
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
const PARK = () => spread({
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
const BEACH = () => spread({
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
const CAMP = () => spread({
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

/**
 * 会場（公園・砂浜・キャンプ場）。作るのに少し時間がかかるので、はじめて使うときに作る（ゲームの始まりに 3 つ分まとめて固まらないように）
 */
export const ARENAS = [];
[PARK, BEACH, CAMP].forEach((make, i) => {
  let v = null;
  Object.defineProperty(ARENAS, i, { get: () => (v ||= make()), enumerable: true, configurable: true });
});


/** 点 (x, z) が箱の水平の範囲に、太さ r で重なるか */
export const overlapXZ = (b, x, z, r) => x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1;

// ---- 高さの地図 ----
// 会場を 2 m のますに分けて、ますごとに「ここより上には何もない」高さを覚えておく
// （動かない箱の上の面と、丘の高さの上限。箱は輪ゴムの太さの分だけ広げて数える）。
// 線分がその高さより上だけを通り、壁・天井・押せるものにも届かないなら、当たらないと決まる。
const SKY = 2;
const SKY_R = 0.6; // これより太い線分は地図を使わない
const skyMaps = new WeakMap();
function skyMap(world) {
  const boxes = world.boxes;
  let m = skyMaps.get(boxes);
  if (m && m.n === boxes.length && m.T === world.terrain) return m;
  const nx = Math.ceil(ROOM.W / SKY);
  const nz = Math.ceil(ROOM.D / SKY);
  const h = new Float64Array(nx * nz);
  const mv = [];
  const ci = (v, half, n) => Math.max(0, Math.min(n - 1, Math.floor((v + half) / SKY)));
  for (const b of boxes) {
    if (b.mv) {
      mv.push(b);
      continue;
    }
    const i0 = ci(b.x0 - SKY_R, ROOM.W / 2, nx);
    const i1 = ci(b.x1 + SKY_R, ROOM.W / 2, nx);
    const j0 = ci(b.z0 - SKY_R, ROOM.D / 2, nz);
    const j1 = ci(b.z1 + SKY_R, ROOM.D / 2, nz);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (b.y1 > h[i * nz + j]) h[i * nz + j] = b.y1;
  }
  // 丘: ますにかかる丘の高さを全部足したもの（本当の地面はこれ以下）
  if (world.terrain?.length) {
    const g = new Float64Array(nx * nz);
    for (const f of world.terrain) {
      if (!(f.h > 0)) continue;
      const i0 = ci(f.x - f.r, ROOM.W / 2, nx);
      const i1 = ci(f.x + f.r, ROOM.W / 2, nx);
      const j0 = ci(f.z - f.r, ROOM.D / 2, nz);
      const j1 = ci(f.z + f.r, ROOM.D / 2, nz);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) g[i * nz + j] += f.h;
    }
    for (let k = 0; k < h.length; k++) if (g[k] > h[k]) h[k] = g[k];
  }
  m = { n: boxes.length, T: world.terrain, nx, nz, h, mv };
  skyMaps.set(boxes, m);
  return m;
}
/** 線分 a → b（太さ r）が、何にも当たらないと先に分かるか（分からないときは false。細かい計算へ） */
function skyFree(world, ax, ay, az, bx, by, bz, r) {
  if (r > SKY_R) return false;
  const x0 = (ax < bx ? ax : bx) - r;
  const x1 = (ax < bx ? bx : ax) + r;
  const z0 = (az < bz ? az : bz) - r;
  const z1 = (az < bz ? bz : az) + r;
  const y0 = (ay < by ? ay : by) - r;
  const y1 = (ay < by ? by : ay) + r;
  const E = 1e-6;
  // 壁・天井・床に届かない（NaN もここで細かい計算へ回る）
  if (!(x0 > -ROOM.W / 2 + E && x1 < ROOM.W / 2 - E && z0 > -ROOM.D / 2 + E && z1 < ROOM.D / 2 - E && y1 < ROOM.CEIL - E && y0 > E)) return false;
  const m = skyMap(world);
  const i0 = Math.floor((x0 + ROOM.W / 2) / SKY);
  const i1 = Math.floor((x1 + ROOM.W / 2) / SKY);
  const j0 = Math.floor((z0 + ROOM.D / 2) / SKY);
  const j1 = Math.floor((z1 + ROOM.D / 2) / SKY);
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > 24) return false; // 長い線分（見通しの確認など）は細かい計算の方が速い
  if (i0 < 0 || j0 < 0 || i1 >= m.nx || j1 >= m.nz) return false;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (m.h[i * m.nz + j] + E >= y0) return false;
  // 押せるもの（動くので、毎回その場所で見る）
  for (let k = 0; k < m.mv.length; k++) {
    const b = m.mv[k];
    if (b.x0 <= x1 && b.x1 >= x0 && b.z0 <= z1 && b.z1 >= z0 && b.y0 <= y1 && b.y1 >= y0) return false;
  }
  return true;
}

/**
 * 線分 a → b（3D）が、最初に何かに当たる割合 t（0〜1）。当たらなければ 1。
 * 当たったものは out に { t, nx, ny, nz }（当たった面の向き）。床・壁・天井・箱
 */
export function segmentHit(arena, ax, ay, az, bx, by, bz, r = 0, out = null) {
  // 何もない空中を飛んでいるだけなら、細かい計算はしない（高さの地図で先に見分ける。結果は同じ）
  if (skyFree(arena, ax, ay, az, bx, by, bz, r)) {
    if (out) {
      out.t = 1;
      out.nx = out.ny = out.nz = 0;
    }
    return 1;
  }
  // Rust（WebAssembly）が使えればそちらで（collide.js）。結果は下の JavaScript と同じ
  let t = wasmSegmentHit(arena.boxes, ROOM.W, ROOM.D, ax, ay, az, bx, by, bz, r, out, arena.floorY || 0, ROOM.CEIL);
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
    [dy, ROOM.CEIL - r - ay, 0, -1, 0, 1], // 見えない天井（上向きに越える）
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
  // 線分を囲む箱（太さ r こみ）。これに重ならない箱は、下の計算をしても当たらないので飛ばす（Rust 版と同じ）
  const sx0 = (ax < bx ? ax : bx) - r;
  const sx1 = (ax < bx ? bx : ax) + r;
  const sy0 = (ay < by ? ay : by) - r;
  const sy1 = (ay < by ? by : ay) + r;
  const sz0 = (az < bz ? az : bz) - r;
  const sz1 = (az < bz ? bz : az) + r;
  for (const b of arena.boxes) {
    if (b.x0 > sx1 || b.x1 < sx0 || b.z0 > sz1 || b.z1 < sz0 || b.y0 > sy1 || b.y1 < sy0) continue;
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
