// コースの形状（純粋な計算のみ。描画は world.js）
// 制御点を Catmull-Rom 曲線でつなぎ、弧長で等間隔に並べ直した閉じたポリラインとして扱う。

import { RACE } from './constants.js';

// 草原サーキット（反時計回り）。長いストレート、ヘアピン、S字、大きなカーブ。
const CONTROL = [
  [-30, -100], [30, -100], [85, -94], [126, -62], [138, -14], [118, 30],
  [80, 44], [54, 66], [54, 100], [82, 128], [76, 166], [24, 182],
  [-30, 166], [-52, 124], [-86, 96], [-126, 64], [-142, 12], [-128, -50], [-86, -90],
].map(([x, z]) => [x * 0.86, z * 0.86]);

function catmull(p0, p1, p2, p3, t) {
  // centripetal ではなく uniform。制御点が均等に近いので十分なめらか
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export class Track {
  constructor(control = CONTROL) {
    this.roadHalf = 8; // 道路の半幅
    this.wallDist = 12.5; // 中心線から壁までの距離（道路の外は芝生）
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

  /** アイテムボックスの配置（コース上の割合位置 × 横 3 列） */
  itemBoxes() {
    const out = [];
    for (const f of [0.2, 0.47, 0.76]) {
      for (const lat of [-5, 0, 5]) {
        const p = this.pointAt(f * this.length, lat);
        out.push({ x: p.x, z: p.z });
      }
    }
    return out;
  }

  /** スタート位置（スタートラインの少し手前、左右に並ぶ） */
  startPos(index) {
    return this.pointAt(-9, index === 0 ? 3.5 : -3.5);
  }
}
