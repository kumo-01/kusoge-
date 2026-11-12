// 会場（犬から見た人間の家）。ラウンドごとに リビング → 子供部屋 → 台所。
// 家具は「箱」の集まりで、当たり判定も見た目もこの箱から作る。
// 箱: { x0, x1, z0, z1, y0, y1, c: 色, k: 見た目の種類 }。y0 > 0 の箱（テーブルの天板など）は下をくぐれる
//
// 広さ: 下の配置は「52 × 40 の部屋」の座標で書き、SCALE 倍に広げて使う（家具の大きさはそのまま、置き場所だけ離れる）。

/** 配置を広げる倍率（1.225 倍 × 1.225 倍 = 広さ 1.5 倍） */
export const SCALE = 1.225;

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

/** ソファ（座面・背もたれ・ひじ掛け）。back: 背もたれの側（'n' / 's' / 'w' / 'e'） */
function sofa(cx, cz, w, d, c, back = 'n') {
  const k = 'fabric';
  return grp(cx, cz, () => {
    if (back === 'n' || back === 's') {
      const sg = back === 'n' ? -1 : 1;
      return [
        box(0, 0, w, d, 0, 0.9, c, k),
        box(0, sg * (d / 2 - 0.4), w, 0.8, 0.9, 1.4, c, k),
        box(-w / 2 + 0.35, -sg * 0.2, 0.7, d - 0.4, 0.9, 0.6, c, k),
        box(w / 2 - 0.35, -sg * 0.2, 0.7, d - 0.4, 0.9, 0.6, c, k),
      ];
    }
    const sg = back === 'w' ? -1 : 1;
    return [
      box(0, 0, w, d, 0, 0.9, c, k),
      box(sg * (w / 2 - 0.4), 0, 0.8, d, 0.9, 1.4, c, k),
      box(-sg * 0.2, -d / 2 + 0.35, w - 0.4, 0.7, 0.9, 0.6, c, k),
      box(-sg * 0.2, d / 2 - 0.35, w - 0.4, 0.7, 0.9, 0.6, c, k),
    ];
  });
}

/** ひとりがけのいす（背もたれは west / east） */
function armchair(cx, cz, c, back = 'w') {
  const sg = back === 'w' ? -1 : 1;
  return grp(cx, cz, () => [box(0, 0, 3, 3, 0, 0.9, c, 'fabric'), box(sg * 1.3, 0, 0.6, 3, 0.9, 1.5, c, 'fabric')]);
}

/** 積み木のかたまり（2 段目つき） */
function blocks(cx, cz, c1, c2, c3) {
  return grp(cx, cz, () => [box(0, 0, 1.4, 1.4, 0, 1.4, c1, 'toy'), box(1.5, 0.2, 1.4, 1.4, 0, 1.4, c2, 'toy'), box(0.75, 0.1, 1.4, 1.4, 1.4, 1.4, c3, 'toy')]);
}

/** おもちゃのトンネル（伏せてくぐる）。ns: 南北向き */
function tunnel(cx, cz, len, c1, c2, ns = false) {
  return grp(cx, cz, () =>
    ns
      ? [box(-1.1, 0, 0.25, len, 0, 0.8, c1, 'toy'), box(1.1, 0, 0.25, len, 0, 0.8, c1, 'toy'), box(0, 0, 2.45, len, 0.65, 0.2, c2, 'toy')]
      : [box(0, -1.1, len, 0.25, 0, 0.8, c1, 'toy'), box(0, 1.1, len, 0.25, 0, 0.8, c1, 'toy'), box(0, 0, len, 2.45, 0.65, 0.2, c2, 'toy')],
  );
}

/**
 * 体当たりで押して動かせるもの（段ボール・洗濯かご・おもちゃの車など）。{ x, z, w, d, h, c, k }
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
    ...(d.type === 'rug' ? { w: d.w * SCALE, d: d.d * SCALE } : {}),
  }));
  return a;
}

const LIVING = spread({
  id: 'living',
  name: 'リビング',
  floor: 0xc99a6b, // フローリング
  floorK: 'wood',
  wall: 0xf3e6cf,
  boxes: [
    // 大きなソファ（北の壁ぎわ）とクッション、西のソファ
    ...grp(0, -16.6, () => [...sofa(0, 0, 13, 3.4, 0x6f8fc9, 'n'), box(-3.5, -0.2, 1.8, 1.4, 0.9, 0.55, 0xffd166, 'cushion'), box(3.8, -0.2, 1.8, 1.4, 0.9, 0.55, 0xef476f, 'cushion')]),
    ...sofa(-21, -4, 3.4, 10, 0x8ecae6, 'w'),
    // ローテーブル（伏せればくぐれる）
    ...table(0, -8, 8, 4, 0.8, 0x9c6b3f),
    // テレビ台とテレビ（南の壁ぎわ）
    ...grp(0, 19, () => [box(0, 0, 11, 2, 0, 1.1, 0x5b4636), box(0, 0.7, 8, 0.4, 1.1, 3.8, 0x222831, 'tv')]),
    // ひとりがけのいす 2 つ
    ...armchair(-12, 9, 0xb5838d, 'w'),
    ...armchair(12, 9, 0xb5838d, 'e'),
    // 食卓といす（東）
    ...grp(16, -10, () => [
      ...table(0, 0, 9, 5, 1.7, 0xa0522d),
      ...chair(-3, -4.3, 1.9, 0.95, 0xdda15e, 'n'),
      ...chair(3, -4.3, 1.9, 0.95, 0xdda15e, 'n'),
      ...chair(-3, 4.3, 1.9, 0.95, 0xdda15e, 's'),
      ...chair(3, 4.3, 1.9, 0.95, 0xdda15e, 's'),
    ]),
    // 床のクッション（歩いて乗れる）
    box(6, 2, 2, 2, 0, 0.45, 0x06d6a0, 'cushion'),
    box(-6, 3, 2, 2, 0, 0.45, 0xffd166, 'cushion'),
    box(3, 11, 2, 2, 0, 0.45, 0xef476f, 'cushion'),
    box(22, 2, 2, 2, 0, 0.45, 0x06d6a0, 'cushion'),
    box(-10, -12, 2, 2, 0, 0.45, 0xef476f, 'cushion'),
    // 本棚（高い）・植木鉢
    box(-25.3, 10, 1.6, 7, 0, 5, 0x7a5230),
    box(25.3, 12, 1.6, 6, 0, 5, 0x7a5230),
    box(24, -18, 2, 2, 0, 1.8, 0xd17a4a, 'pot'),
    box(-24, 18, 2, 2, 0, 1.8, 0xd17a4a, 'pot'),
    // 犬のベッド（低い。歩いて乗れる）・おもちゃ箱
    box(-16, 17, 3.2, 2.6, 0, 0.3, 0x8ecae6, 'bed'),
    box(18, 16, 3, 2, 0, 1.3, 0xf4a261, 'toy'),
    // 広くなった分の隠れ場所: 段ボールの山・観葉植物
    ...grp(-6, -14, () => [box(0, 0, 2.4, 2.2, 0, 1.3, 0xc8a165, 'cardboard'), box(0.3, 0, 1.8, 1.6, 1.3, 1.1, 0xc8a165, 'cardboard')]),
    box(9, -14, 2, 2, 0, 1.8, 0xd17a4a, 'pot'),
  ],
  movables: [mov(8, 6, 1.8, 1.8, 1.3, 0xc8a165), mov(-8, -2, 1.8, 1.8, 1.3, 0xc8a165), mov(-2, 14, 2.2, 1.6, 1.0, 0xa8dadc, 'basket'), mov(8, -2, 1.6, 1.6, 1.1, 0xc8a165), mov(-14, 1, 1.8, 1.8, 1.3, 0xc8a165), mov(16, 4, 1.8, 1.8, 1.3, 0xc8a165)],
  decor: [
    { type: 'rug', x: 0, z: 0, w: 20, d: 14, c: 0xe9c46a },
    { type: 'window', wall: 'n', x: -14, y: 4, w: 6, h: 4 },
    { type: 'window', wall: 'n', x: 14, y: 4, w: 6, h: 4 },
    { type: 'frame', wall: 'e', z: -2, y: 4.5, w: 4, h: 3, c: 0x2a9d8f },
    { type: 'frame', wall: 's', x: 14, y: 4.5, w: 3, h: 3, c: 0xe76f51 },
    { type: 'leaves', x: 24, z: -18, y: 1.8, r: 2 },
    { type: 'leaves', x: -24, z: 18, y: 1.8, r: 2 },
    { type: 'leaves', x: 9, z: -14, y: 1.8, r: 2 },
  ],
  spawns: [
    [-23, -17, Math.PI * 0.25],
    [22, -17, -Math.PI * 0.25],
    [-23, 15, Math.PI * 0.75],
    [23, 7, -Math.PI * 0.6],
    [-6, 15, Math.PI],
    [8, 16, Math.PI],
    [-9, -8, 0],
    [5, -12, 0],
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
    [-14, 4, 0],
    [14, 0, 0],
  ],
});

const KIDS = spread({
  id: 'kids',
  name: '子供部屋',
  floor: 0xa8dadc, // カーペット
  floorK: 'carpet',
  wall: 0xfff1e6,
  boxes: [
    // ベッド（マットレスに乗れる）とヘッドボード・まくら
    ...grp(14, -14, () => [box(0, 0, 10, 8, 0, 1.15, 0xffafcc, 'bed'), box(0, -4.6, 10, 0.8, 0, 3.2, 0xcdb4db), box(-3, -2.5, 2.4, 1.4, 1.15, 0.5, 0xffffff, 'cushion'), box(3, -2.5, 2.4, 1.4, 1.15, 0.5, 0xffffff, 'cushion')]),
    // 勉強机といす
    ...grp(-16, -17, () => [...table(0, 0, 7, 3, 1.6, 0xb08968), ...chair(0, 4.2, 2, 0.95, 0x90be6d, 's')]),
    // 積み木（積んであるところもある）
    ...blocks(-6, -5, 0xe63946, 0x457b9d, 0xffb703),
    ...blocks(6, 6, 0x2a9d8f, 0xe76f51, 0x8338ec),
    ...blocks(-12, 8, 0xffb703, 0x3a86ff, 0xe63946),
    ...blocks(2, -13, 0x06d6a0, 0xff006e, 0xffbe0b),
    ...blocks(14, 10, 0xff006e, 0x8ac926, 0x3a86ff),
    box(17, 4, 1.4, 1.4, 0, 1.4, 0x8338ec, 'toy'),
    // 大きなボール
    box(-21, 1, 2.8, 2.8, 0, 2.8, 0xf94144, 'ball'),
    box(21, 12, 2.2, 2.2, 0, 2.2, 0x4cc9f0, 'ball'),
    box(8, -4, 2, 2, 0, 2, 0xffbe0b, 'ball'),
    // おもちゃのトンネル（伏せてくぐる）: 東西向きと南北向き
    ...tunnel(0, 14.1, 10, 0x4cc9f0, 0x4361ee),
    ...tunnel(-13.9, -3, 8, 0xf72585, 0xb5179e, true),
    // 人形の家（大きくて高い）
    box(-19, 14, 5, 4, 0, 3.4, 0xffc8dd, 'toy'),
    // おもちゃ箱・本棚・たんす
    box(21, 17.5, 5, 2.6, 0, 1.3, 0xf4a261, 'toy'),
    box(-25.3, -6, 1.6, 6, 0, 4.5, 0x9c6644),
    box(25.3, -1, 1.6, 7, 0, 7, 0xddb892),
  ],
  movables: [mov(0, 0, 1.8, 1.8, 1.2, 0xffbe0b, 'toybox'), mov(10, -4, 1.8, 1.8, 1.3, 0xc8a165), mov(-8, 13, 1.8, 1.8, 1.2, 0x90e0ef, 'toybox'), mov(18, -2, 1.8, 1.8, 1.3, 0xc8a165), mov(-4, 4, 1.6, 1.6, 1.0, 0xc8a165), mov(-20, -12, 1.8, 1.8, 1.2, 0xffbe0b, 'toybox')],
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
    [0, -7, 0],
    [12, -6, 0],
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
    [-6, -11, 0],
    [4, -8, 0],
  ],
});

const KITCHEN = spread({
  id: 'kitchen',
  name: '台所',
  floor: 0xe5e5e5, // タイル
  floorK: 'tile',
  wall: 0xe9f5db,
  boxes: [
    // 流し台（犬には高い）と冷蔵庫（北の壁ぎわ）
    box(2, -18.8, 30, 2.8, 0, 3.6, 0xf1faee, 'counter'),
    box(-22, -17.9, 4, 4.2, 0, 8, 0xdee2e6, 'fridge'),
    // まんなかの作業台（高い。隠れられる）
    box(-2, -7, 12, 3, 0, 3.4, 0xf1faee, 'counter'),
    // 食卓といす（食卓は立ったままくぐれる。いすの座面の下は伏せでくぐれる）
    ...grp(4, 7, () => [
      ...table(0, 0, 11, 6, 1.7, 0xbc6c25),
      ...chair(-4, -4, 2, 0.95, 0xdda15e, 'n'),
      ...chair(4, -4, 2, 0.95, 0xdda15e, 'n'),
      ...chair(-4, 4, 2, 0.95, 0xdda15e, 's'),
      ...chair(4, 4, 2, 0.95, 0xdda15e, 's'),
      ...chair(-6.6, 0, 2, 0.95, 0xdda15e, 'w'),
      ...chair(6.6, 0, 2, 0.95, 0xdda15e, 'e'),
    ]),
    // ゴミ箱・キッチンワゴン・棚
    box(23.5, 17.5, 2, 2, 0, 2.6, 0x6c757d, 'metal'),
    box(-16, 10, 4, 2, 0, 2.2, 0xadb5bd, 'metal'),
    box(25.3, 4, 1.6, 8, 0, 4.5, 0xb08968),
    // 積んだ段ボール（動かない）
    ...grp(18, -6, () => [box(0, 0, 2.4, 2.2, 0, 1.3, 0xc8a165, 'cardboard'), box(0.4, 0, 1.8, 1.6, 1.3, 1.1, 0xc8a165, 'cardboard')]),
    ...grp(-20, -6, () => [box(0, 0, 2.2, 2.4, 0, 1.3, 0xc8a165, 'cardboard'), box(0, 0.3, 1.6, 1.8, 1.3, 1.1, 0xc8a165, 'cardboard')]),
    // 野菜のかご（低い。乗れる）
    box(12, -12, 3, 2, 0, 0.9, 0x9c6644, 'basket'),
    // 犬の食器（低い。乗れる）
    box(-6, 18, 1.4, 1.4, 0, 0.3, 0xe63946, 'bowl'),
    box(-4, 18, 1.4, 1.4, 0, 0.3, 0x457b9d, 'bowl'),
  ],
  movables: [mov(-18, 0, 2, 2, 1.3, 0xc8a165), mov(14, 14, 2, 2, 1.3, 0xc8a165), mov(-8, 2, 1.8, 1.8, 1.2, 0xc8a165), mov(16, 2, 2, 1.6, 1.0, 0xa8dadc, 'basket'), mov(-10, -14, 1.8, 1.8, 1.2, 0xc8a165), mov(20, 10, 1.8, 1.8, 1.2, 0xc8a165)],
  decor: [
    { type: 'rug', x: 4, z: 7, w: 15, d: 10, c: 0xccd5ae },
    { type: 'window', wall: 'n', x: 4, y: 5.5, w: 7, h: 3 },
    { type: 'frame', wall: 'e', z: -10, y: 4.5, w: 3, h: 3, c: 0xfb8500 },
    { type: 'clock', wall: 's', x: -10, y: 5.5, r: 1.4 },
  ],
  spawns: [
    [-23, -2, Math.PI * 0.5],
    [23, -16, -Math.PI * 0.25],
    [-23, 17, Math.PI * 0.75],
    [22, 11, -Math.PI * 0.5],
    [6, 17, Math.PI],
    [-10, -12, 0],
    [4, 7, 0], // 食卓の下
    [14, -15, 0],
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
    [12, -12, 0.9], // 野菜のかごの上
    [-20, 3, 0],
  ],
});

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
