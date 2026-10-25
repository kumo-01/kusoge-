// アイテム: ホネアタック / バナナトラップ / わんわんブースト（判定はホストのみ）
import { ITEMS, KART } from './constants.js';

export const ITEM_INFO = {
  [ITEMS.BONE]: { name: 'ホネアタック', icon: '🦴' },
  [ITEMS.BANANA]: { name: 'バナナトラップ', icon: '🍌' },
  [ITEMS.BOOST]: { name: 'わんわんブースト', icon: '⚡' },
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
  let w; // [bone, banana, boost]
  if (rank === 1) w = [0.35, 0.5, 0.15];
  else if (rank === total) w = [0.35, 0.15, 0.5];
  else w = [0.45, 0.25, 0.3];
  if (r < w[0]) return ITEMS.BONE;
  if (r < w[0] + w[1]) return ITEMS.BANANA;
  return ITEMS.BOOST;
}

/** スピンさせる。無敵中なら false */
export function spinKart(k, dur) {
  if (k.inv > 0 || k.fin) return false;
  k.spin = dur;
  k.spinDur = dur;
  k.inv = dur + ITEMS.INVULN_AFTER_SPIN;
  k.sp *= 0.35;
  k.boost = 0;
  k.vy = Math.max(k.vy, 5);
  k.bump = 0.5;
  return true;
}

export function useItem(s, k, events) {
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
    if (!remove) {
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
