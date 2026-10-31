// 都道府県県境バトルの地図の投影と範囲（県境のデータと標高の画像で共通）。
// ウェブメルカトル図法。地図の単位は「本土の幅 = 1000」。沖縄本島のまわりは左上の枠（拡大）に描く。

export const MAIN = { lon0: 128.4, lon1: 146.2, latTop: 45.75, latBottom: 30.0 };
export const INSET = { lon0: 126.6, lon1: 128.45, latTop: 27.15, latBottom: 25.95, zoom: 1.6, ox: 14, oy: 14 };

export const mercX = (lon) => (lon + 180) / 360;
export const mercY = (lat) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);

export function makeView() {
  const X0 = mercX(MAIN.lon0);
  const X1 = mercX(MAIN.lon1);
  const Y0 = mercY(MAIN.latTop);
  const Y1 = mercY(MAIN.latBottom);
  const S = 1000 / (X1 - X0);
  const main = { X0, Y0, S, w: 1000, h: (Y1 - Y0) * S };
  const iX0 = mercX(INSET.lon0);
  const iY0 = mercY(INSET.latTop);
  const iS = S * INSET.zoom;
  const inset = { X0: iX0, Y0: iY0, S: iS, ox: INSET.ox, oy: INSET.oy, w: (mercX(INSET.lon1) - iX0) * iS, h: (mercY(INSET.latBottom) - iY0) * iS };
  return { main, inset, w: 1000, h: main.h };
}

/** 経度・緯度 → 地図の単位（vp: main / inset） */
export function project(view, vp, lon, lat) {
  const v = view[vp];
  const u = (mercX(lon) - v.X0) * v.S + (v.ox || 0);
  const w = (mercY(lat) - v.Y0) * v.S + (v.oy || 0);
  return [u, w];
}

/** 地図の単位 → 経度・緯度（左上の枠の中なら沖縄の範囲） */
export function unproject(view, u, w) {
  const i = view.inset;
  const inInset = u >= i.ox && u <= i.ox + i.w && w >= i.oy && w <= i.oy + i.h;
  const v = inInset ? i : view.main;
  const X = (u - (v.ox || 0)) / v.S + v.X0;
  const Y = (w - (v.oy || 0)) / v.S + v.Y0;
  const lon = X * 360 - 180;
  const lat = (Math.atan(Math.exp((0.5 - Y) * 2 * Math.PI)) * 360) / Math.PI - 90;
  return { lon, lat, inset: inInset };
}
