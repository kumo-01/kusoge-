// アイテム: ホネアタック / バナナトラップ / わんわんブースト / ガード / フリスビー / 飼い主登場 / 豪雨 / 犬小屋（判定はホストのみ）
import { ITEMS, KART, FOOD } from './constants.js';

export const ITEM_INFO = {
  [ITEMS.BONE]: { name: 'ホネアタック', icon: '🦴' },
  [ITEMS.BANANA]: { name: 'バナナトラップ', icon: '🍌' },
  [ITEMS.BOOST]: { name: 'わんわんブースト', icon: '⚡' },
  [ITEMS.GUARD]: { name: 'ガード', icon: '🛡️' },
  [ITEMS.FRISBEE]: { name: 'フリスビー', icon: '🥏' },
  [ITEMS.OWNER]: { name: '飼い主登場', icon: '🧑' },
  [ITEMS.RAIN]: { name: '豪雨', icon: '☔' },
  [ITEMS.HOUSE]: { name: '犬小屋', icon: '🏠' },
};

/** 決定的な乱数（状態をスナップショットに保存できる） */
export function nextRandom(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * 順位に応じてアイテムを選ぶ。rank: 1 = 先頭, total: 台数
 * - 飼い主登場・ブーストは後ろの順位ほど出やすい
 * - フリスビー・犬小屋は 2 位以下だけ / ガードは最下位以外 / 豪雨は最下位だけ
 */
export function itemWeights(rank, total) {
  const f = total > 1 ? (rank - 1) / (total - 1) : 0; // 0 = 先頭, 1 = 最下位
  const last = rank === total && total > 1;
  const w = [];
  w[ITEMS.BONE] = 0.24;
  w[ITEMS.BANANA] = 0.2;
  w[ITEMS.BOOST] = 0.1 + 0.18 * f;
  w[ITEMS.GUARD] = last ? 0 : 0.15;
  w[ITEMS.FRISBEE] = rank >= 2 ? 0.14 : 0;
  w[ITEMS.OWNER] = 0.32 * f * f;
  w[ITEMS.RAIN] = last ? 0.14 : 0;
  w[ITEMS.HOUSE] = rank >= 2 ? 0.05 + 0.1 * f : 0;
  return w;
}

export function chooseItem(s, rank, total) {
  const w = itemWeights(rank, total);
  let sum = 0;
  for (let i = 1; i < w.length; i++) sum += w[i];
  const r = nextRandom(s) * sum;
  let acc = 0;
  for (let i = 1; i < w.length; i++) {
    acc += w[i];
    if (w[i] > 0 && r < acc) return i;
  }
  return ITEMS.BONE;
}

/** スピンさせる。無敵中なら false（force: スピン後などの短い無敵は無視する。ガードと飼い主モードでは防がれる） */
export function spinKart(k, dur, force = false) {
  if (k.fin || k.ow > 0 || (k.inv > 0 && !force)) return false;
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

/**
 * 飼い主に引っ張ってもらえる時間。順位が低いほど長い（1 位は OWNER_MIN 秒、最下位は OWNER_TIME 秒、その間は順位に比例）。
 * progs: 全車の走行距離（なければ最長）
 */
export function ownerTime(karts, k, progs) {
  const n = karts.length;
  if (!progs || n < 2) return ITEMS.OWNER_TIME;
  let rank = 1;
  for (const o of karts) if (o !== k && (progs[o.i] > progs[k.i] || (o.fin && !k.fin))) rank++;
  return ITEMS.OWNER_MIN + ((ITEMS.OWNER_TIME - ITEMS.OWNER_MIN) * (rank - 1)) / (n - 1);
}

/** progs: 全車の走行距離（フリスビー・犬小屋の狙いを決める）。callRain: 豪雨を降らせる処理 */
export function useItem(s, k, events, progs = null, callRain = null) {
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
  } else if (item === ITEMS.OWNER) {
    k.ow = ownerTime(s.karts, k, progs);
    k.spin = 0;
    k.slow = 0;
    k.wet = 0;
  } else if (item === ITEMS.RAIN) {
    callRain?.(k);
  } else if (item === ITEMS.HOUSE) {
    // 今 1 位の車を狙う（自分が先頭になっていたら不発）
    let target = -1;
    let best = -Infinity;
    if (progs) {
      for (const o of s.karts) {
        if (o.fin && !o.npc) continue;
        if (progs[o.i] > best) {
          best = progs[o.i];
          target = o.i;
        }
      }
    }
    if (target < 0 || target === k.i) {
      events.push({ t: 'poof', x: k.x, z: k.z });
    } else {
      const tk = s.karts[target];
      s.houses.push({ id: s.nextId++, o: k.i, t: target, x: tk.x, z: tk.z, age: 0, hit: 0 });
      while (s.houses.length > ITEMS.HOUSE_MAX) s.houses.shift();
    }
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
      // フリスビー: コースに沿って飛び、狙った相手のいる横位置へ寄っていく（壁にぶつからず、カーブも曲がる）
      if (pr.ps === undefined) {
        const q = track.project(pr.x, pr.z);
        pr.ps = q.s;
        pr.pl = q.lat;
      }
      if (pr.sp === undefined) pr.sp = Math.hypot(pr.vx, pr.vz) || 1; // コースに沿って進む速さ（投げたときに決まる）
      const sp = pr.sp;
      const tg = pr.t >= 0 ? karts[pr.t] : null;
      const lim = track.roadHalf - 1.5;
      if (tg && !(tg.fin && !tg.npc)) {
        const tq = track.project(tg.x, tg.z);
        const ahead = track.wrapDS(tq.s - pr.ps);
        // 近くまで来たら相手そのものを狙う。まだ遠いときは相手の横位置（レーン）に寄る
        const goal = ahead > 0 && ahead < 14 ? tq.lat : Math.max(-lim, Math.min(lim, tq.lat));
        const dl = goal - pr.pl;
        const maxStep = ITEMS.FRISBEE_LATERAL * dt;
        pr.pl += Math.max(-maxStep, Math.min(maxStep, dl));
        if (ahead < -6) pr.t = -1; // 追い越してしまったら相手を追わない
      }
      pr.ps += sp * dt;
      const np = track.pointAt(pr.ps, pr.pl);
      pr.vx = (np.x - pr.x) / dt;
      pr.vz = (np.z - pr.z) / dt;
      pr.x = np.x;
      pr.z = np.z;
      pr.d += sp * dt;
      if (pr.d > ITEMS.FRISBEE_RANGE) pr.life = 0;
    } else {
      pr.x += pr.vx * dt;
      pr.z += pr.vz * dt;
    }
    let remove = pr.life <= 0;
    const p = track.project(pr.x, pr.z);
    const limit = track.wallDist - 0.5;
    if (!pr.f && Math.abs(p.lat) > limit) {
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
        if (k.ow > 0) continue; // 飼い主モード中はすり抜ける
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
        if (k.ow > 0) continue;
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

  // 犬小屋: 狙った車（1 位）の上を追いかけて、時間になったら落ちる。近くの車も巻き込まれる
  for (let i = s.houses.length - 1; i >= 0; i--) {
    const hs = s.houses[i];
    hs.age += dt;
    const tk = karts[hs.t];
    if (!hs.hit) {
      if (tk) {
        hs.x = tk.x;
        hs.z = tk.z;
      }
      if (hs.age >= ITEMS.HOUSE_DELAY) {
        hs.hit = 1;
        let n = 0;
        for (const k of karts) {
          if (k.i !== hs.t && (k.x - hs.x) ** 2 + (k.z - hs.z) ** 2 > ITEMS.HOUSE_RADIUS ** 2) continue;
          if (k.ow > 0) continue;
          k.gd = 0; // 犬小屋はガードでも防げない（ガードは割れる）
          if (spinKart(k, ITEMS.HOUSE_SPIN, true)) {
            n++;
            k.stats.hitBy++;
            if (k.i !== hs.o && karts[hs.o]) karts[hs.o].stats.hits++;
            events.push({ t: 'hit', k: k.i, by: hs.o, x: k.x, z: k.z });
          } else {
            events.push({ t: 'block', k: k.i, x: k.x, z: k.z });
          }
        }
        events.push({ t: 'house', k: hs.o, v: hs.t, x: hs.x, z: hs.z, n });
      }
    }
    if (hs.age >= ITEMS.HOUSE_DELAY + ITEMS.HOUSE_STAY) s.houses.splice(i, 1);
  }
}
