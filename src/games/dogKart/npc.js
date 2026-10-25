// NPC（コンピューター）の運転。ホストだけが実行し、入力ビットを作って人間と同じ物理で走らせる。
// 思考に使う状態（走行ライン・引っかかり時間）は車の状態に入れてあるので、スナップショットで復元できる。

import { IN, ITEMS, KART, NPC, TIMING } from './constants.js';
import { nextRandom } from './items.js';

function angleTo(k, x, z) {
  let d = Math.atan2(x - k.x, z - k.z) - k.h;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** コース上の s から先の曲がり具合（進行方向の変化量・ラジアン） */
function bendAhead(track, s, from, to) {
  const a = track.pointAt(s + from);
  const b = track.pointAt(s + to);
  let d = b.h - a.h;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/**
 * NPC の今回の入力を決める
 * @param {import('./race.js').RaceSim} sim
 */
export function npcInput(sim, k, dt) {
  const s = sim.s;
  const track = sim.track;
  if (s.phase === 'countdown') return 0;
  const p = track.project(k.x, k.z);
  const ps = p.s;
  const plat = p.lat;

  // 人間との差で手加減・追い上げ（ラバーバンド）
  let best = -Infinity;
  for (let i = 0; i < 2 && i < s.karts.length; i++) best = Math.max(best, sim.prog[i]);
  const gap = sim.prog[k.i] - best;
  k.ms = gap > NPC.RUBBER_DIST ? NPC.SPEED_AHEAD : gap < -NPC.RUBBER_DIST ? NPC.SPEED_BEHIND : NPC.SPEED;

  // ときどき走行ラインを変える
  k.at -= dt;
  if (k.at <= 0) {
    k.al = (nextRandom(s) * 2 - 1) * (track.roadHalf - 3.5);
    k.at = 1.5 + nextRandom(s) * 3;
  }
  // 前方のバナナはよける
  for (const bn of s.bananas) {
    const q = track.project(bn.x, bn.z);
    const ds = track.wrapDS(q.s - ps);
    if (ds > 2 && ds < 22 && Math.abs(q.lat - k.al) < 3.5) {
      k.al = q.lat > 0 ? q.lat - 5 : q.lat + 5;
      k.al = Math.max(-(track.roadHalf - 2), Math.min(track.roadHalf - 2, k.al));
    }
  }

  const look = 10 + Math.max(0, k.sp) * 0.45;
  const tgt = track.pointAt(ps + look, k.al);
  const d = angleTo(k, tgt.x, tgt.z);
  let bits = 0;
  if (d > 0.04) bits |= IN.LEFT;
  else if (d < -0.04) bits |= IN.RIGHT;

  // カーブの手前で減速
  const bend = bendAhead(track, ps, 6, 6 + Math.max(20, k.sp * 1.2));
  const fast = k.sp > KART.MAX_SPEED * k.ms * 0.78;
  if (bend > 1.25 && fast) bits |= IN.DOWN;
  else if (!(bend > 0.85 && fast)) bits |= IN.UP;
  // 芝生に出ていたら道路へ戻る
  if (Math.abs(plat) > track.roadHalf + 0.5) bits |= IN.UP;

  // 引っかかったら復帰
  if (s.phase === 'racing' && Math.abs(k.sp) < 2 && k.spin <= 0) k.as += dt;
  else k.as = Math.max(0, k.as - dt);
  if (k.as > 2.5) {
    k.as = 0;
    bits |= IN.RESPAWN;
  }

  // タイミングブースト: だいたいのタイミングで押す（ジャストとは限らない）
  if (k.tw > 0) {
    if (k.tn <= 0) k.tn = TIMING.SWEET + (nextRandom(s) - 0.5) * 0.5;
    if (k.tw <= k.tn) {
      bits |= IN.TAP;
      k.tn = 0;
    }
  }
  // 豪雨: 最終ラップに入ってしばらくすると呼ぶ（人間が先に呼べる余裕を残す）
  if (sim.canCallRain(k) && nextRandom(s) < dt * 0.35) bits |= IN.RAIN;

  // アイテム
  if (k.item && k.roll <= 0 && s.phase === 'racing') {
    const fx = Math.sin(k.h);
    const fz = Math.cos(k.h);
    let use = false;
    if (k.item === ITEMS.BOOST) {
      use = bend < 0.5;
    } else {
      for (const o of s.karts) {
        if (o === k) continue;
        const dx = o.x - k.x;
        const dz = o.z - k.z;
        const dist = Math.hypot(dx, dz);
        const dot = (dx * fx + dz * fz) / (dist || 1);
        if (k.item === ITEMS.BONE && dist < 45 && dot > 0.96) use = true;
        if (k.item === ITEMS.BANANA && dist < 26 && dot < -0.8) use = true;
      }
      // 長く持ちすぎたら適当に使う
      if (!use && nextRandom(s) < dt * 0.12) use = true;
    }
    if (use) bits |= IN.ITEM;
  }
  return bits;
}
