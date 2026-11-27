import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Road, ROAD } from '../src/games/cliffTruck/road.js';
import { newTruck, stepTruck, startWreck, stepWreck, TRUCK, trailerAxle } from '../src/games/cliffTruck/truck.js';

const DT = 1 / 60;

/** 道に沿って走る運転のまね（外側をまわる）。戻り値: トラック */
function drive(seed, vTarget, sec) {
  const road = new Road(seed);
  const t = newTruck(road);
  const L = {};
  for (let k = 0; k < sec / DT && !t.over; k++) {
    road.locate(t.x + Math.sin(t.th) * TRUCK.L1, t.z + Math.cos(t.th) * TRUCK.L1, t.hints[0], L);
    const i = Math.floor(L.i);
    road.ensure(i + 60);
    // 先 5〜40 m の曲がりの平均を見て、外側へなめらかに寄る
    const kAvg = (road.h[i + 40] - road.h[i + 5]) / 35;
    t._tg = (t._tg ?? 0) + (Math.max(-1.8, Math.min(1.8, kAvg * 110)) - (t._tg ?? 0)) * 0.03;
    const tgtD = t._tg;
    const hErr = Math.atan2(Math.sin(t.th - road.h[i + 6]), Math.cos(t.th - road.h[i + 6]));
    stepTruck(t, { steer: -(L.d - tgtD) * 0.35 + hErr * 2.2, throttle: t.v < vTarget ? 1 : 0, brake: t.v > vTarget + 1 ? 0.5 : 0 }, DT, road);
  }
  return t;
}

test('道: 同じ種なら同じ道。先へ行くほど曲がりがきつく、せまくなる（はじめはまっすぐ）', () => {
  const a = new Road(1234);
  const b = new Road(1234);
  const c = new Road(99);
  a.ensure(3000);
  b.ensure(3000);
  c.ensure(3000);
  assert.equal(a.x[2999], b.x[2999]);
  assert.equal(a.z[2999], b.z[2999]);
  assert.notEqual(a.x[2999], c.x[2999]);
  for (let i = 0; i < ROAD.START_STRAIGHT; i++) assert.equal(a.h[i], 0, 'はじめはまっすぐ');
  assert.equal(a.w[0], ROAD.W0);
  a.ensure(7000);
  assert.ok(Math.abs(a.w[6000] - ROAD.W_MIN) < 1e-9, 'いちばんせまい');
  const maxK = (i0, i1) => Math.max(...Array.from({ length: i1 - i0 }, (_, k) => Math.abs(a.h[i0 + k + 1] - a.h[i0 + k])));
  assert.ok(maxK(5500, 6900) > maxK(200, 1200) * 1.5, '先の方が急');
  // グネグネ: はじめの 1 km でも、100 m あたり平均 15 度以上曲がる（左右に曲がりかえしながら）
  const turn = (i0, i1) => (Array.from({ length: i1 - i0 }, (_, k) => Math.abs(a.h[i0 + k + 1] - a.h[i0 + k])).reduce((n, x) => n + x, 0) / (i1 - i0)) * 100 * (180 / Math.PI);
  assert.ok(turn(100, 1000) > 15, `${turn(100, 1000)}`);
  assert.ok(turn(5000, 6000) > turn(100, 1000));
  assert.ok(maxK(0, 6900) <= 1 / ROAD.R_MIN + 1e-9, 'いちばん急でも半径 R_MIN');
  // 場所を探す: 道の真ん中から右へ 1.5 m の点
  const i = 2500;
  const p = [a.x[i] - Math.cos(a.h[i]) * 1.5, a.z[i] + Math.sin(a.h[i]) * 1.5];
  const L = a.locate(p[0], p[1], i - 10);
  assert.ok(Math.abs(L.i - i) < 0.6 && Math.abs(L.d - 1.5) < 1e-6, JSON.stringify(L));
});

test('トラック: アクセルで進み、ブレーキで止まる。荷台はとても長い（連結部 → 後ろの車輪 20 m 以上）', () => {
  const road = new Road(7);
  const t = newTruck(road);
  const [tx, tz] = trailerAxle(t);
  assert.ok(Math.hypot(tx - t.x, tz - t.z) > 20);
  for (let k = 0; k < 4 / DT; k++) stepTruck(t, { throttle: 1 }, DT, road);
  assert.ok(t.v > 5 && t.prog > 10 && !t.over, `${t.v} ${t.prog}`);
  const p = t.prog;
  for (let k = 0; k < 3 / DT; k++) stepTruck(t, { brake: 1 }, DT, road);
  assert.equal(t.v, 0);
  assert.equal(t.brake, 1, 'ランプが光る');
  assert.ok(t.prog > p && t.prog < p + 40);
});

test('トラック: ゆっくり道に沿えば遠くまで行ける。ハンドルを切らないとカーブで落ちる。速すぎて急に切ると横転', () => {
  const slow = drive(5, 9, 240);
  assert.equal(slow.over, null, `落ちた ${JSON.stringify(slow.over)}`);
  assert.ok(slow.prog > 1500, `${slow.prog}`);
  // まっすぐのまま
  const road = new Road(5);
  const t = newTruck(road);
  for (let k = 0; k < 60 / DT && !t.over; k++) stepTruck(t, { throttle: 1 }, DT, road);
  assert.equal(t.over?.kind, 'fall');
  // 速いまま、いっぱいに切る
  const r2 = new Road(3);
  const u = newTruck(r2);
  for (let k = 0; k < 600; k++) stepTruck(u, { throttle: 1 }, DT, r2);
  for (let k = 0; k < 300 && !u.over; k++) stepTruck(u, { steer: 1, throttle: 1 }, DT, r2);
  assert.equal(u.over?.kind, 'roll');
  assert.ok(Math.abs(u.roll) > TRUCK.CRASH_ROLL);
  assert.equal(u.over.side, -1, '右へ切ると、左へ倒れる');
  // 落ちたあと: 運転台と荷台が外へ倒れながら落ちていく（道の外に出たら下へ）
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
