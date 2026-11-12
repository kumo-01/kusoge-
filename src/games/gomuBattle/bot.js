// CPU の犬の考え方。見える相手がいれば狙って撃ち、横に動いてよける。いなければアイテムの箱や相手のいた所へ向かう。
// ぶつかって進めないときはジャンプ・伏せ・行き先の変更で抜け出す。

import { BOT, PLAYER, ITEM, ITEMS, BAND_ITEMS, GUN } from './constants.js';
import { canSee, ROOM } from './arena.js';
import { aimDir, eyeOf, heightOf } from './physics.js';

const rnd = Math.random;
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
    let bd = BOT.VIEW;
    for (const q of sim.s.players) {
      if (q.i === p.i || q.dead > 0) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d >= bd) continue;
      const qy = q.y + heightOf(q) * 0.6;
      if (!canSee(arena, ex, ey, ez, q.x, qy, q.z) || smokeBlocks(sim, ex, ey, ez, q.x, qy, q.z)) continue;
      bd = d;
      best = q.i;
    }
    if (best !== b.tgt) b.see = 0;
    b.tgt = best;
  }
  const q = b.tgt >= 0 ? sim.s.players[b.tgt] : null;
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
    const qy = q.y + heightOf(q) * 0.55;
    const dist = Math.hypot(q.x - ex, qy - ey, q.z - ez);
    const lead = Math.min(0.6, dist / GUN.SPEED) * BOT.LEAD;
    const tx = q.x + vx * lead;
    const tz = q.z + vz * lead;
    const hd = Math.hypot(tx - ex, tz - ez);
    const drop = 0.5 * GUN.GRAVITY * (hd / GUN.SPEED) ** 2; // 少し落ちるので上を狙う
    const wantYaw = Math.atan2(tx - ex, tz - ez) + b.err[0];
    const wantPitch = Math.atan2(qy + drop - ey, hd) + b.err[1];
    const turn = BOT.TURN * dt;
    const dy = angDiff(p.yaw, wantYaw);
    p.yaw += Math.max(-turn, Math.min(turn, dy));
    p.pitch += Math.max(-turn, Math.min(turn, wantPitch - p.pitch));
    // 動き: 横に動いてよける。遠ければ近づき、近すぎれば離れる
    if ((b.strafeT -= dt) <= 0) {
      b.strafeT = 0.6 + rnd() * 1.2;
      b.strafe = rnd() < 0.5 ? -1 : 1;
    }
    inp.fx = b.strafe;
    inp.fz = dist > 12 ? 1 : dist < 4 ? -0.7 : 0;
    if (p.stun > 0 && rnd() < 0.05) inp.dash = true;
    // 撃つ（見つけてから少し待ってから、だいたい狙えているとき）
    if (b.see > BOT.REACT && Math.abs(dy) < 0.1 && dist < BOT.VIEW) {
      const d = aimDir(p.yaw, p.pitch);
      sim.tryFire(p, [ex, ey, ez], d);
    }
    // アイテム
    if (p.item) {
      const it = p.item;
      const use = BAND_ITEMS.includes(it) || (it === ITEM.SMOKE && dist < 11) || it === ITEM.SHAKE || it === ITEM.NOAMMO || (it === ITEM.GUM && dist < 6) || (it === ITEM.STAR && dist < 15) || (it === ITEM.HEAL && p.hp <= PLAYER.HP - ITEMS.HEAL);
      if (use) sim.useItem(p.i, [ex, ey, ez], aimDir(p.yaw, p.pitch));
    }
  } else {
    // 相手が見えない: アイテム → 最後に見た所 → 適当な所 へ歩く
    if (!b.goal || Math.hypot(b.goal.x - p.x, b.goal.z - p.z) < 1 || (b.goalT -= dt) <= 0) b.goal = pickGoal(sim, p, b);
    const wantYaw = Math.atan2(b.goal.x - p.x, b.goal.z - p.z);
    const turn = 4 * dt;
    p.yaw += Math.max(-turn, Math.min(turn, angDiff(p.yaw, wantYaw)));
    p.pitch *= 0.9;
    inp.fz = Math.abs(angDiff(p.yaw, wantYaw)) < 1.2 ? 1 : 0.2;
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

function randomSpot(arena) {
  for (let k = 0; k < 20; k++) {
    const x = (Math.random() - 0.5) * (ROOM.W - 3);
    const z = (Math.random() - 0.5) * (ROOM.D - 3);
    if (!arena.boxes.some((b) => x > b.x0 - 0.5 && x < b.x1 + 0.5 && z > b.z0 - 0.5 && z < b.z1 + 0.5 && b.y0 < 0.5)) return { x, z };
  }
  return { x: 0, z: 0 };
}

function pickGoal(sim, p, b) {
  b.goalT = 4 + Math.random() * 3;
  const arena = sim.arena;
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
