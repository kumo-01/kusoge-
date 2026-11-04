// 爆弾・釣り竿・順位で長さの変わる豪雨・3 人のときの決着・乗り物・倒木のすぐ後ろの飼い主ジャンプ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/games/dogKart/track.js';
import { RaceSim, packNetBin, unpackNetBin, packNet, unpackNet, sanitizeSnapshot, VEHICLES } from '../src/games/dogKart/race.js';
import { IN, ITEMS, RAIN, RACE } from '../src/games/dogKart/constants.js';

const DT = 1 / 60;
const track = new Track();
function race(opts = {}) {
  const sim = new RaceSim(track, { players: [0, 1], npcs: 0, ...opts });
  const n = sim.humans;
  while (sim.s.phase === 'countdown') sim.step(DT, new Array(n).fill(0));
  for (let i = 0; i < 60; i++) sim.step(DT, new Array(n).fill(IN.UP));
  sim.drainEvents();
  return sim;
}
const put = (k, s, lat, extra = {}) => {
  const p = track.pointAt(s, lat);
  Object.assign(k, { x: p.x, z: p.z, h: p.h, sp: 0, kx: 0, kz: 0, ...extra });
};

test('爆弾: 前に投げて、投げてから 3 秒後に落ちた場所で爆発。近くの車を巻き込み、遠くの車は無事', () => {
  const sim = race({ npcs: 2 });
  const [a, b, c, d] = sim.s.karts;
  put(a, 100, 0);
  put(b, 300, 0);
  put(c, 400, 5);
  put(d, 600, 0);
  a.item = ITEMS.BOMB;
  sim.step(DT, [IN.ITEM, 0]);
  assert.equal(sim.s.bombs.length, 1);
  const bm = sim.s.bombs[0];
  const land = track.project(bm.x, bm.z);
  assert.ok(track.wrapDS(land.s - 100) > 20, '前に飛ぶ');
  // 落ちる場所に車を置いて止めておく
  put(b, land.s, land.lat + 3);
  put(c, land.s + 40, 0);
  let boom = null;
  for (let i = 0; i < 60 * 3.2 && !boom; i++) {
    for (const k of [a, b, c, d]) k.sp = 0;
    sim.step(DT, [0, 0]);
    boom = sim.drainEvents().find((e) => e.t === 'boom');
    if (!boom) assert.equal(b.spin, 0, '爆発までは何も起きない');
  }
  assert.ok(boom, '爆発した');
  assert.ok(Math.abs(sim.s.tick * DT - 0) >= 0);
  assert.ok(b.spin > 0, '近くの車は巻き込まれる');
  assert.equal(c.spin, 0, '遠くの車は無事');
  assert.equal(boom.n, 1);
  assert.equal(sim.s.bombs.length, 0);
});

test('釣り竿: 1 つ上の順位の車を、どんなに離れていても自分のすぐ後ろへ。周回も合わせる', () => {
  const sim = race({ npcs: 2 });
  const [a, b, c, d] = sim.s.karts;
  // 順位: d（ずっと前）> c（1 つ上）> a（使う人）> b
  put(a, 200, 0, { lap: 0, cp: 1 });
  put(b, 100, 0, { lap: 0, cp: 0 });
  put(c, track.length * 0.9, 0, { lap: 0, cp: track.checkpoints - 2 });
  put(d, 50, 0, { lap: 1, cp: 0 });
  sim.step(DT, [0, 0]);
  a.item = ITEMS.ROD;
  sim.step(DT, [IN.ITEM, 0]);
  const ev = sim.drainEvents().find((e) => e.t === 'fish');
  assert.ok(ev && ev.n === 1 && ev.v === c.i, '1 つ上（c）を釣る');
  const sa = track.project(a.x, a.z).s;
  const sc = track.project(c.x, c.z).s;
  const ds = track.wrapDS(sa - sc);
  assert.ok(ds > 3 && ds < 12, `すぐ後ろ (${ds})`);
  assert.equal(c.lap, a.lap);
  assert.ok(sim.progressOf(c) < sim.progressOf(a), '順位が入れ替わる');
  assert.equal(sim.rankOf(a.i) < sim.rankOf(c.i), true);
});

test('釣り竿: ガードで防げる・飼い主モードは釣れない', () => {
  const sim = race();
  const [a, b] = sim.s.karts;
  put(a, 100, 0);
  put(b, 600, 0, { gd: 10 });
  sim.step(DT, [0, 0]);
  a.item = ITEMS.ROD;
  sim.step(DT, [IN.ITEM, 0]);
  assert.equal(b.gd, 0, 'ガードが割れる');
  assert.ok(track.project(b.x, b.z).s > 500, '釣られない');
});

test('豪雨: 順位が上の車ほど長く遅くなり、下の車ほど短い（使った車は遅くならない）', () => {
  const sim = race({ npcs: 3 });
  const ks = sim.s.karts;
  ks.forEach((k, i) => put(k, 500 - i * 60, 0));
  sim.step(DT, [0, 0]);
  const user = ks[4];
  sim.callRain(user);
  assert.equal(user.wet, 0);
  assert.ok(Math.abs(ks[0].wet - RAIN.SLOW_TIME) < 0.01, '1 位は一番長い');
  for (let i = 1; i < 4; i++) assert.ok(ks[i].wet < ks[i - 1].wet, `${i + 1} 位は ${i} 位より短い`);
  assert.ok(ks[3].wet >= RAIN.SLOW_MIN);
});

test('3 人のときは 2 人目がゴールして決着（勝ちは 1 人目）。2 人のときは 1 人目で決着', () => {
  const finish = (sim, k) => {
    put(k, track.length - 6, 0, { sp: 30, lap: RACE.LAPS - 1, cp: track.checkpoints - 1 });
  };
  const sim = race({ players: [0, 1, 2] });
  const [a, b] = sim.s.karts;
  finish(sim, a);
  for (let i = 0; i < 60; i++) sim.step(DT, [IN.UP, 0, 0]);
  assert.equal(a.fin, 1);
  assert.equal(sim.s.winner, 0);
  assert.equal(sim.s.phase, 'racing', '1 人目だけではまだ続く');
  finish(sim, b);
  for (let i = 0; i < 60; i++) sim.step(DT, [0, IN.UP, 0]);
  assert.equal(sim.s.phase, 'finished');
  assert.equal(sim.s.winner, 0);
  assert.equal(sim.buildResult().players[0].headline, '🏆 勝ち！');
  // 2 人目がいつまでもゴールしないときは打ち切り
  const sim3 = race({ players: [0, 1, 2] });
  finish(sim3, sim3.s.karts[2]);
  for (let i = 0; i < 60; i++) sim3.step(DT, [0, 0, IN.UP]);
  assert.equal(sim3.s.phase, 'racing');
  sim3.s.fw = RACE.FINISH_WAIT - 0.01;
  for (let i = 0; i < 3; i++) sim3.step(DT, [0, 0, 0]);
  assert.equal(sim3.s.phase, 'finished');
  // 2 人
  const sim2 = race();
  finish(sim2, sim2.s.karts[1]);
  for (let i = 0; i < 60; i++) sim2.step(DT, [0, IN.UP]);
  assert.equal(sim2.s.phase, 'finished');
});

test('乗り物: レースごとにランダム（4 種類）で、完全な状態で届き、定期配信では変わらない', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) for (const k of new RaceSim(track, { npcs: 5 }).s.karts) seen.add(k.veh);
  assert.deepEqual([...seen].sort(), [...Array(VEHICLES).keys()]);
  const sim = new RaceSim(track, { npcs: 3 });
  const snap = sim.getSnapshot();
  const got = sanitizeSnapshot(JSON.parse(JSON.stringify(snap)), sim.s, sim.boxPos.length);
  assert.deepEqual(got.karts.map((k) => k.veh), sim.s.karts.map((k) => k.veh));
  const viaNet = sanitizeSnapshot(unpackNet(packNet(sim.s)), got, sim.boxPos.length);
  assert.deepEqual(viaNet.karts.map((k) => k.veh), sim.s.karts.map((k) => k.veh));
});

test('爆弾は配信（JSON・バイナリ）で届く', () => {
  const sim = race();
  const a = sim.s.karts[0];
  a.item = ITEMS.BOMB;
  sim.step(DT, [IN.ITEM, 0]);
  sim.step(DT, [0, 0]);
  const bm = sim.s.bombs[0];
  const j = unpackNet(packNet(sim.s)).bombs[0];
  assert.equal(j.id, bm.id);
  const bin = unpackNetBin(packNetBin(sim.s, [{ id: 1, t: 'boom', k: 0, x: 1, z: 2, n: 3 }, { id: 2, t: 'fish', k: 0, v: 1, x: 3, z: 4, n: 1 }]));
  assert.equal(bin.snap.bombs.length, 1);
  assert.ok(Math.abs(bin.snap.bombs[0].x - bm.x) < 0.02 && Math.abs(bin.snap.bombs[0].age - bm.age) < 0.02);
  assert.deepEqual(bin.ev.map((e) => e.t), ['boom', 'fish']);
  assert.equal(bin.ev[1].v, 1);
  const s2 = sanitizeSnapshot(bin.snap, sim.s, sim.boxPos.length);
  assert.equal(s2.bombs.length, 1);
});

test('飼い主モード: 倒木のすぐ後ろ（止まっている）で使っても、跳んで越える', () => {
  for (const gap of [0, 1, 2.5]) {
    const sim = race();
    const k = sim.s.karts[0];
    const p = track.project(k.x, k.z);
    const s0 = p.s + 30;
    const l1 = track.pointAt(s0, -track.wallDist);
    const l2 = track.pointAt(s0, track.wallDist);
    sim.s.logs.push({ id: 900, o: 1, s: s0, a: -track.wallDist, b: track.wallDist, x1: l1.x, z1: l1.z, x2: l2.x, z2: l2.z });
    // 倒木にくっついて止まっている（車の半径 + 倒木の太さ + gap）
    put(k, s0 - (1.4 + ITEMS.LOG_R + gap), 0, { sp: 0 });
    for (let i = 0; i < 30; i++) sim.step(DT, [0, 0]);
    k.item = ITEMS.OWNER;
    sim.step(DT, [IN.ITEM, 0]);
    for (let i = 0; i < 120; i++) {
      sim.step(DT, [0, 0]);
      if (k.ow <= 0) k.ow = 3;
    }
    assert.ok(track.wrapDS(track.project(k.x, k.z).s - s0) > 5, `倒木の先へ進める (gap ${gap})`);
  }
});
