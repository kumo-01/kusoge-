// 4 人対戦: 部屋・カート（人 4 + NPC 10 + ボス = 15 台）・ゴム鉄砲・2D のゲーム
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PLAYERS, sanitizeRoomState, sanitizeResult, decode, encode, ENGINE_FROM_HOST } from '../src/core/protocol.js';
import { PLAYERS } from '../src/screens/common.js';
import { DogKartEngine } from '../src/games/dogKart/engine.js';
import { RaceSim, NetBinDecoder, NetAckEncoder } from '../src/games/dogKart/race.js';
import { Track } from '../src/games/dogKart/track.js';
import { RACE } from '../src/games/dogKart/constants.js';
import { GomuSim } from '../src/games/gomuBattle/sim.js';
import { SLOT_COLORS } from '../src/games/common2d.js';

test('部屋: 席は 4 つ（ホスト + ゲスト 3 人）。4 人目はパグ（緑）', () => {
  assert.equal(MAX_PLAYERS, 4);
  assert.equal(PLAYERS.length, 4);
  assert.equal(PLAYERS[3].kind, 'pug');
  assert.equal(SLOT_COLORS.length, 4);
  const room = sanitizeRoomState({ rev: 1, screen: 'home', players: [0, 1, 2, 3].map(() => ({ link: 'connected', ready: true })), options: {} });
  assert.ok(room);
  assert.equal(room.players.length, 4);
  const r = sanitizeResult({ winner: 3, players: [0, 1, 2, 3].map((slot) => ({ slot, headline: 'x', detail: 'y' })), points: [1, 2, 3, 4] });
  assert.equal(r.winner, 3);
  assert.deepEqual(r.players.map((p) => p.slot), [0, 1, 2, 3]);
  // サーバー計算の開始の指示に 4 人を載せられる
  const msg = decode(encode({ type: 'e_start', matchId: 'm1', gen: 1, options: {}, players: [0, 1, 2, 3], tickets: ['', 'aaaaaaaa', 'bbbbbbbb', 'cccccccc'] }), ENGINE_FROM_HOST);
  assert.deepEqual(msg.players, [0, 1, 2, 3]);
});

test('カート: 4 人 + NPC 10 台 + ボス = 15 台。4 人のときは 3 人がゴールして決着。配信（差分・P2P の差分）でそろう', () => {
  const sim = new RaceSim(new Track(0), { players: [0, 1, 2, 3], npcs: 10, boss: 1, seed: 4 });
  assert.equal(sim.s.karts.length, RACE.MAX_KARTS);
  assert.equal(sim.finishNeed, 3);
  assert.deepEqual(sim.s.karts.slice(0, 4).map((k) => k.style), [0, 1, 2, 3]);
  const styles = sim.s.karts.map((k) => k.style);
  assert.equal(new Set(styles).size, styles.length, '見た目はみんなちがう');
  // サーバーの差分配信
  const e = new DogKartEngine({ players: [0, 1, 2, 3], npcs: 10, boss: 1, delta: true });
  const dec = new NetBinDecoder();
  let mem = null;
  for (let i = 0; i < 600; i++) {
    e.step(1 / 60, { 0: 1, 1: 1, 2: 1 | 4, 3: 1 | 8 });
    if (i % 2) continue;
    const d = dec.decode(e.encodeBinary(e.drainNetEvents()), mem);
    assert.ok(d);
    mem = { tick: d.snap.tick, karts: d.snap.karts, boxTaken: d.snap.boxTaken, foodTaken: d.snap.foodTaken, bananas: d.snap.bananas, logs: d.snap.logs };
    assert.equal(d.snap.karts.length, 15);
    assert.deepEqual(d.snap.acks, e.sim.s.acks);
    e.sim.s.karts.forEach((k, j) => assert.ok(Math.abs(d.snap.karts[j].x - k.x) < 0.006));
  }
  // P2P の差分（ゲスト 3 人）
  const host = new DogKartEngine({ players: [0, 1, 2, 3], npcs: 10, boss: 1 });
  const enc = new NetAckEncoder();
  const decs = [1, 2, 3].map(() => new NetBinDecoder());
  for (let i = 0; i < 200; i++) {
    host.step(1 / 60, { 0: 1, 1: 1, 2: 1, 3: 1 });
    if (i % 2) continue;
    enc.frame(host.sim.s, host.drainNetEvents());
    decs.forEach((dd, g) => {
      const d = dd.decode(enc.encodeFor(g + 1));
      assert.ok(d);
      enc.ack(g + 1, dd.ackN);
      assert.equal(d.snap.karts.length, 15);
    });
  }
});

test('ゴム鉄砲: 4 人 + CPU 5 匹で 3 ラウンドが進む', () => {
  const sim = new GomuSim({ humans: 4, bots: 5, seed: 9 });
  assert.equal(sim.s.players.length, 9);
  assert.equal(sim.humans, 4);
  for (let i = 0; i < 60 * 30; i++) sim.step(1 / 60);
  assert.ok(sim.s.players.slice(4).some((p) => p.shots > 0));
});
