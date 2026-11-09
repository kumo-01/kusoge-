// 犬の動き（歩く・ジャンプ・ダッシュ・伏せ）と、輪ゴムの飛び方。
// 自分の犬は自分の端末で、CPU の犬はホストが、同じ stepMove で動かす。輪ゴムはホストが正本（ゲストは見た目だけ同じ計算）

import { PLAYER, GUN, ITEMS, ITEM } from './constants.js';
import { ROOM, overlapXZ, segmentHit } from './arena.js';

/** 動く体（犬）の初期値 */
export function createBody(x = 0, z = 0, yaw = 0) {
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, crouch: false, ground: true, dashT: 0, dashCd: 0 };
}

export const heightOf = (m) => (m.crouch ? PLAYER.CROUCH_HEIGHT : PLAYER.HEIGHT);
export const eyeOf = (m) => (m.crouch ? PLAYER.CROUCH_EYE : PLAYER.EYE);

/** 体 m が、高さ h のまま (x, y, z) にいられるか（家具・壁にめりこまないか） */
export function fits(arena, x, y, z, h, r = PLAYER.RADIUS) {
  if (x - r < -ROOM.W / 2 || x + r > ROOM.W / 2 || z - r < -ROOM.D / 2 || z + r > ROOM.D / 2) return false;
  for (const b of arena.boxes) if (overlapXZ(b, x, z, r) && y < b.y1 - 1e-4 && y + h > b.y0 + 1e-4) return false;
  return true;
}

/**
 * 1 tick 動かす。
 * inp: { fx: 右へ -1..1, fz: 前へ -1..1, jump, dash, crouch }（jump・dash は押した瞬間）
 * slow: 速さの割合（よろけ 0.35、ネバネバ 0）
 * 戻り値: { jumped, dashed }（音を鳴らすため）
 */
export function stepMove(m, inp, dt, arena, slow = 1) {
  const r = PLAYER.RADIUS;
  const res = { jumped: false, dashed: false };
  m.dashCd = Math.max(0, m.dashCd - dt);
  m.dashT = Math.max(0, m.dashT - dt);
  // 伏せ: 立ち上がる場所が空いていないとき（テーブルの下）は伏せたまま
  if (inp.crouch) m.crouch = true;
  else if (m.crouch && fits(arena, m.x, m.y, m.z, PLAYER.HEIGHT)) m.crouch = false;
  // 行きたい向き（向いている向きが前。前 = (sin yaw, cos yaw)、右 = (-cos yaw, sin yaw)）
  const sy = Math.sin(m.yaw);
  const cy = Math.cos(m.yaw);
  let fx = inp.fx || 0;
  let fz = inp.fz || 0;
  const len = Math.hypot(fx, fz);
  if (len > 1) {
    fx /= len;
    fz /= len;
  }
  const wx = sy * fz - cy * fx;
  const wz = cy * fz + sy * fx;
  if (inp.dash && m.dashCd <= 0 && slow > 0.5) {
    m.dashT = PLAYER.DASH_TIME;
    m.dashCd = PLAYER.DASH_COOLDOWN;
    m.crouch = m.crouch && !fits(arena, m.x, m.y, m.z, PLAYER.HEIGHT);
    // 入力がなければ前へ
    const dl = Math.hypot(wx, wz);
    m.dashX = dl > 0.1 ? wx / dl : sy;
    m.dashZ = dl > 0.1 ? wz / dl : cy;
    res.dashed = true;
  }
  let tx;
  let tz;
  if (m.dashT > 0) {
    tx = m.dashX * PLAYER.DASH_SPEED;
    tz = m.dashZ * PLAYER.DASH_SPEED;
  } else {
    const sp = (m.crouch ? PLAYER.CROUCH_SPEED : PLAYER.SPEED) * slow;
    tx = wx * sp;
    tz = wz * sp;
  }
  const acc = (m.ground ? PLAYER.ACCEL : PLAYER.AIR_ACCEL) * dt;
  const ease = (v, t) => (Math.abs(t - v) <= acc ? t : v + Math.sign(t - v) * acc);
  m.vx = m.dashT > 0 ? tx : ease(m.vx, tx);
  m.vz = m.dashT > 0 ? tz : ease(m.vz, tz);
  if (inp.jump && m.ground && slow > 0) {
    m.vy = PLAYER.JUMP;
    m.ground = false;
    res.jumped = true;
  }
  m.vy -= PLAYER.GRAVITY * dt;
  const h = heightOf(m);
  // 横（x → z の順に動かして、ぶつかったら止める。低い段差は上がる）
  for (const axis of ['x', 'z']) {
    const v = axis === 'x' ? m.vx : m.vz;
    if (!v) continue;
    const nx = axis === 'x' ? m.x + v * dt : m.x;
    const nz = axis === 'z' ? m.z + v * dt : m.z;
    if (fits(arena, nx, m.y, nz, h)) {
      m.x = nx;
      m.z = nz;
      continue;
    }
    // 段差: 少しだけ上なら乗る
    let top = -1;
    for (const b of arena.boxes) if (overlapXZ(b, nx, nz, r) && m.y < b.y1 && m.y + h > b.y0) top = Math.max(top, b.y1);
    if (m.ground && top > m.y && top - m.y <= PLAYER.STEP && fits(arena, nx, top, nz, h)) {
      m.x = nx;
      m.z = nz;
      m.y = top;
      continue;
    }
    // 壁ぎわまで寄せる（ぴったり止める）
    const lo = 0;
    let hi = 1;
    let ok = lo;
    for (let k = 0; k < 6; k++) {
      const mid = (ok + hi) / 2;
      const px = axis === 'x' ? m.x + v * dt * mid : m.x;
      const pz = axis === 'z' ? m.z + v * dt * mid : m.z;
      if (fits(arena, px, m.y, pz, h)) ok = mid;
      else hi = mid;
    }
    if (axis === 'x') {
      m.x += v * dt * ok;
      m.vx = 0;
    } else {
      m.z += v * dt * ok;
      m.vz = 0;
    }
    if (m.dashT > 0) m.dashT = 0;
  }
  // 縦
  const ny = m.y + m.vy * dt;
  if (m.vy <= 0) {
    // 下: 床か、箱の上に着く
    let floor = 0;
    for (const b of arena.boxes) if (overlapXZ(b, m.x, m.z, r) && b.y1 <= m.y + 1e-3 && b.y1 > floor) floor = b.y1;
    if (ny <= floor) {
      m.y = floor;
      m.vy = 0;
      m.ground = true;
    } else {
      m.y = ny;
      m.ground = false;
    }
  } else {
    // 上: 頭が天板にぶつかる
    let ceil = Infinity;
    for (const b of arena.boxes) if (overlapXZ(b, m.x, m.z, r) && b.y0 >= m.y + h - 1e-3 && b.y0 < ceil) ceil = b.y0;
    if (ny + h >= ceil) {
      m.y = ceil - h;
      m.vy = 0;
    } else m.y = ny;
    m.ground = false;
  }
  return res;
}

/** 向き (yaw, pitch) の向きベクトル */
export function aimDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
}

/** 輪ゴムの種類ごとの速さ・太さ・ダメージ・跳ね返り・飛んでいられる時間 */
export function bandSpec(kind) {
  if (kind === ITEM.THICK) return { speed: ITEMS.THICK_SPEED, r: ITEMS.THICK_RADIUS, dmg: ITEMS.THICK_DAMAGE, bounce: 0, life: GUN.LIFE };
  if (kind === ITEM.BOUNCE) return { speed: GUN.SPEED, r: GUN.RADIUS, dmg: 1, bounce: ITEMS.BOUNCES, life: ITEMS.BOUNCE_LIFE };
  return { speed: GUN.SPEED, r: GUN.RADIUS, dmg: 1, bounce: 0, life: GUN.LIFE };
}

const hitOut = { t: 1, nx: 0, ny: 0, nz: 0 };

/**
 * 輪ゴムを 1 tick 進める。家具・壁・床に当たると、跳ね返る（残りがあれば）か止まる。
 * target(b): 追いかけゴムが追う相手 { x, y, z } を返す（なければ null）
 * 戻り値: 'end'（止まった）/ null
 */
export function stepBand(b, dt, arena, target = null) {
  b.age += dt;
  if (b.age >= b.life) return 'end';
  if (b.kind === ITEM.HOMING && target) {
    const t = target(b);
    if (t) {
      // 向きを相手の方へ、決まった速さで回す
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      const dx = t.x - b.x;
      const dy = t.y - b.y;
      const dz = t.z - b.z;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const ux = b.vx / sp;
      const uy = b.vy / sp;
      const uz = b.vz / sp;
      const cos = Math.max(-1, Math.min(1, (ux * dx + uy * dy + uz * dz) / dl));
      const ang = Math.acos(cos);
      const turn = Math.min(1, (ITEMS.HOMING_TURN * dt) / Math.max(1e-6, ang));
      let nx = ux + (dx / dl - ux) * turn;
      let ny = uy + (dy / dl - uy) * turn;
      let nz = uz + (dz / dl - uz) * turn;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      b.vx = nx * sp;
      b.vy = ny * sp;
      b.vz = nz * sp;
    }
  } else b.vy -= GUN.GRAVITY * dt;
  // 速いので、途中で家具を飛び越えないように線分で当たりを見る
  let rest = 1;
  for (let k = 0; k < 3 && rest > 1e-4; k++) {
    const ex = b.x + b.vx * dt * rest;
    const ey = b.y + b.vy * dt * rest;
    const ez = b.z + b.vz * dt * rest;
    const t = segmentHit(arena, b.x, b.y, b.z, ex, ey, ez, b.r, hitOut);
    if (t >= 1) {
      b.x = ex;
      b.y = ey;
      b.z = ez;
      return null;
    }
    const tt = Math.max(0, t - 1e-3);
    b.x += (ex - b.x) * tt;
    b.y += (ey - b.y) * tt;
    b.z += (ez - b.z) * tt;
    if (b.bounce <= 0) return 'end';
    b.bounce--;
    // 当たった面で跳ね返る（少し弱くなる）
    const vn = b.vx * hitOut.nx + b.vy * hitOut.ny + b.vz * hitOut.nz;
    b.vx = (b.vx - 2 * vn * hitOut.nx) * 0.85;
    b.vy = (b.vy - 2 * vn * hitOut.ny) * 0.85;
    b.vz = (b.vz - 2 * vn * hitOut.nz) * 0.85;
    b.bounced = (b.bounced || 0) + 1;
    rest *= 1 - tt;
  }
  return null;
}

/**
 * 線分 (ax, ay, az) → (bx, by, bz) が、足もとの位置 p・高さ h・太さ R の筒に当たるか。当たれば線分上の割合、なければ -1
 */
export function segCylinder(ax, ay, az, bx, by, bz, p, h, R) {
  // 水平は「線分と円」、縦は当たった場所の高さで判定する（小さな線分なので、両端と中間を見れば十分）
  const n = 4;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    if ((x - p.x) ** 2 + (z - p.z) ** 2 <= R * R && y >= p.y - 0.05 && y <= p.y + h + 0.05) return t;
  }
  return -1;
}
