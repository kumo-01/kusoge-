// レース中のミニゲーム「リズムを真似しろ！」（判定はレースの計算役。画面・音には依存しない）
//
// 流れ（ミニゲームの時計 mg.t、秒）:
//   1) 予告   0 〜 INTRO                         「ミニゲーム！リズムを真似しろ！」。全員その場で止まる（レースの時計も止まる）
//   2) お手本 INTRO 〜 INTRO + len                お手本のリズムが鳴る（len: お手本の長さ）
//   3) 真似   playStart 〜 playEnd                 同じリズムでタップ（クリック / タップ / Enter / Space）
//   4) 結果   playEnd 〜 playEnd + RESULT          真似できた % と順位
//   5) 3・2・1 その後 COUNT 秒                      0 で再スタート。順位が上ほど長く加速（ブースト）
// 採点はリズムの「間隔」だけで比べる（最初の 1 回を合わせて、それ以降のずれを測る）。通信の遅れは関係しない。

import { nextRandom } from './items.js';

export const MG = {
  MAX: 2, // 1 レースで最大何回
  INTRO: 2.4,
  GAP: 1.4, // お手本が終わってから真似の開始まで
  PLAY_EXTRA: 2.6, // 真似の時間 = お手本の長さ + これ
  RESULT: 3.2,
  COUNT: 3,
  UNIT: 0.25, // リズムの最小単位（秒）。BPM 120 の 8 分音符
  PERFECT: 0.04, // ずれがこれ以内なら満点
  ZERO: 0.16, // ずれがこれ以上なら 0 点
  BOOST_MAX: 3.4, // 1 位のブーストの時間（秒）
  BOOST_MIN: 0.7, // 最下位のブーストの時間（秒）
  FREEZE_KEYS: ['sp', 'kx', 'kz', 'vy', 'y'], // 止めるときに 0 にする値
};

/** お手本のリズム（拍の時刻の配列、最初は 0）。拍の数は 6〜8、間隔は 0.25〜1.0 秒 */
export function makePattern(s) {
  const n = 6 + Math.floor(nextRandom(s) * 3);
  const steps = [1, 2, 2, 2, 3, 4];
  const out = [0];
  let t = 0;
  let ones = 0;
  for (let i = 1; i < n; i++) {
    let st = steps[Math.floor(nextRandom(s) * steps.length)];
    if (st === 1 && ++ones > 2) st = 2; // 細かい連打は 2 回まで
    t += st * MG.UNIT;
    out.push(Math.round(t * 1000) / 1000);
  }
  return out;
}

/** ミニゲームの各場面の始まりの時刻 */
export function mgTimes(pat) {
  const len = pat.length ? pat[pat.length - 1] : 0;
  const demo = MG.INTRO;
  const playStart = demo + len + MG.GAP;
  const playEnd = playStart + len + MG.PLAY_EXTRA;
  const result = playEnd;
  const count = result + MG.RESULT;
  const end = count + MG.COUNT;
  return { demo, len, playStart, playEnd, result, count, end };
}

/** 今の場面: 'intro' | 'demo' | 'wait' | 'play' | 'result' | 'count' */
export function mgPhase(mg) {
  const T = mgTimes(mg.pat);
  const t = mg.t;
  if (t < T.demo) return 'intro';
  if (t < T.demo + T.len + 0.4) return 'demo';
  if (t < T.playStart) return 'wait';
  if (t < T.playEnd) return 'play';
  if (t < T.count) return 'result';
  return 'count';
}

/**
 * 真似できた %（0〜100、整数）。taps: 押した時刻（秒）の配列、pat: お手本。
 * 最初の 1 回をお手本の最初に合わせ、そのうえで全体のずれがいちばん小さくなる位置に少しだけ合わせ直す。
 * お手本の拍ごとに、いちばん近い（まだ使っていない）押した時刻とのずれで点（PERFECT 以内 1 → ZERO で 0）。
 * 押した回数がお手本より多い・少ないと、その分だけ下がる（拍の数と押した数の多いほうで割る）
 */
export function mgScore(taps, pat) {
  if (!taps?.length || !pat?.length) return 0;
  const evalAt = (off) => {
    const used = new Uint8Array(taps.length);
    let sum = 0;
    const errs = [];
    for (const b of pat) {
      let bi = -1;
      let bd = Infinity;
      for (let j = 0; j < taps.length; j++) {
        if (used[j]) continue;
        const d = Math.abs(taps[j] - off - b);
        if (d < bd) {
          bd = d;
          bi = j;
        }
      }
      if (bi < 0 || bd >= MG.ZERO) continue;
      used[bi] = 1;
      errs.push(taps[bi] - off - b);
      sum += bd <= MG.PERFECT ? 1 : (MG.ZERO - bd) / (MG.ZERO - MG.PERFECT);
    }
    return { v: sum / Math.max(pat.length, taps.length), errs };
  };
  let off = taps[0] - pat[0];
  let r = evalAt(off);
  // 全体を平均のずれの分だけ動かしてみて、良くなれば使う
  if (r.errs.length) {
    const m = r.errs.reduce((a, b) => a + b, 0) / r.errs.length;
    const r2 = evalAt(off + m);
    if (r2.v > r.v) r = r2;
  }
  return Math.round(Math.max(0, Math.min(1, r.v)) * 100);
}

/** NPC の点（ボスは上手い） */
export function npcMgScore(s, boss) {
  const base = boss ? 78 : 58;
  const spread = boss ? 18 : 34;
  return Math.max(5, Math.min(100, Math.round(base + (nextRandom(s) - 0.5) * 2 * spread)));
}

/** 点数 sc（車ごと）から順位（1 = 一番。同点は車の番号が小さいほう）を出す */
export function mgRanks(sc) {
  return sc.map((v, i) => 1 + sc.filter((w, j) => w > v || (w === v && j < i)).length);
}

/** 再スタートのブーストの時間（秒）。1 位ほど長く、下位ほど短い */
export function mgBoost(sc, i) {
  const n = sc.length;
  if (!n) return 0;
  const r = mgRanks(sc)[i];
  const f = n > 1 ? (r - 1) / (n - 1) : 0;
  return Math.round((MG.BOOST_MAX - (MG.BOOST_MAX - MG.BOOST_MIN) * f) * 1000) / 1000;
}
