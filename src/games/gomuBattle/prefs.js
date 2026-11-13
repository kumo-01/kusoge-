// この端末だけの設定（ゴム鉄砲）: 視点の感度。ほかの人には関係ないので、部屋の設定ではなく端末に保存する
const KEY = 'wanwan.gomu.sens';
export const SENS_MIN = 0.5;
export const SENS_MAX = 2;

/** 視点の感度の倍率（1 = ふつう） */
export function getSens() {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v >= SENS_MIN && v <= SENS_MAX ? v : 1;
  } catch {
    return 1;
  }
}

export function setSens(v) {
  const x = Math.max(SENS_MIN, Math.min(SENS_MAX, Number(v) || 1));
  try {
    localStorage.setItem(KEY, String(x));
  } catch {
    // 保存できなくても、この試合では使える
  }
  return x;
}
