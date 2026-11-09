// 会場（犬から見た人間の家）。ラウンドごとに リビング → 子供部屋 → 台所。
// 家具は「箱」の集まりで、当たり判定も見た目もこの箱から作る。
// 箱: { x0, x1, z0, z1, y0, y1, c: 色, k: 見た目の種類 }。y0 > 0 の箱（テーブルの天板など）は下をくぐれる

/** 部屋の広さ（x: -W/2〜W/2、z: -D/2〜D/2） */
export const ROOM = { W: 26, D: 20, WALL: 7 };

/** 中心 (cx, cz)・幅 w・奥行き d・下の高さ y0・高さ h の箱 */
function box(cx, cz, w, d, y0, h, c, k = 'wood') {
  return { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0, y1: y0 + h, c, k };
}

/** 天板と 4 本の脚のテーブル（天板の下は高さ top まで空いている） */
function table(cx, cz, w, d, top, c, leg = 0.28, thick = 0.16, k = 'wood') {
  const out = [box(cx, cz, w, d, top, thick, c, k)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box(cx + sx * (w / 2 - leg), cz + sz * (d / 2 - leg), leg, leg, 0, top, c, k));
  return out;
}

/** いす（座面の下はくぐれる。背もたれは z の + か - 側） */
function chair(cx, cz, s, seat, c, back = 1) {
  const out = table(cx, cz, s, s, seat, c, 0.2, 0.15);
  out.push(box(cx, cz + back * (s / 2 - 0.1), s, 0.2, seat + 0.15, 1.5, c));
  return out;
}

/** ソファ（座面・背もたれ・ひじ掛け）。背もたれは z の - 側 */
function sofa(cx, cz, w, d, c) {
  return [
    box(cx, cz, w, d, 0, 0.9, c, 'fabric'),
    box(cx, cz - d / 2 + 0.35, w, 0.7, 0.9, 1.3, c, 'fabric'),
    box(cx - w / 2 + 0.3, cz + 0.2, 0.6, d - 0.4, 0.9, 0.55, c, 'fabric'),
    box(cx + w / 2 - 0.3, cz + 0.2, 0.6, d - 0.4, 0.9, 0.55, c, 'fabric'),
  ];
}

const LIVING = {
  id: 'living',
  name: 'リビング',
  floor: 0xc99a6b, // フローリング
  floorK: 'wood',
  wall: 0xf3e6cf,
  boxes: [
    ...sofa(0, -7.6, 8, 2.6, 0x6f8fc9),
    // ソファの上のクッション
    box(-2.2, -7.4, 1.4, 1.2, 0.9, 0.5, 0xffd166, 'cushion'),
    box(2.4, -7.4, 1.4, 1.2, 0.9, 0.5, 0xef476f, 'cushion'),
    // ローテーブル（伏せればくぐれる）
    ...table(0, -1.8, 5, 2.6, 0.8, 0x9c6b3f),
    // テレビ台とテレビ
    box(0, 8.8, 7, 1.6, 0, 1.1, 0x5b4636),
    box(0, 9.2, 5, 0.35, 1.1, 2.6, 0x222831, 'tv'),
    // ひとりがけのいす
    box(-8.5, 2.5, 2.6, 2.6, 0, 0.9, 0xb5838d, 'fabric'),
    box(-9.6, 2.5, 0.5, 2.6, 0.9, 1.5, 0xb5838d, 'fabric'),
    // 床のクッション（ひょいと乗れる）
    box(6.5, 0.5, 1.8, 1.8, 0, 0.45, 0x06d6a0, 'cushion'),
    box(9, -3.5, 1.8, 1.8, 0, 0.45, 0xffd166, 'cushion'),
    box(4.5, 4.5, 1.6, 1.6, 0, 0.45, 0xef476f, 'cushion'),
    // 本棚（高い）
    box(-12, -5, 1.6, 5, 0, 4.5, 0x7a5230),
    // 観葉植物の鉢
    box(11, 7.5, 1.6, 1.6, 0, 1.6, 0xd17a4a, 'pot'),
    // 犬のベッド（低い。歩いて乗れる）
    box(-7, 7, 2.6, 2.2, 0, 0.3, 0x8ecae6, 'bed'),
    // おもちゃ箱
    box(9.5, 3.5, 2, 1.4, 0, 1.2, 0xf4a261, 'toy'),
  ],
  decor: [
    { type: 'rug', x: 0, z: 0, w: 12, d: 8, c: 0xe9c46a },
    { type: 'window', wall: 'n', x: -7, y: 3, w: 4, h: 3 },
    { type: 'window', wall: 'n', x: 7, y: 3, w: 4, h: 3 },
    { type: 'frame', wall: 'e', z: -2, y: 3.5, w: 3, h: 2, c: 0x2a9d8f },
    { type: 'leaves', x: 11, z: 7.5, y: 1.6, r: 1.6 },
  ],
  spawns: [
    [-11, -8.5, Math.PI * 0.25],
    [11, -8.5, -Math.PI * 0.25],
    [-11, 8.5, Math.PI * 0.75],
    [11, 5.5, -Math.PI * 0.75],
    [-4, 6, Math.PI],
    [5, -4, 0],
    [-5, -4.5, 0],
    [6, 7, Math.PI],
  ],
  // アイテムの箱（x, z, 高さ y）。テーブルの下・いすの上にもある
  items: [
    [0, -1.8, 0],
    [-8.2, 2.7, 0.9],
    [11, -8, 0],
    [-11, 8, 0],
    [5, 8.2, 0],
  ],
};

const KIDS = {
  id: 'kids',
  name: '子供部屋',
  floor: 0xa8dadc, // カーペット
  floorK: 'carpet',
  wall: 0xfff1e6,
  boxes: [
    // ベッド（マットレスに乗れる）とヘッドボード
    box(7, -6, 7, 6, 0, 1.15, 0xffafcc, 'bed'),
    box(7, -9.3, 7, 0.6, 0, 3, 0xcdb4db),
    box(5.5, -7.8, 2, 1.2, 1.15, 0.45, 0xffffff, 'cushion'),
    // 勉強机といす
    ...table(-8, -7.8, 5, 2.4, 1.6, 0xb08968),
    ...chair(-8, -4.8, 1.8, 0.95, 0x90be6d, 1),
    // 積み木（積んであるところもある）
    box(-3, -2, 1.3, 1.3, 0, 1.3, 0xe63946, 'toy'),
    box(-3, -2, 1.3, 1.3, 1.3, 1.3, 0x457b9d, 'toy'),
    box(-1.6, -2.2, 1.3, 1.3, 0, 1.3, 0xffb703, 'toy'),
    box(3.5, 3, 1.3, 1.3, 0, 1.3, 0x2a9d8f, 'toy'),
    box(5, 3.4, 1.3, 1.3, 0, 1.3, 0xe76f51, 'toy'),
    box(4.2, 3.2, 1.3, 1.3, 1.3, 1.3, 0x8338ec, 'toy'),
    box(-6, 5, 1.3, 1.3, 0, 1.3, 0xffb703, 'toy'),
    // 大きなボール
    box(-9.5, 1.5, 2, 2, 0, 2, 0xf94144, 'ball'),
    // おもちゃのトンネル（伏せてくぐる）
    box(0, 6, 5, 0.25, 0, 0.8, 0x4cc9f0, 'toy'),
    box(0, 7.8, 5, 0.25, 0, 0.8, 0x4cc9f0, 'toy'),
    box(0, 6.9, 5, 2.05, 0.65, 0.2, 0x4361ee, 'toy'),
    // おもちゃ箱・本棚・たんす
    box(10, 6, 3.2, 2.2, 0, 1.3, 0xf4a261, 'toy'),
    box(-12.2, -1.5, 1.4, 4, 0, 3.6, 0x9c6644),
    box(12.2, 0.5, 1.4, 3.5, 0, 5.5, 0xddb892),
  ],
  decor: [
    { type: 'rug', x: 1, z: 1, w: 9, d: 7, c: 0xffd6a5, round: true },
    { type: 'window', wall: 'n', x: -2, y: 3.2, w: 4, h: 3 },
    { type: 'frame', wall: 'w', z: 5, y: 3.5, w: 3, h: 2.2, c: 0xff006e },
    { type: 'frame', wall: 's', x: 6, y: 3.5, w: 2.5, h: 2.5, c: 0x3a86ff },
  ],
  spawns: [
    [-11, -9, Math.PI * 0.25],
    [11, -2.5, -Math.PI * 0.5],
    [-11, 8.5, Math.PI * 0.75],
    [11, 8.7, -Math.PI * 0.75],
    [-4, 8.5, Math.PI],
    [0, -6, 0],
    [7, -2, Math.PI],
    [-6, -1, Math.PI * 0.5],
  ],
  items: [
    [0, 6.9, 0], // トンネルの中
    [7, -5.5, 1.15], // ベッドの上
    [-8, -7.8, 0], // 机の下
    [-3, 2, 0],
    [8, 1, 0],
  ],
};

const KITCHEN = {
  id: 'kitchen',
  name: '台所',
  floor: 0xe5e5e5, // タイル
  floorK: 'tile',
  wall: 0xe9f5db,
  boxes: [
    // 流し台（犬には高い）と冷蔵庫
    box(1, -9, 16, 2.4, 0, 3.6, 0xf1faee, 'counter'),
    box(-11, -8.2, 3.4, 3.4, 0, 7, 0xdee2e6, 'fridge'),
    // 食卓（立ったままくぐれる）
    ...table(2, 1, 8, 4.4, 1.7, 0xbc6c25),
    // いす（座面の下は伏せでくぐれる）
    ...chair(-0.5, -2.2, 1.8, 0.95, 0xdda15e, -1),
    ...chair(4.5, -2.2, 1.8, 0.95, 0xdda15e, -1),
    ...chair(-0.5, 4.2, 1.8, 0.95, 0xdda15e, 1),
    ...chair(4.5, 4.2, 1.8, 0.95, 0xdda15e, 1),
    // ゴミ箱・キッチンワゴン・段ボール
    box(11, 7.5, 1.6, 1.6, 0, 2.2, 0x6c757d, 'metal'),
    box(-7, 6, 3, 1.6, 0, 2, 0xadb5bd, 'metal'),
    box(9, -3, 2.2, 2, 0, 1.2, 0xc8a165, 'cardboard'),
    box(9.4, -3, 1.6, 1.4, 1.2, 1, 0xc8a165, 'cardboard'),
    box(-9, 0, 2, 2, 0, 1.1, 0xc8a165, 'cardboard'),
    // 犬の食器（低い。乗れる）
    box(-3, 8, 1.2, 1.2, 0, 0.3, 0xe63946, 'bowl'),
    box(-1.4, 8, 1.2, 1.2, 0, 0.3, 0x457b9d, 'bowl'),
  ],
  decor: [
    { type: 'rug', x: 2, z: 1, w: 11, d: 7.5, c: 0xccd5ae },
    { type: 'window', wall: 'n', x: 1, y: 4.5, w: 5, h: 2.2 },
    { type: 'frame', wall: 'e', z: 2, y: 3.6, w: 2, h: 2, c: 0xfb8500 },
    { type: 'clock', wall: 's', x: -5, y: 4.2, r: 1 },
  ],
  spawns: [
    [-11, -4, Math.PI * 0.5],
    [11.5, -8, -Math.PI * 0.25],
    [-11, 8.5, Math.PI * 0.75],
    [11, 4, -Math.PI * 0.5],
    [6, 8.5, Math.PI],
    [-4, -6.5, 0],
    [2, 1, 0], // 食卓の下
    [7, -6.5, 0],
  ],
  items: [
    [2, 1, 0], // 食卓の下
    [-9, 0, 1.1], // 段ボールの上
    [11.5, -6, 0],
    [-11, 3.5, 0],
    [7.5, 8.2, 0],
  ],
};

export const ARENAS = [LIVING, KIDS, KITCHEN];

/** 点 (x, z) が箱の水平の範囲に、太さ r で重なるか */
export const overlapXZ = (b, x, z, r) => x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1;

/**
 * 線分 a → b（3D）が、最初に何かに当たる割合 t（0〜1）。当たらなければ 1。
 * 当たったものは out に { t, nx, ny, nz }（当たった面の向き）。床・壁・天井・箱
 */
export function segmentHit(arena, ax, ay, az, bx, by, bz, r = 0, out = null) {
  let best = 1;
  let n = [0, 0, 0];
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  // 床・壁
  const planes = [
    [dy, r - ay, 0, 1, 0, -1], // 床 y = r（下向きに越える）
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
