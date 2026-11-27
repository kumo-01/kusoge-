import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Road, ROAD } from '../src/games/cliffTruck/road.js';
import { newTruck, stepTruck, startWreck, stepWreck, TRUCK, TRUCK_LEN } from '../src/games/cliffTruck/truck.js';

const DT = 1 / 60;

/**
 * 道に沿って走る運転のまね: 後ろの車輪が、カーブの内側寄りの線をなぞるように（前の車輪は自然に外側を通る）。
 * 狙う点は後ろの車輪から 18 m 先。急なカーブの手前では遅く。戻り値: トラック
 */
function drive(seed, vTarget, sec) {
  const road = new Road(seed);
  const t = newTruck(road);
  const F = {};
  const B = {};
  for (let k = 0; k < sec / DT && !t.over; k++) {
    road.locate(t.x + Math.sin(t.th) * TRUCK.L, t.z + Math.cos(t.th) * TRUCK.L, t.hints[0], F);
    road.locate(t.x, t.z, t.hints[1], B);
    const i = Math.floor(F.i);
    road.ensure(i + 80);
    let kmax = 0;
    for (let j = -20; j < 40; j++) kmax = Math.max(kmax, Math.abs(road.k[Math.max(0, i + j)]));
    const v = Math.min(vTarget, Math.sqrt(3.0 / Math.max(kmax, 1e-4)));
    const j = Math.floor(B.i) + 18;
    const off = -Math.max(-3, Math.min(3, (road.k[j] * TRUCK.L * TRUCK.L) / 4));
    const px = road.x[j] - Math.cos(road.h[j]) * off;
    const pz = road.z[j] + Math.sin(road.h[j]) * off;
    const dx = px - t.x;
    const dz = pz - t.z;
    const alpha = Math.atan2(Math.sin(Math.atan2(dx, dz) - t.th), Math.cos(Math.atan2(dx, dz) - t.th));
    const delta = Math.atan((2 * TRUCK.L * Math.sin(alpha)) / Math.hypot(dx, dz));
    const maxD = TRUCK.STEER_MAX / (1 + (t.v * t.v) / 900);
    stepTruck(t, { steer: -delta / maxD, throttle: t.v < v ? 1 : 0, brake: t.v > v + 0.5 ? 0.6 : 0 }, DT, road);
  }
  return t;
}

test('道: 同じ種なら同じ道。はじめはまっすぐ。カーブ（円の弧）が左右かわるがわる続く。急なカーブの所は広い', () => {
  const a = new Road(1234);
  const b = new Road(1234);
  const c = new Road(99);
  a.ensure(3000);
  b.ensure(3000);
  c.ensure(3000);
  assert.equal(a.x[2999], b.x[2999]);
  assert.equal(a.z[2999], b.z[2999]);
  assert.equal(a.w[2999], b.w[2999]);
  assert.notEqual(a.x[2999], c.x[2999]);
  for (let i = 0; i < ROAD.START_STRAIGHT; i++) assert.equal(a.h[i], 0, 'はじめはまっすぐ');
  a.ensure(7000);
  // いちばん急でも半径 R_HARD[0]（入り口・出口はなめらか: 1 m で曲がり具合が少しずつしか変わらない）
  let kmax = 0;
  let dkmax = 0;
  for (let i = 1; i < 7000; i++) {
    kmax = Math.max(kmax, Math.abs(a.k[i]));
    dkmax = Math.max(dkmax, Math.abs(a.k[i] - a.k[i - 1]));
  }
  assert.ok(kmax <= 1 / ROAD.R_HARD[0] + 1e-9, `${1 / kmax}`);
  assert.ok(dkmax <= 1 / 40 / ROAD.EASE + 1e-9);
  // 左右に曲がりかえす回数（1 km あたり 5 回以上）
  let flips = 0;
  let last = 0;
  for (let i = 0; i < 6000; i++) {
    const sg = Math.sign(Math.round(a.k[i] * 1e4));
    if (sg && last && sg !== last) flips++;
    if (sg) last = sg;
  }
  assert.ok(flips >= 30, `${flips}`);
  // グネグネ: はじめの 1 km でも、100 m あたり平均 70 度以上曲がる
  const turn = (i0, i1) => (Array.from({ length: i1 - i0 }, (_, k) => Math.abs(a.h[i0 + k + 1] - a.h[i0 + k])).reduce((n, x) => n + x, 0) / (i1 - i0)) * 100 * (180 / Math.PI);
  assert.ok(turn(100, 1000) > 70, `${turn(100, 1000)}`);
  assert.ok(turn(5000, 6000) > turn(100, 1000));
  // 幅: まっすぐな所はふつうの幅、急なカーブの所は、長い車体が内側を通る分だけ広い
  for (let i = 200; i < 6000; i += 7) {
    const need = 2 * ((ROAD.WHEELBASE ** 2 * Math.abs(a.k[i])) / 4 + ROAD.TRACK / 2 + ROAD.MARGIN[1]);
    assert.ok(a.w[i] >= need - 0.25, `${i}: ${a.w[i]} < ${need}`);
    assert.ok(a.w[i] >= ROAD.W_BASE[1] - 1e-9);
  }
  // 場所を探す: 道の真ん中から右へ 1.5 m の点
  const i = 2500;
  const p = [a.x[i] - Math.cos(a.h[i]) * 1.5, a.z[i] + Math.sin(a.h[i]) * 1.5];
  const L = a.locate(p[0], p[1], i - 10);
  assert.ok(Math.abs(L.i - i) < 0.6 && Math.abs(L.d - 1.5) < 1e-6, JSON.stringify(L));
});

test('道: どの種でも自分と重ならない（大きな向きは前から約 80 度まで）', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const r = new Road(seed * 7919);
    r.ensure(6000);
    assert.ok(Math.max(...r.h.map(Math.abs)) < (82 * Math.PI) / 180, `道 ${seed}`);
    // 80 m 以上はなれた所どうしは、20 m 以上はなれている
    const cell = new Map();
    const C = 20;
    const key = (x, z) => `${Math.floor(x / C)},${Math.floor(z / C)}`;
    for (let i = 0; i < 6000; i += 2) (cell.get(key(r.x[i], r.z[i])) || cell.set(key(r.x[i], r.z[i]), []).get(key(r.x[i], r.z[i]))).push(i);
    for (let i = 0; i < 6000; i += 2) {
      const cx = Math.floor(r.x[i] / C);
      const cz = Math.floor(r.z[i] / C);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const j of cell.get(`${cx + a},${cz + b}`) || []) if (Math.abs(i - j) >= 80) assert.ok(Math.hypot(r.x[i] - r.x[j], r.z[i] - r.z[j]) > 20, `道 ${seed}: ${i} と ${j}`);
    }
  }
});

test('トラック: アクセルで進み、ブレーキで止まる。車体はとても長い 1 本（23 m 以上）', () => {
  const road = new Road(7);
  const t = newTruck(road);
  assert.ok(TRUCK_LEN > 23);
  for (let k = 0; k < 4 / DT; k++) stepTruck(t, { throttle: 1 }, DT, road);
  assert.ok(t.v > 5 && t.prog > 10 && !t.over, `${t.v} ${t.prog}`);
  const p = t.prog;
  for (let k = 0; k < 3 / DT; k++) stepTruck(t, { brake: 1 }, DT, road);
  assert.equal(t.v, 0);
  assert.equal(t.brake, 1, 'ランプが光る');
  assert.ok(t.prog > p && t.prog < p + 40);
});

test('トラック: 道に沿えば遠くまで行ける。ハンドルを切らないとカーブで落ちる。速いまま切り続けると横転。めちゃくちゃに回しても急には倒れない', () => {
  // グネグネの道でも、長い車体で走りきれる（8 本の道のどれも 3 km 以上）
  for (let seed = 1; seed <= 8; seed++) {
    const t = drive(seed, 8, 420);
    assert.ok(t.prog > 3000, `道 ${seed}: ${Math.round(t.prog)} m ${JSON.stringify(t.over)}`);
  }
  // まっすぐのまま
  const road = new Road(5);
  const t = newTruck(road);
  for (let k = 0; k < 60 / DT && !t.over; k++) stepTruck(t, { throttle: 1 }, DT, road);
  assert.equal(t.over?.kind, 'fall');
  // 速いまま、いっぱいに切る
  const r2 = new Road(3);
  const u = newTruck(r2);
  r2.ensure(600);
  r2.w = r2.w.map(() => 200); // 道から出ないように（横転だけを見る）
  for (let k = 0; k < 900; k++) stepTruck(u, { throttle: 1 }, DT, r2);
  for (let k = 0; k < 400 && !u.over; k++) stepTruck(u, { steer: 1, throttle: 1 }, DT, r2);
  assert.equal(u.over?.kind, 'roll');
  assert.ok(Math.abs(u.roll) > TRUCK.CRASH_ROLL);
  assert.equal(u.over.side, -1, '右へ切ると、左へ倒れる');
  // めちゃくちゃに左右へ回す（0.15 秒ごと）: 傾きは小さいまま
  const r3 = new Road(3);
  r3.ensure(400);
  r3.w = r3.w.map(() => 200);
  const q = newTruck(r3);
  for (let k = 0; k < 600; k++) stepTruck(q, { throttle: 1 }, DT, r3);
  let maxRoll = 0;
  for (let k = 0; k < 120; k++) {
    stepTruck(q, { steer: Math.floor(k / 9) % 2 ? 1 : -1, throttle: 1 }, DT, r3);
    maxRoll = Math.max(maxRoll, Math.abs(q.roll));
  }
  assert.equal(q.over, null);
  assert.ok(maxRoll < 0.05, `${maxRoll}`);
  // 落ちたあと: 車体が外へ倒れながら落ちていく（道の外に出たら下へ）
  const w = startWreck(t, road);
  for (let k = 0; k < 3 / DT; k++) stepWreck(w, DT, road);
  assert.ok(w.bodies.some((b) => b.falling && b.y < -10), JSON.stringify(w.bodies.map((b) => [b.y, b.falling])));
});

test('トラック: 片側の車輪が道から出ると傾く。真ん中まで出ると落ちる', () => {
  const road = new Road(11);
  const t = newTruck(road);
  // 右へずらす（道の向きは 0 = +z。右 = -x）
  const hw = road.w[0] / 2;
  t.x -= hw - TRUCK.TRACK / 2 + 0.5;
  stepTruck(t, {}, DT, road);
  assert.equal(t.over, null);
  assert.ok(t.roll > 0.1, `右が下がる ${t.roll}`);
  const u = newTruck(road);
  u.x -= hw + 0.2;
  stepTruck(u, {}, DT, road);
  assert.equal(u.over?.kind, 'fall');
  assert.equal(u.over.side, 1);
});
