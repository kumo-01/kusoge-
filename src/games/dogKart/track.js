// コースの形状（純粋な計算のみ。描画は world.js）
// 制御点を Catmull-Rom 曲線でつなぎ、弧長で等間隔に並べ直した閉じたポリラインとして扱う。

import { RACE, PAD } from './constants.js';

// コース一覧（すべて反時計回り＝内側は中心線の右側 lat < 0）。theme は world.js の見た目の種類。
// scale は制御点の拡大率（コースの長さ）
export const COURSES = [
  {
    // 長いストレート、ヘアピン、S字、大きなカーブ
    name: 'わんわん草原サーキット',
    theme: 'meadow',
    scale: 1.45,
    control: [
      [-30, -100], [30, -100], [85, -94], [126, -62], [138, -14], [118, 30],
      [80, 44], [54, 66], [54, 100], [82, 128], [76, 166], [24, 182],
      [-30, 166], [-52, 124], [-86, 96], [-126, 64], [-142, 12], [-128, -50], [-86, -90],
    ],
  },
  {
    // 海ぞいの長いストレートと、波のようにうねる浜辺の道
    name: 'しっぽフリフリ海岸',
    theme: 'beach',
    scale: 1.4,
    control: [
      [-120, -70], [-40, -75], [40, -75], [120, -70], [180, -50], [210, -5], [195, 40], [150, 60], [100, 45],
      [60, 70], [20, 95], [-30, 82], [-72, 62], [-112, 78], [-160, 80], [-205, 45], [-210, -10], [-180, -55],
    ],
  },
  {
    // 切り返しの多いテクニカルな雪山
    name: 'もこもこ雪山',
    theme: 'snow',
    scale: 1.4,
    control: [
      [-60, -95], [0, -98], [52, -90], [92, -62], [100, -20], [75, 10], [40, 25], [25, 55], [50, 88], [100, 95],
      [140, 122], [135, 170], [85, 188], [25, 175], [-25, 145], [-60, 108], [-110, 95], [-150, 58], [-152, 0], [-128, -62],
    ],
  },
  {
    // 落ち葉の舞う森。ゆるいS字と、細かく曲がる丘の道
    name: 'ひらひら紅葉の森',
    theme: 'autumn',
    scale: 1.45,
    control: [
      [-70, -90], [0, -95], [70, -85], [120, -50], [125, 0], [90, 30], [110, 70], [85, 115],
      [30, 125], [-10, 95], [-50, 115], [-100, 100], [-130, 55], [-110, 10], [-135, -30], [-115, -70],
    ],
  },
  {
    // 夜の街。広い直線と連続カーブ
    name: 'きらきら夜のスタジアム',
    theme: 'night',
    scale: 1.4,
    control: [
      [0, -100], [70, -100], [130, -70], [150, -10], [120, 40], [65, 45], [55, 90], [80, 130],
      [25, 165], [-55, 160], [-75, 125], [-30, 100], [-45, 55], [-105, 45], [-140, 20], [-140, -50], [-90, -90],
    ],
  },
];

function catmull(p0, p1, p2, p3, t) {
  // centripetal ではなく uniform。制御点が均等に近いので十分なめらか
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export class Track {
  /** @param {number | number[][]} course コース番号（COURSES の添字）または制御点の配列 */
  constructor(course = 0) {
    const def = Array.isArray(course) ? { name: 'custom', theme: 'meadow', control: course } : COURSES[course] || COURSES[0];
    const sc = def.scale || 1;
    const control = def.control.map(([x, z]) => [x * sc, z * sc]);
    this.name = def.name;
    this.theme = def.theme;
    this.roadHalf = 11; // 道路の半幅
    this.wallDist = 15.5; // 中心線から壁までの距離（道路の外は芝生）
    this.checkpoints = RACE.CHECKPOINTS;

    // 1. 細かくサンプリング
    const dense = [];
    const n = control.length;
    for (let i = 0; i < n; i++) {
      const p0 = control[(i - 1 + n) % n];
      const p1 = control[i];
      const p2 = control[(i + 1) % n];
      const p3 = control[(i + 2) % n];
      for (let k = 0; k < 40; k++) {
        const t = k / 40;
        dense.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
      }
    }
    // 2. 弧長で等間隔に並べ直す
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1];
      const b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[dense.length];
    const N = Math.round(total / 2.5);
    this.n = N;
    this.x = new Float64Array(N);
    this.z = new Float64Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = (i / N) * total;
      while (cum[j + 1] < s) j++;
      const a = dense[j];
      const b = dense[(j + 1) % dense.length];
      const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
      this.x[i] = a[0] + (b[0] - a[0]) * t;
      this.z[i] = a[1] + (b[1] - a[1]) * t;
    }
    // 3. 各セグメントの長さ・接線・左向き法線
    this.segLen = new Float64Array(N);
    this.cum = new Float64Array(N + 1);
    this.tx = new Float64Array(N);
    this.tz = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const k = (i + 1) % N;
      const dx = this.x[k] - this.x[i];
      const dz = this.z[k] - this.z[i];
      const len = Math.hypot(dx, dz) || 1e-6;
      this.segLen[i] = len;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
      this.cum[i + 1] = this.cum[i] + len;
    }
    this.length = this.cum[N];
    // ブーストパッド: 1 周に 6 枚（コース上の割合位置と横位置）。アイテムボックスとは重ならない場所
    this.pads = [[0.08, 0], [0.33, -5], [0.4, 5], [0.62, 0], [0.86, -5], [0.92, 5]].map(([f, lat]) => {
      const p = this.pointAt(f * this.length, lat);
      return { x: p.x, z: p.z, h: p.h, tx: p.tx, tz: p.tz };
    });
    this._proj = { i: 0, t: 0, s: 0, lat: 0, cx: 0, cz: 0, tx: 0, tz: 1, nx: 1, nz: 0 };
  }

  /**
   * 点 (x, z) をコース中心線に投影する。
   * 戻り値は内部で再利用するオブジェクトなので、必要な値はすぐにコピーすること。
   * lat > 0 は進行方向の左側。
   */
  project(x, z) {
    const N = this.n;
    let best = Infinity;
    let bi = 0;
    let bt = 0;
    for (let i = 0; i < N; i++) {
      const ax = this.x[i];
      const az = this.z[i];
      const dx = x - ax;
      const dz = z - az;
      let t = (dx * this.tx[i] + dz * this.tz[i]) / this.segLen[i];
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + this.tx[i] * this.segLen[i] * t;
      const qz = az + this.tz[i] * this.segLen[i] * t;
      const d = (x - qx) * (x - qx) + (z - qz) * (z - qz);
      if (d < best) {
        best = d;
        bi = i;
        bt = t;
      }
    }
    const p = this._proj;
    p.i = bi;
    p.t = bt;
    p.s = this.cum[bi] + this.segLen[bi] * bt;
    p.tx = this.tx[bi];
    p.tz = this.tz[bi];
    // 左向き法線: 前方 (tx, tz) を 90° 回転
    p.nx = p.tz;
    p.nz = -p.tx;
    p.cx = this.x[bi] + p.tx * this.segLen[bi] * bt;
    p.cz = this.z[bi] + p.tz * this.segLen[bi] * bt;
    p.lat = (x - p.cx) * p.nx + (z - p.cz) * p.nz;
    return p;
  }

  /** 弧長 s・横位置 lat の点と、その地点の進行方向 */
  pointAt(s, lat = 0) {
    const L = this.length;
    s = ((s % L) + L) % L;
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const t = (s - this.cum[i]) / this.segLen[i];
    const tx = this.tx[i];
    const tz = this.tz[i];
    const cx = this.x[i] + tx * this.segLen[i] * t;
    const cz = this.z[i] + tz * this.segLen[i] * t;
    return { x: cx + tz * lat, z: cz - tx * lat, h: Math.atan2(tx, tz), tx, tz };
  }

  /** チェックポイント k の弧長位置 */
  cpS(k) {
    return (k / this.checkpoints) * this.length;
  }

  /** a - b を -L/2..L/2 に正規化した弧長差 */
  wrapDS(ds) {
    const L = this.length;
    ds = ((ds % L) + L) % L;
    return ds > L / 2 ? ds - L : ds;
  }

  /** アイテムボックスの配置（コース上の割合位置 × 横 5 列） */
  itemBoxes() {
    const out = [];
    for (const f of [0.2, 0.47, 0.76]) {
      for (const lat of [-8, -4, 0, 4, 8]) {
        const p = this.pointAt(f * this.length, lat);
        out.push({ x: p.x, z: p.z });
      }
    }
    return out;
  }

  /** (x, z) がブーストパッドの上なら true */
  onPad(x, z) {
    const hl = PAD.LENGTH / 2;
    const hw = PAD.WIDTH / 2;
    for (const p of this.pads) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (Math.abs(dx * p.tx + dz * p.tz) <= hl && Math.abs(dx * p.tz - dz * p.tx) <= hw) return true;
    }
    return false;
  }

  /** スタート位置: 前列に人間（0 = ホスト, 1 = ゲスト）、2 列目以降に NPC（2 台ずつ） */
  startPos(index) {
    const row = Math.floor(index / 2);
    const side = index % 2 === 0 ? 1 : -1;
    return this.pointAt(-10 - row * 8, side * 5);
  }

  /** 中心線の範囲（背景の配置などに使う） */
  bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.n; i++) {
      minX = Math.min(minX, this.x[i]);
      maxX = Math.max(maxX, this.x[i]);
      minZ = Math.min(minZ, this.z[i]);
      maxZ = Math.max(maxZ, this.z[i]);
    }
    return { minX, maxX, minZ, maxZ };
  }
}
