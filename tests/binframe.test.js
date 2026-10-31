// バイナリの枠と、レースの状態のバイナリ形式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSnapshotFrame, encodeInputFrame, decodeFrame, isFrame, matchHash, FRAME_INPUT, FRAME_SNAPSHOT } from '../src/core/binframe.js';
import { DogKartEngine } from '../src/games/dogKart/engine.js';
import { packNetBin, unpackNetBin, unpackNet, sanitizeSnapshot, RaceSim } from '../src/games/dogKart/race.js';
import { IN, ITEMS } from '../src/games/dogKart/constants.js';
import { encode } from '../src/core/protocol.js';

test('枠: 操作と配信を往復でき、試合と世代を見分けられる', () => {
  const inp = decodeFrame(encodeInputFrame('match-a', 7, 123456, [1, 5, 9]));
  assert.deepEqual({ kind: inp.kind, gen: inp.gen, seq: inp.seq, inputs: inp.inputs, hash: inp.hash }, { kind: FRAME_INPUT, gen: 7, seq: 123456, inputs: [1, 5, 9], hash: matchHash('match-a') });
  assert.notEqual(matchHash('match-a'), matchHash('match-b'));
  const payload = new Uint8Array([1, 2, 3, 250]);
  const buf = encodeSnapshotFrame('match-a', 3, 42, payload);
  assert.ok(isFrame(buf));
  const s = decodeFrame(buf);
  assert.equal(s.kind, FRAME_SNAPSHOT);
  assert.equal(s.seq, 42);
  assert.deepEqual(Array.from(s.payload), [1, 2, 3, 250]);
  // 操作の枠は約 14 バイト（JSON は約 87 文字）
  assert.ok(encodeInputFrame('m'.repeat(24), 3, 99999, [1]).byteLength <= 14);
  // 壊れたもの・ほかのデータは読まない
  assert.equal(decodeFrame(new ArrayBuffer(3)), null);
  assert.equal(isFrame('{"type":"ping"}'), false);
  assert.equal(decodeFrame(new Uint8Array([0xb7, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9]).buffer), null, '操作の数が足りない');
});

test('レースの状態のバイナリ形式: JSON 版と同じ中身に戻り、大きさは約 1/3 以下', () => {
  const e = new DogKartEngine({ course: 2, npcs: 3, boss: 1, players: [0, 1, 2] });
  let jsonLen = 0;
  let binLen = 0;
  let n = 0;
  for (let i = 1; i <= 60 * 30; i++) {
    for (const p of [0, 1, 2]) e.receiveInput(p, i, [IN.UP | (i % 97 < 30 ? IN.LEFT : 0) | (i === 900 && p === 1 ? IN.ITEM : 0)]);
    if (i === 899) e.sim.s.karts[1].item = ITEMS.BANANA;
    e.step(1 / 60);
    if (i % 2 || i < 400) continue;
    const ev = e.drainNetEvents();
    const bin = packNetBin(e.sim.s, ev);
    const json = encode({ type: 'game_snapshot', matchId: 'abcdef0123456789', gen: 1, seq: i, snap: e.encode(), ev });
    jsonLen += json.length;
    binLen += bin.length + 12;
    n++;
    const back = unpackNetBin(bin);
    const ref = unpackNet(JSON.parse(JSON.stringify(e.encode())));
    assert.equal(back.snap.tick, ref.tick);
    assert.deepEqual(back.snap.acks, ref.acks);
    assert.deepEqual(back.snap.boxTaken, ref.boxTaken);
    assert.deepEqual(back.snap.foodTaken, ref.foodTaken);
    assert.equal(back.snap.bananas.length, ref.bananas.length);
    for (let k = 0; k < ref.karts.length; k++) {
      for (const f of Object.keys(ref.karts[k])) assert.ok(Math.abs((back.snap.karts[k][f] || 0) - (ref.karts[k][f] || 0)) < 0.0011, `kart ${k} ${f}`);
    }
    assert.deepEqual(back.ev.map((x) => [x.id, x.t, x.k]), ev.map((x) => [x.id, x.t, Number.isInteger(x.k) && x.k >= 0 ? x.k : -1]));
  }
  assert.ok(binLen * 3 < jsonLen, `binary ${binLen / n} vs json ${jsonLen / n}`);
  // 受け取る側の検証にそのまま通る
  const client = new RaceSim(e.track, { npcs: 3, boss: 1, players: [0, 1, 2] });
  const back = unpackNetBin(packNetBin(e.sim.s, []));
  const s = sanitizeSnapshot(back.snap, client.s, client.boxPos.length);
  assert.notEqual(s, client.s);
  assert.ok(Math.abs(s.karts[1].x - e.sim.s.karts[1].x) < 0.011);
  // 途中で切れたものは null
  assert.equal(unpackNetBin(packNetBin(e.sim.s, []).subarray(0, 20)), null);
});
