// 受け取る側の表示（自分の車の予測・ほかの車の先読み）の単体テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Predictor, RemoteKarts } from '../src/games/dogKart/netview.js';
import { DogKartEngine } from '../src/games/dogKart/engine.js';
import { stepKart } from '../src/games/dogKart/physics.js';
import { IN } from '../src/games/dogKart/constants.js';

const DT = 1 / 60;

function racing() {
  const e = new DogKartEngine({ course: 0, npcs: 2, players: [0, 1] });
  for (let i = 1; i <= 400; i++) {
    e.receiveInput(0, i, [IN.UP]);
    e.receiveInput(1, i, [IN.UP | (i % 90 < 30 ? IN.LEFT : 0)]);
    e.step(DT);
  }
  return e;
}

test('ほかの車: 確定状態から「自分の車が先を走っている tick 数」だけ先へ計算して描く', () => {
  const e = racing();
  const r = new RemoteKarts();
  const ks = e.sim.s.karts;
  r.sync(ks, 1, 10, e.track, true, DT);
  assert.equal(r.g[1], null, '自分の車は対象外');
  const k = { ...ks[0] };
  for (let i = 0; i < 10; i++) stepKart(k, k.in, DT, e.track, true, true);
  const v = r.view(0, 1);
  assert.ok(Math.hypot(v.x - k.x, v.z - k.z) < 1e-9, '10 tick 先の位置');
  assert.ok(Math.hypot(v.x - ks[0].x, v.z - ks[0].z) > 3, '確定状態より先にいる');
});

test('ほかの車: 新しい確定状態が届いても、描く位置は飛ばず、ずれは滑らかに 0 へ戻る', () => {
  const e = racing();
  const r = new RemoteKarts();
  r.sync(e.sim.s.karts, 1, 8, e.track, true, DT);
  const before = r.view(0, 1);
  // 操作が変わった（確定状態が予想と違う）
  const changed = e.sim.s.karts.map((k) => ({ ...k }));
  changed[0].x += 1.2;
  changed[0].h += 0.15;
  r.sync(changed, 1, 8, e.track, true, DT);
  const after = r.view(0, 1);
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < 1e-9, '届いた瞬間は同じ位置');
  assert.ok(Math.abs(after.h - before.h) < 1e-9, '向きも同じ');
  // 2 秒で、ほぼ新しい推定に合う
  for (let i = 0; i < 120; i++) {
    r.step(e.track, true, DT);
    r.decay(DT);
  }
  const o = r.off[0];
  assert.ok(Math.hypot(o.x, o.z) < 0.02 && Math.abs(o.h) < 0.005, `ずれが戻る (${o.x}, ${o.z}, ${o.h})`);
});

test('ほかの車: 復帰などの大きな瞬間移動はそのまま反映する', () => {
  const e = racing();
  const r = new RemoteKarts();
  r.sync(e.sim.s.karts, 1, 5, e.track, true, DT);
  const moved = e.sim.s.karts.map((k) => ({ ...k }));
  const q = e.track.pointAt(e.track.project(moved[0].x, moved[0].z).s + 60, 0); // コースに沿って 60m 先（復帰地点など）
  Object.assign(moved[0], { x: q.x, z: q.z, h: q.h });
  r.sync(moved, 1, 5, e.track, true, DT);
  assert.equal(r.off[0].x, 0);
});

test('自分の車: 確定状態との差は、届いた瞬間には見た目を動かさず、滑らかに直す', () => {
  const e = racing();
  const p = new Predictor();
  const k0 = e.sim.s.karts[1];
  p.reset(k0);
  for (let s = 1; s <= 6; s++) {
    stepKart(p.k, IN.UP, DT, e.track, true);
    p.record(s);
  }
  const shown = () => ({ x: p.k.x + p.off.x, z: p.k.z + p.off.z });
  const before = shown();
  // サーバーでは seq 3 の時点で 0.5m 横にいた
  const server = { ...p.hist[2], x: p.hist[2].x + 0.5 };
  for (const f of ['lap', 'cp', 'item', 'roll', 'fin', 'ft', 'lapStart', 'best', 'stats', 'spinDur', 'wrong', 'bump', 'fd', 'ow', 'tb', 'tw']) server[f] = k0[f];
  p.reconcile(server, 3);
  const after = shown();
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < 1e-9, '見た目は飛ばない');
  assert.ok(Math.abs(p.k.x - (before.x + 0.5)) < 1e-6, '予測は直っている');
  for (let i = 0; i < 60; i++) p.decay(DT);
  assert.ok(Math.hypot(p.off.x, p.off.z) < 0.01, '1 秒で見た目も追いつく');
});

test('見た目のずれの戻し方: 端末が重くて 1 フレームが長くても発散しない', () => {
  const e = racing();
  const p = new Predictor();
  p.reset(e.sim.s.karts[1]);
  p.off.x = 0.8;
  p.off.vx = 12;
  for (let i = 0; i < 20; i++) p.decay(0.25); // 4 fps
  assert.ok(Number.isFinite(p.off.x) && Math.abs(p.off.x) < 1e-3, `${p.off.x}`);
  const r = new RemoteKarts();
  r.sync(e.sim.s.karts, 1, 5, e.track, true, DT);
  r.off[0].x = 2;
  r.off[0].vh = 5;
  for (let i = 0; i < 20; i++) r.decay(0.5);
  assert.ok(Math.abs(r.off[0].x) < 1e-3 && Math.abs(r.off[0].h) < 1e-3);
});

test('追いつき: 一気に進めた分を見た目のずれに入れ、少しずつ追いつかせる', () => {
  const e = racing();
  const r = new RemoteKarts();
  r.sync(e.sim.s.karts, 1, 5, e.track, true, DT);
  const before = r.g.map((g) => g && { x: g.x, z: g.z });
  const shown0 = r.view(0, 1);
  for (let i = 0; i < 18; i++) r.step(e.track, true, DT); // 0.3 秒止まっていた分を一気に
  r.absorb(before, 17 / 18);
  const shown1 = r.view(0, 1);
  assert.ok(Math.hypot(shown1.x - shown0.x, shown1.z - shown0.z) < 1.2, '見た目は 1 tick 分しか動かない');
  for (let i = 0; i < 90; i++) r.decay(DT);
  const o = r.off[0];
  assert.ok(Math.hypot(o.x, o.z) < 0.05, '1.5 秒で追いつく');
});

test('自分の車: 復帰（rc の増加）は瞬時に合わせ、それ以外の大きなずれは滑らかに直す', () => {
  const e = racing();
  const p = new Predictor();
  const k0 = e.sim.s.karts[1];
  p.reset(k0);
  for (let s = 1; s <= 3; s++) {
    stepKart(p.k, IN.UP, DT, e.track, true);
    p.record(s);
  }
  const fields = (src) => { const o = { ...src }; for (const f of ['lap', 'cp', 'item', 'roll', 'fin', 'ft', 'lapStart', 'best', 'stats', 'spinDur', 'wrong', 'bump', 'fd', 'ow', 'tb', 'tw']) o[f] = k0[f]; return o; };
  // 10m ずれていても瞬間移動しない（補正は入るが、見た目は少しずつ）
  let res = p.reconcile(fields({ ...p.hist[1], x: p.hist[1].x + 10 }), 2);
  assert.equal(res.kind, 'ok');
  assert.ok(Math.abs(p.off.x + 10) < 1e-6, 'ずれは見た目のずれに入る');
  // 復帰（クールダウンが増えた）は瞬時
  res = p.reconcile(fields({ ...p.hist[1], x: p.hist[1].x + 3, rc: 3 }), 3);
  assert.equal(res.kind, 'snap');
  assert.equal(p.off.x, 0);
});
