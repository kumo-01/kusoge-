// 都道府県県境バトルの地図の投影と範囲（県境のデータ・地図の画像・地図タイルで共通）。
// ウェブメルカトル図法（地図タイルと同じ）。地図の単位は「範囲の幅 = 1000」。沖縄も本来の位置に描く（別枠にしない）。

export const EXTENT = { lon0: 122.5, lon1: 146.5, latTop: 46.0, latBottom: 23.8 };

export const mercX = (lon) => (lon + 180) / 360;
export const mercY = (lat) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);

/** 地図の単位の定義: 単位 = (メルカトル座標 - 原点) × S */
export function makeView() {
  const X0 = mercX(EXTENT.lon0);
  const X1 = mercX(EXTENT.lon1);
  const Y0 = mercY(EXTENT.latTop);
  const Y1 = mercY(EXTENT.latBottom);
  const S = 1000 / (X1 - X0);
  // 1 単位のおよその長さ（北緯 36 度で）
  const kmPerUnit = ((EXTENT.lon1 - EXTENT.lon0) / 1000) * 111.32 * Math.cos((36 * Math.PI) / 180);
  return { X0, Y0, S, w: 1000, h: (Y1 - Y0) * S, kmPerUnit };
}

/** 経度・緯度 → 地図の単位 */
export function project(view, lon, lat) {
  return [(mercX(lon) - view.X0) * view.S, (mercY(lat) - view.Y0) * view.S];
}
