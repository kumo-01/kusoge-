// 犬の動き（歩く・ジャンプ・ダッシュ・伏せ）と、輪ゴムの飛び方。
// 自分の犬は自分の端末で、CPU の犬はホストが、同じ stepMove で動かす。輪ゴムはホストが正本（ゲストは見た目だけ同じ計算）

import { PLAYER, GUN, ITEMS, ITEM, WEAPON, WEAPONS, BOSS, HAIRBALL, THICK_MUL, HEADSHOT, FUN, EXTRA } from './constants.js';
import { ROOM, overlapXZ, segmentHit, groundY } from './arena.js';

/** 動く体（犬）の初期値 */
export function createBody(x = 0, z = 0, yaw = 0) {
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, crouch: false, ground: true, stam: PLAYER.STAMINA, stamWait: 0, sprint: false };
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
 * inp: { fx: 右へ -1..1, fz: 前へ -1..1, jump（押した瞬間）, dash（走る。押している間）, crouch }
 * slow: 速さの割合（よろけ 0.35、ネバネバ 0）
 * 戻り値: { jumped, dashed: 走り始めた }（音を鳴らすため）
 */
export function stepMove(m, inp, dt, arena, slow = 1) {
  const r = PLAYER.RADIUS;
  const res = { jumped: false, dashed: false };
  if (m.stam == null) m.stam = PLAYER.STAMINA;
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
  // スライディング: 走っている間に伏せを押した瞬間、低い姿勢のまま前へ滑りこむ（ゲージを使う）
  m.slideCd = Math.max(0, (m.slideCd || 0) - dt);
  const crouchEdge = !!inp.crouch && !m.crouchIn;
  m.crouchIn = !!inp.crouch;
  if (crouchEdge && m.sprint && m.ground && m.slideCd <= 0 && m.stam >= FUN.SLIDE_STAM) {
    const vl = Math.hypot(m.vx, m.vz) || 1;
    m.slideX = m.vx / vl;
    m.slideZ = m.vz / vl;
    m.slideT = FUN.SLIDE_TIME;
    m.slideCd = FUN.SLIDE_CD;
    m.stam -= FUN.SLIDE_STAM;
    res.slid = true;
  }
  if (m.slideT > 0) {
    m.slideT = Math.max(0, m.slideT - dt);
    m.crouch = true;
  }
  // 走る（ゲージ式）: 押している間、動いていてゲージがあれば速く走る。空になったら STAMINA_MIN までたまるまで走れない
  const wasSprint = m.sprint;
  m.sprint = !!inp.dash && Math.hypot(wx, wz) > 0.1 && !m.crouch && slow > 0.5 && m.stam > 0 && (wasSprint || m.stam >= PLAYER.STAMINA_MIN);
  if (m.sprint) {
    m.stam = Math.max(0, m.stam - PLAYER.STAMINA_DRAIN * dt);
    m.stamWait = PLAYER.STAMINA_WAIT;
    if (!wasSprint) res.dashed = true;
  } else {
    m.stamWait = Math.max(0, (m.stamWait || 0) - dt);
    if (m.stamWait <= 0) m.stam = Math.min(PLAYER.STAMINA, m.stam + PLAYER.STAMINA_REGEN * dt);
  }
  // 水の中は遅い
  m.inWater = !!arena.water?.some((w) => m.x > w.x0 && m.x < w.x1 && m.z > w.z0 && m.z < w.z1) && m.y < 0.3;
  const sp = (m.crouch ? PLAYER.CROUCH_SPEED : m.sprint ? PLAYER.SPRINT_SPEED : PLAYER.SPEED) * slow * (m.inWater ? EXTRA.WATER_SLOW : 1);
  const tx = wx * sp;
  const tz = wz * sp;
  const acc = (m.ground ? PLAYER.ACCEL : PLAYER.AIR_ACCEL) * dt;
  const ease = (v, t) => (Math.abs(t - v) <= acc ? t : v + Math.sign(t - v) * acc);
  if (m.slideT > 0) {
    // 滑っている間は、向きはそのまま、だんだん遅く
    const ss = FUN.SLIDE_SPEED * (0.45 + (0.55 * m.slideT) / FUN.SLIDE_TIME) * slow;
    m.vx = m.slideX * ss;
    m.vz = m.slideZ * ss;
  } else {
    m.vx = ease(m.vx, tx);
    m.vz = ease(m.vz, tz);
  }
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
    // 押せるもの（段ボールなど）だけにぶつかったときは、ゆっくり押して進む
    const step = Math.max(-PLAYER.PUSH_SPEED * dt, Math.min(PLAYER.PUSH_SPEED * dt, v * dt));
    if (pushMovables(arena, m, h, axis === 'x' ? step : 0, axis === 'z' ? step : 0)) {
      if (axis === 'x') {
        m.x += step;
        m.vx = step / dt;
      } else {
        m.z += step;
        m.vz = step / dt;
      }
      res.pushed = true;
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
  }
  // 縦
  const ny = m.y + m.vy * dt;
  const wasGround = m.ground;
  if (m.vy <= 0) {
    // 下: 地面（丘・くぼみ）か、箱の上に着く
    let floor = groundY(arena, m.x, m.z);
    let floorBox = null;
    for (const b of arena.boxes) {
      if (overlapXZ(b, m.x, m.z, r) && b.y1 <= m.y + 1e-3 && b.y1 > floor) {
        floor = b.y1;
        floorBox = b;
      }
    }
    // 下り坂: 地面についていたら、少し下がっただけなら地面に沿う（ジャンプできなくならないように）
    if (ny <= floor || (wasGround && !res.jumped && m.y - floor < 0.3)) {
      m.y = floor;
      m.vy = 0;
      m.ground = true;
      // トランポリン: 乗ったら大きく跳ねる（真ん中あたりに乗ったとき）
      if (floorBox?.k === 'tramp' && overlapXZ(floorBox, m.x, m.z, -0.3)) {
        m.vy = FUN.TRAMP_V;
        m.ground = false;
        res.bounced = true;
      }
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

/** 押せるもの b を (dx, dz) だけ動かせるか（壁・家具・ほかの押せるものに、めりこまないか） */
function canShift(world, b, dx, dz) {
  const x0 = b.x0 + dx;
  const x1 = b.x1 + dx;
  const z0 = b.z0 + dz;
  const z1 = b.z1 + dz;
  if (x0 < -ROOM.W / 2 || x1 > ROOM.W / 2 || z0 < -ROOM.D / 2 || z1 > ROOM.D / 2) return false;
  for (const o of world.boxes) {
    if (o === b) continue;
    if (x1 > o.x0 && x0 < o.x1 && z1 > o.z0 && z0 < o.z1 && b.y1 > o.y0 + 1e-4 && b.y0 < o.y1 - 1e-4) return false;
  }
  return true;
}

/**
 * 体 m を (dx, dz) へ動かすとき、ぶつかるのが押せるものだけなら、それを同じだけ押す。押せたら true
 */
export function pushMovables(world, m, h, dx, dz) {
  const r = PLAYER.RADIUS;
  const nx = m.x + dx;
  const nz = m.z + dz;
  const hits = [];
  for (const b of world.boxes) {
    if (overlapXZ(b, nx, nz, r) && m.y < b.y1 - 1e-4 && m.y + h > b.y0 + 1e-4) {
      if (!b.mv) return false; // 動かないものにもぶつかる
      hits.push(b);
    }
  }
  if (!hits.length || !hits.every((b) => canShift(world, b, dx, dz))) return false;
  for (const b of hits) {
    b.x0 += dx;
    b.x1 += dx;
    b.z0 += dz;
    b.z1 += dz;
  }
  return true;
}

/**
 * 人の犬の位置（その人の端末が計算したもの）が押せるものに重なっていたら、押せるものを押し出す（ホスト）
 */
export function shoveMovables(world, m) {
  const r = PLAYER.RADIUS;
  const h = heightOf(m);
  for (const b of world.boxes) {
    if (!b.mv || !overlapXZ(b, m.x, m.z, r) || !(m.y < b.y1 - 1e-4 && m.y + h > b.y0 + 1e-4)) continue;
    // いちばん浅い向きへ押し出す
    const cand = [
      [m.x + r - b.x0, 0],
      [-(b.x1 - (m.x - r)), 0],
      [0, m.z + r - b.z0],
      [0, -(b.z1 - (m.z - r))],
    ].sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
    for (const [dx, dz] of cand) {
      if (canShift(world, b, dx, dz)) {
        b.x0 += dx;
        b.x1 += dx;
        b.z0 += dz;
        b.z1 += dz;
        break;
      }
    }
  }
}

/** 押せるものの、中心 (x, z) を持つ箱（位置は配信で x, z だけ送る） */
export function movableBox(d) {
  return { x0: d.x - d.w / 2, x1: d.x + d.w / 2, z0: d.z - d.d / 2, z1: d.z + d.d / 2, y0: 0, y1: d.h, c: d.c, k: d.k, mv: true };
}

/** 向き (yaw, pitch) の向きベクトル */
export function aimDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
}

/**
 * 輪ゴムの種類ごとの速さ・太さ・ダメージの倍率・跳ね返り・飛んでいられる時間・重力。
 * ダメージは当たった距離で決まる（weaponDamage）。爆弾は跳ね返らずに、何かに当たると爆発する
 */
export function bandSpec(kind, weapon = WEAPON.NORMAL) {
  if (kind === HAIRBALL) return { speed: BOSS.SPIT_SPEED, r: BOSS.SPIT_RADIUS, mul: 1, bounce: 0, life: 3, g: 4, w: -1 };
  const w = WEAPONS[weapon] ? weapon : WEAPON.NORMAL;
  const W = WEAPONS[w];
  const bomb = w === WEAPON.BOMB;
  const base = { speed: W.speed, r: W.r, mul: 1, bounce: bomb ? 0 : GUN.BOUNCES, life: W.life, g: W.gravity, w };
  if (kind === ITEM.THICK) return { ...base, speed: w === WEAPON.NORMAL ? ITEMS.THICK_SPEED : W.speed * (bomb ? 1 : 0.8), r: bomb ? W.r * 1.3 : ITEMS.THICK_RADIUS, mul: THICK_MUL };
  if (kind === ITEM.BOUNCE) return { ...base, bounce: ITEMS.BOUNCES, life: Math.max(W.life, ITEMS.BOUNCE_LIFE) };
  if (kind === ITEM.GOLD) return { ...base, mul: FUN.GOLD_MUL, r: W.r * 1.3 }; // 金の輪ゴム: ダメージ 2 倍
  return base;
}

/** (x, y, z) で当たったのが q の頭か（体の高さの上の方 PLAYER.HEAD より上） */
export function isHead(q, y) {
  return y - q.y >= heightOf(q) * PLAYER.HEAD;
}

/** 当たったときのダメージ（距離・極太ゴム・ヘッドショットこみ） */
export function hitDamage(weapon, dist, mul = 1, head = false) {
  const base = weaponDamage(weapon, dist, mul);
  if (!head || weapon === WEAPON.BOMB || weapon === WEAPON.RIFLE) return base;
  if (weapon === WEAPON.SNIPER) return Math.max(base, Math.round(PLAYER.HP * HEADSHOT.SNIPER_RATE));
  return Math.round(base * HEADSHOT.MUL);
}

/**
 * 武器 weapon で、距離 dist で当たったときのダメージ（整数・1 以上）。mul: 極太ゴムなどの倍率。
 * 鉄砲・スナイパーは撃った場所からの距離、爆弾は爆発の中心からの距離（半径の外は 0）
 */
export function weaponDamage(weapon, dist, mul = 1) {
  const W = WEAPONS[weapon] || WEAPONS[WEAPON.NORMAL];
  const [near, far] = W.dmg;
  const [d0, d1] = W.fall || [0, W.blast];
  if (W.blast && dist > W.blast) return 0;
  const t = Math.max(0, Math.min(1, (dist - d0) / (d1 - d0)));
  return Math.max(1, Math.round((near + (far - near) * t) * mul));
}

const hitOut = { t: 1, nx: 0, ny: 0, nz: 0 };

/**
 * 輪ゴムを 1 tick 進める。家具・壁・床に当たると、跳ね返る（残りがあれば）か止まる。
 * target(b): 追いかけゴムが追う相手 { x, y, z } を返す（なければ null）
 * 戻り値: 'end'（止まった）/ null
 */
export function stepBand(b, dt, arena, target = null, wind = null) {
  b.age += dt;
  // 突風: 横に流される
  if (wind && (wind.x || wind.z)) {
    b.vx += wind.x * dt;
    b.vz += wind.z * dt;
  }
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
  } else b.vy -= (b.g ?? GUN.GRAVITY) * dt;
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

/** 半直線 o + d·t（d は長さ 1）が、足もとの位置 p・高さ h・太さ R の筒に最初に入る t。当たらなければ -1 */
export function rayCylinder(o, d, p, h, R) {
  const ox = o[0] - p.x;
  const oz = o[2] - p.z;
  const a = d[0] * d[0] + d[2] * d[2];
  const c = ox * ox + oz * oz - R * R;
  let t0 = 0;
  let t1 = Infinity;
  if (a < 1e-9) {
    if (c > 0) return -1;
  } else {
    const b = ox * d[0] + oz * d[2];
    const disc = b * b - a * c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    t0 = Math.max(0, (-b - sq) / a);
    t1 = (-b + sq) / a;
    if (t1 < 0) return -1;
  }
  // 縦: 高さ p.y〜p.y + h の間にいる t の範囲と重なるか
  const y0 = p.y;
  const y1 = p.y + h;
  if (Math.abs(d[1]) < 1e-9) return o[1] >= y0 && o[1] <= y1 ? t0 : -1;
  let ta = (y0 - o[1]) / d[1];
  let tb = (y1 - o[1]) / d[1];
  if (ta > tb) [ta, tb] = [tb, ta];
  const lo = Math.max(t0, ta);
  const hi = Math.min(t1, tb);
  return lo <= hi ? lo : -1;
}
