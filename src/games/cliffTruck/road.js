// 崖の上の一本道（どこまでも続く）。種（seed）が同じなら、だれの端末でも同じ道になる。
// 道の真ん中の線を 1 m ごとの点で持つ（x, z, 向き h, 幅 w）。向き h は「前 = (sin h, cos h)」。
// 先へ進むほど、曲がりがきつく、道がせまくなる。

export const ROAD = {
  STEP: 1, // 点の間隔（m）
  START_STRAIGHT: 90, // はじめのまっすぐな区間（m）。トラックはここに置く
  W0: 10.0, // はじめの道幅（m）
  W_MIN: 8.8, // いちばんせまい道幅（いちばん急なカーブでも、長い車体の後ろの車輪が内側を通る分 + 少し余裕）
  W_DIST: 4500, // ここまで進むと、いちばんせまくなる（m）
  R0: 60, // はじめのいちばん急なカーブの半径（m）
  R_MIN: 34, // いちばん急なカーブの半径（これより急にはならない）
  R_DIST: 5000, // ここまで進むと、いちばん急になる（m）
  WAVE: [55, 150], // 曲がりの波の長さ（m）。左右に曲がりかえす間隔
  BEND: 2.2, // 波を重ねたものを、これだけ強める（いちばん急なカーブの半径はこえない）
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

export class Road {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    const rnd = mulberry32(this.seed || 1);
    // 曲がり具合 = いくつかの波を重ねたもの（波の長さ WAVE[0]〜WAVE[1] m。短いほどグネグネ）。重ねた大きさが 1 をこえないように割る
    this.waves = Array.from({ length: 4 }, (_, k) => ({ a: 0.5 + rnd() * 0.5, f: (2 * Math.PI) / (ROAD.WAVE[0] + rnd() * (ROAD.WAVE[1] - ROAD.WAVE[0])), p: rnd() * Math.PI * 2, k }));
    const sum = this.waves.reduce((n, w) => n + w.a, 0);
    for (const w of this.waves) w.a /= sum;
    this.x = [0];
    this.z = [0];
    this.h = [0];
    this.w = [ROAD.W0];
  }

  /** 進んだ距離 s（m）での曲がり具合（1 / 半径。正 = 左へ曲がる） */
  curvature(s) {
    const L = ROAD.START_STRAIGHT;
    if (s < L) return 0;
    const ramp = Math.min(1, (s - L) / 60); // まっすぐから、ゆっくり曲がりはじめる
    const k = Math.min(1, s / ROAD.R_DIST);
    const A = 1 / ROAD.R0 + (1 / ROAD.R_MIN - 1 / ROAD.R0) * k;
    let v = 0;
    for (const w of this.waves) v += w.a * Math.sin(w.f * s + w.p);
    v = Math.max(-1, Math.min(1, v * ROAD.BEND)); // 強めて、半径の上限で頭打ち（急なカーブが長く続く）
    return A * ramp * v;
  }

  /** 進んだ距離 s での道幅（m） */
  widthAt(s) {
    const k = Math.min(1, Math.max(0, s - ROAD.START_STRAIGHT) / ROAD.W_DIST);
    return ROAD.W0 + (ROAD.W_MIN - ROAD.W0) * k;
  }

  get length() {
    return this.x.length;
  }

  /** 点を i 番まで作る */
  ensure(i) {
    const n = Math.ceil(i);
    while (this.x.length <= n) {
      const j = this.x.length - 1;
      const s = j * ROAD.STEP;
      const h = this.h[j] + this.curvature(s + ROAD.STEP / 2) * ROAD.STEP;
      const hm = (this.h[j] + h) / 2;
      this.x.push(this.x[j] + Math.sin(hm) * ROAD.STEP);
      this.z.push(this.z[j] + Math.cos(hm) * ROAD.STEP);
      this.h.push(h);
      this.w.push(this.widthAt(s + ROAD.STEP));
    }
  }

  /**
   * 点 (px, pz) にいちばん近い道の場所。hint: 前に見つけた番号（その近くだけ探す。なければ全部）
   * 戻り値: { i: 番号（小数。点と点の間もなめらかに）, d: 道の真ん中からの横のずれ（正 = 右）, hw: その場所の道幅の半分, h: 道の向き }
   */
  locate(px, pz, hint = -1, out = {}) {
    let i0 = 0;
    let i1 = this.x.length - 1;
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
    // となりの点との間（線分）に落とす
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
    return out;
  }
}
