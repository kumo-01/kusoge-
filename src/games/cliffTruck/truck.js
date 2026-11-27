// なっっっがいトラック（運転台 + 長い荷台）の動き。どの端末でも同じ計算（自分のトラックは自分の端末で動かす）。
// 平らな道の上を「自転車の形の動き」で進む: 運転台は前の車輪の向きで曲がり、荷台は連結部に引っぱられて、内側を少し遅れてついてくる。
// 急に曲がりすぎると横に傾き、30 度をこえると横転。車輪の真ん中が道からはみ出すと落ちる。
// 前 = (sin 向き, cos 向き)、右 = (-cos 向き, sin 向き)。傾き roll は正 = 右側が下がる

import { ROAD } from './road.js';

export const TRUCK = {
  L1: 4.0, // 運転台: 後ろの車輪 → 前の車輪（m）
  CAB_FRONT: 1.5, // 前の車輪 → 運転台の前のはし
  CAB_BACK: 1.2, // 運転台の後ろの車輪 → 車体の後ろのはし
  KING: 0.3, // 連結部: 運転台の後ろの車輪より少し前
  TRAILER: 24, // 荷台の長さ（m）
  T_FRONT: 1.4, // 荷台の前のはし → 連結部
  T_AXLE: 2.2, // 荷台の後ろのはし → 後ろの車輪
  WIDTH: 2.55, // 車体の幅
  TRACK: 2.1, // 左右の車輪の間
  V_MAX: 25, // いちばん速い（m/秒。90 km/h）
  ACCEL: 1.9, // アクセル（遅いとき。速くなるほど弱く）
  BRAKE: 6.5, // ブレーキ
  DRAG: 0.12, // 何もしないと少しずつ遅く
  STEER_MAX: 0.6, // ハンドルをいっぱいに切ったときの前の車輪の角度（遅いとき）
  STEER_RATE: 2.4, // ハンドルの効きが追いつく速さ（1 / 秒）
  TIP_ACC: 3.9, // これより強く曲がると、傾きがどんどん大きくなる（横の加速度 m/秒²。約 0.4 G）
  ROLL_K: 0.025, // ふつうに曲がっているときの傾き（横の加速度 1 あたり、ラジアン）
  CRASH_ROLL: Math.PI / 6, // これより傾くと横転（30 度）
  EDGE_ROLL: 0.56, // 片側の車輪が道から出たときの傾き（車輪の真ん中が道のはしに来たとき、ラジアン）
};

/** 荷台の連結部 → 後ろの車輪 */
export const L2 = TRUCK.TRAILER - TRUCK.T_FRONT - TRUCK.T_AXLE;

/** 新しいトラック（道のはじめ。前の車輪が s = START_STRAIGHT - 10 の所） */
export function newTruck(road) {
  const s0 = ROAD.START_STRAIGHT - 10;
  road.ensure(s0 + 50);
  const i = Math.round(s0 / ROAD.STEP);
  const h = road.h[i];
  const x = road.x[i] - Math.sin(h) * TRUCK.L1;
  const z = road.z[i] - Math.cos(h) * TRUCK.L1;
  return {
    x, // 運転台の後ろの車輪の真ん中
    z,
    th: h, // 運転台の向き
    ph: h, // 荷台の向き
    v: 0,
    steer: 0, // いまの切れ具合（-1 左 〜 1 右）
    roll: 0, // 傾き（正 = 右が下）
    rollV: 0,
    dyn: 0, // 曲がりによる傾き（はみ出しの傾きは別）
    s0, // はじめの前の車輪の場所（ここが 0 m）
    prog: 0, // 進んだ距離（m。いちばん遠く）
    hints: [i, i, i], // 前の車輪・後ろの車輪・荷台の車輪の、道の上の番号（探す手がかり）
    brake: 0, // ブレーキを踏んでいる強さ（0〜1。ランプ用）
    over: null, // 落ちた・横転した: { kind: 'fall' | 'roll', side: 1 右 / -1 左, at: 進んだ距離 }
  };
}

const loc = [{}, {}, {}];

/** 荷台の後ろの車輪の真ん中 */
export function trailerAxle(t) {
  const hx = t.x + Math.sin(t.th) * TRUCK.KING;
  const hz = t.z + Math.cos(t.th) * TRUCK.KING;
  return [hx - Math.sin(t.ph) * L2, hz - Math.cos(t.ph) * L2];
}

/**
 * 1 tick 進める。inp: { steer: -1〜1（右が正）, throttle: 0〜1, brake: 0〜1 }
 * 戻り値: 落ちた・横転したときは t.over（それ以外は null）
 */
export function stepTruck(t, inp, dt, road) {
  if (t.over) return t.over;
  // ハンドル（右が正）。速いほど切れにくい（高速で急に切ると、すぐ横転しないように）
  const want = Math.max(-1, Math.min(1, inp.steer || 0));
  const ds = want - t.steer;
  const rate = TRUCK.STEER_RATE * dt;
  t.steer += Math.abs(ds) <= rate ? ds : Math.sign(ds) * rate;
  const maxD = TRUCK.STEER_MAX / (1 + (t.v * t.v) / 260);
  const delta = -t.steer * maxD; // 向き th が増える = 左へ曲がる。右に切ると減る
  // 速さ
  const th = Math.max(0, Math.min(1, inp.throttle || 0));
  const br = Math.max(0, Math.min(1, inp.brake || 0));
  t.brake = br;
  let a = th * TRUCK.ACCEL * Math.max(0, 1 - t.v / TRUCK.V_MAX) - TRUCK.DRAG - 0.0015 * t.v * t.v;
  a -= br * TRUCK.BRAKE;
  t.v = Math.max(0, Math.min(TRUCK.V_MAX, t.v + a * dt));
  // 運転台と荷台
  const dth = (t.v / TRUCK.L1) * Math.tan(delta);
  const hm = t.th + (dth * dt) / 2;
  t.x += Math.sin(hm) * t.v * dt;
  t.z += Math.cos(hm) * t.v * dt;
  t.th += dth * dt;
  const dph = (t.v / L2) * Math.sin(t.th - t.ph);
  t.ph += dph * dt;
  // 傾き: 曲がる強さ（横の加速度）で外側へ。強すぎると、どんどん傾く
  const lat = Math.max(Math.abs(t.v * dth), Math.abs(t.v * dph)) * Math.sign(t.v * dth || t.v * dph); // 正 = 左へ曲がる → 右が下がる
  const ex = Math.max(0, Math.abs(lat) - TRUCK.TIP_ACC);
  const target = lat * TRUCK.ROLL_K + Math.sign(lat) * ex * 0.9;
  // ばねのように目標へ（行きすぎを少しおさえる）。大きく傾くと重さでさらに倒れる
  const tip = Math.abs(t.dyn) > 0.22 ? Math.sign(t.dyn) * (Math.abs(t.dyn) - 0.22) * 14 : 0;
  t.rollV += ((target - t.dyn) * 40 - t.rollV * 9 + tip) * dt;
  t.dyn += t.rollV * dt;
  // 道からはみ出したか（3 つの車輪の組。前・後ろ・荷台）
  const fx = t.x + Math.sin(t.th) * TRUCK.L1;
  const fz = t.z + Math.cos(t.th) * TRUCK.L1;
  const [tx, tz] = trailerAxle(t);
  const pts = [
    [fx, fz],
    [t.x, t.z],
    [tx, tz],
  ];
  let edge = 0;
  let fallSide = 0;
  for (let k = 0; k < 3; k++) {
    const L = road.locate(pts[k][0], pts[k][1], t.hints[k], loc[k]);
    t.hints[k] = L.i;
    const out = Math.abs(L.d) + TRUCK.TRACK / 2 - L.hw; // 外側の車輪がはみ出した長さ
    if (Math.abs(L.d) > L.hw) fallSide = Math.sign(L.d) || 1; // 車輪の真ん中が道の外 → 落ちる
    if (out > 0) {
      const e = Math.sign(L.d) * Math.min(1, out / (TRUCK.TRACK / 2)) * TRUCK.EDGE_ROLL;
      if (Math.abs(e) > Math.abs(edge)) edge = e;
    }
  }
  t.roll = t.dyn + edge;
  // 進んだ距離（前の車輪の、道の上の場所）
  road.ensure(loc[0].i + 800);
  t.prog = Math.max(t.prog, loc[0].i * ROAD.STEP - t.s0);
  if (fallSide) t.over = { kind: 'fall', side: fallSide, at: t.prog };
  else if (Math.abs(t.roll) > TRUCK.CRASH_ROLL) t.over = { kind: Math.abs(edge) > Math.abs(t.dyn) ? 'fall' : 'roll', side: Math.sign(t.roll), at: t.prog };
  return t.over;
}

/**
 * 落ちた・横転したあとの動き（見せるだけ）。運転台と荷台を別々のかたまりとして、外へ倒れながら落ちる。
 * 戻り値の体: { x, y, z, yaw, roll, pitch, vx, vy, vz, rollV, falling }
 */
export function startWreck(t, road) {
  const side = t.over.side;
  const mk = (cx, cz, yaw, len) => {
    const sp = t.v;
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    const push = t.over.kind === 'fall' ? 1.6 : 0.8;
    return { x: cx, y: 0, z: cz, yaw, roll: t.roll, pitch: 0, vx: Math.sin(yaw) * sp + rx * side * push, vy: 0, vz: Math.cos(yaw) * sp + rz * side * push, rollV: side * (1.2 + Math.abs(t.rollV)), pitchV: 0, falling: false, len, hint: -1 };
  };
  // 運転台の真ん中・荷台の真ん中
  const cab = mk(t.x + Math.sin(t.th) * (TRUCK.L1 / 2), t.z + Math.cos(t.th) * (TRUCK.L1 / 2), t.th, TRUCK.L1 + TRUCK.CAB_FRONT + TRUCK.CAB_BACK);
  const hx = t.x + Math.sin(t.th) * TRUCK.KING;
  const hz = t.z + Math.cos(t.th) * TRUCK.KING;
  const mid = TRUCK.TRAILER / 2 - TRUCK.T_FRONT;
  const tr = mk(hx - Math.sin(t.ph) * mid, hz - Math.cos(t.ph) * mid, t.ph, TRUCK.TRAILER);
  for (const b of [cab, tr]) b.hint = road.locate(b.x, b.z, -1).i;
  return { side, bodies: [cab, tr], t: 0 };
}

const wl = {};
export function stepWreck(w, dt, road) {
  w.t += dt;
  // 運転台と荷台はつながっているので、片方が落ちると、少しおくれてもう片方も引きずりこまれる
  const first = w.bodies.find((b) => b.falling);
  if (first) w.pull = (w.pull || 0) + dt;
  for (const b of w.bodies) {
    const L = road.locate(b.x, b.z, b.hint, wl);
    b.hint = L.i;
    // 体の真ん中が道の外に出たら落ちる（落ちはじめたら、もう戻らない）
    if (!b.falling && (Math.abs(L.d) > L.hw + 0.4 || (first && w.pull > 0.35))) {
      b.falling = true;
      if (first && first !== b) {
        // 引っぱられた方へ
        b.vx += (first.x - b.x) * 0.15;
        b.vz += (first.z - b.z) * 0.15;
      }
    }
    b.rollV += w.side * (b.falling ? 1.5 : 5) * dt;
    b.roll += b.rollV * dt;
    if (!b.falling) {
      // 道の上で横だおし: 90 度で止まって、すべりながら止まる
      if (Math.abs(b.roll) >= Math.PI / 2) {
        b.roll = (Math.PI / 2) * Math.sign(b.roll);
        b.rollV = 0;
      }
      const k = Math.max(0, 1 - 1.6 * dt);
      b.vx *= k;
      b.vz *= k;
      // 横だおしになると、外へ少しずつずれていく（はしに近いほど落ちやすい）
      b.vx += -Math.cos(b.yaw) * w.side * 0.6 * dt;
      b.vz += Math.sin(b.yaw) * w.side * 0.6 * dt;
    } else {
      b.vy -= 9.8 * dt;
      b.pitchV += (Math.random() - 0.5) * 0.6 * dt;
      b.pitch += b.pitchV * dt;
      b.vx *= 1 - 0.05 * dt;
      b.vz *= 1 - 0.05 * dt;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
  }
  return w;
}
