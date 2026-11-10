// 会場（犬から見た人間の家）。ラウンドごとに リビング → 子供部屋 → 台所。
// 家具は「箱」の集まりで、当たり判定も見た目もこの箱から作る。
// 箱: { x0, x1, z0, z1, y0, y1, c: 色, k: 見た目の種類 }。y0 > 0 の箱（テーブルの天板など）は下をくぐれる

/** 部屋の広さ（x: -W/2〜W/2、z: -D/2〜D/2）。前の 4 倍の広さ（縦横 2 倍） */
export const ROOM = { W: 52, D: 40, WALL: 9 };

/** 中心 (cx, cz)・幅 w・奥行き d・下の高さ y0・高さ h の箱 */
function box(cx, cz, w, d, y0, h, c, k = 'wood') {
  return { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0, y1: y0 + h, c, k };
}

/** 天板と 4 本の脚のテーブル（天板の下は高さ top まで空いている） */
function table(cx, cz, w, d, top, c, leg = 0.3, thick = 0.18, k = 'wood') {
  const out = [box(cx, cz, w, d, top, thick, c, k)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box(cx + sx * (w / 2 - leg), cz + sz * (d / 2 - leg), leg, leg, 0, top, c, k));
  return out;
}

/** いす（座面の下は伏せでくぐれる）。back: 背もたれの側（'n' = z の -、's' = z の +、'w' = x の -、'e' = x の +） */
function chair(cx, cz, s, seat, c, back = 's') {
  const out = table(cx, cz, s, s, seat, c, 0.2, 0.15);
  const t = 0.2;
  const h = 1.5;
  if (back === 'n' || back === 's') out.push(box(cx, cz + (back === 's' ? 1 : -1) * (s / 2 - t / 2), s, t, seat + 0.15, h, c));
  else out.push(box(cx + (back === 'e' ? 1 : -1) * (s / 2 - t / 2), cz, t, s, seat + 0.15, h, c));
  return out;
}

/** ソファ（座面・背もたれ・ひじ掛け）。back: 背もたれの側（'n' / 's' / 'w' / 'e'） */
function sofa(cx, cz, w, d, c, back = 'n') {
  const k = 'fabric';
  if (back === 'n' || back === 's') {
    const sg = back === 'n' ? -1 : 1;
    return [
      box(cx, cz, w, d, 0, 0.9, c, k),
      box(cx, cz + sg * (d / 2 - 0.4), w, 0.8, 0.9, 1.4, c, k),
      box(cx - w / 2 + 0.35, cz - sg * 0.2, 0.7, d - 0.4, 0.9, 0.6, c, k),
      box(cx + w / 2 - 0.35, cz - sg * 0.2, 0.7, d - 0.4, 0.9, 0.6, c, k),
    ];
  }
  const sg = back === 'w' ? -1 : 1;
  return [
    box(cx, cz, w, d, 0, 0.9, c, k),
    box(cx + sg * (w / 2 - 0.4), cz, 0.8, d, 0.9, 1.4, c, k),
    box(cx - sg * 0.2, cz - d / 2 + 0.35, w - 0.4, 0.7, 0.9, 0.6, c, k),
    box(cx - sg * 0.2, cz + d / 2 - 0.35, w - 0.4, 0.7, 0.9, 0.6, c, k),
  ];
}

/** 積み木のかたまり（2 段目つき） */
function blocks(cx, cz, c1, c2, c3) {
  return [box(cx, cz, 1.4, 1.4, 0, 1.4, c1, 'toy'), box(cx + 1.5, cz + 0.2, 1.4, 1.4, 0, 1.4, c2, 'toy'), box(cx + 0.75, cz + 0.1, 1.4, 1.4, 1.4, 1.4, c3, 'toy')];
}

/**
 * 体当たりで押して動かせるもの（段ボール・洗濯かご・おもちゃの車など）。{ x, z, w, d, h, c, k }
 * 位置は試合の状態に入る（ラウンドの始めにここへ戻る）
 */
const mov = (x, z, w, d, h, c, k = 'cardboard') => ({ x, z, w, d, h, c, k });

const LIVING = {
  id: 'living',
  name: 'リビング',
  floor: 0xc99a6b, // フローリング
  floorK: 'wood',
  wall: 0xf3e6cf,
  boxes: [
    // 大きなソファ（北の壁ぎわ）と、西のソファ
    ...sofa(0, -16.6, 13, 3.4, 0x6f8fc9, 'n'),
    box(-3.5, -16.8, 1.8, 1.4, 0.9, 0.55, 0xffd166, 'cushion'),
    box(3.8, -16.8, 1.8, 1.4, 0.9, 0.55, 0xef476f, 'cushion'),
    ...sofa(-21, -4, 3.4, 10, 0x8ecae6, 'w'),
    // ローテーブル（伏せればくぐれる）
    ...table(0, -8, 8, 4, 0.8, 0x9c6b3f),
    // テレビ台とテレビ（南の壁ぎわ）
    box(0, 18.6, 11, 2, 0, 1.1, 0x5b4636),
    box(0, 19.3, 8, 0.4, 1.1, 3.8, 0x222831, 'tv'),
    // ひとりがけのいす 2 つ
    box(-12, 9, 3, 3, 0, 0.9, 0xb5838d, 'fabric'),
    box(-13.3, 9, 0.6, 3, 0.9, 1.5, 0xb5838d, 'fabric'),
    box(12, 9, 3, 3, 0, 0.9, 0xb5838d, 'fabric'),
    box(13.3, 9, 0.6, 3, 0.9, 1.5, 0xb5838d, 'fabric'),
    // 食卓といす（東）
    ...table(16, -10, 9, 5, 1.7, 0xa0522d),
    ...chair(13, -14.3, 1.9, 0.95, 0xdda15e, 'n'),
    ...chair(19, -14.3, 1.9, 0.95, 0xdda15e, 'n'),
    ...chair(13, -5.7, 1.9, 0.95, 0xdda15e, 's'),
    ...chair(19, -5.7, 1.9, 0.95, 0xdda15e, 's'),
    // 床のクッション（ひょいと乗れる）
    box(6, 2, 2, 2, 0, 0.45, 0x06d6a0, 'cushion'),
    box(-6, 3, 2, 2, 0, 0.45, 0xffd166, 'cushion'),
    box(3, 11, 2, 2, 0, 0.45, 0xef476f, 'cushion'),
    box(22, 2, 2, 2, 0, 0.45, 0x06d6a0, 'cushion'),
    // 本棚（高い）・植木鉢
    box(-25.2, 10, 1.6, 7, 0, 5, 0x7a5230),
    box(25.2, 12, 1.6, 6, 0, 5, 0x7a5230),
    box(24, -18, 2, 2, 0, 1.8, 0xd17a4a, 'pot'),
    box(-24, 18, 2, 2, 0, 1.8, 0xd17a4a, 'pot'),
    // 犬のベッド（低い。歩いて乗れる）・おもちゃ箱
    box(-16, 17, 3.2, 2.6, 0, 0.3, 0x8ecae6, 'bed'),
    box(18, 16, 3, 2, 0, 1.3, 0xf4a261, 'toy'),
  ],
  movables: [mov(8, 6, 1.8, 1.8, 1.3, 0xc8a165), mov(-8, -2, 1.8, 1.8, 1.3, 0xc8a165), mov(-2, 14, 2.2, 1.6, 1.0, 0xa8dadc, 'basket'), mov(8, -2, 1.6, 1.6, 1.1, 0xc8a165), mov(-14, 1, 1.8, 1.8, 1.3, 0xc8a165)],
  decor: [
    { type: 'rug', x: 0, z: 0, w: 20, d: 14, c: 0xe9c46a },
    { type: 'window', wall: 'n', x: -14, y: 4, w: 6, h: 4 },
    { type: 'window', wall: 'n', x: 14, y: 4, w: 6, h: 4 },
    { type: 'frame', wall: 'e', z: -2, y: 4.5, w: 4, h: 3, c: 0x2a9d8f },
    { type: 'frame', wall: 's', x: 14, y: 4.5, w: 3, h: 3, c: 0xe76f51 },
    { type: 'leaves', x: 24, z: -18, y: 1.8, r: 2 },
    { type: 'leaves', x: -24, z: 18, y: 1.8, r: 2 },
  ],
  spawns: [
    [-23, -17, Math.PI * 0.25],
    [22, -17, -Math.PI * 0.25],
    [-23, 15, Math.PI * 0.75],
    [23, 7, -Math.PI * 0.6],
    [-6, 15, Math.PI],
    [8, 16, Math.PI],
    [-9, -10, 0],
    [7, -12, 0],
    [24, -3, -Math.PI * 0.5],
    [-16, -14, Math.PI * 0.3],
  ],
  // アイテムの箱（x, z, 高さ y）。テーブルの下・いすの上にもある
  items: [
    [0, -8, 0],
    [-12, 9.2, 0.9],
    [12, 9.2, 0.9],
    [16, -10, 0],
    [22, -16, 0],
    [-22, 16, 0],
    [0, 4, 0],
    [-21, -4, 0.9],
    [6, 16, 0],
  ],
};

const KIDS = {
  id: 'kids',
  name: '子供部屋',
  floor: 0xa8dadc, // カーペット
  floorK: 'carpet',
  wall: 0xfff1e6,
  boxes: [
    // ベッド（マットレスに乗れる）とヘッドボード・まくら
    box(14, -14, 10, 8, 0, 1.15, 0xffafcc, 'bed'),
    box(14, -18.6, 10, 0.8, 0, 3.2, 0xcdb4db),
    box(11, -16.5, 2.4, 1.4, 1.15, 0.5, 0xffffff, 'cushion'),
    box(17, -16.5, 2.4, 1.4, 1.15, 0.5, 0xffffff, 'cushion'),
    // 勉強机といす
    ...table(-16, -17, 7, 3, 1.6, 0xb08968),
    ...chair(-16, -12.8, 2, 0.95, 0x90be6d, 's'),
    // 積み木（積んであるところもある）
    ...blocks(-6, -5, 0xe63946, 0x457b9d, 0xffb703),
    ...blocks(6, 6, 0x2a9d8f, 0xe76f51, 0x8338ec),
    ...blocks(-12, 8, 0xffb703, 0x3a86ff, 0xe63946),
    ...blocks(2, -13, 0x06d6a0, 0xff006e, 0xffbe0b),
    box(17, 4, 1.4, 1.4, 0, 1.4, 0x8338ec, 'toy'),
    // 大きなボール
    box(-21, 1, 2.8, 2.8, 0, 2.8, 0xf94144, 'ball'),
    box(21, 12, 2.2, 2.2, 0, 2.2, 0x4cc9f0, 'ball'),
    // おもちゃのトンネル（伏せてくぐる）: 東西向きと南北向き
    box(0, 13, 10, 0.25, 0, 0.8, 0x4cc9f0, 'toy'),
    box(0, 15.2, 10, 0.25, 0, 0.8, 0x4cc9f0, 'toy'),
    box(0, 14.1, 10, 2.45, 0.65, 0.2, 0x4361ee, 'toy'),
    box(-15, -3, 0.25, 8, 0, 0.8, 0xf72585, 'toy'),
    box(-12.8, -3, 0.25, 8, 0, 0.8, 0xf72585, 'toy'),
    box(-13.9, -3, 2.45, 8, 0.65, 0.2, 0xb5179e, 'toy'),
    // 人形の家（大きくて高い）
    box(-19, 14, 5, 4, 0, 3.4, 0xffc8dd, 'toy'),
    // おもちゃ箱・本棚・たんす
    box(21, 17, 5, 2.6, 0, 1.3, 0xf4a261, 'toy'),
    box(-25.2, -6, 1.6, 6, 0, 4.5, 0x9c6644),
    box(25.2, -1, 1.6, 7, 0, 7, 0xddb892),
  ],
  movables: [mov(0, 0, 1.8, 1.8, 1.2, 0xffbe0b, 'toybox'), mov(10, -4, 1.8, 1.8, 1.3, 0xc8a165), mov(-8, 13, 1.8, 1.8, 1.2, 0x90e0ef, 'toybox'), mov(18, -2, 1.8, 1.8, 1.3, 0xc8a165), mov(-4, 4, 1.6, 1.6, 1.0, 0xc8a165)],
  decor: [
    { type: 'rug', x: 1, z: 1, w: 16, d: 14, c: 0xffd6a5, round: true },
    { type: 'window', wall: 'n', x: -4, y: 4.5, w: 6, h: 4 },
    { type: 'frame', wall: 'w', z: 8, y: 4.5, w: 4, h: 3, c: 0xff006e },
    { type: 'frame', wall: 's', x: 10, y: 4.5, w: 3.5, h: 3.5, c: 0x3a86ff },
    { type: 'frame', wall: 'e', z: 12, y: 4.5, w: 3, h: 3, c: 0x8ac926 },
  ],
  spawns: [
    [-23, -17, Math.PI * 0.25],
    [23, -6, -Math.PI * 0.5],
    [-23, 17, Math.PI * 0.75],
    [23, 7, -Math.PI * 0.6],
    [-6, 17, Math.PI],
    [8, 17, Math.PI],
    [0, -6, 0],
    [8, -6, 0],
    [-9, -15, Math.PI * 0.5],
    [-20, 6, Math.PI * 0.5],
  ],
  items: [
    [0, 14.1, 0], // トンネルの中
    [-13.9, -3, 0], // もう 1 つのトンネルの中
    [14, -13, 1.15], // ベッドの上
    [-16, -17, 0], // 机の下
    [-3, 2, 0],
    [12, 2, 0],
    [22, 8, 0],
    [-22, 8, 0],
    [8, 12, 0],
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
    box(2, -18.6, 30, 2.8, 0, 3.6, 0xf1faee, 'counter'),
    box(-22, -17.5, 4, 4.2, 0, 8, 0xdee2e6, 'fridge'),
    // まんなかの作業台（高い。隠れられる）
    box(-2, -7, 12, 3, 0, 3.4, 0xf1faee, 'counter'),
    // 食卓（立ったままくぐれる）
    ...table(4, 7, 11, 6, 1.7, 0xbc6c25),
    // いす（座面の下は伏せでくぐれる）
    ...chair(0, 3, 2, 0.95, 0xdda15e, 'n'),
    ...chair(8, 3, 2, 0.95, 0xdda15e, 'n'),
    ...chair(0, 11, 2, 0.95, 0xdda15e, 's'),
    ...chair(8, 11, 2, 0.95, 0xdda15e, 's'),
    ...chair(-2.6, 7, 2, 0.95, 0xdda15e, 'w'),
    ...chair(10.6, 7, 2, 0.95, 0xdda15e, 'e'),
    // ゴミ箱・キッチンワゴン・棚
    box(23.5, 17.5, 2, 2, 0, 2.6, 0x6c757d, 'metal'),
    box(-16, 10, 4, 2, 0, 2.2, 0xadb5bd, 'metal'),
    box(25.2, 4, 1.6, 8, 0, 4.5, 0xb08968),
    // 積んだ段ボール（動かない）
    box(18, -6, 2.4, 2.2, 0, 1.3, 0xc8a165, 'cardboard'),
    box(18.4, -6, 1.8, 1.6, 1.3, 1.1, 0xc8a165, 'cardboard'),
    // 犬の食器（低い。乗れる）
    box(-6, 18, 1.4, 1.4, 0, 0.3, 0xe63946, 'bowl'),
    box(-4, 18, 1.4, 1.4, 0, 0.3, 0x457b9d, 'bowl'),
  ],
  movables: [mov(-18, 0, 2, 2, 1.3, 0xc8a165), mov(14, 14, 2, 2, 1.3, 0xc8a165), mov(-8, 2, 1.8, 1.8, 1.2, 0xc8a165), mov(16, 2, 2, 1.6, 1.0, 0xa8dadc, 'basket'), mov(-10, -14, 1.8, 1.8, 1.2, 0xc8a165)],
  decor: [
    { type: 'rug', x: 4, z: 7, w: 15, d: 10, c: 0xccd5ae },
    { type: 'window', wall: 'n', x: 4, y: 5.5, w: 7, h: 3 },
    { type: 'frame', wall: 'e', z: -10, y: 4.5, w: 3, h: 3, c: 0xfb8500 },
    { type: 'clock', wall: 's', x: -10, y: 5.5, r: 1.4 },
  ],
  spawns: [
    [-23, -5, Math.PI * 0.5],
    [23, -16, -Math.PI * 0.25],
    [-23, 17, Math.PI * 0.75],
    [22, 11, -Math.PI * 0.5],
    [6, 17, Math.PI],
    [-10, -12, 0],
    [4, 7, 0], // 食卓の下
    [14, -14, 0],
    [-8, 15, Math.PI],
    [10, -2, 0],
  ],
  items: [
    [4, 7, 0], // 食卓の下
    [18.2, -6, 2.4], // 段ボールの上
    [23, -12, 0],
    [-23, 4, 0],
    [17, 17, 0],
    [-2, -12, 0],
    [-12, -2, 0],
    [8, -3, 0],
    [-16, 16, 0],
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
