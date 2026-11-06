// サーバーからの差分の配信（v10）: 予想との差だけを送り、受け取る側が同じ予想で元に戻す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DogKartEngine } from '../src/games/dogKart/engine.js';
import { NetDeltaEncoder, NetBinDecoder, NetBinEncoder, DELTA_KEY_EVERY } from '../src/games/dogKart/race.js';
import { ITEMS } from '../src/games/dogKart/constants.js';

const memOf = (d) => ({ tick: d.snap.tick, karts: d.snap.karts.map((k) => ({ ...k })), boxTaken: d.snap.boxTaken, foodTaken: d.snap.foodTaken, bananas: d.snap.bananas, logs: d.snap.logs });
const angle = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** 毎秒 40 回（1 tick と 2 tick の間隔を交互に）配信して、受け取った状態が元と同じかを見る */
function run(seconds, opts = {}) {
  const e = new DogKartEngine({ players: [0, 1, 2], npcs: 10, boss: 1, mg: 1, delta: true, ...opts });
  e.sim.rng = undefined;
  const dec = new NetBinDecoder();
  const v9 = new NetBinEncoder();
  let mem = null;
  let acc = 0;
  const st = { frames: 0, bytes: 0, bytes9: 0, evIn: 0, evOut: 0, maxErr: 0 };
  for (let i = 0; i < 60 * seconds; i++) {
    e.step(1 / 60, { 0: 1, 1: i % 90 < 30 ? 1 | 4 : 1, 2: i % 200 < 3 ? 16 : 1 });
    acc += 1;
    const every = e.sim.s.mg ? 6 : 1.5;
    if (acc < every) continue;
    acc -= every;
    const ev = e.drainNetEvents();
    st.evIn += ev.length;
    const buf = e.encodeBinary(ev);
    st.bytes += buf.length;
    st.bytes9 += v9.encode(e.sim.s, ev).length;
    st.frames++;
    const d = dec.decode(buf, mem);
    assert.ok(d, `配信 ${st.frames} が読めない`);
    st.evOut += d.ev.length;
    mem = memOf(d);
    const s = e.sim.s;
    assert.equal(d.snap.tick, s.tick);
    assert.equal(d.snap.phase, s.phase);
    assert.ok(Math.abs(d.snap.t - s.t) < 0.001);
    assert.deepEqual(d.snap.acks, s.acks);
    assert.equal(d.snap.winner, s.winner);
    s.karts.forEach((k, j) => {
      const q = d.snap.karts[j];
      for (const f of ['x', 'z', 'sp', 'y', 'boost', 'roll', 'spin', 'item', 'item2', 'lap', 'cp', 'fd', 'ow', 'fs', 'gi', 'wk']) {
        const err = Math.abs((q[f] || 0) - (k[f] || 0));
        assert.ok(err <= 0.0101, `車 ${j} の ${f}: ${q[f]} ≠ ${k[f]}`);
        st.maxErr = Math.max(st.maxErr, err);
      }
      assert.ok(angle(q.h, k.h) < 0.001, `車 ${j} の向き`);
      assert.equal(q.in, k.in);
    });
    assert.deepEqual(d.snap.boxTaken, s.boxes.reduce((o, t, i) => (t > 0 && o.push(i), o), []));
    assert.deepEqual(d.snap.bananas.map((b) => b.id), s.bananas.map((b) => b.id));
    assert.deepEqual(d.snap.proj.map((p) => p.id), s.proj.map((p) => p.id));
    assert.deepEqual(d.snap.logs.map((l) => l.id), s.logs.map((l) => l.id));
  }
  return { e, st, dec };
}

test('差分の配信: 長いレース（NPC 10 台・ミニゲームあり）で、受け取った状態が元と一致し、v9 の約 1/3 の大きさ', () => {
  const { st, e } = run(150);
  assert.ok(st.frames > 5000);
  assert.equal(st.evOut, st.evIn, '演出イベントは 1 回ずつ、すべて届く');
  assert.ok(st.bytes / st.frames < (st.bytes9 / st.frames) * 0.45, `平均 ${(st.bytes / st.frames).toFixed(0)} バイト（v9: ${(st.bytes9 / st.frames).toFixed(0)}）`);
  assert.ok(e.sim.s.mgN >= 1, 'ミニゲームをまたいでも読める');
});

test('差分の配信: 途中から受け取ると、キーが来るまで読まずに needKey になる。forceKey で次はキー', () => {
  const e = new DogKartEngine({ players: [0, 1], npcs: 4, delta: true });
  const frames = [];
  for (let i = 0; i < 60; i++) {
    e.step(1 / 60, { 0: 1, 1: 1 });
    if (i % 2) frames.push(e.encodeBinary(e.drainNetEvents()));
  }
  const late = new NetBinDecoder();
  assert.equal(late.decode(frames[frames.length - 1], null), null);
  assert.equal(late.needKey, true);
  e.enc.forceKey();
  e.step(1 / 60, { 0: 1, 1: 1 });
  const d = late.decode(e.encodeBinary([]), null);
  assert.ok(d);
  assert.equal(late.needKey, false);
  assert.ok(Math.abs(d.snap.karts[0].x - e.sim.s.karts[0].x) < 0.006);
  // 1 回飛ばす（取りこぼし）と、また needKey
  e.step(1 / 60, { 0: 1, 1: 1 });
  e.encodeBinary([]);
  e.step(1 / 60, { 0: 1, 1: 1 });
  assert.equal(late.decode(e.encodeBinary([]), null), null);
  assert.equal(late.needKey, true);
});

test('差分の配信: 一定の間隔でキーが入り、P2P のホスト（delta なし）は今までどおり v9 でイベントを 3 回載せる', () => {
  const e = new DogKartEngine({ players: [0, 1], npcs: 2, delta: true });
  let keys = 0;
  for (let i = 0; i < DELTA_KEY_EVERY * 2 + 4; i++) {
    e.step(1 / 60, { 0: 1, 1: 1 });
    const b = e.encodeBinary([]);
    if (b[1] & 8) keys++;
  }
  assert.ok(keys >= 2 && keys <= 4, `キー ${keys} 回`);
  const p2p = new DogKartEngine({ players: [0, 1], npcs: 2 });
  p2p.sim.events.push({ t: 'go' });
  p2p.step(1 / 60, { 0: 1, 1: 1 });
  assert.equal(p2p.encodeBinary(p2p.drainNetEvents())[0], 9);
  assert.equal(p2p.drainNetEvents().length + p2p.drainNetEvents().length, 2, 'P2P は同じイベントを 3 回続けて載せる');
});

test('差分の配信: コースの外まで飛ばされた車・アイテムや倒木があっても正しく戻る', () => {
  const e = new DogKartEngine({ players: [0, 1], npcs: 3, delta: true });
  const dec = new NetBinDecoder();
  let mem = null;
  for (let i = 0; i < 400; i++) {
    if (i === 250) {
      Object.assign(e.sim.s.karts[2], { x: 900, z: -840, h: 3.1, sp: 40 });
      e.sim.s.karts[1].item = ITEMS.BANANA;
    }
    e.step(1 / 60, { 0: 1, 1: i > 252 && i < 256 ? 1 | 16 : 1 });
    const d = dec.decode(e.encodeBinary(e.drainNetEvents()), mem);
    assert.ok(d);
    mem = memOf(d);
    e.sim.s.karts.forEach((k, j) => assert.ok(Math.abs(d.snap.karts[j].x - k.x) < 0.006 && Math.abs(d.snap.karts[j].z - k.z) < 0.006, `車 ${j}`));
  }
});
