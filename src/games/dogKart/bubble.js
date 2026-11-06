// プレイヤー名の吹き出しの置き場所の計算（画面・DOM に依存しない）

/**
 * 名前の吹き出しの置き場所（画面の CSS ピクセル）。
 * nx, ny, nz: 頭の上の点を画面に写した値（-1〜1 が画面の中。nz > 1 はカメラの後ろ）。W, H: 画面の大きさ。bw, bh: 吹き出しの大きさ。
 * 画面の中なら頭の上に（しっぽは下向き）。画面の外なら、その方向の画面のはしに（しっぽはその人のほうを向く）。
 * 戻り値: { x, y: 吹き出しの中心, edge: 画面のはしか, tx, ty: しっぽの先（吹き出しの中心から）, a: しっぽの向き（ラジアン。0 = 右、π/2 = 下） }
 */
export function bubbleLayout(nx, ny, nz, W, H, bw, bh, margin = 10, tail = 9) {
  let sx = (nx * 0.5 + 0.5) * W;
  let sy = (-ny * 0.5 + 0.5) * H;
  const behind = nz > 1;
  const inside = !behind && sx >= 0 && sx <= W && sy >= 0 && sy <= H;
  if (inside) return { x: sx, y: sy - bh / 2 - tail, edge: false, tx: 0, ty: bh / 2 + tail, a: Math.PI / 2 };
  // 画面の外: 画面の真ん中から見た向き（カメラの後ろなら反対向き）
  const cx = W / 2;
  const cy = H / 2;
  let dx = sx - cx;
  let dy = sy - cy;
  if (behind) {
    dx = -dx;
    dy = -dy;
    if (Math.abs(dy) < 1e-3 && Math.abs(dx) < 1e-3) dy = 1;
  }
  // 吹き出しの中心が動ける四角（はしからの余白 + しっぽの分）
  const hw = Math.max(1, W / 2 - margin - tail - bw / 2);
  const hh = Math.max(1, H / 2 - margin - tail - bh / 2);
  const f = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh, 1e-6);
  sx = cx + dx * f;
  sy = cy + dy * f;
  const a = Math.atan2(dy, dx);
  // しっぽは、吹き出しの枠の、その向きの所から外へ
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const t = Math.min((bw / 2) / Math.max(1e-6, Math.abs(c)), (bh / 2) / Math.max(1e-6, Math.abs(sn)));
  return { x: sx, y: sy, edge: true, tx: c * (t + tail), ty: sn * (t + tail), a };
}
