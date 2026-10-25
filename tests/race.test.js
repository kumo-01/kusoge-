// レースシミュレーションの単体テスト（ブラウザ不要）: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/games/dogKart/track.js';
import { RaceSim, sanitizeSnapshot } from '../src/games/dogKart/race.js';
import { IN, ITEMS, RACE, KART } from '../src/games/dogKart/constants.js';
import { decode, encode, FROM_GUEST, FROM_HOST, sanitizeRoomState } from '../src/core/protocol.js';

const DT = 1 / 60;
const track = new Track();

function newRace() {
  const sim = new RaceSim(track);
  // カウントダウンを飛ばす
  while (sim.s.phase === 'countdown') sim.step(DT, [0, 0]);
  sim.drainEvents();
  return sim;
}

function place(k, s, lat = 0) {
  const p = track.pointAt(s, lat);
  Object.assign(k, { x: p.x, z: p.z, h: p.h, sp: 0, kx: 0, kz: 0 });
}

/** k を基準に、前方 dist の位置へ other を同じ向きで置く */
function placeAhead(k, other, dist) {
  Object.assign(other, { x: k.x + Math.sin(k.h) * dist, z: k.z + Math.cos(k.h) * dist, h: k.h, sp: 0, kx: 0, kz: 0 });
}

/** コースに沿って走るボット */
function bot(k, latOff = 0) {
  const p = track.project(k.x, k.z);
  const tgt = track.pointAt(p.s + 14, latOff);
  let d = Math.atan2(tgt.x - k.x, tgt.z - k.z) - k.h;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  let b = IN.UP;
  if (d > 0.05) b |= IN.LEFT;
  else if (d < -0.05) b |= IN.RIGHT;
  return b;
}

test('コースは閉じていて、離れた区間同士が十分に離れている', () => {
  assert.ok(track.length > 600);
  let minD = Infinity;
  for (let i = 0; i < track.n; i += 2)
    for (let j = i + 2; j < track.n; j += 2) {
      if (Math.abs(track.wrapDS(track.cum[i] - track.cum[j])) < 70) continue;
      minD = Math.min(minD, Math.hypot(track.x[i] - track.x[j], track.z[i] - track.z[j]));
    }
  assert.ok(minD > track.wallDist * 2 + 4, `min separation ${minD}`);
});

test('ボット同士で3周レースが完走し、勝者が決まる', () => {
  const sim = new RaceSim(track);
  let laps = 0;
  for (let i = 0; i < 60 * 240 && sim.s.phase !== 'finished'; i++) {
    const [a, b] = sim.s.karts;
    sim.step(DT, [bot(a, 3), bot(b, -3)]);
    for (const e of sim.drainEvents()) if (e.t === 'lap') laps++;
  }
  assert.equal(sim.s.phase, 'finished');
  assert.ok(sim.s.winner === 0 || sim.s.winner === 1);
  const w = sim.s.karts[sim.s.winner];
  assert.equal(w.lap, RACE.LAPS);
  assert.ok(w.ft > 30 && w.ft < 200, `finish time ${w.ft}`);
  assert.ok(laps >= RACE.LAPS);
  const r = sim.buildResult();
  assert.equal(r.winner, sim.s.winner === 0 ? 'host' : 'guest');
  assert.ok(r.stats.length > 3);
});

test('逆走でスタートラインを越えても周回数は増えない', () => {
  const sim = newRace();
  const k = sim.s.karts[0];
  sim.s.karts[1].x += 500; // 邪魔にならないところへ
  place(k, 20, 0);
  k.h += Math.PI; // 逆向き
  for (let i = 0; i < 60 * 6; i++) sim.step(DT, [IN.UP, 0]);
  assert.equal(k.lap, 0);
  assert.equal(k.cp, 0);
});

test('チェックポイントを飛ばす（ショートカット）と周回にならない', () => {
  const sim = newRace();
  const k = sim.s.karts[0];
  // 5番目のチェックポイント付近へワープしてからゴールラインを越える
  place(k, track.cpS(5) + 5, 0);
  for (let i = 0; i < 10; i++) sim.step(DT, [0, 0]);
  place(k, track.length - 5, 0);
  k.sp = 20;
  for (let i = 0; i < 60; i++) sim.step(DT, [IN.UP, 0]);
  assert.equal(k.lap, 0, 'lap must not increase');
});

test('壁を突き抜けない', () => {
  const sim = newRace();
  const k = sim.s.karts[0];
  place(k, 100, 0);
  k.h += Math.PI / 2; // 横向き（壁へ一直線）
  for (let i = 0; i < 60 * 3; i++) sim.step(DT, [IN.UP, 0]);
  const p = track.project(k.x, k.z);
  assert.ok(Math.abs(p.lat) <= track.wallDist, `lat ${p.lat}`);
  assert.ok(k.stats.walls >= 1);
});

test('体当たり: すり抜けず、押し出されてイベントが出る', () => {
  const sim = newRace();
  const [a, b] = sim.s.karts;
  place(a, 100, 0);
  place(b, 108, 0);
  a.sp = KART.MAX_SPEED; // 後ろから突っ込む
  let bump = null;
  for (let i = 0; i < 60; i++) {
    sim.step(DT, [IN.UP, 0]);
    for (const e of sim.drainEvents()) if (e.t === 'bump') bump = e;
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= KART.RADIUS * 2 - 0.05, 'karts overlap');
  }
  assert.ok(bump, 'bump event');
  assert.equal(bump.r, 0, 'a is the rammer');
  assert.ok(b.sp > 0, 'victim pushed forward');
  assert.ok(Math.abs(a.y) < 10 && Math.abs(b.y) < 10, 'not launched to space');
});

test('ホネアタックが前の相手に当たるとスピンする', () => {
  const sim = newRace();
  const [a, b] = sim.s.karts;
  place(a, 10, 0); // スタート直後のストレート
  placeAhead(a, b, 20);
  a.item = ITEMS.BONE;
  sim.step(DT, [IN.ITEM, 0]);
  let hit = false;
  for (let i = 0; i < 60 && !hit; i++) {
    sim.step(DT, [0, 0]);
    for (const e of sim.drainEvents()) if (e.t === 'hit' && e.k === 1) hit = true;
  }
  assert.ok(hit);
  assert.ok(b.spin > 0);
  assert.equal(a.item, 0);
  assert.equal(a.stats.hits, 1);
});

test('バナナを踏むとスピンし、スピン後の無敵中は連続で回らない', () => {
  const sim = newRace();
  const [a, b] = sim.s.karts;
  place(a, 30, 0);
  placeAhead(a, b, -18); // 真後ろ
  a.item = ITEMS.BANANA;
  sim.step(DT, [IN.ITEM, 0]);
  assert.equal(sim.s.bananas.length, 1);
  b.sp = 15;
  let slipped = 0;
  for (let i = 0; i < 90; i++) {
    sim.step(DT, [0, IN.UP]);
    for (const e of sim.drainEvents()) if (e.t === 'slip') slipped++;
  }
  assert.equal(slipped, 1);
  // 無敵中にもう一度バナナ
  sim.s.bananas.push({ id: 999, o: 0, x: b.x, z: b.z, life: 10, age: 5 });
  b.inv = 1;
  sim.step(DT, [0, 0]);
  assert.equal(b.spin > 0 && b.spinDur === ITEMS.BANANA_SPIN && b.spin > ITEMS.BANANA_SPIN - 0.05, false);
});

test('わんわんブーストで最高速を超えられる', () => {
  const sim = newRace();
  const a = sim.s.karts[0];
  place(a, 30, 0);
  sim.s.karts[1].x += 500;
  for (let i = 0; i < 60 * 4; i++) sim.step(DT, [bot(a), 0]);
  const normal = a.sp;
  a.item = ITEMS.BOOST;
  sim.step(DT, [bot(a) | IN.ITEM, 0]);
  for (let i = 0; i < 60; i++) sim.step(DT, [bot(a), 0]);
  assert.ok(a.sp > normal + 5, `${a.sp} > ${normal}`);
});

test('アイテムボックスを取るとルーレット後にアイテムが入り、箱は時間で復活する', () => {
  const sim = newRace();
  const a = sim.s.karts[0];
  const box = sim.boxPos[0];
  Object.assign(a, { x: box.x, z: box.z });
  sim.step(DT, [0, 0]);
  assert.ok(sim.s.boxes[0] > 0);
  assert.ok(a.roll > 0);
  for (let i = 0; i < 60 * 1.3; i++) sim.step(DT, [0, 0]);
  assert.ok(a.item >= 1 && a.item <= 3);
  a.x += 50; // 箱から離れる
  for (let i = 0; i < 60 * ITEMS.BOX_RESPAWN; i++) sim.step(DT, [0, 0]);
  assert.equal(sim.s.boxes[0], 0);
});

test('R で最後のチェックポイントへ復帰できる', () => {
  const sim = newRace();
  const a = sim.s.karts[0];
  place(a, track.cpS(2) + 30, 0);
  for (let i = 0; i < 5; i++) sim.step(DT, [0, 0]);
  a.cp = 2;
  sim.step(DT, [IN.RESPAWN, 0]);
  const p = track.project(a.x, a.z);
  assert.ok(Math.abs(track.wrapDS(p.s - track.cpS(2))) < 6);
});

test('スナップショットの保存と復元で同じ状態に戻る', () => {
  const sim = newRace();
  for (let i = 0; i < 120; i++) sim.step(DT, [IN.UP | IN.LEFT, IN.UP]);
  const snap = JSON.parse(encode(sim.getSnapshot())); // ネットワーク経由を想定
  const other = new RaceSim(track);
  other.loadSnapshot(snap);
  assert.ok(Math.abs(other.s.karts[0].x - sim.s.karts[0].x) < 0.01);
  assert.equal(other.s.phase, 'racing');
  // 同じ入力で進めれば同じ結果
  for (let i = 0; i < 60; i++) {
    sim.step(DT, [IN.UP, IN.UP | IN.RIGHT]);
    other.step(DT, [IN.UP, IN.UP | IN.RIGHT]);
  }
  assert.ok(Math.abs(other.s.karts[1].z - sim.s.karts[1].z) < 0.05);
});

test('不正なスナップショットでもクラッシュしない', () => {
  const sim = newRace();
  const prev = sim.s;
  assert.equal(sanitizeSnapshot(null, prev, 9), prev);
  assert.equal(sanitizeSnapshot({ karts: 'x' }, prev, 9), prev);
  const s = sanitizeSnapshot({ karts: [{ x: 'NaN', lap: 1e99, item: 77 }, {}], proj: [null, { x: Infinity }], phase: 'evil' }, prev, 9);
  assert.ok(Number.isFinite(s.karts[0].x));
  assert.ok(s.karts[0].lap <= 99);
  assert.ok(s.karts[0].item <= 3);
  assert.equal(s.phase, 'countdown');
  assert.equal(s.proj.length, 1);
  assert.ok(Number.isFinite(s.proj[0].x));
});

test('プロトコル: 方向・形式・サイズが不正なメッセージは捨てる', () => {
  assert.equal(decode('{"type":"room_close","reason":"x"}', FROM_GUEST), null); // ゲストは送れない
  assert.ok(decode('{"type":"room_close","reason":"x"}', FROM_HOST));
  assert.equal(decode('not json', FROM_HOST), null);
  assert.equal(decode(123, FROM_HOST), null);
  assert.equal(decode('x'.repeat(70000), FROM_HOST), null);
  assert.equal(decode(JSON.stringify({ type: 'player_input', matchId: 'a', gen: 1, seq: 1, inputs: [999] }), FROM_GUEST), null);
  assert.ok(decode(JSON.stringify({ type: 'player_input', matchId: 'a', gen: 1, seq: 1, inputs: [1, 5] }), FROM_GUEST));
  assert.equal(sanitizeRoomState({ screen: 'hack', guest: 'none', rev: 1, ready: {} }), null);
  assert.ok(sanitizeRoomState({ screen: 'home', guest: 'connected', rev: 1, ready: { host: true } }));
});

test('アイテムを持っている車はボックスをすり抜け、箱は消えない（総取り防止）', () => {
  const sim = newRace();
  const a = sim.s.karts[0];
  a.item = ITEMS.BONE;
  const box = sim.boxPos[0];
  Object.assign(a, { x: box.x, z: box.z });
  sim.step(DT, [0, 0]);
  assert.equal(sim.s.boxes[0], 0, 'box must remain');
  assert.equal(a.roll, 0);
  // ルーレット中も同様
  a.item = 0;
  a.roll = 0.5;
  sim.step(DT, [0, 0]);
  assert.equal(sim.s.boxes[0], 0);
  // 手ぶらなら取れる
  a.roll = 0;
  sim.step(DT, [0, 0]);
  assert.ok(sim.s.boxes[0] > 0);
});

test('アイテムボックスは 1 か所に横 5 列', () => {
  assert.equal(new RaceSim(track).boxPos.length, 15);
});

test('NPC 2 台入りのレース: NPC が自分で走って周回し、人間がゴールすると決着する', () => {
  const sim = new RaceSim(track, { npcs: 2 });
  assert.equal(sim.s.karts.length, 4);
  let npcLaps = 0;
  let npcItems = 0;
  for (let i = 0; i < 60 * 240 && sim.s.phase !== 'finished'; i++) {
    const [a, b] = sim.s.karts;
    sim.step(DT, [bot(a, 4), bot(b, -4)]);
    for (const e of sim.drainEvents()) {
      if (e.t === 'lap' && e.k >= 2) npcLaps++;
      if (e.t === 'use' && e.k >= 2) npcItems++;
    }
  }
  assert.equal(sim.s.phase, 'finished');
  assert.ok(sim.s.winner === 0 || sim.s.winner === 1, 'winner is human');
  assert.ok(npcLaps >= 4, `npc laps ${npcLaps}`);
  assert.ok(npcItems >= 1, `npc items ${npcItems}`);
  const r = sim.buildResult();
  assert.ok(r.stats[0].host.includes('/ 4台'));
  const snap = JSON.parse(encode(sim.getSnapshot()));
  const other = new RaceSim(track, { npcs: 2 });
  other.loadSnapshot(snap);
  assert.equal(other.s.karts.length, 4);
  assert.equal(other.s.karts[3].npc, 1);
});
