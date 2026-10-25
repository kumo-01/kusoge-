// アーケード風の簡易物理（ホストの正本シミュレーションとゲストの予測で共通に使う）
//
// 車の速度 = 前方向 × sp（スカラー）＋ 押し出し速度 (kx, kz)
// 押し出し速度は横滑りやノックバックとして働き、すぐに減衰する。

import { KART, IN, RAIN } from './constants.js';

export function createKart(index, pos) {
  return {
    i: index,
    x: pos.x,
    z: pos.z,
    y: 0,
    vy: 0,
    h: pos.h,
    sp: 0,
    kx: 0,
    kz: 0,
    st: 0, // ハンドル（-1..1、見た目用・旋回用に平滑化）
    th: 0, // アクセル状態（見た目用）
    spin: 0, // スピン残り時間（操作不能）
    spinDur: 1,
    boost: 0,
    slow: 0,
    inv: 0, // 無敵時間（スピンしない）
    bump: 0, // 衝突の揺れ（見た目用）
    grass: 0,
    lap: 0,
    cp: 0,
    item: 0,
    roll: 0, // アイテムルーレット残り時間
    rc: 0, // 復帰のクールダウン
    wrong: 0, // 逆走している時間
    fin: 0,
    ft: 0,
    lapStart: 0,
    best: 0,
    bc: 0, // 体当たり演出のクールダウン
    npc: index >= 2 ? 1 : 0,
    ms: 1, // 最高速の倍率（NPC の手加減・追い上げ用）
    al: 0, // NPC: 目標の走行ライン（横位置）
    at: 0, // NPC: 走行ラインを変えるまでの時間
    as: 0, // NPC: 止まっている時間（引っかかり検出）
    tw: 0, // タイミングブースト: リングの残り時間（0 なら出ていない）
    tb: 0, // タイミングブースト: これまでに出たチャンスの数
    tn: 0, // NPC: タイミングを押す予定の残り時間
    wet: 0, // 豪雨で遅くなっている残り時間
    rq: 0, // 豪雨を呼ぶ入力の保留時間（最終ラップに入る直前に押した場合）
    stats: { bumps: 0, hits: 0, hitBy: 0, walls: 0, items: 0, boosts: 0 },
  };
}

/** 物理に関わる数値フィールド（予測の誤差補正で使う） */
export const PHYS_KEYS = ['x', 'z', 'y', 'vy', 'h', 'sp', 'kx', 'kz', 'spin', 'boost', 'slow', 'inv', 'rc', 'wet'];

export function maxSpeedOf(k) {
  let m = (k.boost > 0 ? KART.BOOST_SPEED : KART.MAX_SPEED) * (k.ms || 1);
  if (k.slow > 0) m *= KART.SLOW_FACTOR;
  if (k.wet > 0) m *= RAIN.FACTOR;
  if (k.grass && k.boost <= 0) m *= KART.GRASS_FACTOR;
  return m;
}

/** 速度ベクトル (vx, vz) を「前方スカラー＋横方向の押し出し」に分解して設定 */
export function setVelocity(k, vx, vz) {
  const fx = Math.sin(k.h);
  const fz = Math.cos(k.h);
  let sp = vx * fx + vz * fz;
  sp = Math.max(-KART.REVERSE_MAX * 1.5, Math.min(KART.BOOST_SPEED * 1.1, sp));
  k.sp = sp;
  k.kx = vx - fx * sp;
  k.kz = vz - fz * sp;
  const km = Math.hypot(k.kx, k.kz);
  if (km > KART.KNOCK_MAX) {
    k.kx *= KART.KNOCK_MAX / km;
    k.kz *= KART.KNOCK_MAX / km;
  }
}

/**
 * 車を 1 ステップ進める。
 * @param {object} k 車の状態
 * @param {number} input 入力ビット
 * @param {number} dt
 * @param {import('./track.js').Track} track
 * @param {boolean} active レース中（カウントダウン中・ゴール後は操作不可）
 * @returns {number} 壁への衝突速度（0 なら衝突なし）
 */
export function stepKart(k, input, dt, track, active) {
  // ゴールした人間は操作終了。NPC はゴール後も走り続ける（コース上で止まって邪魔にならないように）
  const control = active && k.spin <= 0 && (!k.fin || k.npc);
  const up = control && input & IN.UP;
  const down = control && input & IN.DOWN;
  const steerIn = control ? (input & IN.LEFT ? 1 : 0) - (input & IN.RIGHT ? 1 : 0) : 0;

  k.st += (steerIn - k.st) * Math.min(1, dt * 10);
  k.th = up ? 1 : down ? -1 : 0;

  const maxSp = maxSpeedOf(k);
  if (up) {
    if (k.sp < 0) k.sp += KART.BRAKE * dt;
    else k.sp += (k.boost > 0 ? KART.BOOST_ACCEL : KART.ACCEL) * dt * (1 - 0.55 * Math.min(1, Math.max(0, k.sp / maxSp)));
  } else if (down) {
    if (k.sp > 0.5) k.sp -= KART.BRAKE * dt;
    else k.sp -= KART.REVERSE_ACCEL * dt;
  } else {
    const c = KART.COAST * dt;
    k.sp = Math.abs(k.sp) <= c ? 0 : k.sp - Math.sign(k.sp) * c;
  }
  // ブースト中はアクセルを踏んでいなくても押し出される
  if (k.boost > 0 && k.sp < maxSp) k.sp = Math.min(maxSp, k.sp + KART.BOOST_ACCEL * 0.6 * dt);
  if (k.grass && k.boost <= 0 && Math.abs(k.sp) > 4) k.sp -= Math.sign(k.sp) * KART.GRASS_DRAG * dt * 0.3;
  if (k.sp > maxSp) k.sp = Math.max(maxSp, k.sp - KART.OVERSPEED_DECAY * dt);
  if (k.sp < -KART.REVERSE_MAX) k.sp = Math.min(-KART.REVERSE_MAX, k.sp + KART.OVERSPEED_DECAY * dt);
  if (k.spin > 0) k.sp *= Math.exp(-2.2 * dt);

  // ステアリング: 低速では曲がりにくく、高速では少しだけ鈍くなる
  const a = Math.abs(k.sp);
  const steerFactor = Math.min(1, a / 7) * (1 - 0.22 * Math.min(1, Math.max(0, (a - 16) / 20)));
  k.h += k.st * KART.STEER_RATE * steerFactor * Math.sign(k.sp || 1) * dt;
  if (k.h > Math.PI) k.h -= Math.PI * 2;
  else if (k.h < -Math.PI) k.h += Math.PI * 2;

  // 押し出し速度の減衰（タイヤのグリップ）
  const kd = Math.exp(-KART.KNOCK_DECAY * dt);
  k.kx *= kd;
  k.kz *= kd;

  k.x += (Math.sin(k.h) * k.sp + k.kx) * dt;
  k.z += (Math.cos(k.h) * k.sp + k.kz) * dt;

  // 縦方向（ジャンプ・跳ね）
  if (k.y > 0 || k.vy > 0) {
    k.vy -= KART.GRAVITY * dt;
    k.y += k.vy * dt;
    if (k.y <= 0) {
      k.y = 0;
      k.vy = k.vy < -6 ? -k.vy * 0.3 : 0;
    }
  }

  k.spin = Math.max(0, k.spin - dt);
  k.boost = Math.max(0, k.boost - dt);
  k.slow = Math.max(0, k.slow - dt);
  k.inv = Math.max(0, k.inv - dt);
  k.bump = Math.max(0, k.bump - dt);
  k.rc = Math.max(0, k.rc - dt);
  k.bc = Math.max(0, k.bc - dt);
  k.wet = Math.max(0, k.wet - dt);

  return collideWalls(k, track);
}

/** コース外側の壁との衝突。戻り値は衝突速度 */
export function collideWalls(k, track) {
  const p = track.project(k.x, k.z);
  const lat = p.lat;
  k.grass = Math.abs(lat) > track.roadHalf ? 1 : 0;
  const limit = track.wallDist - KART.RADIUS;
  if (Math.abs(lat) <= limit) return 0;
  const sgn = lat > 0 ? 1 : -1;
  const nx = p.nx * sgn; // 外向き
  const nz = p.nz * sgn;
  k.x = p.cx + nx * limit;
  k.z = p.cz + nz * limit;
  const fx = Math.sin(k.h);
  const fz = Math.cos(k.h);
  let vx = fx * k.sp + k.kx;
  let vz = fz * k.sp + k.kz;
  const vn = vx * nx + vz * nz;
  if (vn <= 0) return 0;
  vx -= nx * vn * (1 + KART.WALL_RESTITUTION);
  vz -= nz * vn * (1 + KART.WALL_RESTITUTION);
  setVelocity(k, vx * 0.94, vz * 0.94);
  if (vn > 9) {
    k.bump = 0.35;
    k.vy = Math.max(k.vy, 3.5);
  }
  return vn;
}

/**
 * 2台の車の衝突（質量は同じ）。すり抜け防止の押し出しと、速度の反発を行う。
 * @returns {{ rel: number, rammer: number } | null}
 */
export function collideKarts(a, b) {
  let dx = b.x - a.x;
  let dz = b.z - a.z;
  let d = Math.hypot(dx, dz);
  const minD = KART.RADIUS * 2;
  if (d >= minD) return null;
  if (d < 1e-4) {
    dx = 1;
    dz = 0;
    d = 1e-4;
  }
  const nx = dx / d;
  const nz = dz / d;
  const push = (minD - d) / 2;
  a.x -= nx * push;
  a.z -= nz * push;
  b.x += nx * push;
  b.z += nz * push;

  const avx = Math.sin(a.h) * a.sp + a.kx;
  const avz = Math.cos(a.h) * a.sp + a.kz;
  const bvx = Math.sin(b.h) * b.sp + b.kx;
  const bvz = Math.cos(b.h) * b.sp + b.kz;
  const ca = avx * nx + avz * nz; // a が b に向かう速さ
  const cb = -(bvx * nx + bvz * nz); // b が a に向かう速さ
  const rel = ca + cb;
  if (rel <= 0) return { rel: 0, rammer: -1 };

  const j = (rel * (1 + KART.KART_RESTITUTION)) / 2;
  // コミカルに少し大げさに弾く（上限あり）
  const extra = Math.min(rel * 0.35, 7);
  const rammer = ca >= cb ? 0 : 1;
  const ea = rammer === 0 ? extra * 0.4 : extra;
  const eb = rammer === 1 ? extra * 0.4 : extra;
  setVelocity(a, avx - nx * (j + ea), avz - nz * (j + ea));
  setVelocity(b, bvx + nx * (j + eb), bvz + nz * (j + eb));
  return { rel, rammer };
}
