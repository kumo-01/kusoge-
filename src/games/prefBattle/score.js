// 都道府県県境バトルの採点と、描いた線の扱い（画面に依存しない。単体テストでも使う）。
//
// 座標は「地図の単位」（範囲の幅 = 1000、1 単位 ≒ 2.2km。tools/japan-map/view.mjs）。データの中では ×10 の整数。
// お題の「県境」は、となりの都道府県と接している陸の境だけ（海岸線・島は含まない。borders）。
// 一致率 = 「本物の県境のうち、描いた線が近くを通っている割合（網羅）」と
//          「描いた線のうち、本物の県境の近くにある割合（正確さ）」の調和平均。
// 近さは、許容距離 T の中で近いほど高い（距離 0 で 1、T で 0）。T は県境の広がりに合わせる。
// 描いた線の総延長が本物の 1.5 倍を超えたら、その分だけ割り引く（塗りつぶし対策）。

/** 県のデータ（borders: ×10 の整数の配列）→ 陸の県境の折れ線（地図の単位）の配列 */
export function prefLines(pref) {
  return (pref.borders || []).map((r) => {
    const pts = [];
    for (let i = 0; i < r.length; i += 2) pts.push([r[i] / 10, r[i + 1] / 10]);
    return pts;
  });
}

/** 許容距離（地図の単位）: 県境の広がり（外接箱の対角）の 7%。5〜13km の間 */
export function tolerance(pref, kmPerUnit) {
  const [x0, y0, x1, y1] = pref.borderBox || pref.box;
  const km = Math.max(5, Math.min(13, 0.07 * Math.hypot(x1 - x0, y1 - y0) * kmPerUnit));
  return km / kmPerUnit;
}

/** 折れ線を step ごとの点にする */
export function resample(lines, step) {
  const out = [];
  for (const l of lines) {
    if (!l.length) continue;
    out.push(l[0]);
    let carry = 0;
    for (let i = 1; i < l.length; i++) {
      const [ax, ay] = l[i - 1];
      const [bx, by] = l[i];
      const d = Math.hypot(bx - ax, by - ay);
      let t = step - carry;
      while (t <= d) {
        out.push([ax + ((bx - ax) * t) / d, ay + ((by - ay) * t) / d]);
        t += step;
      }
      carry = d - (t - step);
    }
  }
  return out;
}

/** 線分の集まりから、点への最短距離を速く求めるための格子 */
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

/**
 * 一致率（0〜100、小数 1 桁）。truth: 本物の境界の折れ線、drawn: 描いた線（どちらも地図の単位）
 * @returns {{ pct: number, cover: number, precise: number }}
 */
export function scoreDrawing(truth, drawn, T) {
  const dLines = drawn.filter((l) => l.length > 0);
  if (!dLines.length) return { pct: 0, cover: 0, precise: 0 };
  const step = Math.max(0.5, T / 10);
  const tp = resample(truth, step);
  const dp = resample(dLines, step);
  const nearDrawn = segIndex(dLines, T);
  const nearTruth = segIndex(truth, T);
  const soft = (d) => Math.max(0, 1 - d / T);
  const cover = tp.reduce((a, [x, y]) => a + soft(nearDrawn(x, y, T)), 0) / tp.length;
  const precise = dp.reduce((a, [x, y]) => a + soft(nearTruth(x, y, T)), 0) / dp.length;
  let f = cover + precise > 0 ? (2 * cover * precise) / (cover + precise) : 0;
  // 塗りつぶすように描く（線をやたら長く描く）と、どこかが境界の近くを通ってしまうので、長すぎる分は割り引く
  const len = (ls) => ls.reduce((a, l) => a + l.reduce((b, p, i) => b + (i ? Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0), 0);
  const over = len(dLines) / Math.max(1e-9, len(truth));
  if (over > 1.5) f *= 1.5 / over;
  return { pct: Math.round(f * 1000) / 10, cover, precise, over };
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
