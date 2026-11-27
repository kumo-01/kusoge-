// なっっっがいトラック（運転台と荷台がひとつにつながった、曲がらない 1 本の車体）の動き。
// どの端末でも同じ計算（自分のトラックは自分の端末で動かす）。
// ハンドルで動くのは前の車輪だけ。車体は後ろの車輪のまわりを回るように曲がる（自転車の形の動き）。
// 長い車体なので、カーブでは後ろの車輪が内側を通る。速すぎるカーブでは傾き、30 度をこえると横転。
// 前・後ろの車輪の組のどちらかの真ん中が道からはみ出すと落ちる。
// 前 = (sin 向き, cos 向き)、右 = (-cos 向き, sin 向き)。傾き roll は正 = 右側が下がる

import { ROAD } from './road.js';

export const TRUCK = {
  L: 18.6, // 後ろの車輪（2 本の真ん中） → 前の車輪（m）
  FRONT: 1.4, // 前の車輪 → 車体の前のはし
  REAR: 3.6, // 後ろの車輪 → 車体の後ろのはし
  CAB: 2.6, // 運転台の長さ（前のはしから）
  WIDTH: 2.55, // 車体の幅
  TRACK: 2.1, // 左右の車輪の間
  V_MAX: 25, // いちばん速い（m/秒。90 km/h）
  ACCEL: 1.9, // アクセル（遅いとき。速くなるほど弱く）
  BRAKE: 6.5, // ブレーキ
  DRAG: 0.12, // 何もしないと少しずつ遅く
  STEER_MAX: 0.62, // ハンドルをいっぱいに切ったときの前の車輪の角度（遅いとき）
  STEER_RATE: 1.8, // 前の車輪がハンドルに追いつく速さ（1 / 秒）。めちゃくちゃに回しても、車輪はなめらかに動く
  LAT_SMOOTH: 0.45, // 傾きは、この時間（秒）でならした横の加速度で決まる（一瞬のハンドルでは倒れない）
  TIP_ACC: 3.9, // これより強く曲がり続けると、傾きがどんどん大きくなる（横の加速度 m/秒²。約 0.4 G）
  ROLL_K: 0.025, // ふつうに曲がっているときの傾き（横の加速度 1 あたり、ラジアン）
  CRASH_ROLL: Math.PI / 6, // これより傾くと横転（30 度）
  EDGE_ROLL: 0.56, // 片側の車輪が道から出たときの傾き（車輪の真ん中が道のはしに来たとき、ラジアン）
};
/** 車体の長さ */
export const TRUCK_LEN = TRUCK.L + TRUCK.FRONT + TRUCK.REAR;
/** 後ろの車輪 → 車体の真ん中 */
export const MID = TRUCK_LEN / 2 - TRUCK.REAR;

/** 新しいトラック（道のはじめ。前の車輪が s = START_STRAIGHT - 8 の所） */
export function newTruck(road) {
  const s0 = ROAD.START_STRAIGHT - 8;
  road.ensure(s0 + 50);
  const i = Math.round(s0 / ROAD.STEP);
  const h = road.h[i];
  return {
    x: road.x[i] - Math.sin(h) * TRUCK.L, // 後ろの車輪の真ん中
    z: road.z[i] - Math.cos(h) * TRUCK.L,
    th: h, // 車体の向き
    v: 0,
    steer: 0, // 前の車輪の切れ具合（-1 左 〜 1 右）
    delta: 0, // 前の車輪の角度（ラジアン。正 = 左。見た目用）
    lat: 0, // ならした横の加速度（正 = 左へ曲がっている）
    roll: 0, // 傾き（正 = 右が下）
    rollV: 0,
    dyn: 0, // 曲がりによる傾き（はみ出しの傾きは別）
    s0, // はじめの前の車輪の場所（ここが 0 m）
    prog: 0, // 進んだ距離（m。いちばん遠く）
    hints: [i, i - Math.round(TRUCK.L)], // 前の車輪・後ろの車輪の、道の上の番号（探す手がかり）
    brake: 0, // ブレーキを踏んでいる強さ（0〜1。ランプ用）
    over: null, // 落ちた・横転した: { kind: 'fall' | 'roll', side: 1 右 / -1 左, at: 進んだ距離 }
  };
}

const loc = [{}, {}];

/**
 * 1 tick 進める。inp: { steer: -1〜1（右が正）, throttle: 0〜1, brake: 0〜1 }
 * 戻り値: 落ちた・横転したときは t.over（それ以外は null）
 */
export function stepTruck(t, inp, dt, road) {
  if (t.over) return t.over;
  // 前の車輪（右が正）。ハンドルにゆっくり追いつく。速いほど切れにくい
  const want = Math.max(-1, Math.min(1, inp.steer || 0));
  const ds = want - t.steer;
  const rate = TRUCK.STEER_RATE * dt;
  t.steer += Math.abs(ds) <= rate ? ds : Math.sign(ds) * rate;
  const maxD = TRUCK.STEER_MAX / (1 + (t.v * t.v) / 900);
  t.delta = -t.steer * maxD; // 向き th が増える = 左へ曲がる。右に切ると減る
  // 速さ
  const thr = Math.max(0, Math.min(1, inp.throttle || 0));
  const br = Math.max(0, Math.min(1, inp.brake || 0));
  t.brake = br;
  let a = thr * TRUCK.ACCEL * Math.max(0, 1 - t.v / TRUCK.V_MAX) - TRUCK.DRAG - 0.0015 * t.v * t.v;
  a -= br * TRUCK.BRAKE;
  t.v = Math.max(0, Math.min(TRUCK.V_MAX, t.v + a * dt));
  // 車体（後ろの車輪のまわりを回る）
  const dth = (t.v / TRUCK.L) * Math.tan(t.delta);
  const hm = t.th + (dth * dt) / 2;
  t.x += Math.sin(hm) * t.v * dt;
  t.z += Math.cos(hm) * t.v * dt;
  t.th += dth * dt;
  // 傾き: ならした横の加速度で外側へ。強すぎるのが続くと、どんどん傾く
  t.lat += (t.v * dth - t.lat) * Math.min(1, dt / TRUCK.LAT_SMOOTH);
  const ex = Math.max(0, Math.abs(t.lat) - TRUCK.TIP_ACC);
  const target = t.lat * TRUCK.ROLL_K + Math.sign(t.lat) * ex * 0.9;
  const tip = Math.abs(t.dyn) > 0.22 ? Math.sign(t.dyn) * (Math.abs(t.dyn) - 0.22) * 14 : 0;
  t.rollV += ((target - t.dyn) * 30 - t.rollV * 8 + tip) * dt;
  t.dyn += t.rollV * dt;
  // 道からはみ出したか（前・後ろの車輪の組）
  const pts = [
    [t.x + Math.sin(t.th) * TRUCK.L, t.z + Math.cos(t.th) * TRUCK.L],
    [t.x, t.z],
  ];
  let edge = 0;
  let fallSide = 0;
  for (let k = 0; k < 2; k++) {
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
  road.ensure(loc[0].i + 800);
  t.prog = Math.max(t.prog, loc[0].i * ROAD.STEP - t.s0);
  if (fallSide) t.over = { kind: 'fall', side: fallSide, at: t.prog };
  else if (Math.abs(t.roll) > TRUCK.CRASH_ROLL) t.over = { kind: Math.abs(edge) > Math.abs(t.dyn) ? 'fall' : 'roll', side: Math.sign(t.roll), at: t.prog };
  return t.over;
}

/**
 * 落ちた・横転したあとの動き（見せるだけ）。車体は 1 本のまま、外へ倒れながら落ちる。
 * 体: { x, y, z（車体の真ん中）, yaw, roll, pitch, vx, vy, vz, rollV, pitchV, falling }
 */
export function startWreck(t, road) {
  const side = t.over.side;
  const yaw = t.th;
  const push = t.over.kind === 'fall' ? 1.6 : 0.8;
  const b = {
    x: t.x + Math.sin(yaw) * MID,
    y: 0,
    z: t.z + Math.cos(yaw) * MID,
    yaw,
    roll: t.roll,
    pitch: 0,
    vx: Math.sin(yaw) * t.v - Math.cos(yaw) * side * push,
    vy: 0,
    vz: Math.cos(yaw) * t.v + Math.sin(yaw) * side * push,
    rollV: side * (1.2 + Math.abs(t.rollV)),
    pitchV: 0,
    yawV: (t.v / TRUCK.L) * Math.tan(t.delta),
    falling: false,
    hint: -1,
  };
  b.hint = road.locate(b.x, b.z, -1).i;
  return { side, bodies: [b], t: 0 };
}

const wl = {};
export function stepWreck(w, dt, road) {
  w.t += dt;
  for (const b of w.bodies) {
    const L = road.locate(b.x, b.z, b.hint, wl);
    b.hint = L.i;
    // 車体の真ん中が道の外に出たら落ちる（落ちはじめたら、もう戻らない）
    if (!b.falling && Math.abs(L.d) > L.hw + 0.4) b.falling = true;
    b.rollV += w.side * (b.falling ? 1.5 : 5) * dt;
    b.roll += b.rollV * dt;
    b.yaw += b.yawV * dt;
    b.yawV *= Math.max(0, 1 - 2 * dt);
    if (!b.falling) {
      // 道の上で横だおし: 90 度で止まって、すべりながら止まる
      if (Math.abs(b.roll) >= Math.PI / 2) {
        b.roll = (Math.PI / 2) * Math.sign(b.roll);
        b.rollV = 0;
      }
      const k = Math.max(0, 1 - 1.6 * dt);
      b.vx *= k;
      b.vz *= k;
      b.vx += -Math.cos(b.yaw) * w.side * 0.6 * dt;
      b.vz += Math.sin(b.yaw) * w.side * 0.6 * dt;
    } else {
      b.vy -= 9.8 * dt;
      // 先に落ちた側（前か後ろ）へ、少しずつ前のめり・後ろのめり
      b.pitchV += (b.pitchV >= 0 ? 0.25 : -0.25) * dt;
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
