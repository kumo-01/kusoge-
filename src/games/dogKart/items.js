// アイテム: ホネアタック / バナナトラップ / わんわんブースト（判定はホストのみ）
import { ITEMS, KART, FOOD } from './constants.js';

export const ITEM_INFO = {
  [ITEMS.BONE]: { name: 'ホネアタック', icon: '🦴' },
  [ITEMS.BANANA]: { name: 'バナナトラップ', icon: '🍌' },
  [ITEMS.BOOST]: { name: 'わんわんブースト', icon: '⚡' },
  [ITEMS.GUARD]: { name: 'ガード', icon: '🛡️' },
  [ITEMS.FRISBEE]: { name: 'フリスビー', icon: '🥏' },
};

/** 決定的な乱数（状態をスナップショットに保存できる） */
export function nextRandom(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 順位に応じてアイテムを選ぶ（後ろの人ほどブーストが出やすい）。rank: 1 = 先頭, total: 台数 */
export function chooseItem(s, rank, total) {
  const r = nextRandom(s);
  let w; // [bone, banana, boost, guard, frisbee]（先頭は追尾する相手がいないのでフリスビーは出にくい）
  if (rank === 1) w = [0.25, 0.3, 0.1, 0.3, 0.05];
  else if (rank === total) w = [0.2, 0.1, 0.3, 0.1, 0.3];
  else w = [0.3, 0.2, 0.2, 0.15, 0.15];
  const order = [ITEMS.BONE, ITEMS.BANANA, ITEMS.BOOST, ITEMS.GUARD, ITEMS.FRISBEE];
  let acc = 0;
  for (let i = 0; i < w.length; i++) {
    acc += w[i];
    if (r < acc) return order[i];
  }
  return ITEMS.FRISBEE;
}

/** スピンさせる。無敵中なら false */
export function spinKart(k, dur) {
  if (k.inv > 0 || k.fin) return false;
  if (k.gd > 0) {
    // ガード: 1 回だけ防ぐ（直後の連続ヒットを避けるため少しだけ無敵）
    k.gd = 0;
    k.inv = 0.8;
    return false;
  }
  k.fd = Math.max(0, (k.fd || 0) - FOOD.HIT_LOSS); // ぶつけられるとドッグフードを落とす
  k.spin = dur;
  k.spinDur = dur;
  k.inv = dur + ITEMS.INVULN_AFTER_SPIN;
  k.sp *= 0.35;
  k.boost = 0;
  k.vy = Math.max(k.vy, 5);
  k.bump = 0.5;
  return true;
}

/** progs: 全車の走行距離（フリスビーの追尾先を決める） */
export function useItem(s, k, events, progs = null) {
  if (!k.item || k.roll > 0) return;
  const item = k.item;
  k.item = 0;
  k.stats.items++;
  const fx = Math.sin(k.h);
  const fz = Math.cos(k.h);
  if (item === ITEMS.BONE) {
    const speed = Math.max(0, k.sp) + ITEMS.BONE_SPEED;
    s.proj.push({
      id: s.nextId++,
      o: k.i,
      x: k.x + fx * 2.4,
      z: k.z + fz * 2.4,
      vx: fx * speed,
      vz: fz * speed,
      life: ITEMS.BONE_LIFE,
      age: 0,
      b: ITEMS.BONE_BOUNCES,
    });
  } else if (item === ITEMS.BANANA) {
    s.bananas.push({ id: s.nextId++, o: k.i, x: k.x - fx * 2.8, z: k.z - fz * 2.8, life: ITEMS.BANANA_LIFE, age: 0 });
    while (s.bananas.length > ITEMS.BANANA_MAX) s.bananas.shift();
  } else if (item === ITEMS.GUARD) {
    k.gd = ITEMS.GUARD_TIME;
  } else if (item === ITEMS.FRISBEE) {
    // 自分のすぐ前にいる相手を追いかける（いなければまっすぐ飛ぶ）
    let target = -1;
    if (progs) {
      let best = Infinity;
      for (const o of s.karts) {
        if (o === k || (o.fin && !o.npc)) continue;
        const d = progs[o.i] - progs[k.i];
        if (d > 0 && d < best) {
          best = d;
          target = o.i;
        }
      }
    }
    const speed = Math.max(0, k.sp) + ITEMS.FRISBEE_SPEED;
    s.proj.push({
      id: s.nextId++,
      o: k.i,
      x: k.x + fx * 2.4,
      z: k.z + fz * 2.4,
      vx: fx * speed,
      vz: fz * speed,
      life: ITEMS.FRISBEE_RANGE / speed + 1,
      age: 0,
      b: ITEMS.FRISBEE_BOUNCES,
      f: 1,
      t: target,
      d: 0,
    });
  } else if (item === ITEMS.BOOST) {
    k.boost = ITEMS.BOOST_TIME;
    k.sp = Math.min(KART.BOOST_SPEED, Math.max(k.sp, KART.MAX_SPEED * 0.85) + 6);
    k.stats.boosts++;
  }
  events.push({ t: 'use', k: k.i, item, x: k.x, z: k.z });
}

/**
 * アイテムボックス・飛翔物・バナナの更新と当たり判定
 * @param {(i: number) => number} rankOf 車 i の現在順位（1 = 先頭）
 */
export function updateItems(s, dt, track, boxPos, rankOf, events) {
  const karts = s.karts;
  for (const k of karts) if (k.gd > 0) k.gd = Math.max(0, k.gd - dt);

  // ボックス: アイテムを受け取れる車（手ぶら・ルーレット中でない）だけが箱を割る。
  // すでに持っている車はすり抜けるので、1人が箱を全部消して総取りすることはできない。
  for (let b = 0; b < s.boxes.length; b++) {
    if (s.boxes[b] > 0) {
      s.boxes[b] = Math.max(0, s.boxes[b] - dt);
      continue;
    }
    const p = boxPos[b];
    for (const k of karts) {
      if (k.item || k.roll > 0 || (k.fin && !k.npc)) continue;
      const dx = k.x - p.x;
      const dz = k.z - p.z;
      if (dx * dx + dz * dz < (ITEMS.BOX_RADIUS + KART.RADIUS) ** 2 && k.y < 2) {
        s.boxes[b] = ITEMS.BOX_RESPAWN;
        k.roll = ITEMS.ROULETTE;
        events.push({ t: 'box', k: k.i, b, grant: true });
        break;
      }
    }
  }

  // ルーレット
  for (const k of karts) {
    if (k.roll > 0) {
      k.roll -= dt;
      if (k.roll <= 0) {
        k.roll = 0;
        k.item = chooseItem(s, rankOf(k.i), karts.length);
        events.push({ t: 'item', k: k.i, item: k.item });
      }
    }
  }

  // ホネ（壁で跳ね返る）
  for (let i = s.proj.length - 1; i >= 0; i--) {
    const pr = s.proj[i];
    pr.age += dt;
    pr.life -= dt;
    if (pr.f) {
      // フリスビー: 狙った相手の方へ少しずつ向きを変える。飛べる距離には限りがある
      const sp = Math.hypot(pr.vx, pr.vz) || 1;
      const tg = pr.t >= 0 ? karts[pr.t] : null;
      if (tg && !(tg.fin && !tg.npc)) {
        const cur = Math.atan2(pr.vx, pr.vz);
        let d = Math.atan2(tg.x - pr.x, tg.z - pr.z) - cur;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const na = cur + Math.max(-ITEMS.FRISBEE_TURN * dt, Math.min(ITEMS.FRISBEE_TURN * dt, d));
        pr.vx = Math.sin(na) * sp;
        pr.vz = Math.cos(na) * sp;
      }
      pr.d += sp * dt;
      if (pr.d > ITEMS.FRISBEE_RANGE) pr.life = 0;
    }
    pr.x += pr.vx * dt;
    pr.z += pr.vz * dt;
    let remove = pr.life <= 0;
    const p = track.project(pr.x, pr.z);
    const limit = track.wallDist - 0.5;
    if (Math.abs(p.lat) > limit) {
      const sgn = p.lat > 0 ? 1 : -1;
      const nx = p.nx * sgn;
      const nz = p.nz * sgn;
      const vn = pr.vx * nx + pr.vz * nz;
      if (vn > 0) {
        pr.vx -= 2 * vn * nx;
        pr.vz -= 2 * vn * nz;
      }
      pr.x = p.cx + nx * limit;
      pr.z = p.cz + nz * limit;
      if (--pr.b < 0) remove = true;
      else events.push({ t: 'boing', x: pr.x, z: pr.z });
    }
    if (!remove) {
      for (const k of karts) {
        if (k.i === pr.o && pr.age < 0.5) continue; // 投げた直後に自分に当たらない（跳ね返りには当たる）
        const dx = k.x - pr.x;
        const dz = k.z - pr.z;
        if (dx * dx + dz * dz < ITEMS.BONE_HIT_R ** 2 && k.y < 2.5) {
          remove = true;
          if (spinKart(k, ITEMS.BONE_SPIN)) {
            k.stats.hitBy++;
            if (k.i !== pr.o && karts[pr.o]) karts[pr.o].stats.hits++;
            events.push({ t: 'hit', k: k.i, by: pr.o, x: k.x, z: k.z });
          } else {
            events.push({ t: 'block', k: k.i, x: k.x, z: k.z });
          }
          break;
        }
      }
    }
    if (!remove && !pr.f) {
      // ホネとバナナがぶつかると両方消える
      for (let j = s.bananas.length - 1; j >= 0; j--) {
        const bn = s.bananas[j];
        if ((bn.x - pr.x) ** 2 + (bn.z - pr.z) ** 2 < 2.2) {
          s.bananas.splice(j, 1);
          remove = true;
          events.push({ t: 'poof', x: pr.x, z: pr.z });
          break;
        }
      }
    }
    if (remove) {
      s.proj.splice(i, 1);
      if (pr.life <= 0) events.push({ t: 'poof', x: pr.x, z: pr.z });
    }
  }

  // バナナ
  for (let i = s.bananas.length - 1; i >= 0; i--) {
    const bn = s.bananas[i];
    bn.age += dt;
    bn.life -= dt;
    let remove = bn.life <= 0;
    if (!remove) {
      for (const k of karts) {
        if (k.i === bn.o && bn.age < 0.8) continue;
        const dx = k.x - bn.x;
        const dz = k.z - bn.z;
        if (dx * dx + dz * dz < ITEMS.BANANA_HIT_R ** 2 && k.y < 1.5) {
          remove = true;
          if (spinKart(k, ITEMS.BANANA_SPIN)) {
            k.stats.hitBy++;
            if (k.i !== bn.o && karts[bn.o]) karts[bn.o].stats.hits++;
            events.push({ t: 'slip', k: k.i, by: bn.o, x: bn.x, z: bn.z });
          } else {
            events.push({ t: 'block', k: k.i, x: k.x, z: k.z });
          }
          break;
        }
      }
    }
    if (remove) s.bananas.splice(i, 1);
  }
}
