// 都道府県県境バトルの採点と、描いた線の扱い（画面に依存しない。単体テストでも使う）。
//
// 座標は「地図の単位」（ウェブメルカトル。範囲の幅 = 1000。tools/japan-map/view.mjs）。データの中では ×10 の整数。
// お題の「県境」は、となりの都道府県と接している陸の境だけ（海岸線・島は含まない。borders）。
//
// 測り方（すべて実際の地上の距離 km で測る）:
//   メルカトル図法は北ほど引き伸ばされる（北緯 24° と 41° で 1.2 倍ちがう）ので、地図の単位の長さを
//   その場所の緯度で km に直してから測る（unitKm）。
//   1) 本物の県境と描いた線を、それぞれ 0.25km ごとの点に分ける
//   2) 本物の県境の各点 → 描いた線までの最短距離、描いた線の各点 → 本物の県境までの最短距離を求める
//   3) 1 点の得点: 距離が A 以内なら満点 1、A〜T は直線的に減り、T より遠ければ 0
//      T（許容距離）= 県境の広がり（外接箱の対角）の 7%（5〜13km）、A（満点の距離）= T の 1/4
//   4) なぞれた割合（網羅）= 本物の県境の点の得点の平均、線の正確さ = 描いた線の点の得点の平均
//   5) 一致率 = 2 × 網羅 × 正確さ ÷（網羅 + 正確さ）（調和平均。片方だけ高くても上がらない）
//   6) 塗りつぶし対策: 描いた線が通った 1km 四方のマスの数が、本物の県境の 1.5 倍を超えたら、その分だけ割り引く
//      （同じ所を何度なぞってもマスは増えないので、描き直しは損にならない）

export const EARTH_R = 6371.0088; // 地球の平均半径 km
export const STEP_KM = 0.25; // 点に分ける間隔
export const FULL_RATIO = 0.25; // 満点の距離 A = T × これ
export const OVER_LIMIT = 1.5; // 線の量がこれを超えたら割り引く

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

/** 許容距離 T（km）: 県境の広がり（外接箱の対角）の 7%。5〜13km の間 */
export function tolerance(pref, view) {
  const [x0, y0, x1, y1] = pref.borderBox || pref.box;
  const diagKm = Math.hypot(x1 - x0, y1 - y0) * unitKm(view, (y0 + y1) / 2);
  return Math.max(5, Math.min(13, 0.07 * diagKm));
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
 * 描いた線を本物の県境と比べて採点する（測り方はこのファイルの先頭）。
 * truth: 本物の県境、drawn: 描いた線（どちらも地図の単位の折れ線の配列）、view: 地図の投影、T: 許容距離 km
 * @returns {{ pct: number, cover: number, precise: number, dev: number, miss: number, T: number, A: number, over: number, pts: number[] }}
 *   pct: 一致率（0〜100、小数 1 桁）、cover: なぞれた割合、precise: 線の正確さ（0〜1）、
 *   dev: 描いた線の、本物の県境からの平均のずれ km、miss: 本物の県境の点のうち、描いた線から T より遠い割合、over: 線の量の比
 */
export function scoreDrawing(truth, drawn, view, T) {
  const A = T * FULL_RATIO;
  const dLines = drawn.filter((l) => l.length > 0);
  const empty = { pct: 0, cover: 0, precise: 0, dev: 0, miss: 1, T, A, over: 0 };
  if (!dLines.length || !truth.length) return empty;
  const tp = resample(truth, STEP_KM, view);
  const dp = resample(dLines, STEP_KM, view);
  // 格子の大きさ: T を地図の単位にしたもの（北ほど 1 単位が短いので、範囲でいちばん北の縮尺を使う）
  let yMin = Infinity;
  for (const [, y] of tp) yMin = Math.min(yMin, y);
  const kN = unitKm(view, yMin);
  const cellU = T / kN;
  const nearDrawn = segIndex(dLines, cellU);
  const nearTruth = segIndex(truth, cellU);
  const credit = (dKm) => (dKm <= A ? 1 : dKm >= T ? 0 : (T - dKm) / (T - A));
  let cover = 0;
  let missN = 0;
  for (const [x, y] of tp) {
    const k = unitKm(view, y);
    const d = nearDrawn(x, y, T / k) * k;
    cover += credit(d);
    if (d >= T) missN++;
  }
  cover /= tp.length;
  let precise = 0;
  let dev = 0;
  const FAR = 200; // 平均のずれは、遠くても 200km まで数える
  const farTruth = segIndex(truth, FAR / kN);
  for (const [x, y] of dp) {
    const k = unitKm(view, y);
    let d = nearTruth(x, y, T / k) * k;
    precise += credit(d);
    if (d >= T) d = farTruth(x, y, FAR / k) * k;
    dev += d;
  }
  precise /= dp.length;
  dev /= dp.length;
  let f = cover + precise > 0 ? (2 * cover * precise) / (cover + precise) : 0;
  const kmCell = 1 / unitKm(view, (yMin + tp.reduce((m, p) => Math.max(m, p[1]), -Infinity)) / 2);
  const over = cellCount(dp, kmCell) / Math.max(1, cellCount(tp, kmCell));
  if (over > OVER_LIMIT) f *= OVER_LIMIT / over;
  return { pct: Math.round(f * 1000) / 10, cover, precise, dev, miss: missN / tp.length, T, A, over };
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
