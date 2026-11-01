// 都道府県県境バトルの採点と、描いた線の扱い（画面に依存しない。単体テストでも使う）。
//
// 座標は「地図の単位」（ウェブメルカトル。範囲の幅 = 1000。tools/japan-map/view.mjs）。データの中では ×10 の整数。
// お題の「県境」は、となりの都道府県と接している陸の境だけ（海岸線・島は含まない。borders）。
//
// 採点（100 点満点。すべて実際の地上の距離 km で測る）:
//   メルカトル図法は北ほど引き伸ばされる（北緯 24° と 41° で 1.2 倍ちがう）ので、地図の単位の長さを
//   その場所の緯度で km に直してから測る（unitKm）。本物の県境と描いた線は 0.25km ごとの点に分けて測る。
//   目安の距離 T = 県境の広がり（外接箱の対角）の 8%（6〜16km）。1 点の評価は、相手の線までの距離が
//   T/2 以内なら満点 1、そこから 2T にかけてなめらかに 0 まで下がる（ちょっとのずれは気にしない）。
//   ① 位置（40 点）: 本物の県境をどれだけなぞれたか（網羅）と、描いた線がどれだけ県境の上にあるか（正確さ）の調和平均
//   ② 形（40 点）: 描いた線を丸ごと少し（最大 T）ずらして、いちばん合う所で ① と同じ計算。場所が少しずれていても形が合えば点になる
//                  （ずらした距離に応じて最大 3 割引き）
//   ③ 長さ（20 点）: 描いた線の量（1km 四方のマスの数）が本物の 0.8〜1.25 倍なら満点、0.3 倍・2.5 倍で 0。② の形の点を掛ける
//   線が多すぎる（本物の 2 倍を超える）ときは全体をその分割り引く（ぐちゃぐちゃ塗り対策。同じ所のなぞり直しは損にならない）

export const EARTH_R = 6371.0088; // 地球の平均半径 km
export const STEP_KM = 0.25; // 点に分ける間隔
export const FULL_RATIO = 0.3; // 満点の距離 = T × これ
export const ZERO_RATIO = 1.5; // 0 点になる距離 = T × これ
export const SHIFT_RATIO = 1; // ② 形: ずらせる距離の上限 = T × これ
export const OVER_LIMIT = 2; // 線の量がこれを超えたら割り引く
export const WEIGHTS = { pos: 40, shape: 40, len: 20 };

/** 地図の単位 1 が、地図の y の所で何 km か（メルカトルの縮尺は緯度だけで決まる） */
export function unitKm(view, y) {
  const Y = view.Y0 + y / view.S;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * Y)));
  return (2 * Math.PI * EARTH_R * Math.cos(lat)) / view.S;
}

/** 地図の y → 緯度（度） */
export function latOf(view, y) {
  const Y = view.Y0 + y / view.S;
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180) / Math.PI;
}

/** 県のデータ（borders: ×10 の整数の配列）→ 陸の県境の折れ線（地図の単位）の配列 */
export function prefLines(pref) {
  return (pref.borders || []).map((r) => {
    const pts = [];
    for (let i = 0; i < r.length; i += 2) pts.push([r[i] / 10, r[i + 1] / 10]);
    return pts;
  });
}

/** 目安の距離 T（km）: 県境の広がり（外接箱の対角）の 8%。6〜16km の間 */
export function tolerance(pref, view) {
  const [x0, y0, x1, y1] = pref.borderBox || pref.box;
  const diagKm = Math.hypot(x1 - x0, y1 - y0) * unitKm(view, (y0 + y1) / 2);
  return Math.max(6, Math.min(16, 0.08 * diagKm));
}

/** 距離 d km の点の評価（0〜1）。T/2 以内は 1、2T で 0（その間は余弦でなめらかに） */
export function credit(d, T) {
  const a = T * FULL_RATIO;
  const z = T * ZERO_RATIO;
  if (d <= a) return 1;
  if (d >= z) return 0;
  return 0.5 + 0.5 * Math.cos((Math.PI * (d - a)) / (z - a));
}

/** ③ 長さの評価（0〜1）。線の量の比 r が 0.8〜1.25 なら 1、0.3 / 2.5 で 0 */
export function lengthCredit(r) {
  if (r >= 0.8 && r <= 1.25) return 1;
  if (r < 0.8) return Math.max(0, (r - 0.3) / 0.5);
  return Math.max(0, (2.5 - r) / 1.25);
}

/** 折れ線の長さ（km） */
export function lengthKm(lines, view) {
  let s = 0;
  for (const l of lines) for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]) * unitKm(view, (l[i][1] + l[i - 1][1]) / 2);
  return s;
}

/** 折れ線を、地上の距離で stepKm ごとの点にする（地図の単位の点） */
export function resample(lines, stepKm, view) {
  const out = [];
  for (const l of lines) {
    if (!l.length) continue;
    out.push(l[0]);
    let carry = 0; // 前の点から、まだ進んでいない距離（km）
    for (let i = 1; i < l.length; i++) {
      const [ax, ay] = l[i - 1];
      const [bx, by] = l[i];
      const d = Math.hypot(bx - ax, by - ay) * unitKm(view, (ay + by) / 2);
      let t = stepKm - carry;
      while (t <= d) {
        out.push([ax + ((bx - ax) * t) / d, ay + ((by - ay) * t) / d]);
        t += stepKm;
      }
      carry = d - (t - stepKm);
    }
  }
  return out;
}

/** 線分の集まりから、点への最短距離（地図の単位）を速く求めるための格子 */
function segIndex(lines, cell) {
  const grid = new Map();
  const add = (k, s) => (grid.get(k) || grid.set(k, []).get(k)).push(s);
  for (const l of lines) {
    for (let i = 1; i < l.length; i++) {
      const s = [l[i - 1][0], l[i - 1][1], l[i][0], l[i][1]];
      const gx0 = Math.floor(Math.min(s[0], s[2]) / cell);
      const gx1 = Math.floor(Math.max(s[0], s[2]) / cell);
      const gy0 = Math.floor(Math.min(s[1], s[3]) / cell);
      const gy1 = Math.floor(Math.max(s[1], s[3]) / cell);
      for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) add(`${gx},${gy}`, s);
    }
    if (l.length === 1) add(`${Math.floor(l[0][0] / cell)},${Math.floor(l[0][1] / cell)}`, [l[0][0], l[0][1], l[0][0], l[0][1]]);
  }
  return (x, y, max) => {
    let best = max;
    const r = Math.ceil(max / cell);
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gy = cy - r; gy <= cy + r; gy++) {
        const list = grid.get(`${gx},${gy}`);
        if (!list) continue;
        for (const s of list) {
          const dx = s[2] - s[0];
          const dy = s[3] - s[1];
          const L = dx * dx + dy * dy;
          const t = L > 0 ? Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / L)) : 0;
          const d = Math.hypot(x - (s[0] + t * dx), y - (s[1] + t * dy));
          if (d < best) best = d;
        }
      }
    }
    return best;
  };
}

/** 点の集まりが通る、1km 四方のマスの数（kmCell: 1km が地図の単位でいくつか） */
function cellCount(pts, kmCell) {
  const set = new Set();
  for (const [x, y] of pts) set.add(`${Math.floor(x / kmCell)},${Math.floor(y / kmCell)}`);
  return set.size;
}

/**
 * 描いた線を本物の県境と比べて採点する（採点の仕方はこのファイルの先頭）。
 * truth: 本物の県境、drawn: 描いた線（どちらも地図の単位の折れ線の配列）、view: 地図の投影、T: 目安の距離 km
 * @returns 採点の内訳。pct: 合計（0〜100、小数 1 桁）、pos / shape / lenS: ①②③ の評価（0〜1）、
 *   cover / precise: ① の網羅・正確さ、shift: ② でずらした距離 km、over: 線の量の比、
 *   dev: 描いた線の、本物の県境からの平均のずれ km、miss: 本物の県境のうち描いた線から 2T より遠い割合
 */
export function scoreDrawing(truth, drawn, view, T) {
  const dLines = drawn.filter((l) => l.length > 0);
  const empty = { pct: 0, pos: 0, shape: 0, lenS: 0, cover: 0, precise: 0, shift: 0, dev: 0, miss: 1, T, over: 0 };
  if (!dLines.length || !truth.length) return empty;
  const tp = resample(truth, STEP_KM, view);
  const dp = resample(dLines, STEP_KM, view);
  if (!tp.length || !dp.length) return empty;
  let yMin = Infinity;
  let yMax = -Infinity;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of tp) {
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
    cx += x;
    cy += y;
  }
  cx /= tp.length;
  cy /= tp.length;
  const kN = unitKm(view, yMin); // 範囲でいちばん北の縮尺（1 単位がいちばん短い）
  const kC = unitKm(view, cy); // ずらすときの縮尺（県境の真ん中）
  const Z = T * ZERO_RATIO;
  const nearDrawn = segIndex(dLines, Z / kN);
  const nearTruth = segIndex(truth, Z / kN);
  // ①② 共通: (ux, uy) だけずらした描いた線の、網羅・正確さ・調和平均（tpS / dpS は点の間引き）
  const evalAt = (ux, uy, tpS, dpS) => {
    let cov = 0;
    for (const [x, y] of tpS) {
      const k = unitKm(view, y);
      cov += credit(nearDrawn(x - ux, y - uy, Z / k) * k, T);
    }
    cov /= tpS.length;
    let pre = 0;
    for (const [x, y] of dpS) {
      const k = unitKm(view, y);
      pre += credit(nearTruth(x + ux, y + uy, Z / k) * k, T);
    }
    pre /= dpS.length;
    return { cov, pre, f: cov + pre > 0 ? (2 * cov * pre) / (cov + pre) : 0 };
  };
  // ① 位置
  const base = evalAt(0, 0, tp, dp);
  // ② 形: 粗い点で、ずらす量を粗く → 細かく探す
  const thin = (pts, n) => (pts.length <= n ? pts : pts.filter((_, i) => i % Math.ceil(pts.length / n) === 0));
  const tpC = thin(tp, 160);
  const dpC = thin(dp, 160);
  const maxU = (T * SHIFT_RATIO) / kC;
  let best = { f: -1, ux: 0, uy: 0 };
  const tryAt = (ux, uy) => {
    if (Math.hypot(ux, uy) > maxU + 1e-9) return;
    const r = evalAt(ux, uy, tpC, dpC);
    if (r.f > best.f) best = { f: r.f, ux, uy };
  };
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) tryAt((i * maxU) / 3, (j * maxU) / 3);
  const b0 = best;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (i || j) tryAt(b0.ux + (i * maxU) / 8, b0.uy + (j * maxU) / 8);
  const fine = evalAt(best.ux, best.uy, tp, dp);
  const shift = Math.hypot(best.ux, best.uy) * kC;
  const shapeRaw = Math.max(fine.f, base.f);
  const shape = Math.max(base.f, shapeRaw * (1 - 0.3 * Math.min(1, shift / (T * SHIFT_RATIO))));
  // ③ 長さ（線の量は 1km 四方のマスの数で比べる。同じ所のなぞり直しは増えない）
  const kmCell = 1 / unitKm(view, (yMin + yMax) / 2);
  const over = cellCount(dp, kmCell) / Math.max(1, cellCount(tp, kmCell));
  const lenS = lengthCredit(over);
  let total = WEIGHTS.pos * base.f + WEIGHTS.shape * shape + WEIGHTS.len * lenS * shape;
  if (over > OVER_LIMIT) total *= OVER_LIMIT / over;
  // 参考: 平均のずれと、取りこぼし
  const FAR = 200;
  const farTruth = segIndex(truth, FAR / kN);
  let dev = 0;
  for (const [x, y] of dp) {
    const k = unitKm(view, y);
    let d = nearTruth(x, y, Z / k) * k;
    if (d >= Z) d = farTruth(x, y, FAR / k) * k; // 遠い点だけ、広い範囲で探す
    dev += d;
  }
  dev /= dp.length;
  let missN = 0;
  for (const [x, y] of tp) {
    const k = unitKm(view, y);
    if (nearDrawn(x, y, Z / k) * k >= Z) missN++;
  }
  return { pct: Math.round(Math.min(100, total) * 10) / 10, pos: base.f, shape, lenS, cover: base.cov, precise: base.pre, shift, dev, miss: missN / tp.length, T, over };
}

/** 折れ線を間引く（Douglas–Peucker）。送る前に点を減らす */
export function simplifyLine(pts, tol) {
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

export const MAX_POINTS = 2000; // 1 人が送れる点の数の上限（通信の上限に収める）

/** 描いた線（地図の単位）→ 送る形（×10 の整数の配列の配列）。点が多ければ間引きを強める */
export function packStrokes(strokes) {
  let tol = 0.25;
  let s = strokes;
  for (let k = 0; k < 6; k++) {
    s = strokes.map((l) => simplifyLine(l, tol)).filter((l) => l.length > 0);
    if (s.reduce((n, l) => n + l.length, 0) <= MAX_POINTS) break;
    tol *= 2;
  }
  let left = MAX_POINTS;
  const out = [];
  for (const l of s) {
    if (left <= 0) break;
    const part = l.slice(0, left);
    left -= part.length;
    out.push(part.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]));
  }
  return out;
}

/** 受け取った線を検証して、地図の単位に戻す */
export function unpackStrokes(v, w = 1000, h = 1200) {
  if (!Array.isArray(v)) return [];
  const out = [];
  let left = MAX_POINTS;
  for (const r of v.slice(0, 400)) {
    if (!Array.isArray(r) || left <= 0) continue;
    const pts = [];
    for (let i = 0; i + 1 < r.length && left > 0; i += 2) {
      const x = r[i];
      const y = r[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push([Math.max(-50, Math.min(w + 50, x / 10)), Math.max(-50, Math.min(h + 50, y / 10))]);
      left--;
    }
    if (pts.length) out.push(pts);
  }
  return out;
}

/** 消しゴム: (x, y) から r 以内の点を消し、線を分ける */
export function eraseAt(strokes, x, y, r) {
  const out = [];
  let changed = false;
  for (const l of strokes) {
    let cur = [];
    for (const p of l) {
      if (Math.hypot(p[0] - x, p[1] - y) <= r) {
        changed = true;
        if (cur.length) out.push(cur);
        cur = [];
      } else cur.push(p);
    }
    if (cur.length) out.push(cur);
  }
  return changed ? out : strokes;
}

/**
 * CPU の描く線: 本物の県境を「だいたい覚えている人」が手で描いたような線を作る。
 * - となり合う県境の線は端どうしをつないで、ひと筆書きの長い線にする（とぎれとぎれにしない）
 * - 細かいギザギザは覚えていない（強さに応じた粗さで単純にする）
 * - 全体の位置・大きさ・向きが少しずれ、線もゆっくりうねり、手のふるえも少し入る
 * - よわい CPU は、短い区間をまるごと描き忘れることがある
 * level: 1 よわい / 2 ふつう / 3 つよい、rnd: 0〜1 の乱数、gauss: 標準正規乱数
 */
export const CPU_LEVELS = {
  // simp / off / wob / jit は「県境の大きさ U（外接箱の対角の 8%）」の何倍か（大きな県ほど、ずれも大きい）
  1: { simp: 1.3, off: 1.4, scale: 0.12, rot: 7, wob: 1.0, jit: 0.1, forget: 0.35 },
  2: { simp: 0.9, off: 0.9, scale: 0.08, rot: 4, wob: 0.7, jit: 0.08, forget: 0.15 },
  3: { simp: 0.5, off: 0.5, scale: 0.04, rot: 2, wob: 0.45, jit: 0.06, forget: 0.05 },
};
export function cpuDrawing(truth, view, level, rnd = Math.random, gauss = null) {
  const g = gauss || (() => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd()));
  const c = CPU_LEVELS[level] || CPU_LEVELS[2];
  const lines = truth.filter((l) => l.length > 1);
  if (!lines.length) return [];
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const l of lines) for (const [x, y] of l) (sx += x), (sy += y), n++;
  const cx = sx / n;
  const cy = sy / n;
  const k = unitKm(view, cy); // 1 単位 = k km（県境の真ん中の縮尺で十分）
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of lines) for (const [x, y] of l) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
  const U = Math.max(2, 0.08 * Math.hypot(x1 - x0, y1 - y0) * k); // ずれの大きさの単位 km
  // 1) 端どうしが近い線をつないで、ひと筆書きの線にする
  const JOIN = 4 / k;
  const left = lines.map((l) => l.slice());
  const chains = [];
  while (left.length) {
    let ch = left.shift();
    for (let found = true; found; ) {
      found = false;
      for (let i = 0; i < left.length; i++) {
        const l = left[i];
        const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
        const tail = ch[ch.length - 1];
        const head = ch[0];
        let add = null;
        if (d(tail, l[0]) < JOIN) add = () => (ch = ch.concat(l));
        else if (d(tail, l[l.length - 1]) < JOIN) add = () => (ch = ch.concat(l.slice().reverse()));
        else if (d(head, l[l.length - 1]) < JOIN) add = () => (ch = l.concat(ch));
        else if (d(head, l[0]) < JOIN) add = () => (ch = l.slice().reverse().concat(ch));
        if (add) {
          add();
          left.splice(i, 1);
          found = true;
          break;
        }
      }
    }
    chains.push(ch);
  }
  // 2) 全体のずれ（位置・大きさ・向き）
  const ang = rnd() * Math.PI * 2;
  const offU = (c.off * U * (0.5 + rnd())) / k;
  const ox = Math.cos(ang) * offU;
  const oy = Math.sin(ang) * offU;
  const sc = 1 + g() * c.scale;
  const rot = (g() * c.rot * Math.PI) / 180;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const warp = ([x, y]) => {
    const dx = (x - cx) * sc;
    const dy = (y - cy) * sc;
    return [cx + dx * cs - dy * sn + ox, cy + dx * sn + dy * cs + oy];
  };
  const total = lengthKm(chains, view);
  const wv = Array.from({ length: 4 }, () => (2 * Math.PI) / (40 + rnd() * 50)); // うねりの波（km あたりの位相）
  const ph = Array.from({ length: 4 }, () => rnd() * 6.3);
  const out = [];
  for (const ch of chains) {
    const len = lengthKm([ch], view);
    if (len < total * 0.25 && rnd() < c.forget) continue; // 短い区間を、まるごと描き忘れる
    // 3) 細かいところは覚えていない → 単純にして、手で描くくらいの間隔の点に
    const simple = simplifyLine(ch, (c.simp * U) / k);
    let pts = resample([simple], 1.2, view);
    if (pts.length < 2) continue;
    // 4) ゆっくりしたうねり: 場所だけで決まるなめらかなずれ（波長 40〜90km）。線の向きに頼らないので、角でも飛ばない
    //    手のふるえは、なめらかにした小さなずれ
    let jx = 0;
    let jy = 0;
    pts = pts.map(([x, y]) => {
      jx = jx * 0.85 + g() * c.jit * U * 0.5;
      jy = jy * 0.85 + g() * c.jit * U * 0.5;
      const xk = x * k;
      const yk = y * k;
      const dx = c.wob * U * (0.7 * Math.sin(yk * wv[0] + ph[0]) + 0.3 * Math.sin(xk * wv[1] + ph[1])) + jx;
      const dy = c.wob * U * (0.7 * Math.sin(xk * wv[2] + ph[2]) + 0.3 * Math.sin(yk * wv[3] + ph[3])) + jy;
      return warp([x + dx / k, y + dy / k]);
    });
    // 5) 角を少し丸める（Chaikin を 2 回）
    for (let it = 0; it < 2; it++) {
      const q = [pts[0]];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
      }
      q.push(pts[pts.length - 1]);
      pts = q;
    }
    out.push(pts);
  }
  return out;
}
