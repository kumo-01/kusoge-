// 地図タイル（国土地理院の色別標高図）を、拡大に合わせた細かさで読み込んで描く。
// 画像を引き伸ばすのではなく、拡大するほど細かいタイルに切り替えるので、どこまで拡大してもくっきり見える。
// 読み込み中のタイルは、すでにある粗いタイル、なければ日本全体の下地の画像（japan-base.jpg）で埋める。
//
// 座標: 地図の単位 = (ウェブメルカトル座標 - 原点 X0, Y0) × S（tools/japan-map/view.mjs）。
// 出典: 国土地理院 色別標高図 https://maps.gsi.go.jp/development/ichiran.html#relief

const URL_OF = (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/relief/${z}/${x}/${y}.png`;
const Z_MIN = 5;
const Z_MAX = 15;
const MAX_CACHE = 500; // 覚えておくタイルの数
const MAX_LOADING = 16; // 同時に読み込むタイルの数

export class TileMap {
  /** view: { X0, Y0, S, w, h }、baseUrl: 下地の画像 */
  constructor(view, baseUrl) {
    this.v = view;
    this.cache = new Map(); // "z/x/y" → { img, ok, bad, used }
    this.loading = 0;
    this.queue = [];
    this.tick = 0;
    this.base = new Image();
    this.base.decoding = 'async';
    this.base.src = baseUrl;
  }

  _get(z, x, y, want) {
    const key = `${z}/${x}/${y}`;
    let t = this.cache.get(key);
    if (!t && want) {
      t = { img: null, ok: false, bad: false, used: 0, z, x, y };
      this.cache.set(key, t);
      this.queue.push(t);
    }
    if (t) t.used = this.tick;
    return t;
  }

  _pump() {
    // 新しく見えるようになったタイルから読む
    this.queue.sort((a, b) => b.used - a.used);
    while (this.loading < MAX_LOADING && this.queue.length) {
      const t = this.queue.shift();
      if (t.used < this.tick - 2) {
        this.cache.delete(`${t.z}/${t.x}/${t.y}`); // もう見えていない
        continue;
      }
      this.loading++;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        this.loading--;
        t.img = img;
        t.ok = true;
      };
      img.onerror = () => {
        this.loading--;
        t.bad = true; // データのない所（遠い海など）
      };
      img.src = URL_OF(t.z, t.x, t.y);
    }
    if (this.cache.size > MAX_CACHE) {
      const old = [...this.cache.values()].filter((t) => t.ok || t.bad).sort((a, b) => a.used - b.used);
      for (const t of old.slice(0, this.cache.size - MAX_CACHE)) this.cache.delete(`${t.z}/${t.x}/${t.y}`);
    }
  }

  /**
   * 描く。scale: 画面の画素 / 地図の単位、(ox, oy): 地図の原点の画面位置、(cw, ch): 描く範囲の大きさ（画面の画素）、dpr: 画素密度
   * clip: 描く範囲（画面の画素の四角 {x, y, w, h}。なければ 0,0,cw,ch）
   */
  draw(g, scale, ox, oy, cw, ch, dpr = 1, clip = null) {
    const v = this.v;
    const C0 = clip || { x: 0, y: 0, w: cw, h: ch };
    this.tick++;
    g.save();
    g.beginPath();
    g.rect(C0.x, C0.y, C0.w, C0.h);
    g.clip();
    g.fillStyle = '#2f6fc4';
    g.fillRect(C0.x, C0.y, C0.w, C0.h);
    // 地図の範囲の外（遠い海・大陸）は描かない（下地の画像とタイルの境目が見えないように）
    const mx0 = Math.max(C0.x, ox);
    const my0 = Math.max(C0.y, oy);
    const C = { x: mx0, y: my0, w: Math.min(C0.x + C0.w, ox + v.w * scale) - mx0, h: Math.min(C0.y + C0.h, oy + v.h * scale) - my0 };
    if (C.w <= 0 || C.h <= 0) {
      g.restore();
      return;
    }
    g.beginPath();
    g.rect(C.x, C.y, C.w, C.h);
    g.clip();
    if (this.base.complete && this.base.naturalWidth) g.drawImage(this.base, ox, oy, v.w * scale, v.h * scale);
    // 画面の 1 画素 ≒ タイルの 1 画素になる細かさ
    let z = Math.ceil(Math.log2((scale * dpr * v.S) / 256) - 0.15);
    z = Math.max(Z_MIN, Math.min(Z_MAX, z));
    const span = (zz) => {
      const n = 2 ** zz;
      const X = (sx) => v.X0 + (sx - ox) / scale / v.S;
      const Y = (sy) => v.Y0 + (sy - oy) / scale / v.S;
      return {
        n,
        x0: Math.max(0, Math.floor(X(C.x) * n)),
        x1: Math.min(n - 1, Math.floor(X(C.x + C.w) * n)),
        y0: Math.max(0, Math.floor(Y(C.y) * n)),
        y1: Math.min(n - 1, Math.floor(Y(C.y + C.h) * n)),
      };
    };
    let sp = span(z);
    while (z > Z_MIN && (sp.x1 - sp.x0 + 1) * (sp.y1 - sp.y0 + 1) > 80) sp = span(--z); // 多すぎるときは粗く
    const px = (X) => ox + (X - v.X0) * v.S * scale;
    const py = (Y) => oy + (Y - v.Y0) * v.S * scale;
    const size = (v.S * scale) / sp.n;
    for (let x = sp.x0; x <= sp.x1; x++) {
      for (let y = sp.y0; y <= sp.y1; y++) {
        const dx = px(x / sp.n);
        const dy = py(y / sp.n);
        const t = this._get(z, x, y, true);
        if (t.ok) {
          g.drawImage(t.img, dx, dy, size + 0.5, size + 0.5);
          continue;
        }
        if (t.bad) continue;
        // まだ: 読み込み済みの粗いタイルの一部で埋める
        for (let up = 1; up <= 4 && z - up >= Z_MIN; up++) {
          const pz = z - up;
          const k = 2 ** up;
          const p = this._get(pz, Math.floor(x / k), Math.floor(y / k), false);
          if (p?.ok) {
            const sub = 256 / k;
            g.drawImage(p.img, (x % k) * sub, (y % k) * sub, sub, sub, dx, dy, size + 0.5, size + 0.5);
            break;
          }
        }
      }
    }
    g.restore();
    this._pump();
  }
}
