// いぬいぬゴム鉄砲バトル: 会場・動き・輪ゴム・体力と点数・アイテム・ラウンド
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GomuSim } from '../src/games/gomuBattle/sim.js';
import { ARENAS, ROOM, SCALE } from '../src/games/gomuBattle/arena.js';
import { createBody, stepMove, fits, aimDir, heightOf, movableBox, shoveMovables, bandSpec, weaponDamage } from '../src/games/gomuBattle/physics.js';
import { ROUND, PLAYER, GUN, ITEM, ITEMS, SCORE } from '../src/games/gomuBattle/constants.js';

const DT = 1 / 60;
// 当たった数を数えやすいように、ふだんは毎秒の回復を止める（回復のテストだけ戻す）
const REGEN = PLAYER.REGEN;
PLAYER.REGEN = 0;
const run = (sim, sec) => {
  for (let i = 0; i < sec * 60; i++) sim.step(DT);
};
/** 撃つ準備ができた試合（始まりの 3・2・1 を飛ばす） */
function ready(o = {}) {
  const sim = new GomuSim({ humans: 2, bots: 0, seed: 11, ...o });
  run(sim, ROUND.INTRO + 0.1);
  sim.drainEvents();
  return sim;
}
/** p を (x, z) に立たせて、q の方を向かせる */
function face(p, q) {
  p.yaw = Math.atan2(q.x - p.x, q.z - p.z);
  p.pitch = 0;
}
const eye = (p) => [p.x, p.y + PLAYER.EYE, p.z];
const chestDir = (p, q) => {
  const d = [q.x - p.x, q.y + 0.8 - (p.y + PLAYER.EYE), q.z - p.z]; // 少し落ちるので、胸より少し上を狙う
  const l = Math.hypot(...d);
  return d.map((v) => v / l);
};

test('会場: 3 つとも、出発地点・アイテムの箱・押せるものは家具にめりこんでいない', () => {
  assert.equal(ARENAS.length, 3);
  for (const a of ARENAS) {
    const w = { boxes: [...a.boxes, ...a.movables.map(movableBox)] };
    for (const sp of a.spawns) assert.ok(fits(w, sp[0], 0, sp[1], PLAYER.HEIGHT), `${a.name} の出発地点 ${sp}`);
    for (const it of a.items) assert.ok(fits(w, it[0], it[2], it[1], PLAYER.CROUCH_HEIGHT), `${a.name} の箱 ${it}`);
    for (const m of a.movables) {
      const b = movableBox(m);
      const hit = a.boxes.some((o) => b.x1 > o.x0 && b.x0 < o.x1 && b.z1 > o.z0 && b.z0 < o.z1 && b.y1 > o.y0 && b.y0 < o.y1);
      assert.ok(!hit && b.x0 > -ROOM.W / 2 && b.x1 < ROOM.W / 2, `${a.name} の押せるもの ${m.x},${m.z}`);
    }
    assert.ok(a.spawns.length >= 8 && a.items.length >= 8, '広い会場なので出発地点・箱も多い');
  }
  assert.ok(Math.abs((ROOM.W * ROOM.D) / (52 * 40) - 2.25) < 0.01, '52 × 40 の部屋の 2.25 倍の広さ（1.5 倍を 2 回）');
  assert.equal(ROUND.TIME, 405, '6 分 45 秒');
  assert.equal(PLAYER.HP, 100);
});

test('動き: 歩く・ベンチの座面にぶつかって止まる・ジャンプで座面に乗る・座面の下は伏せでくぐる', () => {
  const a = ARENAS[0];
  // 公園のベンチ（座面の下は高さ 0.85。立った犬は 1 なので入れない）
  const seat = a.boxes.find((b) => b.y0 === 0.85 && b.x1 - b.x0 === 4 && b.z1 < -10);
  const cx = (seat.x0 + seat.x1) / 2;
  const m = createBody(cx, seat.z1 + 4, Math.PI);
  for (let i = 0; i < 120; i++) stepMove(m, { fz: 1 }, DT, a);
  assert.ok(Math.abs(m.z - (seat.z1 + PLAYER.RADIUS)) < 0.02, `ベンチの前で止まる (${m.z})`);
  assert.equal(m.y, 0);
  // ジャンプしながら前へ → 座面に乗る
  stepMove(m, { fz: 1, jump: true }, DT, a);
  for (let i = 0; i < 60; i++) stepMove(m, { fz: 1 }, DT, a);
  assert.ok(Math.abs(m.y - seat.y1) < 1e-6, `座面の上 (${m.y})`);
  // 伏せれば座面の下をくぐって向こうへ抜ける
  const t = createBody(cx, seat.z1 + 4, Math.PI);
  for (let i = 0; i < 240; i++) stepMove(t, { fz: 1, crouch: true }, DT, a);
  assert.ok(t.z < seat.z0 - 0.5, `伏せでくぐれる (${t.z})`);
  // 座面の下では立ち上がれない（伏せたまま）
  t.z = (seat.z0 + seat.z1) / 2;
  stepMove(t, { crouch: false }, DT, a);
  assert.equal(t.crouch, true);
  assert.equal(heightOf(t), PLAYER.CROUCH_HEIGHT);
});

test('動き: 走るのはゲージ式（押している間、ゲージが尽きるまで速く走れる。離すと回復）。壁は抜けない', () => {
  const a = { boxes: [] }; // 広い所で
  const m = createBody(-25, 0, Math.PI / 2);
  const r0 = stepMove(m, { fz: 1, dash: true }, DT, a);
  assert.equal(r0.dashed, true, '走り始め');
  for (let i = 0; i < 30; i++) stepMove(m, { fz: 1, dash: true }, DT, a);
  assert.ok(Math.abs(Math.hypot(m.vx, m.vz) - PLAYER.SPRINT_SPEED) < 1e-6, '走る速さ');
  assert.ok(m.stam < PLAYER.STAMINA);
  // 押し続けると、ゲージが尽きたら歩く速さに戻る
  let k = 0;
  while (m.stam > 0 && k++ < 60 * 4) stepMove(m, { fz: 1, dash: true }, DT, a);
  const ran = (k + 31) / 60; // 最初の 31 tick も走っていた
  assert.ok(ran > 3 && ran < 3.6, `約 3.3 秒走れる (${ran.toFixed(2)})`);
  for (let i = 0; i < 20; i++) stepMove(m, { fz: 1, dash: true }, DT, a);
  assert.equal(m.sprint, false);
  assert.ok(Math.abs(Math.hypot(m.vx, m.vz) - PLAYER.SPEED) < 1e-6, '尽きたら歩く速さ');
  // 少し待ってから回復。少したまるまでは走り出せない
  for (let i = 0; i < 50; i++) stepMove(m, { fz: 1 }, DT, a);
  assert.ok(m.stam > 0 && m.stam < PLAYER.STAMINA_MIN);
  stepMove(m, { fz: 1, dash: true }, DT, a);
  assert.equal(m.sprint, false, 'ゲージが少なすぎると走り出せない');
  for (let i = 0; i < 60 * 6; i++) stepMove(m, {}, DT, a);
  assert.equal(m.stam, PLAYER.STAMINA, '満タンまで回復');
  const w = createBody(20, 12, Math.PI / 2);
  for (let i = 0; i < 300; i++) stepMove(w, { fz: 1 }, DT, a);
  assert.ok(w.x <= ROOM.W / 2 - PLAYER.RADIUS + 1e-6 && w.x > 25, `壁を抜けない (${w.x})`);
});

test('撃つ: 近くから 14 ずつ減って 8 発で倒れる。与えたダメージ 10 ごとに 1 点、倒すと +3 点。3 秒で復活し、2 秒は無敵', () => {
  const sim = ready();
  const [a, b] = sim.s.players;
  Object.assign(a, { x: -4, z: 2, y: 0 });
  Object.assign(b, { x: 4, z: 2, y: 0 });
  face(a, b);
  assert.ok(sim.fire(0, eye(a), chestDir(a, b)));
  run(sim, 0.4);
  assert.equal(b.hp, PLAYER.HP - 14, '8 より近いので 14');
  for (let n = 1; n < 8; n++) {
    assert.ok(sim.fire(0, eye(a), chestDir(a, b)));
    run(sim, 0.4);
  }
  const ev = sim.drainEvents();
  assert.equal(ev.filter((e) => e.t === 'hit').length, 8);
  assert.equal(ev.filter((e) => e.t === 'kill').length, 1);
  assert.equal(a.score, PLAYER.HP / SCORE.DMG_PER_POINT + SCORE.KILL + 2, 'ラウンドで最初に倒したのでファーストブラッド +2');
  assert.equal(a.rs[0], a.score);
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);
  assert.ok(b.dead > 0);
  assert.equal(sim.fire(1, eye(b), [1, 0, 0]), false, '倒れている間は撃てない');
  run(sim, PLAYER.RESPAWN);
  assert.equal(b.dead, 0);
  assert.equal(b.hp, PLAYER.HP);
  assert.ok(b.inv > 0);
  const sp = sim.drainEvents().find((e) => e.t === 'spawn' && e.i === 1);
  assert.ok(sp, '復活の位置が配られる');
  // 無敵の間は当たらない
  face(a, b);
  sim.fire(0, eye(a), chestDir(a, b));
  run(sim, 0.8);
  assert.equal(b.hp, PLAYER.HP);
});

test('撃つ: 家具の陰には当たらない・自分には当たらない・撃った位置がおかしければ断る', () => {
  const sim = ready();
  const [a, b] = sim.s.players;
  // 生け垣の向こう
  Object.assign(a, { x: 0, z: 9, y: 0 });
  Object.assign(b, { x: 0, z: 15.5, y: 0 });
  sim.fire(0, eye(a), chestDir(a, b));
  run(sim, 1);
  assert.equal(b.hp, PLAYER.HP, '生け垣にさえぎられる');
  assert.equal(sim.fire(0, [a.x + 8, 1, a.z], [0, 0, 1]), false);
  sim.fire(0, eye(a), [0, 1, 0]);
  run(sim, 2);
  assert.equal(a.hp, PLAYER.HP);
});

test('アイテム: 箱に近づくと取れて、10 秒後にまた出る。ゴムが変わるアイテムは次の 5 発', () => {
  const sim = ready();
  const a = sim.s.players[0];
  const [bx, bz, by] = sim.arena.items[1]; // いすの座面の上
  Object.assign(a, { x: bx, z: bz, y: by });
  sim.step(DT);
  assert.ok(a.item > 0);
  assert.ok(sim.s.boxes[1] > 0);
  run(sim, ITEMS.BOX_RESPAWN + 0.1);
  assert.equal(sim.s.boxes[1], 0, '箱はまた出ているが、持っている間は取れない');
  a.item = ITEM.TRIPLE;
  sim.drainEvents();
  assert.ok(sim.useItem(0, eye(a), [1, 0, 0]));
  assert.equal(a.sp, ITEM.TRIPLE);
  assert.equal(a.spN, ITEMS.SPECIAL_SHOTS);
  sim.fire(0, eye(a), [1, 0, 0], ITEM.TRIPLE);
  const shots = sim.drainEvents().filter((e) => e.t === 'shot');
  assert.equal(shots.length, 3, '3 方向');
  assert.equal(a.spN, ITEMS.SPECIAL_SHOTS - 1);
  // 持っていない種類を言っても、ふつうのゴムになる
  a.sp = 0;
  sim.fire(0, eye(a), [1, 0, 0], ITEM.THICK);
  assert.equal(sim.drainEvents().find((e) => e.t === 'shot').k, 0);
});

test('アイテム: 極太は 1.6 倍のダメージ、跳ね返りは壁で跳ね返る、追いかけは曲がって当たる', () => {
  const sim = ready();
  const [a, b] = sim.s.players;
  Object.assign(a, { x: -4, z: 2, y: 0 });
  Object.assign(b, { x: 4, z: 2, y: 0 });
  a.sp = ITEM.THICK;
  a.spN = 5;
  sim.fire(0, eye(a), chestDir(a, b), ITEM.THICK);
  run(sim, 0.8);
  assert.equal(b.hp, PLAYER.HP - Math.round(14 * 1.6));
  // 跳ね返り: 壁へ撃つと戻ってくる
  b.hp = PLAYER.HP;
  a.sp = ITEM.BOUNCE;
  a.spN = 5;
  sim.drainEvents();
  sim.fire(0, eye(a), [0, 0, 1], ITEM.BOUNCE);
  run(sim, 0.9);
  assert.ok(sim.s.bands[0]?.bounced >= 1, 'テレビ台で跳ね返った');
  assert.ok(sim.s.bands[0].vz < 0, '戻ってくる');
  // 追いかけ: 少しずれた向きに撃っても当たる
  sim.s.bands = [];
  a.sp = ITEM.HOMING;
  a.spN = 5;
  const d = chestDir(a, b);
  const off = aimDir(Math.atan2(d[0], d[2]) + 0.25, 0);
  sim.fire(0, eye(a), off, ITEM.HOMING);
  run(sim, 1);
  assert.ok(b.hp < PLAYER.HP, '曲がって当たった');
});

test('アイテム: 照準ぶれ・ゴム切れは自分以外、ガムを踏むと動けない、煙幕は狙った所に出る', () => {
  const sim = ready({ humans: 3 });
  const [a, b, c] = sim.s.players;
  a.item = ITEM.NOAMMO;
  sim.useItem(0, eye(a), [1, 0, 0]);
  assert.ok(b.noAmmo > 0 && c.noAmmo > 0 && a.noAmmo === 0);
  assert.equal(sim.fire(1, eye(b), [1, 0, 0]), false, 'ゴム切れの間は撃てない');
  a.item = ITEM.SHAKE;
  sim.useItem(0, eye(a), [1, 0, 0]);
  assert.ok(b.shake > 0 && a.shake === 0);
  // ガム
  Object.assign(a, { x: 3, z: 4, y: 0 });
  a.item = ITEM.GUM;
  sim.useItem(0, eye(a), [1, 0, 0]);
  assert.equal(sim.s.gums.length, 1);
  sim.step(DT);
  assert.equal(sim.s.gums.length, 1, '置いた本人は踏まない');
  Object.assign(b, { x: 3.2, z: 4, y: 0 });
  sim.step(DT);
  assert.ok(b.stuck > 0);
  assert.equal(sim.s.gums.length, 0);
  // 煙幕
  a.item = ITEM.SMOKE;
  Object.assign(a, { x: 0, z: 2, y: 0 });
  sim.useItem(0, eye(a), [0, 0, 1]);
  const sm = sim.s.smokes[0];
  assert.ok(sm && sm.z > 4 && sm.z < ROOM.D / 2 - 2, `前に煙 (${sm?.z})`);
  run(sim, ITEMS.SMOKE_TIME + 0.1);
  assert.equal(sim.s.smokes.length, 0);
});

test('ラウンド: 6 分 45 秒で 1 ラウンド、会場が変わって 3 ラウンドで終わる。点はラウンドごとにも数える', () => {
  const sim = new GomuSim({ humans: 1, bots: 3, seed: 5 });
  const rounds = [];
  let ticks = 0;
  while (sim.s.phase !== 'done' && ticks < 60 * 1300) {
    sim.step(DT);
    ticks++;
    for (const e of sim.drainEvents()) if (e.t === 'round') rounds.push(e.r);
  }
  assert.equal(sim.s.phase, 'done');
  assert.deepEqual(rounds, [0, 1, 2]);
  const per = ROUND.INTRO + ROUND.TIME + ROUND.END;
  assert.ok(Math.abs(ticks / 60 - per * 3) < 0.2, `${ticks / 60} 秒`);
  const total = sim.s.players.reduce((n, p) => n + p.score, 0);
  assert.ok(total > 20, 'CPU どうしで撃ち合って点が入る');
  for (const p of sim.s.players) assert.equal(p.rs.reduce((x, y) => x + y, 0), p.score);
  const st = sim.standings();
  assert.ok(st[0].score >= st[st.length - 1].score);
});

test('CPU: 動き回って撃ち、アイテムを拾って使う（家具に引っかかったままにならない）', () => {
  const sim = new GomuSim({ humans: 1, bots: 5, seed: 3 });
  const ev = {};
  const start = sim.s.players.map((p) => [p.x, p.z]);
  let far = 0;
  // 会場が広いので、出会う・箱にたどり着くまで少しかかる（アイテムを拾って使うまで、最大 4 分）
  run(sim, ROUND.INTRO + 60);
  for (const e of sim.drainEvents()) ev[e.t] = (ev[e.t] || 0) + 1;
  for (let k = 0; k < 18 && !(ev.pick > 0 && ev.use > 0); k++) {
    run(sim, 10);
    for (const e of sim.drainEvents()) ev[e.t] = (ev[e.t] || 0) + 1;
  }
  for (const p of sim.s.players.slice(1)) if (Math.hypot(p.x - start[p.i][0], p.z - start[p.i][1]) > 2 || p.deaths) far++;
  assert.ok(far >= 4, `動いた CPU ${far}`);
  assert.ok(ev.shot > 20 && ev.hit > 3, JSON.stringify(ev));
  assert.ok(ev.pick > 0 && ev.use > 0, 'アイテム');
});

test('人の位置の報告: 復活の前の古い報告は捨てる', () => {
  const sim = ready();
  const b = sim.s.players[1];
  const g = b.g;
  sim.setPilot(1, { x: 1, y: 0, z: 2, yaw: 0, pitch: 0, g });
  assert.equal(b.x, 1);
  sim.setPilot(1, { x: 5, y: 0, z: 5, yaw: 0, pitch: 0, g: (g + 1) & 255 });
  assert.equal(b.x, 1);
  void GUN;
});

test('押せるもの: 体当たりでズルズル押して動かせる。壁にぶつかったら止まる。ゲストの押した分はホストで押し出す', () => {
  const a = ARENAS[0];
  const box = movableBox({ x: 0, z: 3, w: 1.8, d: 1.8, h: 1.3, c: 0, k: 'cardboard' });
  const w = { boxes: [...a.boxes, box] };
  const m = createBody(-3, 3, Math.PI / 2); // 東（+x）を向く
  for (let i = 0; i < 120; i++) stepMove(m, { fz: 1 }, DT, w);
  const cx = (box.x0 + box.x1) / 2;
  assert.ok(cx > 1, `押して動いた (${cx})`);
  assert.ok(Math.abs(box.x0 - (m.x + PLAYER.RADIUS)) < 0.05, '押している');
  // 押す速さは歩くより遅い
  const v0 = m.x;
  stepMove(m, { fz: 1 }, DT, w);
  assert.ok((m.x - v0) / DT <= PLAYER.PUSH_SPEED + 1e-6);
  // 押し続けると、柵（会場のはし）にぶつかって止まる
  for (let i = 0; i < 1000; i++) stepMove(m, { fz: 1 }, DT, w);
  const stop = (box.x0 + box.x1) / 2;
  for (let i = 0; i < 60; i++) stepMove(m, { fz: 1 }, DT, w);
  assert.equal((box.x0 + box.x1) / 2, stop, '止まったまま');
  // ゲストの報告した位置が押せるものに重なっていたら、ホストが押し出す
  const b2 = movableBox({ x: -10, z: 12, w: 1.8, d: 1.8, h: 1.3, c: 0, k: 'cardboard' });
  const w2 = { boxes: [...a.boxes, b2] };
  const g = createBody(-10.4 - 0.9, 12, 0);
  g.x = -10.9 + 0.2;
  shoveMovables(w2, g);
  assert.ok(b2.x0 >= g.x + PLAYER.RADIUS - 1e-6, '押し出された');
});

test('押せるもの: 試合では、CPU も押す。輪ゴムは押せるものにさえぎられる。ラウンドの始めに元の場所へ戻る', () => {
  const sim = ready();
  const [a, b] = sim.s.players;
  const m0 = sim.s.mov[0];
  const start = [(m0.x0 + m0.x1) / 2, (m0.z0 + m0.z1) / 2];
  // a と b の間に押せるもの
  const [mx, mz] = start;
  Object.assign(a, { x: mx - 3.5, z: mz, y: 0 });
  Object.assign(b, { x: mx + 3.5, z: mz, y: 0 });
  sim.fire(0, eye(a), chestDir(a, b));
  run(sim, 0.6);
  assert.equal(b.hp, PLAYER.HP, '段ボールにさえぎられる');
  // 位置の報告で押す
  sim.setPilot(0, { x: mx - 1.1, y: 0, z: mz, yaw: 0, pitch: 0, g: a.g });
  assert.ok((m0.x0 + m0.x1) / 2 > start[0], '押された');
  // 次のラウンドで元に戻る
  sim.s.t = ROUND.TIME + ROUND.END;
  sim.s.phase = 'end';
  sim.step(DT);
  const n0 = sim.s.mov[0];
  assert.deepEqual([(n0.x0 + n0.x1) / 2, (n0.z0 + n0.z1) / 2], [ARENAS[1].movables[0].x, ARENAS[1].movables[0].z]);
});

// ---- 遅れを減らす仕組み ----
import { packBin, unpackBin, toB64, fromB64 } from '../src/games/gomuBattle/net.js';

test('撃った人の画面で当たりを決める: ホストでは当てず、知らせを確かめてから当てる（同じ輪ゴムは 1 回だけ・遠すぎる相手はだめ）', () => {
  const sim = ready();
  sim.clientJudge = (i) => i === 1; // ゲスト（1）の輪ゴム
  const [a, b] = sim.s.players;
  Object.assign(a, { x: -4, z: 2, y: 0 });
  Object.assign(b, { x: 4, z: 2, y: 0 });
  sim.fire(1, eye(b), chestDir(b, a), 0, 7);
  run(sim, 0.8);
  assert.equal(a.hp, PLAYER.HP, 'ホストの計算では当てない（撃った人の画面で決める）');
  const key = 7 * 4;
  assert.equal(sim.remoteHit(1, key + 1, 0, [a.x, 0.6, a.z]), false, '撃っていない番号');
  assert.equal(sim.remoteHit(1, key, 0, [a.x + 8, 0.6, a.z]), false, '相手から遠すぎる');
  assert.equal(sim.remoteHit(1, key, 0, [a.x + 0.3, 0.6, a.z]), true);
  assert.equal(a.hp, PLAYER.HP - 14, '撃った場所から当たった場所までの距離でダメージ（近いので 14）');
  assert.equal(b.score, 1);
  assert.equal(sim.remoteHit(1, key, 0, [a.x, 0.6, a.z]), false, '同じ輪ゴムは 1 回だけ');
  const ev = sim.drainEvents();
  assert.ok(ev.some((e) => e.t === 'hit' && e.v === 0 && e.by === 1));
  // ホスト自身・CPU の輪ゴムは、今までどおりホストが当てる
  sim.fire(0, eye(a), chestDir(a, b));
  run(sim, 0.8);
  assert.equal(b.hp, PLAYER.HP - 14);
});

test('配信のバイト列: 位置・向き・体力・アイテム・点・押せるもの・煙・ガム・起きたことが戻る。JSON より小さい', () => {
  const sim = new GomuSim({ humans: 2, bots: 5, seed: 3 });
  run(sim, ROUND.INTRO + 15);
  sim.s.gums.push({ id: 70000, o: 1, x: 1.234, y: 0, z: -2.5, age: 0 });
  sim.s.smokes.push({ id: 5, o: 1, x: 3, y: 1.2, z: 4, age: 1.5 });
  const ev = sim.drainEvents().slice(0, 4);
  const u8 = packBin(sim.s, true, ev);
  const d = unpackBin(fromB64(toB64(u8)), 7);
  assert.ok(d);
  assert.equal(d.st.phase, sim.s.phase);
  assert.ok(Math.abs(d.st.t - sim.s.t) < 0.002);
  sim.s.players.forEach((p, i) => {
    const q = d.st.players[i];
    assert.ok(Math.abs(q.x - p.x) < 0.002 && Math.abs(q.z - p.z) < 0.002 && Math.abs(q.y - p.y) < 0.002);
    assert.ok(Math.abs(Math.atan2(Math.sin(q.yaw - p.yaw), Math.cos(q.yaw - p.yaw))) < 0.001);
    assert.deepEqual([q.hp, q.item, q.g, q.score, q.kills, q.deaths], [p.hp, p.item, p.g, p.score, p.kills, p.deaths]);
    assert.deepEqual(q.rs, p.rs);
  });
  assert.equal(d.st.mov.length, sim.s.mov.length);
  assert.ok(d.st.gums.some((g) => g.id === 70000), '番号はそのまま（知らせの番号と合う）');
  assert.ok(d.st.smokes.some((x) => x.id === 5));
  assert.deepEqual(d.ev.map((e) => e.t), ev.map((e) => e.t));
  // ラウンドごとの点を載せない回は、前の値を使う
  const d2 = unpackBin(packBin(sim.s, false, null), 7, d.st.players.map((p) => p.rs));
  assert.deepEqual(d2.st.players.map((p) => p.rs), d.st.players.map((p) => p.rs));
  assert.ok(packBin(sim.s, false, null).length < 250, '7 匹で 250 バイト未満（煙・ガムの数で少し変わる）');
});

test('アイテム: 回復おやつは体力が 40 回復（100 まで）、無敵スターは 10 秒間 輪ゴムもガムも効かない', () => {
  const sim = ready();
  const [a, b] = sim.s.players;
  a.hp = 1;
  a.item = ITEM.HEAL;
  assert.ok(sim.useItem(0, eye(a), [1, 0, 0]));
  assert.equal(a.hp, 1 + ITEMS.HEAL);
  a.hp = PLAYER.HP - 10;
  a.item = ITEM.HEAL;
  sim.useItem(0, eye(a), [1, 0, 0]);
  assert.equal(a.hp, PLAYER.HP, '最大を超えない');
  assert.ok(sim.drainEvents().some((e) => e.t === 'heal' && e.i === 0));
  // 無敵スター
  Object.assign(a, { x: -4, z: 2, y: 0 });
  Object.assign(b, { x: 4, z: 2, y: 0 });
  b.item = ITEM.STAR;
  sim.useItem(1, eye(b), [1, 0, 0]);
  assert.ok(sim.drainEvents().some((e) => e.t === 'star' && e.i === 1 && e.d === ITEMS.STAR_TIME));
  sim.fire(0, eye(a), chestDir(a, b));
  run(sim, 0.6);
  assert.equal(b.hp, PLAYER.HP, '無敵の間は当たらない');
  assert.equal(a.score, 0);
  run(sim, ITEMS.STAR_TIME - 0.6);
  assert.equal(b.inv, 0, '10 秒で切れる');
  sim.fire(0, eye(a), chestDir(a, b));
  run(sim, 0.6);
  assert.equal(b.hp, PLAYER.HP - 14);
  // 箱から出る（拾うと 1〜COUNT-1 のどれか）
  assert.ok(ITEM.HEAL < ITEM.COUNT && ITEM.STAR < ITEM.COUNT);
});

test('照準が相手に重なっているか（半直線と筒）: 遠くても正しく分かる', async () => {
  const { rayCylinder } = await import('../src/games/gomuBattle/physics.js');
  const q = { x: 0, y: 0, z: 30 };
  assert.ok(Math.abs(rayCylinder([0, 0.85, 0], [0, 0, 1], q, 1, 0.5) - 29.5) < 1e-9);
  assert.equal(rayCylinder([0, 0.85, 0], [0, 0, -1], q, 1, 0.5), -1, '後ろ');
  assert.equal(rayCylinder([2, 0.85, 0], [0, 0, 1], q, 1, 0.5), -1, '横にずれている');
  const up = aimDir(0, 0.2); // 上を向きすぎ（頭の上を通る）
  assert.equal(rayCylinder([0, 0.85, 0], up, q, 1, 0.5), -1);
  const down = aimDir(0, -0.02);
  assert.ok(rayCylinder([0, 0.85, 0], down, q, 1, 0.5) > 0);
});

// ---- 武器えらび・スナイパー・チーム戦・ボス戦 ----
import { WEAPON, WEAPONS, MODE, BOSS, teamOf } from '../src/games/gomuBattle/constants.js';

test('武器えらび: ラウンドの前に選ぶ。全員選べば早く始まる。選ばなければ時間で始まる。CPU は自分で選ぶ', () => {
  const sim = new GomuSim({ humans: 2, bots: 2, seed: 4, pick: true });
  assert.equal(sim.s.phase, 'pick');
  assert.ok(sim.s.players.slice(2).every((p) => p.picked), 'CPU は選んである');
  assert.equal(sim.fire(0, eye(sim.s.players[0]), [1, 0, 0]), false, '選んでいる間は撃てない');
  assert.ok(sim.pickWeapon(0, WEAPON.SNIPER));
  run(sim, 1);
  assert.equal(sim.s.phase, 'pick', 'まだ 1 人が選んでいない');
  sim.pickWeapon(1, WEAPON.NORMAL);
  sim.step(DT);
  assert.equal(sim.s.phase, 'intro', '全員選んだので 3・2・1 へ');
  assert.equal(sim.s.players[0].weapon, WEAPON.SNIPER);
  assert.equal(sim.s.players[0].ammo, WEAPONS[WEAPON.SNIPER].ammo);
  assert.equal(sim.pickWeapon(0, WEAPON.NORMAL), false, '始まったら選び直せない');
  // 選ばなくても時間で始まる
  const s2 = new GomuSim({ humans: 2, bots: 0, seed: 4, pick: true });
  run(s2, ROUND.PICK + 0.1);
  assert.equal(s2.s.phase, 'intro');
});

test('スナイパー: 速くまっすぐ飛んで、遠いほど痛い。5 発で補充。連射は遅い', () => {
  const sim = ready();
  const [a, b] = sim.s.players;
  a.weapon = WEAPON.SNIPER;
  a.ammo = WEAPONS[WEAPON.SNIPER].ammo;
  Object.assign(a, { x: -25, z: 1, y: 0 }); // 公園の z = 1 の通りは何もない
  Object.assign(b, { x: 10, z: 1, y: 0 });
  // 胸（頭より下）を狙う
  const d = [b.x - a.x, b.y + 0.5 - eye(a)[1], 0];
  const l = Math.hypot(...d);
  assert.ok(sim.tryFire(a, eye(a), d.map((v) => v / l)));
  assert.equal(sim.tryFire(a, eye(a), [1, 0, 0]), false, 'すぐには次を撃てない');
  run(sim, 0.8); // 40 先まで 0.6 秒くらい
  const sd = PLAYER.HP - b.hp;
  assert.ok(sd > 45 && sd <= 60, `35 離れているので、近く（30）より痛い: ${sd}`);
  for (let k = 1; k < WEAPONS[WEAPON.SNIPER].ammo; k++) {
    run(sim, 1.1);
    assert.ok(sim.tryFire(a, eye(a), [1, 0, 0]));
  }
  assert.equal(a.ammo, 0);
  assert.ok(a.reload > 0, '5 発で補充');
});

test('輪ゴム: ふつうは 10 発・壁で 1 回跳ね返る。跳ね返りゴムは 3 回', () => {
  assert.equal(WEAPONS[WEAPON.NORMAL].ammo, 10);
  assert.equal(WEAPONS[WEAPON.SNIPER].ammo, 5);
  // ダメージは距離で: 鉄砲は近いほど、スナイパーは遠いほど痛い
  assert.equal(weaponDamage(WEAPON.NORMAL, 3), 14);
  assert.equal(weaponDamage(WEAPON.NORMAL, 24), 10);
  assert.equal(weaponDamage(WEAPON.NORMAL, 60), 6);
  assert.equal(weaponDamage(WEAPON.SNIPER, 5), 30);
  assert.equal(weaponDamage(WEAPON.SNIPER, 50), 60);
  assert.ok(weaponDamage(WEAPON.SNIPER, 30) > weaponDamage(WEAPON.SNIPER, 15));
  assert.equal(weaponDamage(WEAPON.BOMB, 0), WEAPONS[WEAPON.BOMB].dmg[0]);
  assert.equal(weaponDamage(WEAPON.BOMB, WEAPONS[WEAPON.BOMB].blast + 0.1), 0, '爆発の外は 0');
  assert.equal(bandSpec(0, WEAPON.BOMB).bounce, 0, '爆弾は跳ね返らずに爆発');
  assert.equal(bandSpec(0).bounce, 1);
  assert.equal(bandSpec(0, WEAPON.SNIPER).bounce, 1);
  assert.equal(bandSpec(ITEM.BOUNCE).bounce, 3);
  assert.ok(Math.abs(bandSpec(0).speed - 28 * 1.8) < 1e-9);
});

test('チーム戦: 2 チームに分かれ、味方には当たらない。照準ぶれ・ゴム切れは敵のチームだけ', () => {
  const sim = new GomuSim({ humans: 2, bots: 2, seed: 9, mode: MODE.TEAM });
  run(sim, ROUND.INTRO + 0.1);
  const [a, b, c] = sim.s.players; // a, c は同じチーム（0）、b は敵（1）
  assert.equal(teamOf(MODE.TEAM, 0), teamOf(MODE.TEAM, 2));
  assert.notEqual(teamOf(MODE.TEAM, 0), teamOf(MODE.TEAM, 1));
  Object.assign(a, { x: -10, z: 0, y: 0 });
  Object.assign(c, { x: -2, z: 0, y: 0 });
  Object.assign(b, { x: -2, z: 3.5, y: 0 });
  for (const p of sim.s.players.slice(2)) p.bot = false; // CPU を止める
  sim.fire(0, eye(a), chestDir(a, c));
  run(sim, 0.6);
  assert.equal(c.hp, PLAYER.HP, '味方には当たらない（すり抜ける）');
  sim.fire(0, eye(a), chestDir(a, b));
  run(sim, 0.6);
  assert.ok(b.hp < PLAYER.HP, '敵には当たる');
  a.item = ITEM.NOAMMO;
  sim.useItem(0, eye(a), [1, 0, 0]);
  assert.ok(b.noAmmo > 0 && c.noAmmo === 0, 'ゴム切れは敵だけ');
  assert.equal(sim.remoteHit(0, 999, 2, [c.x, 0.5, c.z]), false);
});

test('ボス戦: 猫の体力は人数で変わる。犬どうしは当たらない。猫に当てると点。倒すとラウンドおわり', () => {
  const two = new GomuSim({ humans: 2, bots: 0, seed: 1, mode: MODE.BOSS });
  const five = new GomuSim({ humans: 2, bots: 3, seed: 1, mode: MODE.BOSS });
  assert.equal(two.s.boss.max, BOSS.HP_BASE + BOSS.HP_PER * 2);
  assert.equal(five.s.boss.max, BOSS.HP_BASE + BOSS.HP_PER * 5);
  const sim = two;
  run(sim, ROUND.INTRO + 0.1);
  const [a, b] = sim.s.players;
  const boss = sim.s.boss;
  Object.assign(boss, { x: 0, z: 10, y: 0, yaw: Math.PI, cd: 99, sd: 99 });
  Object.assign(a, { x: -4, z: -4, y: 0 });
  Object.assign(b, { x: 4, z: -4, y: 0 });
  sim.fire(0, eye(a), chestDir(a, b));
  run(sim, 0.6);
  assert.equal(b.hp, PLAYER.HP, '犬どうしは当たらない');
  // 猫を撃つ
  sim.drainEvents();
  Object.assign(boss, { x: 0, z: 6, cd: 99, sd: 99 });
  const to = [boss.x - a.x, BOSS.HEIGHT * 0.5 - PLAYER.EYE, boss.z - a.z];
  const tl = Math.hypot(...to);
  sim.fire(0, eye(a), to.map((v) => v / tl));
  run(sim, 0.4);
  assert.equal(boss.hp, boss.max - 14, '近いので 14');
  assert.equal(a.score, 1, 'ダメージ 10 ごとに 1 点');
  assert.ok(sim.drainEvents().some((e) => e.t === 'bhit' && e.by === 0));
  // とどめ
  boss.hp = 1;
  sim.fire(0, eye(a), to.map((v) => v / tl));
  run(sim, 0.4);
  assert.equal(boss.hp, 0);
  assert.equal(sim.s.phase, 'end');
  assert.equal(sim.s.bossWon[0], true);
  assert.equal(a.kills, 1);
});

test('ボス戦: 猫は近づいてひっかく（前ぶりのあと）。とびかかって着地で当たる。ガムを踏むと止まる', () => {
  const sim = new GomuSim({ humans: 1, bots: 0, seed: 2, mode: MODE.BOSS });
  run(sim, ROUND.INTRO + 0.1);
  const a = sim.s.players[0];
  const boss = sim.s.boss;
  Object.assign(a, { x: 0, z: -9, y: 0 });
  Object.assign(boss, { x: 0, z: -6, yaw: Math.PI, cd: 99, sd: 99, st: 'walk' });
  run(sim, 0.2);
  assert.equal(boss.st, 'wind', '近いので前ぶり');
  assert.equal(a.hp, PLAYER.HP, '前ぶりの間はまだ当たらない');
  run(sim, BOSS.SWIPE_WIND + 0.1);
  assert.equal(a.hp, PLAYER.HP - BOSS.SWIPE_DMG, 'ひっかかれた');
  // とびかかり
  run(sim, PLAYER.INVINCIBLE + 1);
  Object.assign(a, { x: 10, z: 8, y: 0, inv: 0, hp: PLAYER.HP, dead: 0 });
  Object.assign(boss, { x: -6, z: 8, yaw: Math.PI / 2, cd: 0, sd: 99, st: 'walk', t: 0 });
  run(sim, 0.1);
  assert.equal(boss.st, 'crouch');
  run(sim, BOSS.POUNCE_WIND + BOSS.POUNCE_TIME + 0.1);
  assert.ok(Math.hypot(boss.x - a.x, boss.z - a.z) < 1, '相手の所に着地');
  assert.equal(a.hp, PLAYER.HP - BOSS.POUNCE_DMG);
  // ガム
  boss.st = 'walk';
  sim.s.gums.push({ id: 999, o: 0, x: boss.x, y: 0, z: boss.z, age: 0 });
  sim.step(DT);
  assert.ok(boss.stuck > 0, 'ガムで動けない');
});

test('配信のバイト列: 武器・選んだか・猫の位置と体力・倒せたラウンドも戻る', () => {
  const sim = new GomuSim({ humans: 2, bots: 1, seed: 3, mode: MODE.BOSS, pick: true });
  sim.pickWeapon(1, WEAPON.SNIPER);
  sim.s.boss.x = 3.25;
  sim.s.boss.hp = 77;
  sim.s.bossWon = [true];
  const d = unpackBin(packBin(sim.s, true, null), 3);
  assert.equal(d.st.phase, 'pick');
  assert.equal(d.st.players[1].weapon, WEAPON.SNIPER);
  assert.equal(d.st.players[1].picked, true);
  assert.equal(d.st.players[0].picked, false);
  assert.ok(Math.abs(d.st.boss.x - 3.25) < 0.002);
  assert.equal(d.st.boss.hp, 77);
  assert.equal(d.st.boss.max, sim.s.boss.max);
  assert.deepEqual(d.st.bossWon, [true, false, false]);
});

test('体力: 生きている間は 1 秒に 1 ずつ回復する（100 まで）', () => {
  PLAYER.REGEN = REGEN;
  try {
    const sim = ready();
    const [a] = sim.s.players;
    a.hp = 50;
    run(sim, 3.02);
    assert.equal(a.hp, 53);
    a.hp = PLAYER.HP - 1;
    run(sim, 5);
    assert.equal(a.hp, PLAYER.HP);
  } finally {
    PLAYER.REGEN = 0;
  }
});

test('爆弾: 全員が 1 ラウンドに 5 回まで投げられる。山なりに投げて、当たると爆発。まわりの相手にまとめて、中心に近いほど大きなダメージ。ホストが爆発させる', async () => {
  const { lobPitch } = await import('../src/games/gomuBattle/bot.js');
  const sim = new GomuSim({ humans: 3, bots: 0, seed: 11 });
  run(sim, ROUND.INTRO + 0.1);
  sim.clientJudge = () => true; // ゲストの爆弾でもホストが当たりを決める
  const [a, b, c] = sim.s.players;
  assert.equal(a.bombs, 5);
  assert.equal(a.weapon, WEAPON.NORMAL, '武器はそのまま（爆弾は別に持っている）');
  Object.assign(a, { x: -8, z: 2, y: 0 });
  Object.assign(b, { x: 2, z: 2, y: 0 });
  Object.assign(c, { x: 2, z: 4.2, y: 0 }); // b の近く（巻きこまれる）
  sim.drainEvents();
  const W = WEAPONS[WEAPON.BOMB];
  const e = eye(a);
  const pitch = lobPitch(W.speed, W.gravity, b.x - a.x, 0.3 - e[1]);
  assert.ok(pitch != null && pitch > 0.05, '山なり');
  assert.ok(sim.throwBomb(0, e, aimDir(Math.PI / 2, pitch), 3));
  assert.equal(sim.s.bands[0].cj, false, '爆弾は投げた人の端末では当てない');
  assert.equal(sim.s.bands[0].cid, 12, '投げた人の端末の番号（自分の画面の爆弾と結びつける）');
  assert.equal(sim.throwBomb(0, e, [1, 0, 0]), false, '続けては投げられない');
  run(sim, 1.5);
  const ev = sim.drainEvents();
  const boom = ev.find((x) => x.t === 'boom');
  assert.ok(boom, '爆発した');
  assert.ok(b.hp < PLAYER.HP && c.hp < PLAYER.HP, '2 匹とも巻きこまれる');
  assert.ok(PLAYER.HP - b.hp > PLAYER.HP - c.hp, '中心に近い方が痛い');
  assert.equal(a.hp, PLAYER.HP, '自分は巻きこまれない');
  assert.ok(ev.some((x) => x.t === 'hit' && x.by === 0 && x.bm === 1), '爆弾の当たりの印（ゲストの画面で当たりを出すため）');
  for (let k = 1; k < 5; k++) {
    assert.ok(sim.throwBomb(0, e, [0, 0.6, 0.8]));
    run(sim, W.gap + 0.05);
  }
  assert.equal(a.bombs, 0);
  assert.equal(sim.throwBomb(0, e, [0, 0.6, 0.8]), false, '5 回で終わり');
  // 倒れて復活しても増えない。次のラウンドで 5 に戻る
  sim.s.t = ROUND.TIME;
  run(sim, ROUND.END + ROUND.INTRO + 0.2);
  assert.equal(sim.s.round, 1);
  assert.equal(a.bombs, 5);
});

test('チーム分け: 準備画面で組んだとおりに分かれる（人は席、CPU は番号）。片方が空なら交互', async () => {
  const { teamList, autoTeamBits, TEAM_CPU_BIT } = await import('../src/games/gomuBattle/constants.js');
  // 人 = 席 0・2、CPU 3 匹。自動は交互
  assert.deepEqual(teamList(MODE.TEAM, -1, [0, 2], 3), [0, 1, 0, 1, 0]);
  assert.deepEqual(teamList(MODE.TEAM, autoTeamBits([0, 2], 3), [0, 2], 3), [0, 1, 0, 1, 0], '自動のビットは交互と同じ');
  // 人 2 人をあおに、CPU はみんなあか
  const bits = (1 << 0) | (1 << 2);
  assert.deepEqual(teamList(MODE.TEAM, bits, [0, 2], 3), [1, 1, 0, 0, 0]);
  // CPU 2 匹目だけあお
  assert.deepEqual(teamList(MODE.TEAM, 1 << (TEAM_CPU_BIT + 1), [0], 3), [0, 0, 1, 0]);
  // 全員あお → 交互にもどす
  assert.deepEqual(teamList(MODE.TEAM, 0b1111111111, [0, 1], 2), [0, 1, 0, 1]);
  assert.deepEqual(teamList(MODE.FFA, bits, [0, 2], 1), [-1, -1, -1]);
  // 計算: 組んだとおりに味方・敵が決まる
  const sim = new GomuSim({ humans: 2, bots: 2, seed: 9, mode: MODE.TEAM, teams: [1, 1, 0, 0] });
  assert.equal(sim.foes(0, 1), false, '人 2 人は味方');
  assert.equal(sim.foes(2, 3), false, 'CPU 2 匹は味方');
  assert.equal(sim.foes(0, 2), true);
});

test('当たり判定は見た目に合わせる: テントの三角の外・車のボンネットの上は通り抜け、真ん中には当たる', async () => {
  const { segmentHit } = await import('../src/games/gomuBattle/arena.js');
  const camp = ARENAS[2];
  const tent = camp.draw.find((b) => b.k === 'tent');
  const car = camp.draw.find((b) => b.k === 'car');
  const cw = { boxes: camp.boxes };
  const tcx = (tent.x0 + tent.x1) / 2;
  const tcz = (tent.z0 + tent.z1) / 2;
  const tw = tent.x1 - tent.x0;
  const th = tent.y1 - tent.y0;
  // 三角の上のすみ（はしの近くの高い所）を奥行き方向に横切る → 当たらない
  const y = th * 0.8;
  const x = tcx + tw * 0.4;
  assert.equal(segmentHit(cw, x, y, tent.z0 - 2, x, y, tent.z1 + 2), 1, 'テントの斜めの外は通り抜ける');
  // 真ん中の低い所 → 当たる
  assert.ok(segmentHit(cw, tcx, th * 0.3, tent.z0 - 2, tcx, th * 0.3, tent.z1 + 2) < 1, 'テントの真ん中には当たる');
  // 車: ボンネットの上（前のはしの、屋根より低くない高さ）を横切る → 当たらない。屋根の高さの真ん中 → 当たる
  const ch = car.y1 - car.y0;
  const ccz = (car.z0 + car.z1) / 2;
  const fx = car.x1 - (car.x1 - car.x0) * 0.08;
  assert.equal(segmentHit(cw, fx, ch * 0.8, car.z0 - 2, fx, ch * 0.8, car.z1 + 2), 1, 'ボンネットの上は通り抜ける');
  const mx = (car.x0 + car.x1) / 2;
  assert.ok(segmentHit(cw, mx, ch * 0.8, ccz - 3, mx, ch * 0.8, ccz + 3) < 1, '屋根には当たる');
  // 見た目の箱は元のまま（テント・車は 1 つずつ）
  assert.equal(camp.draw.filter((b) => b.k === 'tent').length, 3);
  assert.ok(camp.boxes.filter((b) => b.k === 'tent').length >= 15, '当たり判定は細かい箱の組');
});

test('ライフル: 1 発だけ。どんな距離でも当たれば一撃で倒す。補充はスナイパーより長い。武器の選択は 3 つ（爆弾は選べない）', () => {
  const sim = ready();
  const [a, b] = sim.s.players;
  assert.ok(WEAPONS[WEAPON.RIFLE].reload > WEAPONS[WEAPON.SNIPER].reload);
  assert.equal(WEAPONS[WEAPON.RIFLE].ammo, 1);
  a.weapon = WEAPON.RIFLE;
  a.ammo = 1;
  Object.assign(a, { x: -28, z: 1, y: 0 }); // 公園の z = 1 の通りは端から端まで何もない
  Object.assign(b, { x: 28, z: 1, y: 0 });
  assert.ok(sim.tryFire(a, eye(a), [1, 0, 0]));
  assert.ok(a.reload > 0, '1 発で補充');
  assert.equal(sim.tryFire(a, eye(a), [1, 0, 0]), false);
  run(sim, 1);
  assert.ok(b.dead > 0, `56 離れていても一撃 (${b.hp})`);
  run(sim, WEAPONS[WEAPON.RIFLE].reload);
  assert.equal(a.ammo, 1, '補充は 1 発だけ');
  // 選べる武器
  const s2 = new GomuSim({ humans: 1, bots: 0, seed: 2, pick: true });
  assert.equal(s2.pickWeapon(0, WEAPON.BOMB), false, '爆弾は武器として選べない');
  assert.equal(s2.pickWeapon(0, WEAPON.RIFLE), true);
});

test('配信: ホストのチームと残りの爆弾が載る（ゲストはホストのチームに合わせる）', () => {
  const sim = new GomuSim({ humans: 2, bots: 3, seed: 4, mode: MODE.TEAM, teams: [1, 1, 0, 0, 1] });
  run(sim, ROUND.INTRO + 0.1);
  sim.s.players[2].bombs = 3;
  const d = unpackBin(packBin(sim.s), 5);
  assert.deepEqual(d.st.players.map((p) => p.team), [1, 1, 0, 0, 1]);
  assert.equal(d.st.players[2].bombs, 3);
  assert.equal(d.st.players[0].bombs, 5);
});

test('ヘッドショット: 頭（体の上の方）に当たると、スナイパーは 80（体力の 8 割）、輪ゴム鉄砲は 15% 多い。印つきで配る', () => {
  const sim = ready();
  const [a, b] = sim.s.players;
  Object.assign(a, { x: -4, z: 1, y: 0 });
  Object.assign(b, { x: 4, z: 1, y: 0 });
  const head = (q) => [q.x - a.x, q.y + heightOf(q) * 0.9 - eye(a)[1], q.z - a.z];
  const norm = (v) => v.map((x) => x / Math.hypot(...v));
  // 輪ゴム鉄砲で頭: 14 × 1.15 = 16
  assert.ok(sim.fire(0, eye(a), norm(head(b))));
  run(sim, 0.4);
  assert.equal(b.hp, PLAYER.HP - Math.round(14 * 1.15));
  const ev = sim.drainEvents().find((e) => e.t === 'hit');
  assert.equal(ev.hs, 1, 'ヘッドショットの印');
  // 胸なら 14（印なし）
  b.hp = PLAYER.HP;
  sim.fire(0, eye(a), norm([b.x - a.x, b.y + 0.4 - eye(a)[1], 0]));
  run(sim, 0.4);
  assert.equal(b.hp, PLAYER.HP - 14);
  assert.equal(sim.drainEvents().find((e) => e.t === 'hit').hs, undefined);
  // スナイパーで頭: 80
  b.hp = PLAYER.HP;
  a.weapon = WEAPON.SNIPER;
  sim.fire(0, eye(a), norm(head(b)));
  run(sim, 0.4);
  assert.equal(b.hp, PLAYER.HP - 80);
});

test('回復のおやつ: 会場に落ちていて、体力が減った犬が拾うと 40 回復。しばらくしてまた出る。箱からは回復が出ない', async () => {
  const { TREAT, BOX_ITEMS } = await import('../src/games/gomuBattle/constants.js');
  assert.ok(!BOX_ITEMS.includes(ITEM.HEAL));
  for (const ar of ARENAS) assert.equal(ar.heals.length, TREAT.COUNT, `${ar.id} におやつ 8 つ`);
  const sim = ready();
  const [a] = sim.s.players;
  const [hx, hz] = sim.arena.heals[0];
  // 満タンなら拾わない
  Object.assign(a, { x: hx, z: hz, y: 0 });
  run(sim, 0.1);
  assert.equal(sim.s.heals[0], 0, '満タンのときは拾わない');
  a.hp = 30;
  run(sim, 0.1);
  assert.equal(a.hp, 30 + TREAT.HEAL);
  assert.ok(sim.s.heals[0] > 0, '拾ったら消える');
  assert.ok(sim.drainEvents().some((e) => e.t === 'heal' && e.i === 0 && e.k === 0));
  Object.assign(a, { x: hx + 6, z: hz }); // 離れる（立ったままだと、また出た瞬間に拾う）
  run(sim, TREAT.RESPAWN + 0.2);
  assert.equal(sim.s.heals[0], 0, 'また出る');
  const d = unpackBin(packBin(sim.s), 2);
  assert.equal(d.st.heals & 1, 1, '配信に載る');
});

test('お楽しみ: ラストスパート（残り 30 秒は点が 2 倍）・連続撃破・リベンジ', async () => {
  const { FUN } = await import('../src/games/gomuBattle/constants.js');
  const sim = new GomuSim({ humans: 2, bots: 2, seed: 5 });
  run(sim, ROUND.INTRO + 0.1);
  const [a, b, c, d] = sim.s.players;
  for (const p of [c, d]) p.bot = false;
  sim.drainEvents();
  const kill = (by, v) => sim._hit(v, { o: by.i, dmg: 999, vx: 1, vz: 0 });
  // 連続撃破: 3 匹目で +2
  kill(a, b);
  b.dead = 0; b.hp = PLAYER.HP; b.inv = 0;
  kill(a, c);
  const s2 = a.score;
  kill(a, d);
  const ev = sim.drainEvents();
  assert.ok(ev.some((e) => e.t === 'streak' && e.i === 0 && e.n === 3));
  assert.ok(a.score - s2 >= SCORE.KILL + FUN.STREAK_BONUS[3]);
  // リベンジ: b を倒したのは a。b が a を倒すと +3
  assert.equal(b.nemesis, 0);
  const sb = b.score;
  kill(b, a);
  assert.ok(sim.drainEvents().some((e) => e.t === 'revenge' && e.i === 1 && e.v === 0));
  assert.ok(b.score - sb >= SCORE.KILL + FUN.REVENGE_BONUS);
  assert.equal(a.streak, 0, '倒されたら連続はおしまい');
  // ラストスパート: 残り 30 秒からは 2 倍
  sim.s.t = ROUND.TIME - FUN.SPURT + 0.5;
  run(sim, 0.05);
  assert.ok(sim.drainEvents().some((e) => e.t === 'spurt'));
  const s0 = c.score;
  sim._addScore(c, 3);
  assert.equal(c.score - s0, 6);
});

test('お楽しみ: トランポリンで跳ねる・走りながら伏せるとスライディング', async () => {
  const { FUN } = await import('../src/games/gomuBattle/constants.js');
  const a = ARENAS[0];
  const t = a.tramps[0];
  const m = createBody((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2 - 3, 0);
  let bounced = false;
  let top = 0;
  for (let i = 0; i < 120; i++) {
    const r = stepMove(m, { fz: i < 40 ? 1 : 0 }, DT, a);
    bounced ||= !!r.bounced;
    top = Math.max(top, m.y);
  }
  assert.ok(bounced, 'トランポリンに乗ると跳ねる');
  assert.ok(top > 3, `高く跳ねる (${top.toFixed(2)})`);
  // スライディング
  const s = createBody(0, 20, Math.PI / 2);
  const open = { boxes: [] };
  for (let i = 0; i < 20; i++) stepMove(s, { fz: 1, dash: true }, DT, open);
  const st0 = s.stam;
  const r = stepMove(s, { fz: 1, dash: true, crouch: true }, DT, open);
  assert.equal(r.slid, true);
  assert.ok(s.crouch, '低い姿勢');
  assert.ok(Math.hypot(s.vx, s.vz) > PLAYER.SPRINT_SPEED, '走るより速く滑る');
  assert.ok(st0 - s.stam >= FUN.SLIDE_STAM - 1, 'ゲージを使う');
});

test('お楽しみ: 補給箱が空から落ちてきて、取ると金の輪ゴム（ダメージ 2 倍）。突風で輪ゴムが流される。遠吠え', async () => {
  const { FUN } = await import('../src/games/gomuBattle/constants.js');
  const sim = ready();
  const [a, b] = sim.s.players;
  sim.s.t = FUN.DROP_FIRST;
  run(sim, 0.05);
  const dp = sim.s.drop;
  assert.ok(dp && dp.y > 20, '空の高い所に出る');
  assert.ok(sim.drainEvents().some((e) => e.t === 'drop'));
  // 配信に載る
  let d = unpackBin(packBin(sim.s), 2);
  assert.ok(Math.abs(d.st.drop.x - dp.x) < 0.01 && d.st.drop.y > 20);
  run(sim, FUN.DROP_HEIGHT / FUN.DROP_FALL + 0.5);
  assert.equal(sim.s.drop.y, 0, '地面に着く');
  Object.assign(a, { x: dp.x, z: dp.z, y: 0 });
  run(sim, 0.1);
  assert.equal(sim.s.drop, null, '取った');
  assert.equal(a.sp, ITEM.GOLD);
  assert.equal(a.spN, FUN.GOLD_SHOTS);
  assert.ok(sim.drainEvents().some((e) => e.t === 'dropget' && e.i === 0));
  // 金の輪ゴム: 近くから 14 × 2 = 28
  Object.assign(a, { x: -4, z: 1, y: 0 });
  Object.assign(b, { x: 4, z: 1, y: 0, hp: PLAYER.HP, inv: 0 });
  sim.fire(0, eye(a), chestDir(a, b), ITEM.GOLD);
  run(sim, 0.4);
  assert.equal(b.hp, PLAYER.HP - 28);
  // 突風
  sim.s.nextWind = sim.s.t;
  run(sim, 0.05);
  const w = sim.s.wind;
  assert.ok(w.t > 0 && Math.hypot(w.x, w.z) > 1, '風が吹く');
  sim.s.bands = [];
  b.dead = 0;
  sim.fire(1, eye(b), [0, 0.99, 0.14]); // 上へ（何にも当たらない）
  const band = sim.s.bands[0];
  const v0 = [band.vx, band.vz];
  run(sim, 0.5);
  if (sim.s.bands[0] === band) assert.ok(Math.hypot(band.vx - v0[0], band.vz - v0[1]) > 1, '横に流される');
  d = unpackBin(packBin(sim.s), 2);
  assert.ok(Math.abs(d.st.wind.x - w.x) < 0.11 && d.st.wind.t > 0, '突風も配信に載る');
  // 遠吠え（続けては吠えられない）
  sim.drainEvents();
  assert.equal(sim.bark(0), true);
  assert.equal(sim.bark(0), false);
  assert.ok(sim.drainEvents().some((e) => e.t === 'bark' && e.i === 0));
});

test('追加: 風船の的（割ると +1、ときどきアイテム）・おとり人形（輪ゴムを受け止める・CPU が狙う）・雨・水で遅くなる', async () => {
  const { EXTRA } = await import('../src/games/gomuBattle/constants.js');
  const { botThink } = await import('../src/games/gomuBattle/bot.js');
  const sim = ready();
  const [a, b] = sim.s.players;
  // 風船: 真下から撃ち上げる
  const [bx, bz, by] = sim.arena.balloons[0];
  Object.assign(a, { x: bx + 3, z: bz, y: 0 });
  const o = eye(a);
  const d = [bx - o[0], by - o[1], bz - o[2]];
  const l = Math.hypot(...d);
  sim.drainEvents();
  sim.fire(0, o, d.map((v) => v / l));
  run(sim, 0.3);
  assert.ok(sim.s.balloons[0] > 0, '割れた');
  assert.equal(a.pops, 1);
  assert.ok(sim.drainEvents().some((e) => e.t === 'pop' && e.i === 0 && e.k === 0));
  let u = unpackBin(packBin(sim.s), 2);
  assert.equal(u.st.balloons & 1, 0, '割れた風船は配信で消える');
  // おとり人形: b が置き、a の輪ゴムを受け止める
  Object.assign(a, { x: -4, z: 1, y: 0 });
  Object.assign(b, { x: 4, z: 1, y: 0, hp: PLAYER.HP, item: ITEM.DECOY });
  assert.ok(sim.useItem(1, eye(b), [1, 0, 0]));
  assert.equal(sim.s.decoys.length, 1);
  Object.assign(b, { x: 4, z: 6 }); // 本物は横へ
  sim.fire(0, eye(a), chestDir(a, sim.s.decoys[0]));
  run(sim, 0.4);
  assert.equal(b.hp, PLAYER.HP, '本物には当たらない');
  assert.ok(sim.s.decoys[0].hp < EXTRA.DECOY_HP, '人形が受け止めた');
  u = unpackBin(packBin(sim.s), 2);
  assert.equal(u.st.decoys.length, 1, '配信に載る');
  // CPU は人形を狙う
  const c = new GomuSim({ humans: 1, bots: 1, seed: 2 });
  run(c, ROUND.INTRO + 0.1);
  const [h, bot] = c.s.players;
  Object.assign(h, { x: 30, z: 20, y: 0 });
  Object.assign(bot, { x: 0, z: 1, y: 0, yaw: Math.PI / 2 });
  c.s.decoys.push({ id: 99, o: 0, x: 6, y: 0, z: 1, yaw: 0, hp: 40, t: 10 });
  bot.bot2 = null; // 考え直させる（相手を探すのは 0.12 秒ごと）
  botThink(c, bot, 1 / 60);
  assert.equal(bot.bot2.tgt, -3, 'おとりに引っかかる');
  // 雨
  sim.s.nextRain = sim.s.t;
  run(sim, 0.05);
  assert.ok(sim.s.rain > 0);
  assert.ok(sim.drainEvents().some((e) => e.t === 'rain'));
  assert.ok(unpackBin(packBin(sim.s), 2).st.rain > 0);
  // 水の中は遅い（砂浜の海）
  const beach = ARENAS[1];
  const w = beach.water[0];
  const cw = { boxes: [], water: beach.water };
  const m = createBody(0, (w.z0 + w.z1) / 2, Math.PI / 2);
  for (let i = 0; i < 60; i++) stepMove(m, { fz: 1 }, DT, cw);
  assert.ok(m.inWater);
  assert.ok(Math.abs(Math.hypot(m.vx, m.vz) - PLAYER.SPEED * EXTRA.WATER_SLOW) < 1e-6);
});

test('追加: チーム戦は味方の近くで復活する', () => {
  const sim = new GomuSim({ humans: 2, bots: 2, seed: 8, mode: MODE.TEAM, teams: [0, 0, 1, 1] });
  run(sim, ROUND.INTRO + 0.1);
  const [a, ally, e1, e2] = sim.s.players;
  for (const p of [e1, e2]) p.bot = false;
  const sp = sim.arena.spawns;
  Object.assign(ally, { x: sp[0][0], z: sp[0][1] });
  Object.assign(e1, { x: -sp[0][0], z: -sp[0][1] });
  Object.assign(e2, { x: -sp[0][0] + 2, z: -sp[0][1] });
  sim._respawn(a);
  const dAlly = Math.hypot(a.x - ally.x, a.z - ally.z);
  const dFoe = Math.min(Math.hypot(a.x - e1.x, a.z - e1.z), Math.hypot(a.x - e2.x, a.z - e2.z));
  assert.ok(dAlly < dFoe, `味方の方が近い (味方 ${dAlly.toFixed(1)} / 敵 ${dFoe.toFixed(1)})`);
});

import { deltaEncode, deltaDecode } from '../src/core/netcodec.js';

test('配信のバイト列は、前の配信との差分（共通の差分の配信）にすると小さくなり、元に戻せる', () => {
  const sim = new GomuSim({ humans: 2, bots: 5, seed: 3 });
  run(sim, ROUND.INTRO + 10);
  let prev = packBin(sim.s, true, null);
  let raw = 0;
  let small = 0;
  for (let k = 0; k < 80; k++) {
    for (let j = 0; j < 2; j++) sim.step(1 / 60); // 毎秒 30 回くらいの間隔
    const cur = packBin(sim.s, true, null);
    const d = deltaEncode(prev, cur);
    assert.deepEqual([...deltaDecode(prev, d)], [...cur]);
    raw += cur.length;
    small += d.length;
    prev = cur;
  }
  assert.ok(small < raw * 0.6, `差分 ${small} / そのまま ${raw}`);
});
