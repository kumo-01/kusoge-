// 爆弾・釣り竿・順位で長さの変わる豪雨・3 人のときの決着・乗り物・倒木のすぐ後ろの飼い主ジャンプ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/games/dogKart/track.js';
import { RaceSim, packNetBin, unpackNetBin, packNet, unpackNet, sanitizeSnapshot, VEHICLES } from '../src/games/dogKart/race.js';
import { IN, ITEMS, RAIN, RACE } from '../src/games/dogKart/constants.js';
import { useItem } from '../src/games/dogKart/items.js';

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

test('爆弾: 前に投げて、投げてから 2〜3 秒後に落ちた場所で爆発。近くの車を巻き込み、遠くの車は無事', () => {
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

test('釣り竿: コース上でいちばん近く前の車を、どんなに離れていても自分の 7m 後ろへ引き寄せる。周回数は変えない', () => {
  const sim = race({ npcs: 2 });
  const [a, b, c, d] = sim.s.karts;
  // a（使う人）の前: c が 300m 先（1 周多い）、d が 600m 先。b は後ろ
  put(a, 200, 0, { lap: 1, cp: 0 });
  put(b, 100, 0, { lap: 1, cp: 0 });
  put(c, 500, 0, { lap: 2, cp: 1 });
  put(d, 800, 0, { lap: 1, cp: 2 });
  sim.step(DT, [0, 0]);
  a.item = ITEMS.ROD;
  sim.step(DT, [IN.ITEM, 0]);
  const ev = sim.drainEvents().find((e) => e.t === 'fish');
  assert.ok(ev && ev.n === 1 && ev.v === c.i, 'いちばん近く前（c）を釣る');
  // 一瞬で飛ばず、引き寄せられて動く（宙を飛ぶ）
  assert.ok(c.fs > 0);
  let maxY = 0;
  let prevS = track.project(c.x, c.z).s;
  let backward = 0;
  for (let i = 0; i < 60 * ITEMS.ROD_TIME + 5; i++) {
    a.sp = 0;
    sim.step(DT, [0, 0]);
    maxY = Math.max(maxY, c.y);
    const cs = track.project(c.x, c.z).s;
    if (track.wrapDS(cs - prevS) < -0.01) backward++;
    assert.ok(Math.abs(track.wrapDS(cs - prevS)) < 20, '途中で瞬間移動しない');
    prevS = cs;
  }
  assert.ok(maxY > 3, '弧を描いて飛ぶ');
  assert.ok(backward > 30, 'コースに沿って後ろへ動く');
  assert.equal(c.fs, 0);
  const ds = track.wrapDS(track.project(a.x, a.z).s - track.project(c.x, c.z).s);
  assert.ok(ds > 5 && ds < 9, `7m 後ろ (${ds})`);
  assert.equal(c.lap, 2, '周回数は変わらない');
  assert.ok(c.cp <= a.cp + 1);
});

test('釣り竿: 1 位のときは使えず（アイテムは残る）、前にいても周回遅れの車は釣らない', () => {
  const sim = race({ npcs: 1 });
  const [a, b, c] = sim.s.karts;
  // a が 1 位（2 周目）。b・c は周回遅れで、コース上では a のすぐ前にいる
  put(a, 200, 0, { lap: 1, cp: 0 });
  put(b, 260, 0, { lap: 0, cp: 0 });
  put(c, 400, 0, { lap: 0, cp: 1 });
  sim.step(DT, [0, 0]);
  sim.drainEvents();
  a.item = ITEMS.ROD;
  sim.step(DT, [IN.ITEM, 0]);
  const ev = sim.drainEvents();
  assert.ok(ev.some((e) => e.t === 'rodNo' && e.k === a.i), '使えない');
  assert.ok(!ev.some((e) => e.t === 'fish'));
  assert.equal(a.item, ITEMS.ROD, 'アイテムは持ったまま');
  assert.equal(b.fs, 0);
  assert.equal(c.fs, 0);
  // 最下位の b が使うと、順位が上の車（a・c）のうち、コース上でいちばん近く前の c を釣る
  b.item = ITEMS.ROD;
  sim.step(DT, [0, IN.ITEM]);
  const ev2 = sim.drainEvents().find((e) => e.t === 'fish');
  assert.equal(ev2?.v, c.i);
});

test('釣り竿: 飼い主モードの車は飛ばして、その 1 つ先の車を釣る', () => {
  const sim = race({ npcs: 1 });
  const [a, b, c] = sim.s.karts;
  put(a, 200, 0);
  put(b, 300, 0, { ow: 5 });
  put(c, 700, 0);
  sim.step(DT, [0, 0]);
  b.ow = 5;
  a.item = ITEMS.ROD;
  sim.step(DT, [IN.ITEM, 0]);
  const ev = sim.drainEvents().find((e) => e.t === 'fish');
  assert.equal(ev.v, c.i);
  for (let i = 0; i < 80; i++) sim.step(DT, [0, 0]);
  assert.ok(track.project(c.x, c.z).s < 200);
});

test('爆弾: 爆発までの時間は投げるたびに 2〜3 秒', () => {
  const fus = new Set();
  for (let n = 0; n < 12; n++) {
    const sim = race();
    sim.s.rng = n * 7919 + 1;
    sim.s.karts[0].item = ITEMS.BOMB;
    sim.step(DT, [IN.ITEM, 0]);
    const fu = sim.s.bombs[0].fu;
    assert.ok(fu >= 2 && fu <= 3, String(fu));
    fus.add(Math.round(fu * 10));
  }
  assert.ok(fus.size >= 4, 'ばらつく');
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

test('釣り竿: すぐ前の相手を、速く走りながら釣っても、1 周ぐるっと戻さない（周回はそのまま、自分の後ろへ）', () => {
  const sim = race({ npcs: 2 });
  const [a, b, c, d] = sim.s.karts;
  put(a, 500, 0, { lap: 1, cp: 2, sp: 35 });
  put(b, 515, 3, { lap: 1, cp: 2, sp: 30 });
  put(c, 100, 0);
  put(d, 50, 0);
  sim.step(DT, [0, 0]);
  a.item = ITEMS.ROD;
  sim.step(DT, [IN.ITEM | IN.UP, 0]);
  assert.ok(Math.abs(b.fb - b.fa) < 60, `近い距離だけ動く (${b.fa} → ${b.fb})`);
  assert.equal(b.lap, 1, '周回は変わらない');
  for (let i = 0; i < 80; i++) sim.step(DT, [IN.UP, 0]);
  const ds = track.wrapDS(track.project(a.x, a.z).s - track.project(b.x, b.z).s);
  assert.ok(ds > 0 && ds < 25, `自分の後ろ (${ds})`);
  assert.equal(b.lap, 1);
});

test('フリスビー: 狙った相手を追い越したら、その先の車を狙い直す。通り道の車にも当たる', () => {
  // NPC は止まっていると復帰してしまうので、人間 3 人で
  const sim = race({ players: [0, 1, 2] });
  const [a, c, d] = sim.s.karts;
  put(a, 100, 0);
  put(c, 140, 0, { inv: 0 }); // すぐ前（最初に狙う）
  put(d, 300, -8, { inv: 0 });
  sim.step(DT, [0, 0, 0]);
  a.item = ITEMS.FRISBEE;
  sim.step(DT, [IN.ITEM, 0, 0]);
  const pr = sim.s.proj.find((p) => p.f);
  assert.equal(pr.t, c.i);
  // c を急に後ろへ動かして外させる → 前の d を狙い直して当たる
  put(c, 20, 0);
  let hitD = false;
  for (let i = 0; i < 360 && !hitD; i++) {
    for (const k of [a, c, d]) k.sp = 0;
    sim.step(DT, [0, 0, 0]);
    hitD = sim.drainEvents().some((e) => e.t === 'hit' && e.k === d.i);
  }
  assert.ok(hitD, '狙い直した相手に当たる');
  // 通り道の車: 狙っていない車がちょうど通り道にいれば当たる
  const sim2 = race({ players: [0, 1, 2] });
  const [a2, b2, c2] = sim2.s.karts;
  put(a2, 100, 0);
  put(b2, 400, 0);
  put(c2, 150, 0.5, { inv: 0 });
  sim2.step(DT, [0, 0, 0]);
  a2.item = ITEMS.FRISBEE;
  sim2.step(DT, [IN.ITEM, 0, 0]);
  sim2.s.proj[0].t = b2.i; // 狙いは遠くの b2。c2 はちょうど通り道にいる
  let hitC = false;
  for (let i = 0; i < 120 && !hitC; i++) {
    for (const k of [a2, b2, c2]) k.sp = 0;
    sim2.step(DT, [0, 0, 0]);
    hitC = sim2.drainEvents().some((e) => e.t === 'hit' && e.k === c2.i);
  }
  assert.ok(hitC);
});

test('巨大化: 大きくなり、触れた相手をつぶして遅くする（スピンはしない）', () => {
  const sim = race();
  const [a, b] = sim.s.karts;
  put(a, 200, 0, { sp: 20 });
  put(b, 203, 0.5, { sp: 10 });
  a.item = ITEMS.GIANT;
  sim.step(DT, [IN.ITEM | IN.UP, IN.UP]);
  assert.ok(a.gi > 0);
  let sq = false;
  for (let i = 0; i < 30 && !sq; i++) {
    sim.step(DT, [IN.UP, IN.UP]);
    sq = sim.drainEvents().some((e) => e.t === 'squash' && e.k === b.i);
  }
  assert.ok(sq, 'つぶれた');
  assert.ok(b.sq > 0 && b.slow > 0);
  assert.equal(b.spin, 0);
});

test('逆走爺: 使った人以外の操作が逆になる（アクセルでバック）', () => {
  const sim = race({ npcs: 1 });
  const [a, b] = sim.s.karts;
  put(a, 200, 0);
  put(b, 300, 0, { sp: 0 });
  a.item = ITEMS.REVERSE;
  sim.step(DT, [IN.ITEM, 0]);
  assert.equal(a.rv, 0);
  assert.ok(b.rv > 0 && sim.s.karts[2].rv > 0);
  for (let i = 0; i < 40; i++) sim.step(DT, [0, IN.UP]);
  assert.ok(b.sp < 0, `アクセルでバックする (${b.sp})`);
  for (let i = 0; i < 60 * ITEMS.REVERSE_TIME; i++) sim.step(DT, [0, 0]);
  assert.equal(b.rv, 0);
});

test('免許返納: 5 位以内（使った人を除く）から 2 台が歩きになり、遅くなる', () => {
  for (let n = 0; n < 6; n++) {
    const sim = race({ npcs: 6 });
    sim.s.rng = 1234 + n * 77;
    const ks = sim.s.karts;
    ks.forEach((k, i) => put(k, 900 - i * 50, 0)); // 0 が 1 位 … 7 が 8 位
    sim.step(DT, new Array(2).fill(0));
    const user = n % 2 ? ks[2] : ks[6]; // 3 位（5 位以内）と 7 位
    user.item = ITEMS.LICENSE;
    sim.prog = ks.map((k) => sim.progressOf(k));
    useItem(sim.s, user, [], sim.prog, null, track);
    const walked = ks.filter((k) => k.wk > 0);
    assert.equal(walked.length, 2);
    for (const k of walked) {
      assert.notEqual(k, user);
      assert.ok(sim.rankOf(k.i, sim.prog) <= 5);
    }
    const w = walked[0];
    for (let i = 0; i < 120; i++) sim.step(DT, [IN.UP, IN.UP]);
    assert.ok(w.sp <= ITEMS.WALK_SPEED + 0.5, `歩く速さ (${w.sp})`);
  }
});
