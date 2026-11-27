// 崖の上の一本道（どこまでも続く）。種（seed）が同じなら、だれの端末でも同じ道になる。
// 道の真ん中の線を 1 m ごとの点で持つ（x, z, 向き h, 曲がり具合 k, 幅 w）。向き h は「前 = (sin h, cos h)」。
//
// 道の形: 円の弧（カーブ）を、左右かわるがわる、間にほとんど直線をはさまずにつなぐ（S 字が続くグネグネ）。
// 1 つのカーブで大きく（最大 150 度）曲がる。カーブのつなぎ目は、曲がり具合を少しずつ変えてなめらかに。
// 道の大きな向きは、はじめの向きから ±H_MAX までにおさえる（道が自分と重ならない）。
// 上り下り: ゆるい長い波と短い波を重ねた高さ（はじめのまっすぐな所は平ら。そこから少しずつ）。
// 道幅: 長いトラックはカーブで後ろの車輪が内側を通るので、その分だけ、急なカーブの所を広くする（手前から少しずつ）。
// 先へ進むほど、カーブは急で長く、広げる分の余裕は少なくなる（むずかしくなる）。

export const ROAD = {
  STEP: 1, // 点の間隔（m）
  START_STRAIGHT: 90, // はじめのまっすぐな区間（m）。トラックはここに置く
  DIFF: 2000, // ここまで進むと、いちばんむずかしくなる（m）
  R_EASY: [46, 62], // はじめのカーブの半径（m）
  R_HARD: [36, 44], // むずかしくなったときのカーブの半径
  ARC_EASY: [80, 140], // はじめの 1 つのカーブで曲がる角度（度）
  ARC_HARD: [110, 160], // むずかしくなったとき
  GAP_EASY: [0, 4], // カーブとカーブの間の直線（m）
  GAP_HARD: [0, 0],
  EASE: 8, // 曲がり具合を少しずつ変える長さ（m。カーブの入り口・出口）
  FLIP: 0.88, // 次のカーブが反対向きになる確率（S 字）
  H_MAX: (80 * Math.PI) / 180, // 道の大きな向きが、はじめからこれ以上ずれない
  W_BASE: [8.0, 6.6], // まっすぐな所の道幅（はじめ → むずかしくなったとき）
  WHEELBASE: 24, // 道幅を決めるときに考えるトラックの車輪の間（truck.js の L と同じ）
  TRACK: 2.1, // 左右の車輪の間
  MARGIN: [1.3, 0.45], // カーブで、車輪の通り道の外に残す余裕（片側。はじめ → むずかしくなったとき）
  SPREAD: 28, // 広げはじめ・広げおわりを、カーブの何 m 手前・先にするか
  HILLS: [
    [9, 560], // [高さの振れ幅（m）, 波の長さ（m）]
    [2.8, 230],
  ],
  HILL_RAMP: 160, // はじめのまっすぐな所のあと、この長さで平らから上り下りへ
};

/** 種から作る乱数（0〜1。同じ種なら同じ並び） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;

export class Road {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.rnd = mulberry32(this.seed || 1);
    this.x = [0];
    this.z = [0];
    this.h = [0];
    this.k = [0];
    this.y = [0]; // 道の高さ（m）
    this.w = [];
    // 上り下りの波のずらし（カーブとは別の乱数。カーブの並びは変えない）
    const hr = mulberry32((this.seed ^ 0x5bd1e995) >>> 0 || 7);
    this.hills = ROAD.HILLS.map(([a, l]) => ({ a, f: (2 * Math.PI) / l, p: hr() * Math.PI * 2 })); // 幅は、先の曲がりがわかってから決める（ensure）
    this._side = this.rnd() < 0.5 ? 1 : -1;
    this._plan = []; // これから作る区間（曲がり具合の目標と長さ）
    this._kNow = 0;
  }

  get length() {
    return this.w.length;
  }

  /** s（m）でのむずかしさ（0〜1） */
  diff(s) {
    return Math.max(0, Math.min(1, (s - ROAD.START_STRAIGHT) / ROAD.DIFF));
  }

  /** 進んだ距離 s での道の高さ（はじめは 0。まっすぐな所のあと、なめらかに上り下りへ） */
  heightAt(s) {
    const L = ROAD.START_STRAIGHT;
    if (s <= L) return 0;
    const u = Math.min(1, (s - L) / ROAD.HILL_RAMP);
    const ramp = u * u * (3 - 2 * u);
    let e = 0;
    for (const w of this.hills) e += w.a * (Math.sin(w.f * s + w.p) - Math.sin(w.f * L + w.p));
    return e * ramp;
  }

  /** 次のカーブ（と、その前の直線）を決める */
  _nextCurve(s, h) {
    const d = this.diff(s);
    const R = lerp(lerp(ROAD.R_EASY[0], ROAD.R_HARD[0], d), lerp(ROAD.R_EASY[1], ROAD.R_HARD[1], d), this.rnd());
    let arc = lerp(lerp(ROAD.ARC_EASY[0], ROAD.ARC_HARD[0], d), lerp(ROAD.ARC_EASY[1], ROAD.ARC_HARD[1], d), this.rnd()) * DEG;
    const gap = lerp(lerp(ROAD.GAP_EASY[0], ROAD.GAP_HARD[0], d), lerp(ROAD.GAP_EASY[1], ROAD.GAP_HARD[1], d), this.rnd());
    let side = this.rnd() < ROAD.FLIP ? -this._side : this._side;
    // 大きな向きのはしを越えそうなら、反対へ曲がる。それでも越えるなら、曲がる角度を減らす
    const lim = ROAD.H_MAX - 8 * DEG; // 入り口・出口のなめらかな所で少し余分に曲がる分
    if (Math.abs(h + side * arc) > lim) side = -Math.sign(h) || -side;
    arc = Math.min(arc, lim - side * h);
    this._side = side;
    if (gap >= 1) this._plan.push({ k: 0, len: Math.round(gap) });
    if (arc > 5 * DEG) this._plan.push({ k: side / R, len: Math.max(2, Math.round(R * arc)) });
    else this._plan.push({ k: 0, len: 15 });
  }

  /** 1 m 進んだ所の曲がり具合（目標へ少しずつ近づける） */
  _stepK(s, h) {
    if (s < ROAD.START_STRAIGHT) return 0;
    while (!this._plan.length || this._plan[0].len <= 0) {
      if (this._plan.length) this._plan.shift();
      if (!this._plan.length) this._nextCurve(s, h + this._kNow * ROAD.EASE * 0.5);
    }
    const p = this._plan[0];
    p.len--;
    // 入り口・出口は EASE m かけて曲がり具合を変える（急にハンドルを切らなくていいように）
    const step = (1 / 40) / ROAD.EASE;
    // 大きな向きのはしに近いとき: 外へ曲がるカーブは、なめらかにやめる（このまま曲がりやめると、はしを越える分を見て）
    let goal = p.k;
    const over = Math.abs(h) + (this._kNow * this._kNow) / (2 * step) * Math.sign(this._kNow) * Math.sign(h);
    if (Math.sign(goal) === Math.sign(h) && over >= ROAD.H_MAX) {
      goal = 0;
      p.len = 0; // このカーブはここまで
    }
    const dk = goal - this._kNow;
    this._kNow += Math.abs(dk) <= step ? dk : Math.sign(dk) * step;
    return this._kNow;
  }

  /** 点 i での、道幅を決めるのに要る幅（カーブで後ろの車輪が内側を通る分 + 余裕） */
  _need(i) {
    const s = i * ROAD.STEP;
    const d = this.diff(s);
    const k = Math.abs(this.k[i] || 0);
    const L = ROAD.WHEELBASE;
    // 前の車輪を外側へ a、後ろの車輪を内側へ a ずらすと、ちょうど通れる（a = L² / 4R）
    const a = (L * L * k) / 4;
    return 2 * (a + ROAD.TRACK / 2 + lerp(ROAD.MARGIN[0], ROAD.MARGIN[1], d));
  }

  /** 点を i 番まで作る（幅も） */
  ensure(i) {
    const n = Math.ceil(i);
    const ahead = n + ROAD.SPREAD + 12;
    while (this.x.length <= ahead) {
      const j = this.x.length - 1;
      const s = j * ROAD.STEP;
      const k = this._stepK(s, this.h[j]);
      const h = this.h[j] + k * ROAD.STEP;
      const hm = (this.h[j] + h) / 2;
      this.x.push(this.x[j] + Math.sin(hm) * ROAD.STEP);
      this.z.push(this.z[j] + Math.cos(hm) * ROAD.STEP);
      this.h.push(h);
      this.k.push(k);
      this.y.push(this.heightAt(s + ROAD.STEP));
    }
    // 幅: まっすぐな所の幅と、前後 SPREAD m の中でいちばん要る幅の大きい方。さらに前後 8 m でならす
    while (this.w.length <= n) {
      const i0 = this.w.length;
      const s = i0 * ROAD.STEP;
      const base = lerp(ROAD.W_BASE[0], ROAD.W_BASE[1], this.diff(s));
      let sum = 0;
      let cnt = 0;
      for (let q = i0 - 8; q <= i0 + 8; q++) {
        let m = base;
        for (let r = Math.max(0, q - ROAD.SPREAD); r <= q + ROAD.SPREAD; r++) m = Math.max(m, this._need(r));
        sum += m;
        cnt++;
      }
      this.w.push(sum / cnt);
    }
  }

  /**
   * 点 (px, pz) にいちばん近い道の場所。hint: 前に見つけた番号（その近くだけ探す。なければ全部）
   * 戻り値: { i: 番号（小数。点と点の間もなめらかに）, d: 道の真ん中からの横のずれ（正 = 右）, hw: その場所の道幅の半分, h: 道の向き }
   */
  locate(px, pz, hint = -1, out = {}) {
    let i0 = 0;
    let i1 = this.w.length - 1;
    if (hint >= 0) {
      i0 = Math.max(0, Math.floor(hint) - 40);
      i1 = Math.floor(hint) + 40;
      this.ensure(i1 + 1);
    }
    let best = i0;
    let bd = Infinity;
    for (let i = i0; i <= i1; i++) {
      const dx = px - this.x[i];
      const dz = pz - this.z[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) {
        bd = d2;
        best = i;
      }
    }
    const i = best;
    const h = this.h[i];
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const dx = px - this.x[i];
    const dz = pz - this.z[i];
    const along = dx * fx + dz * fz;
    const f = Math.max(-0.5, Math.min(0.5, along / ROAD.STEP));
    out.i = Math.max(0, i + f);
    // 右 = (-cos h, sin h)（前が +z のとき、右は -x）
    out.d = -dx * fz + dz * fx;
    out.hw = this.w[i] / 2;
    out.h = h;
    const i2 = f >= 0 ? Math.min(this.y.length - 1, i + 1) : Math.max(0, i - 1);
    out.y = this.y[i] + (this.y[i2] - this.y[i]) * Math.abs(f);
    return out;
  }
}
