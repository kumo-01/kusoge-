// 端末の種類と画質設定。スマホ・タブレットは描画を軽めに始める。

const QUALITY_KEY = 'wanwan.quality';

function mq(q) {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
}

function detect() {
  const coarse = mq('(pointer: coarse)') || mq('(any-pointer: coarse)');
  const mem = navigator.deviceMemory || 4; // Chrome 系のみ。未対応なら 4GB 扱い
  const cores = navigator.hardwareConcurrency || 4;
  const short = Math.min(screen.width || 1000, screen.height || 1000);
  const phone = coarse && short < 700;
  const weak = mem <= 2 || (coarse && (mem <= 4 || cores <= 4));
  return {
    coarse,
    phone,
    tablet: coarse && !phone,
    // 「かるい」構成で始める端末（シーンの密度を下げ、影も小さくする）
    low: coarse || weak,
    // 描画解像度の上限（CSS ピクセルに対する倍率）
    maxPixelRatio: coarse || weak ? 1 : 1.5,
    shadowSize: coarse || weak ? 512 : 1024,
  };
}

export const device = detect();

/** 画質の設定: 'auto'（端末に合わせて自動）/ 'high'（高画質）/ 'light'（かるい） */
export function getQualityPref() {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return v === 'high' || v === 'light' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function setQualityPref(v) {
  try {
    localStorage.setItem(QUALITY_KEY, v);
  } catch {
    /* noop */
  }
}

/** 画面が消えないようにする（対応ブラウザのみ） */
export function keepAwake() {
  let lock = null;
  let stopped = false;
  const acquire = async () => {
    try {
      if (!stopped && navigator.wakeLock && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
    } catch {
      /* 取れなくても遊べる */
    }
  };
  const onVis = () => {
    if (document.visibilityState === 'visible') acquire();
  };
  document.addEventListener('visibilitychange', onVis);
  acquire();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVis);
    lock?.release?.().catch(() => {});
  };
}
