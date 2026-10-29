// レースシミュレーションの単体テスト（ブラウザ不要）: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track, COURSES } from '../src/games/dogKart/track.js';
import { RaceSim, sanitizeSnapshot, packNet, unpackNet, kartName } from '../src/games/dogKart/race.js';
import { maxSpeedOf as maxSpeedFor } from '../src/games/dogKart/physics.js';
import { spinKart, itemWeights, chooseItem } from '../src/games/dogKart/items.js';
import { IN, ITEMS, RACE, KART, TIMING, RAIN, PAD, FOOD, SCORE } from '../src/games/dogKart/constants.js';
import { getGame, resolveMatchOptions, validOptions } from '../src/games/registry.js';
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
function bot(k, latOff = 0, tr = track) {
  const p = tr.project(k.x, k.z);
  const tgt = tr.pointAt(p.s + 14, latOff);
  let d = Math.atan2(tgt.x - k.x, tgt.z - k.z) - k.h;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  let b = IN.UP;
  if (d > 0.05) b |= IN.LEFT;
  else if (d < -0.05) b |= IN.RIGHT;
  return b;
}

test('コースは閉じていて、離れた区間同士が十分に離れている', () => {
  assert.ok(track.length > 2400);
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
  for (let i = 0; i < 60 * 480 && sim.s.phase !== 'finished'; i++) {
    const [a, b] = sim.s.karts;
    sim.step(DT, [bot(a, 3), bot(b, -3)]);
    for (const e of sim.drainEvents()) if (e.t === 'lap') laps++;
  }
  assert.equal(sim.s.phase, 'finished');
  assert.ok(sim.s.winner === 0 || sim.s.winner === 1);
  const w = sim.s.karts[sim.s.winner];
  assert.equal(w.lap, RACE.LAPS);
  assert.ok(w.ft > 120 && w.ft < 420, `finish time ${w.ft}`);
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
  place(a, 600, 0); // ブーストパッドのない区間
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
  assert.ok(a.item >= 1 && a.item < ITEMS.COUNT);
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
  assert.ok(s.karts[0].item < ITEMS.COUNT);
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

test('アイテムボックスは 6 か所に横 5 列', () => {
  assert.equal(new RaceSim(track).boxPos.length, 30);
});

test('NPC 2 台入りのレース: NPC が自分で走って周回し、人間がゴールすると決着する', () => {
  const sim = new RaceSim(track, { npcs: 2 });
  assert.equal(sim.s.karts.length, 4);
  let npcLaps = 0;
  let npcItems = 0;
  for (let i = 0; i < 60 * 480 && sim.s.phase !== 'finished'; i++) {
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

test('全コース: 閉じていて離れた区間が十分離れ、内側が lat < 0、7 台のスタート位置が道路上', () => {
  assert.equal(COURSES.length, 10);
  COURSES.forEach((c, ci) => {
    const t = new Track(ci);
    assert.equal(t.name, c.name);
    assert.ok(t.length > 2400 && t.length < 3200, `${c.name} length ${t.length}`);
    // カーブがきつすぎない（15m 離れた 3 点の外接円の半径）
    const kk = Math.round(15 / (t.length / t.n));
    let minR = Infinity;
    for (let i = 0; i < t.n; i++) {
      const a = [t.x[(i - kk + t.n) % t.n], t.z[(i - kk + t.n) % t.n]];
      const b = [t.x[i], t.z[i]];
      const d = [t.x[(i + kk) % t.n], t.z[(i + kk) % t.n]];
      const cross = Math.abs((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]));
      if (cross > 1e-6) minR = Math.min(minR, (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(d[0] - b[0], d[1] - b[1]) * Math.hypot(d[0] - a[0], d[1] - a[1])) / (2 * cross));
    }
    assert.ok(minR > 22, `${c.name} min radius ${minR}`);
    let minD = Infinity;
    for (let i = 0; i < t.n; i += 2)
      for (let j = i + 2; j < t.n; j += 2) {
        if (Math.abs(t.wrapDS(t.cum[i] - t.cum[j])) < 70) continue;
        minD = Math.min(minD, Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]));
      }
    assert.ok(minD > t.wallDist * 2 + 25, `${c.name} min separation ${minD}`);
    // 反時計回り（内側が中心線の右 = lat < 0）
    let area = 0;
    for (let i = 0; i < t.n; i++) {
      const k = (i + 1) % t.n;
      area += t.x[i] * t.z[k] - t.x[k] * t.z[i];
    }
    assert.ok(area > 0, `${c.name} orientation`);
    const starts = Array.from({ length: 7 }, (_, i) => t.startPos(i));
    for (const [i, p] of starts.entries()) {
      assert.ok(Math.abs(t.project(p.x, p.z).lat) < t.roadHalf - 2, `${c.name} start ${i} on road`);
      for (let j = 0; j < i; j++) assert.ok(Math.hypot(p.x - starts[j].x, p.z - starts[j].z) > KART.RADIUS * 2.5, `${c.name} start ${i}/${j} overlap`);
    }
    for (const b of t.itemBoxes()) assert.ok(Math.abs(t.project(b.x, b.z).lat) < t.roadHalf, `${c.name} box on road`);
  });
});

test('全コース: NPC 4 台（6 台）でレースが決着し、NPC も周回する', () => {
  COURSES.forEach((c, ci) => {
    const t = new Track(ci);
    const sim = new RaceSim(t, { npcs: 4 });
    assert.equal(sim.s.karts.length, 6);
    const npcLaps = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60 * 480 && sim.s.phase !== 'finished'; i++) {
      const [a, b] = sim.s.karts;
      sim.step(DT, [bot(a, 4, t), bot(b, -4, t)]);
      for (const e of sim.drainEvents()) if (e.t === 'lap') npcLaps[e.k]++;
    }
    assert.equal(sim.s.phase, 'finished', `${c.name} finished`);
    for (let i = 2; i < 6; i++) assert.ok(npcLaps[i] >= 2, `${c.name} npc ${i} laps ${npcLaps[i]}`);
    const r = sim.buildResult();
    assert.ok(r.stats[0].host.includes('/ 6台'));
  });
});

test('NPC の数は 0〜4 台に制限される', () => {
  assert.equal(new RaceSim(track, { npcs: 9 }).s.karts.length, 6);
  assert.equal(new RaceSim(track, { npcs: -1 }).s.karts.length, 2);
});

test('タイミングブースト: チャンスは 1〜2 回で、ジャストで押すとブースト・ずれると無し・押さないと失敗', () => {
  const counts = new Set();
  for (let i = 0; i < 40; i++) {
    const sim = new RaceSim(track);
    const tc = sim.s.tc;
    counts.add(tc.length);
    assert.ok(tc.length >= 1 && tc.length <= 2);
    for (const p of tc) assert.ok(p > 0 && p < RACE.LAPS * track.length);
  }
  assert.deepEqual([...counts].sort(), [1, 2]);

  // 3 人のボット: 0 はジャスト、1 は早押し、もう 1 回は押さない
  const sim = new RaceSim(track);
  const results = { 0: [], 1: [] };
  let boostSeen = false;
  for (let i = 0; i < 60 * 240 && sim.s.phase !== 'finished'; i++) {
    const [a, b] = sim.s.karts;
    let ia = bot(a, 3);
    let ib = bot(b, -3);
    if (a.tw > 0 && a.tw <= TIMING.SWEET + 0.01) ia |= IN.TAP;
    if (b.tw > 0 && b.tw < TIMING.WINDOW - 0.1 && b.tb === 1) ib |= IN.TAP; // 1 回目は早すぎ、2 回目は押さない
    sim.step(DT, [ia, ib]);
    for (const e of sim.drainEvents()) {
      if (e.t !== 'timing') continue;
      results[e.k].push(e.q);
      if (e.k === 0 && e.q === 2) boostSeen = a.boost > TIMING.BOOST_PERFECT - 0.1;
    }
  }
  const n = sim.s.tc.length;
  assert.deepEqual(results[0], Array(n).fill(2), 'host perfect every time');
  assert.equal(results[1][0], 0, 'early tap = no boost');
  if (n === 2) assert.equal(results[1][1], -1, 'no tap = missed');
  assert.ok(boostSeen);
});

test('豪雨アイテム: 使った車以外が遅くなり、時間がたつと戻る（ガードは1回防ぐ）', () => {
  const sim = new RaceSim(track, { npcs: 2 });
  while (sim.s.phase === 'countdown') sim.step(DT, [0, 0, 0, 0]);
  const [a, b, c, d] = sim.s.karts;
  c.gd = 10; // NPC の 1 台はガード中
  a.item = ITEMS.RAIN;
  sim.drainEvents();
  sim.step(DT, [IN.ITEM, 0]);
  assert.equal(a.item, 0);
  assert.equal(sim.s.rk, 0);
  assert.ok(sim.s.rain > RAIN.DURATION - 0.1);
  assert.equal(a.wet, 0, 'user not slowed');
  assert.ok(b.wet > 0 && d.wet > 0, 'others slowed');
  assert.equal(c.wet, 0, 'guard blocks rain');
  assert.equal(c.gd, 0);
  assert.equal(sim.drainEvents().filter((e) => e.t === 'rain').length, 1);
  // 遅くなっている間は最高速が下がる
  Object.assign(b, { boost: 0, slow: 0, grass: 0 });
  assert.ok(maxSpeedFor(b) <= KART.MAX_SPEED * RAIN.FACTOR + 1e-6, `wet max speed ${maxSpeedFor(b)}`);
  for (let i = 0; i < 60 * RAIN.DURATION; i++) sim.step(DT, [0, 0]);
  Object.assign(b, { boost: 0, slow: 0, grass: 0 });
  assert.ok(maxSpeedFor(b) >= KART.MAX_SPEED - 1e-6);
  assert.equal(b.wet, 0);
  assert.ok(sim.s.rain < 1e-6);
});

test('アイテムの出方: 豪雨は最下位だけ・ガードは最下位以外・フリスビーと犬小屋は2位以下・飼い主は後ろほど出やすい', () => {
  for (const total of [2, 3, 4, 6, 7]) {
    let prevOwner = -1;
    for (let rank = 1; rank <= total; rank++) {
      const w = itemWeights(rank, total);
      const last = rank === total;
      assert.equal(w[ITEMS.RAIN] > 0, last, `rain rank ${rank}/${total}`);
      assert.equal(w[ITEMS.GUARD] > 0, !last, `guard rank ${rank}/${total}`);
      assert.equal(w[ITEMS.FRISBEE] > 0, rank >= 2, `frisbee rank ${rank}/${total}`);
      assert.equal(w[ITEMS.HOUSE] > 0, rank >= 2, `house rank ${rank}/${total}`);
      assert.ok(w[ITEMS.OWNER] >= prevOwner, 'owner more likely behind');
      prevOwner = w[ITEMS.OWNER];
    }
    assert.equal(itemWeights(1, total)[ITEMS.OWNER], 0, 'leader never gets owner');
    assert.ok(itemWeights(total, total)[ITEMS.OWNER] > 0);
  }
  // 実際に引いてみても、出てはいけないものは出ない
  const sim = newRace();
  for (let i = 0; i < 3000; i++) {
    const t = 5;
    assert.notEqual(chooseItem(sim.s, 1, t), ITEMS.FRISBEE);
    assert.notEqual(chooseItem(sim.s, 1, t), ITEMS.HOUSE);
    assert.notEqual(chooseItem(sim.s, 1, t), ITEMS.RAIN);
    assert.notEqual(chooseItem(sim.s, 3, t), ITEMS.RAIN);
    assert.notEqual(chooseItem(sim.s, t, t), ITEMS.GUARD);
  }
  const seen = new Set();
  for (let i = 0; i < 4000; i++) seen.add(chooseItem(sim.s, 5, 5));
  for (const it of [ITEMS.BONE, ITEMS.BANANA, ITEMS.BOOST, ITEMS.FRISBEE, ITEMS.OWNER, ITEMS.RAIN, ITEMS.HOUSE]) assert.ok(seen.has(it), `last place can get ${it}`);
});

test('飼い主登場: 無敵で自動で走り、触れた車をはね飛ばして、時間で終わる。全コースで壁に張りつかない', () => {
  COURSES.forEach((c, ci) => {
    const t = new Track(ci);
    const sim = new RaceSim(t);
    while (sim.s.phase === 'countdown') sim.step(DT, [0, 0]);
    const [a, b] = sim.s.karts;
    const p = t.pointAt(40, 0);
    Object.assign(a, { x: p.x, z: p.z, h: p.h, sp: 0, kx: 0, kz: 0 });
    const q = t.pointAt(-200, 0);
    Object.assign(b, { x: q.x, z: q.z, h: q.h });
    a.item = ITEMS.OWNER;
    sim.step(DT, [IN.ITEM, 0]);
    assert.ok(a.ow > 0 && a.item === 0);
    // 操作（後退・左右）は無視される
    let top = 0;
    let off = 0;
    const walls0 = a.stats.walls;
    const start = sim.progressOf(a);
    for (let i = 0; i < 60 * ITEMS.OWNER_TIME + 30; i++) {
      sim.step(DT, [IN.DOWN | IN.LEFT, 0]);
      top = Math.max(top, a.sp);
      off = Math.max(off, Math.abs(t.project(a.x, a.z).lat) / t.roadHalf);
      assert.equal(a.spin, 0);
      b.x = q.x; b.z = q.z; // 邪魔しない場所で待機
    }
    assert.equal(a.ow, 0, 'owner mode ends');
    assert.ok(top > KART.MAX_SPEED, `${c.name} top speed ${top}`);
    assert.ok(sim.progressOf(a) - start > 250, `${c.name} progressed ${sim.progressOf(a) - start}`);
    assert.ok(off < 1.05, `${c.name} stays on the road (${off.toFixed(2)})`);
    assert.ok(a.stats.walls - walls0 <= 1, `${c.name} wall hits ${a.stats.walls - walls0}`);
  });
  // 無敵: ホネ・バナナ・スピンのどれも効かない
  const sim = newRace();
  const [a, b] = sim.s.karts;
  place(a, 100, 0);
  place(b, 60, 0);
  a.item = ITEMS.OWNER;
  sim.step(DT, [IN.ITEM, 0]);
  assert.equal(spinKart(a, 1), false);
  assert.equal(spinKart(a, 1, true), false);
  b.item = ITEMS.BONE;
  // 触れた車ははね飛ばされる
  const sim2 = newRace();
  const [x, y] = sim2.s.karts;
  place(x, 100, 0);
  placeAhead(x, y, 12);
  x.item = ITEMS.OWNER;
  sim2.step(DT, [IN.ITEM, 0]);
  let by = -1;
  for (let i = 0; i < 90 && y.spin <= 0; i++) {
    sim2.step(DT, [0, 0]);
    y.sp = 0;
    for (const e of sim2.drainEvents()) if (e.t === 'hit' && e.k === 1) by = e.by;
  }
  assert.ok(y.spin > 0, 'touched kart spins');
  assert.equal(by, 0);
  assert.ok(x.stats.hits >= 1 && y.stats.hitBy >= 1);
});

test('犬小屋: 1位を狙って必ず当たり、近くの車も巻き込む。ガードは防ぐ。自分が1位なら不発', () => {
  const setup = () => {
    const sim = new RaceSim(track, { npcs: 2 });
    while (sim.s.phase === 'countdown') sim.step(DT, [0, 0, 0, 0]);
    const [a, b, c, d] = sim.s.karts;
    const hold = () => {
      place(b, 300, 0);
      place(c, 294, 3); // b のすぐ後ろ（近く）
      place(d, 150, 0); // 遠い
    };
    place(a, 200, 0);
    hold();
    a.item = ITEMS.HOUSE;
    sim.drainEvents();
    return { sim, a, b, c, d, hold };
  };
  {
    const { sim, a, b, c, d, hold } = setup();
    b.inv = 100; // スピン直後のような無敵でも当たる
    sim.step(DT, [IN.ITEM, 0, 0, 0]);
    assert.equal(a.item, 0);
    assert.equal(sim.s.houses.length, 1);
    assert.equal(sim.s.houses[0].t, 1, 'targets the leader');
    for (let i = 0; i < 60 * ITEMS.HOUSE_DELAY - 3; i++) {
      hold();
      sim.step(DT, [0, 0]);
    }
    assert.equal(b.spin, 0, 'not landed yet');
    assert.equal(sim.drainEvents().filter((e) => e.t === 'house').length, 0);
    for (let i = 0; i < 12; i++) {
      hold();
      sim.step(DT, [0, 0]);
    }
    assert.ok(b.spin > 0, 'leader hit');
    assert.ok(c.spin > 0, 'nearby kart caught');
    assert.equal(d.spin, 0, 'far kart not');
    assert.equal(a.spin, 0, 'thrower far away');
    assert.ok(a.stats.hits >= 2);
    // しばらく地面に残ってから消える
    for (let i = 0; i < 60 * (ITEMS.HOUSE_STAY + 0.5); i++) {
      hold();
      sim.step(DT, [0, 0]);
    }
    assert.equal(sim.s.houses.length, 0);
  }
  {
    const { sim, a, b, hold } = setup();
    b.gd = 10;
    sim.step(DT, [IN.ITEM, 0, 0, 0]);
    for (let i = 0; i < 60 * ITEMS.HOUSE_DELAY + 5; i++) {
      hold();
      sim.step(DT, [0, 0]);
    }
    assert.equal(b.spin, 0, 'guard blocks the house');
    assert.equal(b.gd, 0);
  }
  {
    // 狙いは使った時点の1位に固定（追い越されても追いかける）
    const { sim, a, b, hold } = setup();
    sim.step(DT, [IN.ITEM, 0, 0, 0]);
    place(a, 400, 0);
    for (let i = 0; i < 60 * ITEMS.HOUSE_DELAY + 5; i++) {
      hold();
      sim.step(DT, [0, 0]);
    }
    assert.ok(b.spin > 0);
  }
  {
    // 自分が1位なら不発
    const { sim, a } = setup();
    place(a, 500, 0);
    sim.step(DT, [IN.ITEM, 0, 0, 0]);
    assert.equal(a.item, 0);
    assert.equal(sim.s.houses.length, 0);
    assert.equal(sim.drainEvents().filter((e) => e.t === 'poof').length, 1);
  }
});

test('NPC は飼い主・豪雨・犬小屋のアイテムも使う', () => {
  for (const item of [ITEMS.OWNER, ITEMS.RAIN, ITEMS.HOUSE]) {
    const sim = new RaceSim(track, { npcs: 1 });
    while (sim.s.phase === 'countdown') sim.step(DT, [0, 0, 0]);
    const [a, b, n] = sim.s.karts;
    place(a, 400, 0);
    place(b, 380, 0);
    place(n, 300, 0);
    n.item = item;
    let used = false;
    for (let i = 0; i < 60 * 20 && !used; i++) {
      place(a, 400, 0);
      place(b, 380, 0);
      place(n, 300, 0);
      sim.step(DT, [0, 0, 0]);
      used = n.item === 0;
    }
    assert.ok(used, `npc used item ${item}`);
  }
});

test('定期配信の形式で飼い主・犬小屋・豪雨の状態も復元できる', () => {
  const sim = new RaceSim(track, { npcs: 4 });
  while (sim.s.phase === 'countdown') sim.step(DT, [0, 0]);
  const [a, b] = sim.s.karts;
  place(a, 200, 0);
  place(b, 300, 0);
  a.item = ITEMS.OWNER;
  sim.step(DT, [IN.ITEM, 0]);
  b.item = ITEMS.RAIN;
  sim.step(DT, [0, IN.ITEM]);
  sim.s.karts[2].item = ITEMS.HOUSE;
  sim.s.karts[2].x = a.x;
  sim.s.karts[2].z = a.z - 30;
  sim.s.houses.push({ id: 77, o: 2, t: 1, x: b.x, z: b.z, age: 0.5, hit: 0 });
  sim.s.karts[3].item = ITEMS.HOUSE;
  const snap = JSON.parse(encode(packNet(sim.getSnapshot())));
  const back = sanitizeSnapshot(unpackNet(snap), new RaceSim(track).s, 30);
  assert.equal(back.karts.length, 6);
  assert.ok(Math.abs(back.karts[0].ow - a.ow) < 0.01 && back.karts[0].ow > 0);
  assert.equal(back.karts[3].item, ITEMS.HOUSE);
  assert.equal(back.houses.length, 1);
  assert.equal(back.houses[0].id, 77);
  assert.equal(back.houses[0].t, 1);
  assert.ok(Math.abs(back.houses[0].age - 0.5) < 0.01);
  assert.equal(back.rk, 1);
  assert.ok(back.rain > 0);
  assert.ok(back.karts[0].wet === 0 && back.karts[2].wet > 0);
  assert.equal(back.karts[5].npc, 1);
  // 不正な犬小屋は無視・丸められる
  const bad = sanitizeSnapshot({ ...sim.getSnapshot(), houses: [null, { id: 1, o: 99, t: -5, x: 'a', z: 1e99, age: 99 }] }, sim.s, 30);
  assert.equal(bad.houses.length, 1);
  assert.ok(bad.houses[0].t >= 0 && Number.isFinite(bad.houses[0].x));
});

test('ブーストパッド: 全コース道路上にあり、踏むとブーストして加速する', () => {
  COURSES.forEach((c, ci) => {
    const t = new Track(ci);
    assert.equal(t.pads.length, 10);
    for (const p of t.pads) {
      assert.ok(Math.abs(t.project(p.x, p.z).lat) < t.roadHalf - PAD.WIDTH / 2 + 0.5, `${c.name} pad on road`);
      assert.ok(t.onPad(p.x, p.z));
      assert.ok(!t.onPad(p.x + p.tx * PAD.LENGTH, p.z + p.tz * PAD.LENGTH), 'ahead of pad is off');
    }
    // パッドとアイテムボックスは重ならない
    for (const b of t.itemBoxes()) assert.ok(!t.pads.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < PAD.LENGTH), `${c.name} pad/box overlap`);
  });
  const sim = newRace();
  const [a, b] = sim.s.karts;
  const pad = track.pads[0];
  Object.assign(a, { x: pad.x - pad.tx * 6, z: pad.z - pad.tz * 6, h: pad.h, sp: KART.MAX_SPEED * 0.8, kx: 0, kz: 0, boost: 0 });
  place(b, 700, 0); // パッドのない場所
  b.sp = KART.MAX_SPEED * 0.8;
  for (let i = 0; i < 40; i++) sim.step(DT, [IN.UP, IN.UP]);
  assert.ok(a.boost > 0 || a.sp > KART.MAX_SPEED, `pad boost sp=${a.sp} boost=${a.boost}`);
  assert.ok(a.sp > b.sp + 3, `pad kart faster ${a.sp} vs ${b.sp}`);
  // パッドの外ではブーストしない
  assert.equal(b.boost, 0);
});

test('ガード: ホネ・バナナ・体当たり・豪雨を 1 回だけ防ぐ', () => {
  const sim = newRace();
  const [a, b] = sim.s.karts;
  place(a, 300, 0);
  placeAhead(a, b, 12);
  a.item = ITEMS.GUARD;
  sim.step(DT, [IN.ITEM, 0]);
  assert.ok(a.gd > 0 && a.item === 0);
  // ホネを当てられても防ぐ（1 回で消える）
  b.item = ITEMS.BONE;
  Object.assign(b, { h: a.h + Math.PI });
  placeAhead(a, b, 12);
  b.h = a.h + Math.PI;
  sim.step(DT, [0, IN.ITEM]);
  for (let i = 0; i < 60; i++) sim.step(DT, [0, 0]);
  assert.equal(a.gd, 0, 'guard consumed');
  assert.equal(a.spin, 0, 'not spun');
  assert.ok(sim.drainEvents().some((e) => e.t === 'block' && e.k === 0));
  // ガードがなければ次は当たる
  a.inv = 0;
  placeAhead(a, b, 12);
  b.h = a.h + Math.PI;
  b.item = ITEMS.BONE;
  sim.step(DT, [0, IN.ITEM]);
  for (let i = 0; i < 40; i++) sim.step(DT, [0, 0]);
  assert.ok(a.spin > 0 || a.inv > 0, 'second hit lands');
});

test('フリスビー: 前の相手を追尾して当てる。飛べる距離には限りがある', () => {
  const sim = newRace();
  const [a, b] = sim.s.karts;
  place(a, 20, 0);
  place(b, 60, 0);
  sim.step(DT, [0, 0]); // 走行距離を更新
  a.item = ITEMS.FRISBEE;
  sim.step(DT, [IN.ITEM, 0]);
  const fr = sim.s.proj.find((p) => p.f);
  assert.ok(fr && fr.t === 1, 'targets the kart ahead');
  // b を横にずらしても追いかける
  b.x += 6 * Math.cos(b.h);
  b.z -= 6 * Math.sin(b.h);
  b.sp = 0;
  let hit = false;
  for (let i = 0; i < 120 && !hit; i++) {
    sim.step(DT, [0, 0]);
    hit = sim.drainEvents().some((e) => e.t === 'hit' && e.k === 1);
  }
  assert.ok(hit, 'frisbee hit the target');
  // 追尾先がいないとまっすぐ飛び、距離の限界で消える
  const sim2 = newRace();
  const k = sim2.s.karts[0];
  place(k, 60, 0);
  place(sim2.s.karts[1], 20, 0); // 自分が先頭
  sim2.step(DT, [0, 0]);
  k.item = ITEMS.FRISBEE;
  sim2.step(DT, [IN.ITEM, 0]);
  assert.equal(sim2.s.proj[0].t, -1);
  for (let i = 0; i < 60 * 4; i++) sim2.step(DT, [0, 0]);
  assert.equal(sim2.s.proj.filter((p) => p.f).length, 0, 'range limit');
});

test('新アイテムの状態も配信形式で復元できる', () => {
  const sim = new RaceSim(track, { npcs: 1 });
  const [a] = sim.s.karts;
  a.gd = 12;
  a.item = ITEMS.FRISBEE;
  sim.s.proj.push({ id: 9, o: 0, x: 1, z: 2, vx: 3, vz: 4, life: 2, age: 0.1, b: 1, f: 1, t: 1, d: 33 });
  const back = sanitizeSnapshot(unpackNet(JSON.parse(encode(packNet(sim.getSnapshot())))), new RaceSim(track, { npcs: 1 }).s, 30);
  assert.ok(Math.abs(back.karts[0].gd - 12) < 0.01);
  assert.equal(back.karts[0].item, ITEMS.FRISBEE);
  assert.deepEqual([back.proj[0].f, back.proj[0].t, Math.round(back.proj[0].d)], [1, 1, 33]);
});

// ---- コース拡張・ドッグフード・ボス犬・連戦 ----

test('project の格子による高速化は、全探索と同じ結果を返す（全コース・コース外も）', () => {
  const brute = (t, x, z) => {
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < t.n; i++) {
      let u = ((x - t.x[i]) * t.tx[i] + (z - t.z[i]) * t.tz[i]) / t.segLen[i];
      u = Math.max(0, Math.min(1, u));
      const qx = t.x[i] + t.tx[i] * t.segLen[i] * u;
      const qz = t.z[i] + t.tz[i] * t.segLen[i] * u;
      const d = (x - qx) ** 2 + (z - qz) ** 2;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    return { bi, d: Math.sqrt(best) };
  };
  COURSES.forEach((c, ci) => {
    const t = new Track(ci);
    const bb = t.bounds();
    let seed = ci + 1;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let n = 0; n < 400; n++) {
      // コースの内側・外側・遠く離れた点を混ぜる
      const x = bb.minX - 300 + rnd() * (bb.maxX - bb.minX + 600);
      const z = bb.minZ - 300 + rnd() * (bb.maxZ - bb.minZ + 600);
      const want = brute(t, x, z);
      const p = t.project(x, z);
      const got = Math.hypot(x - p.cx, z - p.cz);
      assert.ok(Math.abs(got - want.d) < 1e-6, `${c.name} (${x.toFixed(0)}, ${z.toFixed(0)}) ${got} vs ${want.d}`);
    }
  });
});

test('トンネル: 新コースにあり、区間はスタートラインを避け、内側かどうかを判定できる', () => {
  COURSES.forEach((c, ci) => {
    const t = new Track(ci);
    assert.equal(t.tunnels.length, c.tunnels.length);
    if (ci < 5) assert.equal(t.tunnels.length, 0, `${c.name} has no tunnel`);
    for (const tn of t.tunnels) {
      assert.ok(tn.a > t.length * 0.03 && tn.b < t.length * 0.97 && tn.b - tn.a > 150, `${c.name} tunnel range`);
      assert.ok(t.inTunnel((tn.a + tn.b) / 2));
      assert.ok(!t.inTunnel(tn.a - 40) || t.tunnels.some((o) => o !== tn && o.a <= tn.a - 40 && o.b >= tn.a - 40));
      assert.ok(t.inTunnel(tn.a - 5, 8), 'margin counts as inside');
    }
  });
  const tunnelCourses = COURSES.filter((c) => c.tunnels.length).map((c) => c.theme);
  assert.deepEqual(tunnelCourses, ['cave', 'subway', 'volcano', 'desert', 'candy']);
});

test('ドッグフード: 全コースの道路上にあり、拾うと増えて、速くなり、取られると一定時間なくなる', () => {
  COURSES.forEach((c, ci) => {
    const t = new Track(ci);
    assert.equal(t.foods.length, FOOD.GROUPS * FOOD.PER_GROUP);
    for (const f of t.foods) assert.ok(Math.abs(t.project(f.x, f.z).lat) < t.roadHalf - 1, `${c.name} food on road`);
  });
  const sim = newRace();
  const [a, b] = sim.s.karts;
  place(b, 800, 0);
  const f = track.foods[7];
  Object.assign(a, { x: f.x, z: f.z, h: track.pointAt(0, 0).h });
  sim.step(DT, [0, 0]);
  assert.equal(a.fd, 1);
  assert.equal(a.stats.foods, 1);
  assert.ok(sim.s.foods[7] > 0, 'taken');
  assert.ok(sim.drainEvents().some((e) => e.t === 'food' && e.k === 0 && e.n === 1));
  // 同じ場所にいても二重に拾わない。時間が経つとまた出る
  sim.step(DT, [0, 0]);
  assert.equal(a.fd, 1);
  place(a, 1500, 0); // 立ち止まったままだと、また出た瞬間に拾ってしまう
  for (let i = 0; i < 60 * (FOOD.RESPAWN + 1); i++) sim.step(DT, [0, 0]);
  assert.equal(sim.s.foods[7], 0, 'respawned');
  // 持っている数が多いほど最高速が少し上がる（15 個で +6%）
  const base = { ...a, fd: 0 };
  assert.ok(Math.abs(maxSpeedFor({ ...base, fd: FOOD.MAX }) / maxSpeedFor(base) - 1 - FOOD.MAX * FOOD.SPEED) < 1e-9);
  assert.ok(maxSpeedFor({ ...base, fd: 8 }) > maxSpeedFor({ ...base, fd: 3 }));
  // 上限（15）を超えては拾わない（通り過ぎて、他の車が拾える）
  a.fd = FOOD.MAX;
  const g = track.foods[20];
  Object.assign(a, { x: g.x, z: g.z });
  sim.step(DT, [0, 0]);
  assert.equal(a.fd, FOOD.MAX);
  assert.equal(sim.s.foods[20], 0);
  // ぶつけられてスピンすると 3 個落とす。ガードで防いだときは落とさない
  a.fd = 10;
  a.inv = 0;
  a.gd = 0;
  assert.ok(spinKart(a, 1));
  assert.equal(a.fd, 10 - FOOD.HIT_LOSS);
  a.inv = 0;
  a.gd = 5;
  assert.ok(!spinKart(a, 1));
  assert.equal(a.fd, 10 - FOOD.HIT_LOSS);
});

test('ドッグフードの状態も定期配信の形式で復元でき、持っている数も同期される', () => {
  const sim = newRace();
  sim.s.foods[3] = 5;
  sim.s.foods[40] = 2;
  sim.s.karts[1].fd = 9;
  const back = sanitizeSnapshot(unpackNet(JSON.parse(encode(packNet(sim.getSnapshot())))), new RaceSim(track).s, 30);
  assert.equal(back.foods.length, track.foods.length);
  assert.ok(back.foods[3] > 0 && back.foods[40] > 0);
  assert.equal(back.foods.filter((t) => t > 0).length, 2);
  assert.equal(back.karts[1].fd, 9);
  // 完全な状態（再接続時）でも
  const full = sanitizeSnapshot(JSON.parse(encode(sim.getSnapshot())), new RaceSim(track).s, 30);
  assert.ok(full.foods[3] > 0 && full.foods[40] > 0);
});

test('ボス犬: 台数に関係なく最後の NPC、専用の名前、ふつうの NPC より速く、配信でも保たれる', () => {
  const sim = new RaceSim(track, { npcs: 2, boss: 1 });
  assert.equal(sim.s.karts.length, 5);
  assert.equal(sim.s.karts[4].boss, 1);
  assert.equal(sim.s.karts.filter((k) => k.boss).length, 1);
  assert.equal(kartName(sim.s.karts[4]), 'ドーベルマン');
  assert.equal(kartName(sim.s.karts[2]), 'プードル');
  assert.equal(new RaceSim(track, { npcs: 4, boss: 1 }).s.karts.length, 7);
  assert.equal(new RaceSim(track, { npcs: 4, boss: 0 }).s.karts.length, 6);
  assert.equal(new RaceSim(track, { npcs: 0, boss: 1 }).s.karts.length, 3);
  // 人間のボットと並んで走ると、ボス犬はふつうの NPC を引き離す
  const race = new RaceSim(track, { npcs: 2, boss: 1 });
  for (let i = 0; i < 60 * 150; i++) {
    const [a, b] = race.s.karts;
    race.step(DT, [bot(a, 4), bot(b, -4)]);
  }
  const prog = race.s.karts.map((k) => race.progressOf(k));
  assert.ok(prog[4] > Math.max(prog[2], prog[3]) + 40, `boss ${prog[4]} vs npc ${prog[2]}, ${prog[3]}`);
  const back = sanitizeSnapshot(unpackNet(JSON.parse(encode(packNet(race.getSnapshot())))), new RaceSim(track, { npcs: 2, boss: 1 }).s, 30);
  assert.equal(back.karts[4].boss, 1);
  assert.equal(back.karts[3].boss, 0);
});

test('連戦のポイント: 順位・ドッグフード・体当たり・アイテム命中・ファステストラップの合計', () => {
  const sim = new RaceSim(track, { npcs: 2 });
  while (sim.s.phase === 'countdown') sim.step(DT, [0, 0]);
  const [a, b, c, d] = sim.s.karts;
  // a が 1 位、b が 3 位（c が 2 位）
  // 進み具合はチェックポイントからの距離で測るので、チェックポイントも合わせて置く
  const seg = track.length / RACE.CHECKPOINTS;
  for (const [k, at] of [[a, 900], [c, 700], [b, 500], [d, 100]]) {
    place(k, at);
    k.cp = Math.floor(at / seg);
  }
  sim.step(DT, [0, 0]);
  a.stats.foods = 7;
  a.stats.bumps = 2;
  a.stats.hits = 1;
  b.stats.hits = 3;
  a.best = 0;
  b.best = 70;
  const [pa, pb] = sim.calcScores();
  assert.equal(pa.rank, 1);
  assert.equal(pb.rank, 3);
  assert.equal(pa.rankPts, SCORE.RANK[0]);
  assert.equal(pb.rankPts, SCORE.RANK[2]);
  assert.equal(pa.total, SCORE.RANK[0] + 7 * SCORE.FOOD + 2 * SCORE.BUMP + 1 * SCORE.HIT);
  assert.equal(pb.total, SCORE.RANK[2] + 3 * SCORE.HIT + SCORE.FAST, 'only b has a best lap');
  // 同じ周回タイムなら無し
  a.best = 70;
  assert.equal(sim.calcScores()[0].fastPts, 0);
  assert.equal(sim.calcScores()[1].fastPts, 0);
  a.best = 60;
  assert.equal(sim.calcScores()[0].fastPts, SCORE.FAST);
  // 結果オブジェクトにも載る
  const r = sim.buildResult();
  assert.equal(r.points.host, sim.calcScores()[0].total);
  assert.equal(r.points.guest, sim.calcScores()[1].total);
  assert.equal(r.course, track.name);
  assert.ok(r.score.length >= 5 && r.score.at(-1).label === '今回の合計');
  assert.ok(SCORE.RANK.every((v, i) => i === 0 || v < SCORE.RANK[i - 1]), '順位ポイントは下位ほど少ない');
});

test('コース設定: ランダムは使っていないコースから選ぶ。連戦・ボス犬の設定も検証される', () => {
  const def = getGame('dogKart');
  const course = def.options.find((o) => o.key === 'course');
  assert.equal(course.choices.filter((c) => !c.random).length, COURSES.length);
  assert.deepEqual(def.options.find((o) => o.key === 'races').choices.map((c) => c.value), [1, 2, 3, 4, 6]);
  const random = course.choices.find((c) => c.random).value;
  const used = [];
  for (let i = 0; i < COURSES.length; i++) {
    const o = resolveMatchOptions(def, { course: random, races: 6 }, { course: used });
    assert.ok(Number.isInteger(o.course) && o.course >= 0 && o.course < COURSES.length, 'random resolved');
    assert.ok(!used.includes(o.course), 'no repeat until all used');
    used.push(o.course);
  }
  assert.equal(resolveMatchOptions(def, { course: 4 }, {}).course, 4, '固定のコースはそのまま');
  assert.equal(resolveMatchOptions(def, { course: 4, races: 4, boss: 0 }).boss, 0);
  assert.equal(validOptions(def, { races: 5 }).races, 1, '不正な値は初期値に戻る');
  assert.equal(validOptions(def, {}).boss, 1);
});

test('部屋の状態: 連戦の途中経過とレースごとの設定を検証して受け取る', () => {
  const base = { rev: 3, screen: 'result', guest: 'connected', ready: { host: false, guest: false }, options: { course: 99, races: 3 }, match: null, result: null };
  const ok = sanitizeRoomState({ ...base, series: { total: 3, round: 2, host: 31, guest: 22, final: false, history: [{ name: 'A', host: 15, guest: 12 }, { name: 'B', host: 16, guest: 10 }] } });
  assert.equal(ok.series.round, 2);
  assert.equal(ok.series.history.length, 2);
  assert.equal(ok.series.host, 31);
  assert.equal(sanitizeRoomState({ ...base, series: { total: 99, round: 2 } }).series, null, '範囲外は捨てる');
  assert.equal(sanitizeRoomState({ ...base, series: 'x' }).series, null);
  const m = sanitizeRoomState({ ...base, screen: 'game', match: { matchId: 'abc', gen: 1, status: 'running', synced: true, started: true, opts: { course: 7, round: 2, bad: 'x'.repeat(40), npcs: 3 } } });
  assert.equal(m.match.opts.course, 7);
  assert.equal(m.match.opts.round, 2);
  assert.equal(m.match.opts.npcs, 3);
  assert.equal(m.match.opts.bad, undefined);
});
