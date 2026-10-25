// タイミングブースト（ホストの正本とゲストの予測で共通に使う）
//
// レース開始時にチャンスの地点（スタートからの走行距離）を 1〜2 か所決める。
// 車がその地点を通るとリングが出て、縮んだリングが的に重なった瞬間に押すとブースト。
// 判定は「その車がチャンス地点を通ってからの時間」で行うので、
// ゲストの入力が通信で遅れて届いても、ゲストの画面で見たタイミングどおりに判定される。

import { KART, RACE, TIMING } from './constants.js';
import { nextRandom } from './items.js';

/** チャンスの地点を決める（1 回なら 2 周目、2 回なら 1 周目と 3 周目） */
export function pickChances(s, length) {
  const two = nextRandom(s) < 0.5;
  const at = (lap, from, to) => (lap + from + (to - from) * nextRandom(s)) * length;
  return two ? [at(0, 0.35, 0.8), at(RACE.LAPS - 1, 0.15, 0.6)] : [at(1, 0.25, 0.75)];
}

/** 判定: 2 = ジャスト, 1 = おしい（少しずれた）, 0 = 失敗 */
export function judgeTiming(tw) {
  const d = Math.abs(tw - TIMING.SWEET);
  return d <= TIMING.PERFECT ? 2 : d <= TIMING.GOOD ? 1 : 0;
}

/**
 * 1 tick 分の処理。stepKart の前に呼ぶ。
 * @param {object} k 車
 * @param {number} prog スタートからの走行距離
 * @param {number[]} chances チャンスの地点
 * @param {boolean} tapped この tick に押したか
 * @param {object[] | null} events 演出イベントの出力先（予測では null）
 */
export function stepTiming(k, prog, chances, tapped, dt, events) {
  if (k.tw > 0) {
    if (tapped) {
      const q = judgeTiming(k.tw);
      k.tw = 0;
      if (q > 0) {
        k.boost = Math.max(k.boost, q === 2 ? TIMING.BOOST_PERFECT : TIMING.BOOST_GOOD);
        k.sp = Math.min(KART.BOOST_SPEED, Math.max(k.sp, KART.MAX_SPEED * 0.8) + (q === 2 ? 8 : 4));
        k.stats.boosts++;
      }
      events?.push({ t: 'timing', k: k.i, q, x: k.x, z: k.z });
      return;
    }
    k.tw -= dt;
    if (k.tw <= 0) {
      k.tw = 0;
      events?.push({ t: 'timing', k: k.i, q: -1, x: k.x, z: k.z }); // 押さないまま終わった
    }
    return;
  }
  if (k.tb < chances.length && prog >= chances[k.tb] && !k.fin) {
    k.tb++;
    k.tw = TIMING.WINDOW;
  }
}
