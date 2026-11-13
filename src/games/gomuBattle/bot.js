// CPU の犬の考え方。見える相手がいれば狙って撃ち、横に動いてよける。いなければアイテムの箱や相手のいた所へ向かう。
// ぶつかって進めないときはジャンプ・伏せ・行き先の変更で抜け出す。

import { BOT, PLAYER, ITEM, ITEMS, BAND_ITEMS, GUN, WEAPON, WEAPONS, BOSS, EXTRA } from './constants.js';
import { canSee, ROOM } from './arena.js';
import { aimDir, eyeOf, heightOf } from './physics.js';

const rnd = Math.random;
/** のぞいて遠くを狙う武器（スナイパー・ライフル） */
const scoped = (p) => p.weapon === WEAPON.SNIPER || p.weapon === WEAPON.RIFLE;
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** 線分 a → b が、煙の中を通るか */
export function smokeBlocks(sim, ax, ay, az, bx, by, bz) {
  for (const sm of sim.s.smokes) {
    const r = ITEMS.SMOKE_RADIUS;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const l2 = dx * dx + dy * dy + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((sm.x - ax) * dx + (sm.y - ay) * dy + (sm.z - az) * dz) / l2));
    if ((ax + dx * t - sm.x) ** 2 + (ay + dy * t - sm.y) ** 2 + (az + dz * t - sm.z) ** 2 < r * r * 0.8) return true;
  }
  return false;
}

/** 1 tick 分の CPU の操作を決める（向きは p.yaw / p.pitch を直接変える。撃つ・アイテムは sim を呼ぶ） */
export function botThink(sim, p, dt) {
  const b = (p.bot2 ||= { tgt: -1, see: 0, look: 0, goal: null, strafe: 1, strafeT: 0, chk: 0, lastX: p.x, lastZ: p.z, blocked: 0, err: [0, 0], errT: 0, jumpCd: 0, crouchT: 0, seenAt: null, prevT: {} });
  const inp = { fx: 0, fz: 0, jump: false, dash: false, crouch: false };
  if (p.dead > 0) return inp;
  const arena = sim.cw;
  const ex = p.x;
  const ey = p.y + eyeOf(p);
  const ez = p.z;
  // 相手を探す（重いので数 tick に 1 回）
  if ((b.look -= dt) <= 0) {
    b.look = 0.12;
    let best = -1;
    let bd = BOT.VIEW * (scoped(p) ? 1.6 : 1) * (sim.s.rain > 0 ? EXTRA.RAIN_VIEW : 1); // 雨の間は遠くが見えにくい
    b.decoy = null;
    const boss = sim.s.boss;
    if (boss && boss.hp > 0) {
      // ボス戦: 猫だけを狙う（見えていれば）
      const by = boss.y + BOSS.HEIGHT * 0.6;
      if (canSee(arena, ex, ey, ez, boss.x, by, boss.z) && !smokeBlocks(sim, ex, ey, ez, boss.x, by, boss.z)) best = -2;
    } else for (const q of sim.s.players) {
      if (!sim.foes(p.i, q.i) || q.dead > 0) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d >= bd) continue;
      const qy = q.y + heightOf(q) * 0.6;
      if (!canSee(arena, ex, ey, ez, q.x, qy, q.z) || smokeBlocks(sim, ex, ey, ez, q.x, qy, q.z)) continue;
      bd = d;
      best = q.i;
    }
    // おとり人形（敵のもの）がもっと近くに見えたら、そっちを狙ってしまう
    if (best !== -2) {
      for (const dc of sim.s.decoys || []) {
        if (!sim.foes(p.i, dc.o)) continue;
        const d = Math.hypot(dc.x - p.x, dc.z - p.z);
        if (d >= bd) continue;
        if (!canSee(arena, ex, ey, ez, dc.x, dc.y + 0.7, dc.z)) continue;
        bd = d;
        best = -3;
        b.decoy = dc.id;
      }
    }
    if (best !== b.tgt) b.see = 0;
    b.tgt = best;
  }
  const bs = sim.s.boss;
  const dcT = b.tgt === -3 ? (sim.s.decoys || []).find((d) => d.id === b.decoy) : null;
  const q = b.tgt === -2 && bs && bs.hp > 0 ? { i: -2, x: bs.x, y: bs.y, z: bs.z, dead: 0, h: BOSS.HEIGHT } : dcT ? { i: -3, x: dcT.x, y: dcT.y, z: dcT.z, dead: 0, h: PLAYER.HEIGHT } : b.tgt >= 0 ? sim.s.players[b.tgt] : null;
  const W = WEAPONS[p.weapon] || WEAPONS[WEAPON.NORMAL];
  // 狙いのぶれ（ゆっくり変わる。照準ぶれのときは大きい）
  if ((b.errT -= dt) <= 0) {
    b.errT = 0.4 + rnd() * 0.4;
    const e = BOT.AIM_ERROR * (p.shake > 0 ? 5 : 1);
    b.err = [(rnd() - 0.5) * 2 * e, (rnd() - 0.5) * 2 * e];
  }
  b.jumpCd = Math.max(0, b.jumpCd - dt);
  if (q && q.dead <= 0) {
    b.see += dt;
    b.seenAt = { x: q.x, z: q.z };
    // 相手の動きを見て、少し先を狙う
    const pv = b.prevT[q.i];
    const vx = pv ? (q.x - pv.x) / dt : 0;
    const vz = pv ? (q.z - pv.z) / dt : 0;
    b.prevT[q.i] = { x: q.x, z: q.z };
    const qy = q.y + (q.h ?? heightOf(q)) * 0.55;
    const dist = Math.hypot(q.x - ex, qy - ey, q.z - ez);
    const lead = Math.min(0.6, dist / W.speed) * BOT.LEAD;
    const tx = q.x + vx * lead;
    const tz = q.z + vz * lead;
    const hd = Math.hypot(tx - ex, tz - ez);
    // 落ちる分だけ上を狙う
    const bal = lobPitch(W.speed, W.gravity, hd, qy - ey);
    const em = p.weapon === WEAPON.RIFLE ? 2.6 : 1; // ライフル（一撃）の CPU は狙いを少しへたに（強すぎないように）
    const wantYaw = Math.atan2(tx - ex, tz - ez) + b.err[0] * em;
    const wantPitch = (bal ?? Math.atan2(qy - ey, hd)) + b.err[1] * em;
    const turn = BOT.TURN * dt;
    const dy = angDiff(p.yaw, wantYaw);
    p.yaw += Math.max(-turn, Math.min(turn, dy));
    p.pitch += Math.max(-turn, Math.min(turn, wantPitch - p.pitch));
    // 動き: 横に動いてよける。遠ければ近づき、近すぎれば離れる
    if ((b.strafeT -= dt) <= 0) {
      // 横へ動いてよける（向きは少し長めに保つ。ときどき止まって撃つ）
      b.strafeT = 0.9 + rnd() * 1.3;
      b.strafe = rnd() < (scoped(p) ? 0.55 : 0.2) ? 0 : rnd() < 0.5 ? -0.9 : 0.9; // スナイパー・ライフルは高台でじっと狙う
    }
    inp.fx = b.strafe;
    // スナイパー: 近くに高台があれば、狙いながらそこへ上る（上に着いたらじっと狙う）
    const perch = scoped(p) ? nearPerch(sim.arena, p, 20) : null;
    if (perch) {
      const dxw = perch.x - p.x;
      const dzw = perch.z - p.z;
      const l = Math.hypot(dxw, dzw) || 1;
      if (l > 1.2 || p.y < perch.y - 0.2) {
        // 世界の向き → 自分の向きから見た前・右（前 = (sin yaw, cos yaw)、右 = (-cos yaw, sin yaw)）
        inp.fz = (dxw * Math.sin(p.yaw) + dzw * Math.cos(p.yaw)) / l;
        inp.fx = (-dxw * Math.cos(p.yaw) + dzw * Math.sin(p.yaw)) / l;
      } else inp.fx = 0;
    } else if (q.i === -2) inp.fz = dist > 14 ? 1 : dist < 8 ? -1 : 0; // 間合い: ボス戦は猫の手が届かない所から
    else if (scoped(p)) inp.fz = dist > 24 ? 1 : dist < 10 ? -0.8 : 0; // スナイパー・ライフルは遠くから
    else inp.fz = dist > 12 ? 1 : dist < 4 ? -0.7 : 0;
    // 走る: よろけたときと、遠くの相手へ近づくとき（ゲージに余裕があれば）
    if ((p.stun > 0 || (inp.fz > 0.5 && dist > 20)) && (p.stam ?? 0) > 40) inp.dash = true;
    // 撃つ（見つけてから少し待ってから、だいたい狙えているとき）
    if (b.see > BOT.REACT * (p.weapon === WEAPON.RIFLE ? 2 : 1) && Math.abs(dy) < (scoped(p) ? 0.06 : 0.1) && dist < BOT.VIEW * (scoped(p) ? 1.6 : 1)) {
      const d = aimDir(p.yaw, p.pitch);
      sim.tryFire(p, [ex, ey, ez], d);
    }
    // 爆弾（1 ラウンドに 5 回まで）: 届く距離で、ときどき山なりに投げる（狙いはへため。まとめて当たると強いので）
    if (p.bombs > 0 && p.bombCd <= 0 && b.see > BOT.REACT && dist > 6 && dist < 17 && rnd() < dt * 0.25) {
      const BW = WEAPONS[WEAPON.BOMB];
      const lp = lobPitch(BW.speed, BW.gravity, hd, q.y + 0.3 - ey);
      if (lp != null) sim.throwBomb(p.i, [ex, ey, ez], aimDir(Math.atan2(tx - ex, tz - ez) + b.err[0] * 2.2, lp + b.err[1] * 2.2));
    }
    // アイテム
    if (p.item) {
      const it = p.item;
      const use = (it === ITEM.DECOY && dist < 18) || BAND_ITEMS.includes(it) || (it === ITEM.SMOKE && dist < 11) || it === ITEM.SHAKE || it === ITEM.NOAMMO || (it === ITEM.GUM && dist < 6) || (it === ITEM.STAR && dist < 15) || (it === ITEM.HEAL && p.hp <= PLAYER.HP - ITEMS.HEAL);
      if (use) sim.useItem(p.i, [ex, ey, ez], aimDir(p.yaw, p.pitch));
    }
  } else {
    // 相手が見えない: アイテム → 最後に見た所 → 適当な所 へ歩く。着いたら少しその場で見張る
    if (b.wait > 0) b.wait -= dt;
    else if (!b.goal || Math.hypot(b.goal.x - p.x, b.goal.z - p.z) < 1 || (b.goalT -= dt) <= 0) {
      if (b.goal && rnd() < (b.goal.perch ? 0.5 : 0.3)) b.wait = b.goal.perch ? 4 + rnd() * 4 : 0.5 + rnd() * 1.0; // 高台に着いたスナイパーはしばらく見張る
      b.goal = pickGoal(sim, p, b);
    }
    const wantYaw = Math.atan2(b.goal.x - p.x, b.goal.z - p.z);
    const turn = 4 * dt;
    if (!(b.wait > 0)) p.yaw += Math.max(-turn, Math.min(turn, angDiff(p.yaw, wantYaw)));
    p.pitch *= 0.9;
    inp.fz = b.wait > 0 ? 0 : Math.abs(angDiff(p.yaw, wantYaw)) < 1.2 ? 1 : 0.2;
    // 遠くの行き先へは、ゲージに余裕があれば走る
    if (inp.fz > 0.5 && b.goal && Math.hypot(b.goal.x - p.x, b.goal.z - p.z) > 12 && (p.stam ?? 0) > 60) inp.dash = true;
    if (p.item === ITEM.GUM && rnd() < 0.01) sim.useItem(p.i, [ex, ey, ez], aimDir(p.yaw, p.pitch));
    if (p.item && (BAND_ITEMS.includes(p.item) || (p.item === ITEM.HEAL && p.hp < PLAYER.HP))) sim.useItem(p.i, [ex, ey, ez], aimDir(p.yaw, p.pitch));
  }
  // 進めていないとき: ジャンプ、伏せ、行き先を変える
  if ((b.chk -= dt) <= 0) {
    b.chk = 0.35;
    const moved = Math.hypot(p.x - b.lastX, p.z - b.lastZ);
    b.lastX = p.x;
    b.lastZ = p.z;
    const want = Math.hypot(inp.fx, inp.fz) > 0.3 && p.stuck <= 0;
    b.blocked = want && moved < 0.5 ? b.blocked + 1 : 0;
  }
  if (b.blocked >= 1) {
    // 前が低い天板（テーブルの下）なら伏せ、そうでなければジャンプ
    const fx = p.x + Math.sin(p.yaw) * 0.8;
    const fz = p.z + Math.cos(p.yaw) * 0.8;
    const low = arena.boxes.some((bx) => fx > bx.x0 && fx < bx.x1 && fz > bx.z0 && fz < bx.z1 && bx.y0 > p.y + PLAYER.CROUCH_HEIGHT && bx.y0 < p.y + PLAYER.HEIGHT);
    if (low) b.crouchT = 1.2;
    else if (b.jumpCd <= 0) {
      inp.jump = true;
      b.jumpCd = 0.8;
    }
    if (b.blocked >= 3) {
      b.goal = randomSpot(arena);
      b.goalT = 3;
      b.blocked = 0;
      b.strafe = -b.strafe;
    }
  }
  if (b.crouchT > 0) {
    b.crouchT -= dt;
    inp.crouch = true;
  }
  return inp;
}

/**
 * 速さ v・重力 g で、水平に hd 先・高さ h 上の所へ届く低い方の角度（届かなければ null）
 */
export function lobPitch(v, g, hd, h) {
  if (g < 1e-6) return Math.atan2(h, hd);
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * hd * hd + 2 * h * v2);
  if (disc < 0) return null;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * Math.max(0.01, hd)));
}

function randomSpot(arena) {
  for (let k = 0; k < 20; k++) {
    const x = (Math.random() - 0.5) * (ROOM.W - 3);
    const z = (Math.random() - 0.5) * (ROOM.D - 3);
    if (!arena.boxes.some((b) => x > b.x0 - 0.5 && x < b.x1 + 0.5 && z > b.z0 - 0.5 && z < b.z1 + 0.5 && b.y0 < 0.5)) return { x, z };
  }
  return { x: 0, z: 0 };
}

/** p から r 以内でいちばん近い高台の上（なければ null） */
function nearPerch(arena, p, r) {
  let best = null;
  let bd = r;
  for (const x of perches(arena)) {
    const d = Math.hypot(x.x - p.x, x.z - p.z);
    if (d < bd) {
      bd = d;
      best = x;
    }
  }
  return best;
}

/** 高台のいちばん上（スナイパーの見張り場所）。会場ごとに 1 回だけ探す */
function perches(arena) {
  if (arena._perches) return arena._perches;
  const hills = arena.boxes.filter((x) => x.k === 'hill');
  const cx = (x) => (x.x0 + x.x1) / 2;
  const cz = (x) => (x.z0 + x.z1) / 2;
  arena._perches = hills.filter((x) => !hills.some((o) => o !== x && Math.abs(cx(o) - cx(x)) < 0.01 && Math.abs(cz(o) - cz(x)) < 0.01 && o.y1 > x.y1)).map((x) => ({ x: cx(x), z: cz(x), y: x.y1, perch: true }));
  return arena._perches;
}

function pickGoal(sim, p, b) {
  b.goalT = 5 + Math.random() * 3;
  const arena = sim.arena;
  // 空からの補給箱が近くに落ちてくるなら、取りに行く
  const dp = sim.s.drop;
  if (dp && Math.hypot(dp.x - p.x, dp.z - p.z) < 35 && Math.random() < 0.8) {
    b.goalT = 12;
    return { x: dp.x, z: dp.z };
  }
  // 体力が減っていたら、いちばん近い回復のおやつへ
  if (p.hp < 55 && arena.heals?.length) {
    let best = null;
    let bd = Infinity;
    arena.heals.forEach(([x, z], k) => {
      if (sim.s.heals?.[k] > 0) return;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bd) {
        bd = d;
        best = { x, z };
      }
    });
    if (best) return best;
  }
  // スナイパーは高台へ（近い方）
  if (scoped(p) && Math.random() < 0.6) {
    const ps = perches(arena);
    if (ps.length) {
      const g = ps.reduce((m, x) => (Math.hypot(x.x - p.x, x.z - p.z) < Math.hypot(m.x - p.x, m.z - p.z) ? x : m));
      b.goalT = 14;
      return { ...g };
    }
  }
  if (!p.item) {
    // いちばん近い、出ているアイテムの箱
    let best = null;
    let bd = Infinity;
    arena.items.forEach(([x, z], k) => {
      if (sim.s.boxes[k] > 0) return;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bd) {
        bd = d;
        best = { x, z };
      }
    });
    if (best && Math.random() < 0.7) return best;
  }
  if (b.seenAt && Math.random() < 0.6) {
    const g = b.seenAt;
    b.seenAt = null;
    return g;
  }
  // 生きている相手のだいたいの方向へ
  const others = sim.s.players.filter((q) => q.i !== p.i && q.dead <= 0);
  if (others.length && Math.random() < 0.6) {
    const q = others[Math.floor(Math.random() * others.length)];
    return { x: q.x + (Math.random() - 0.5) * 4, z: q.z + (Math.random() - 0.5) * 4 };
  }
  return randomSpot(arena);
}
