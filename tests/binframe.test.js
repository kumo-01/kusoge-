// バイナリの枠と、レースの状態のバイナリ形式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSnapshotFrame, encodeInputFrame, decodeFrame, isFrame, matchHash, FRAME_INPUT, FRAME_SNAPSHOT } from '../src/core/binframe.js';
import { DogKartEngine } from '../src/games/dogKart/engine.js';
import { packNetBin, unpackNetBin, unpackNet, sanitizeSnapshot, RaceSim, NetBinEncoder, BIN_COLD_FIELDS, BIN_KEY_EVERY } from '../src/games/dogKart/race.js';
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
      for (const f of Object.keys(ref.karts[k])) assert.ok(Math.abs((back.snap.karts[k][f] || 0) - (ref.karts[k][f] || 0)) < (['x', 'z', 'fa', 'fb'].includes(f) ? 0.011 : 0.0011), `kart ${k} ${f}`);
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

test('変わったときだけ送る形式: 取りこぼしがなければ全部載せと同じに戻り、大きさは約半分。取りこぼしても 1 秒以内にそろう', () => {
  const run = (loss) => {
    const e = new DogKartEngine({ course: 3, npcs: 2, boss: 1, players: [0, 1, 2] });
    const enc = new NetBinEncoder();
    let mem = null;
    let rnd = 12345;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    const stat = { full: 0, delta: 0, n: 0, wrong: 0, got: 0, sinceKeyWrong: 0, ban: 0 };
    for (let i = 1; i <= 60 * 40; i++) {
      for (const p of [0, 1, 2]) e.receiveInput(p, i, [IN.UP | (i % 97 < 30 ? IN.LEFT : 0) | (i % 180 === 90 ? IN.ITEM : 0)]);
      if (i % 360 === 89) for (const k of e.sim.s.karts.slice(0, 3)) k.item = ITEMS.BANANA; // バナナを置く
      e.step(1 / 60);
      if (i % 2 || i < 300) continue;
      const full = packNetBin(e.sim.s, []);
      const bin = enc.encode(e.sim.s, []);
      stat.full += full.length;
      stat.delta += bin.length;
      stat.n++;
      if (rand() < loss) continue; // 取りこぼし
      const ref = unpackNetBin(full).snap;
      const prev = mem || { tick: ref.tick, karts: e.sim.s.karts.map((k) => Object.fromEntries(BIN_COLD_FIELDS.map((f) => [f, k[f]]))), boxTaken: ref.boxTaken, foodTaken: ref.foodTaken, bananas: ref.bananas };
      const d = unpackNetBin(bin, prev).snap;
      mem = { tick: d.tick, karts: d.karts.map((k) => Object.fromEntries(BIN_COLD_FIELDS.map((f) => [f, k[f]]))), boxTaken: d.boxTaken, foodTaken: d.foodTaken, bananas: d.bananas };
      stat.got++;
      let ok = JSON.stringify(d.boxTaken) === JSON.stringify(ref.boxTaken) && JSON.stringify(d.foodTaken) === JSON.stringify(ref.foodTaken);
      // バナナ: 同じものがあり、残り時間のずれは 0.2 秒まで（載っていない配信では受け取る側で進める）
      if (d.bananas.map((b) => b.id).join() !== ref.bananas.map((b) => b.id).join() || d.bananas.some((b, j) => Math.abs(b.life - ref.bananas[j].life) > 0.2 || Math.abs(b.x - ref.bananas[j].x) > 0.011)) ok = false;
      stat.ban += ref.bananas.length;
      for (let k = 0; k < ref.karts.length; k++) for (const f of Object.keys(ref.karts[k])) if (Math.abs((d.karts[k][f] || 0) - (ref.karts[k][f] || 0)) > 0.0011) ok = false;
      if (!ok) stat.wrong++;
      if (!ok && enc.n % BIN_KEY_EVERY === 0) stat.sinceKeyWrong++; // キーフレームは必ず正しい
    }
    return stat;
  };
  const a = run(0);
  assert.equal(a.wrong, 0, '取りこぼしがなければ、毎回まったく同じ');
  assert.ok(a.ban > 100, `バナナが出ている ${a.ban}`);
  assert.ok(a.delta < a.full * 0.8, `大きさ ${(a.delta / a.n).toFixed(0)} B（全部載せ ${(a.full / a.n).toFixed(0)} B）`);
  const b = run(0.3);
  assert.equal(b.sinceKeyWrong, 0, 'キーフレームを受け取ればそろう');
  assert.ok(b.wrong / b.got < 0.02, `3 割取りこぼしても、ずれた配信は ${(b.wrong / b.got * 100).toFixed(1)}%`);
});

test('位置: ふだんは 2 バイト（2cm）、コースの外まではみ出した車がいれば 3 バイト（1cm）で正しく戻る', () => {
  const e = new DogKartEngine({ course: 0, npcs: 1, boss: 0, players: [0, 1] });
  for (let i = 0; i < 30; i++) e.step(1 / 60);
  const small = packNetBin(e.sim.s, []);
  e.sim.s.karts[1].x = 900.123;
  const big = packNetBin(e.sim.s, []);
  assert.equal(big.length - small.length, e.sim.s.karts.length * 2, '1 台あたり 2 バイト増える');
  const back = unpackNetBin(big).snap;
  assert.ok(Math.abs(back.karts[1].x - 900.123) < 0.006);
  assert.ok(Math.abs(unpackNetBin(small).snap.karts[0].z - e.sim.s.karts[0].z) < 0.011);
});
