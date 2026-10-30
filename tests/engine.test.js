// 計算役（DogKartEngine）の単体テスト: ブラウザのホストも Cloudflare のサーバーも同じものを使う
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DogKartEngine } from '../src/games/dogKart/engine.js';
import { Track } from '../src/games/dogKart/track.js';
import { sanitizeSnapshot, unpackNet, RaceSim } from '../src/games/dogKart/race.js';
import { IN, RACE, NET } from '../src/games/dogKart/constants.js';
import { encode } from '../src/core/protocol.js';

const DT = 1 / 60;

function started(opts = {}) {
  const e = new DogKartEngine({ course: 0, players: [0, 1, 2], ...opts });
  while (e.sim.s.phase === 'countdown') e.step(DT);
  return e;
}

test('エンジン: 人ごとの入力が、その人の車だけを動かす（キューから 1 tick ずつ）', () => {
  const e = started();
  const [a, b, c] = e.sim.s.karts;
  for (let i = 0; i < 90; i++) {
    // 毎ステップ、直近 2 tick 分を重ねて送ってくる（実際の送り方）
    e.receiveInput(1, i + 1, [IN.UP, IN.UP]);
    e.step(DT);
  }
  assert.ok(b.sp > 10, `guest 1 accelerates (${b.sp})`);
  assert.ok(a.sp < 0.5 && c.sp < 0.5, 'others stay');
  assert.ok(e.sim.s.acks[1] > 60, `ack follows the input seq (${e.sim.s.acks[1]})`);
  assert.equal(e.sim.s.acks[2], 0);
});

test('エンジン: 古い seq は無視・押しっぱなしの解除・キューの上限', () => {
  const e = started();
  e.receiveInput(2, 10, [IN.UP, IN.UP, IN.UP]);
  assert.equal(e.gq[2].queue.length, 3);
  e.receiveInput(2, 10, [IN.UP, IN.UP, IN.UP]); // 同じものが重なって届いても増えない
  assert.equal(e.gq[2].queue.length, 3);
  e.receiveInput(2, 5, [IN.UP]); // 古い
  assert.equal(e.gq[2].queue.length, 3);
  e.receiveInput(9, 1, [IN.UP]); // 存在しない人
  e.receiveInput(2, 1e6, Array.from({ length: 200 }, () => IN.UP));
  assert.ok(e.gq[2].queue.length <= 120);
  // 入力が途切れたら、押しっぱなし扱いが解除される
  const e2 = started();
  e2.receiveInput(1, 2, [IN.UP, IN.UP]);
  for (let i = 0; i < 50; i++) e2.step(DT);
  assert.equal(e2.gq[1].held, 0, 'held released after starvation');
  // 追いつけないほど溜まったら、押した瞬間の入力は引き継ぐ
  const e3 = started();
  const many = Array.from({ length: NET.INPUT_BUFFER_MAX + 6 }, (_, i) => (i === 3 ? IN.ITEM : IN.UP));
  e3.receiveInput(1, many.length, many);
  e3.step(DT);
  assert.ok(e3.gq[1].queue.length <= 3, 'caught up');
});

test('エンジン: 送り手の seq と計算の tick は 1 対 1。届いていない tick は押しっぱなしで代用し、遅れに合わせて 1 tick だけ待つ', () => {
  const e = started();
  e.receiveInput(1, 4, [IN.UP, IN.UP, IN.UP, IN.UP]);
  for (let i = 0; i < 4; i++) e.step(DT);
  assert.equal(e.sim.s.acks[1], 4);
  // 次の入力がまだ届いていなくても、押しっぱなしで代用して seq を進める（予測と食い違わない）
  e.step(DT);
  e.step(DT);
  assert.equal(e.sim.s.acks[1], 6);
  assert.equal(e.gq[1].held, IN.UP);
  // 遅れて届いた分は使わない。押した瞬間の入力（アイテム）だけ次の tick に回す
  e.sim.s.karts[1].item = 1;
  e.receiveInput(1, 6, [IN.UP | IN.ITEM, IN.UP]);
  assert.equal(e.gq[1].queue.length, 0);
  assert.equal(e.gq[1].carry, IN.ITEM);
  const ev = e.step(DT);
  assert.ok(ev.some((x) => x.t === 'use'), 'late item press is still used');
  // 遅れて届き続けると、ときどき 1 tick だけ seq を進めずに待つ
  const g = e.gq[1];
  let stalls = 0;
  for (let t = 0; t < 120; t++) {
    const before = g.next;
    e.receiveInput(1, g.next - 1, [IN.UP]); // いつも 1 tick 遅れて届く
    e.step(DT);
    if (g.next === before) stalls++;
  }
  assert.ok(stalls >= 1 && stalls <= 6, `stalls ${stalls}`);
});

test('エンジン: 演出イベントは id つきで、3 回の配信にわたって載る', () => {
  const e = started();
  e.sim.s.karts[0].item = 1; // ホネ
  e.receiveInput(0, 2, [IN.ITEM, IN.ITEM]);
  const ev = e.step(DT);
  assert.ok(ev.some((x) => x.t === 'use' && x.id > 0), 'use event with id');
  const first = e.drainNetEvents();
  const second = e.drainNetEvents();
  const third = e.drainNetEvents();
  const fourth = e.drainNetEvents();
  assert.ok(first.length >= 1 && second.length >= 1 && third.length >= 1);
  assert.equal(fourth.length, 0, 'sent exactly 3 times');
  assert.equal(first[0].id, second[0].id, 'same id so receivers can drop duplicates');
});

test('エンジン: 決着すると結果を 1 度だけ返す（人数分・席つき）', () => {
  const e = started({ npcs: 0 });
  const k = e.sim.s.karts[2];
  const p = e.track.pointAt(e.track.length - 12, 0);
  for (const o of e.sim.s.karts) o.sp = 0;
  Object.assign(k, { x: p.x, z: p.z, h: p.h, sp: 26, kx: 0, kz: 0, lap: 2, cp: e.track.checkpoints - 1 });
  let result = null;
  let results = 0;
  for (let i = 0; i < 60 * 30; i++) {
    e.receiveInput(2, i + 1, [IN.UP]);
    e.step(DT);
    const r = e.takeResult();
    if (r) {
      result = r;
      results++;
    }
  }
  assert.equal(results, 1, 'result is returned once');
  assert.equal(result.winner, 2);
  assert.equal(result.players.length, 3);
  assert.deepEqual(result.players.map((x) => x.slot), [0, 1, 2]);
});

test('エンジン: 配信用の状態（encode）と完全な状態を受け取る側が読める。読み込むと入力のキューが仕切り直される', () => {
  const e = started({ npcs: 1 });
  for (let i = 0; i < 60; i++) {
    e.receiveInput(1, i + 1, [IN.UP, IN.UP]);
    e.step(DT);
  }
  // 受け取る側（ブラウザ）の状態に、配信用の状態を当てはめられる
  const client = new RaceSim(e.track, { players: [0, 1, 2], npcs: 1 });
  const net = JSON.parse(encode(e.encode()));
  const s = sanitizeSnapshot(unpackNet(net), client.s, client.boxPos.length);
  assert.notEqual(s, client.s, 'accepted');
  assert.equal(s.tick, e.sim.s.tick);
  assert.deepEqual(s.acks, e.sim.s.acks);
  // 車ごとの今の操作（ほかの端末が少し先の動きを計算するのに使う）
  assert.equal(e.sim.s.karts[1].in, IN.UP);
  assert.equal(s.karts[1].in, IN.UP);
  assert.equal(s.karts[0].in, 0);
  assert.ok(Math.abs(s.karts[1].x - e.sim.s.karts[1].x) < 0.01);
  // 完全な状態
  const full = JSON.parse(JSON.stringify(e.getSnapshot()));
  client.loadSnapshot(full);
  assert.equal(client.s.karts.length, e.sim.s.karts.length);
  assert.deepEqual(client.s.karts.map((k) => k.style), e.sim.s.karts.map((k) => k.style));
  // 巻き戻し: 状態を読み込み直すと、未処理の入力は捨てられて、確定済みの seq から受け直す
  e.receiveInput(1, 999, [IN.UP, IN.UP]);
  e.loadSnapshot(full);
  assert.equal(e.gq[1].queue.length, 0);
  assert.equal(e.gq[1].lastSeq, full.acks[1]);
});

test('エンジン: 人数・NPC の数・席の指定どおりに作られる', () => {
  const e = new DogKartEngine({ course: 3, npcs: 2, boss: 1, players: [0, 2] });
  assert.equal(e.sim.humans, 2);
  assert.equal(e.sim.s.karts.length, 5);
  assert.equal(e.gq.length, 2);
  assert.equal(e.track.name, new DogKartEngine({ course: 3 }).track.name);
  assert.ok(RACE.MAX_KARTS >= e.sim.s.karts.length);
});

test('配信の形: 車は変わった項目だけ・ボックスは取られた番号だけで、元の状態に戻せ、1 回の配信が小さい', () => {
  const e = started({ npcs: 3, boss: 1 });
  for (let i = 0; i < 90; i++) {
    for (const p of [0, 1, 2]) e.receiveInput(p, i + 1, [IN.UP, IN.UP]);
    e.step(DT);
  }
  const s = e.sim.s;
  s.karts[1].spin = 0.75;
  s.karts[1].boost = 1.2;
  s.karts[2].gd = 5;
  s.karts[0].ow = 3.5;
  s.boxes[3] = 2.5;
  const net = e.encode();
  assert.equal(net.p, 2);
  assert.equal(net.tc, undefined, 'タイミングのチャンス地点は毎回送らない');
  assert.deepEqual(net.bx, [3], 'taken boxes only');
  // 車の行: 毎回の 10 項目 + 印 + 該当する項目だけ（何もない車は 11 個）
  const idle = net.k[3];
  assert.ok(idle.length < 20, `idle kart row is short (${idle.length})`);
  assert.ok(net.k[1].length >= 13, 'spin と boost の値が載る（10 項目 + 印 + 2）');
  // 往復
  const client = new RaceSim(e.track, { players: [0, 1, 2], npcs: 3, boss: 1 });
  const back = sanitizeSnapshot(unpackNet(JSON.parse(JSON.stringify(net))), client.s, client.boxPos.length);
  assert.notEqual(back, client.s);
  assert.ok(Math.abs(back.karts[1].spin - 0.75) < 0.01 && Math.abs(back.karts[1].boost - 1.2) < 0.01);
  assert.ok(Math.abs(back.karts[2].gd - 5) < 0.01 && Math.abs(back.karts[0].ow - 3.5) < 0.01);
  assert.equal(back.karts[2].spin, 0, 'omitted fields are the default');
  assert.equal(back.karts[2].ms, s.karts[2].ms >= 1.0 ? back.karts[2].ms : 1);
  assert.deepEqual(back.boxes.map((v) => v > 0), s.boxes.map((v, i) => i === 3));
  for (let i = 0; i < s.karts.length; i++) {
    assert.ok(Math.abs(back.karts[i].x - s.karts[i].x) < 0.011, `x ${i}`);
    assert.ok(Math.abs(back.karts[i].h - s.karts[i].h) < 0.0011, `h ${i}`);
    assert.equal(back.karts[i].lap, s.karts[i].lap);
    assert.equal(back.karts[i].cp, s.karts[i].cp);
  }
  assert.deepEqual(back.tc, client.s.tc, 'tc は前の状態を引き継ぐ');
  // 古い形（p: 1）や壊れたものは読まない
  assert.equal(unpackNet({ ...net, p: 1 }), null);
  assert.equal(unpackNet(null), null);
  // 大きさ（6 台）: 以前は約 1.07KB だった
  const bytes = encode({ type: 'game_snapshot', matchId: 'abcd1234', gen: 1, seq: 1, snap: net, ev: [] }).length;
  assert.ok(bytes < 800, `snapshot ${bytes} bytes`);
});

test('Track.project: 覚えた結果を返しても、毎回計算した結果と同じ（全コース）', () => {
  for (const ci of [0, 4, 6, 9]) {
    const t = new Track(ci);
    const fresh = new Track(ci);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 400; n++) {
      const x = (rnd() - 0.5) * 1500;
      const z = (rnd() - 0.5) * 1500;
      const a = { ...t.project(x, z) };
      const b = { ...fresh._project(x, z) };
      const again = { ...t.project(x, z) }; // 2 回目は覚えた結果
      for (const k of Object.keys(b)) {
        assert.ok(Math.abs(a[k] - b[k]) < 1e-9 && Math.abs(again[k] - b[k]) < 1e-9, `${k} ${a[k]} ${b[k]} ${again[k]}`);
      }
    }
  }
});
