// いぬいぬゴム鉄砲バトル: 会場・動き・輪ゴム・体力と点数・アイテム・ラウンド
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GomuSim } from '../src/games/gomuBattle/sim.js';
import { ARENAS, ROOM, SCALE } from '../src/games/gomuBattle/arena.js';
import { createBody, stepMove, fits, aimDir, heightOf, movableBox, shoveMovables } from '../src/games/gomuBattle/physics.js';
import { ROUND, PLAYER, GUN, ITEM, ITEMS, SCORE } from '../src/games/gomuBattle/constants.js';

const DT = 1 / 60;
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
  assert.ok(Math.abs((ROOM.W * ROOM.D) / (52 * 40) - 1.5) < 0.01, '前の 1.5 倍の広さ');
  assert.equal(ROUND.TIME, 360);
  assert.equal(PLAYER.HP, 5);
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

test('動き: ダッシュは速く、使ったあとは待ち時間。壁は抜けない', () => {
  const a = ARENAS[2];
  const m = createBody(-6, 1, 0);
  m.yaw = Math.PI / 2;
  stepMove(m, { fz: 1, dash: true }, DT, a);
  assert.ok(Math.hypot(m.vx, m.vz) > PLAYER.SPEED * 1.8);
  assert.ok(m.dashCd > 0);
  const x0 = m.x;
  const r = stepMove(m, { fz: 1, dash: true }, DT, a);
  assert.equal(r.dashed, false, 'すぐにはもう一度ダッシュできない');
  assert.ok(m.x > x0);
  const w = createBody(20, 12, Math.PI / 2);
  for (let i = 0; i < 300; i++) stepMove(w, { fz: 1 }, DT, a);
  assert.ok(w.x <= ROOM.W / 2 - PLAYER.RADIUS + 1e-6 && w.x > 25, `壁を抜けない (${w.x})`);
});

test('撃つ: 当たると体力が減って点が入り、5 発で倒れて +3 点。3 秒で復活し、2 秒は無敵', () => {
  const sim = ready();
  const [a, b] = sim.s.players;
  Object.assign(a, { x: -4, z: 2, y: 0 });
  Object.assign(b, { x: 4, z: 2, y: 0 });
  face(a, b);
  for (let n = 0; n < PLAYER.HP; n++) {
    assert.ok(sim.fire(0, eye(a), chestDir(a, b)));
    run(sim, 0.6);
  }
  const ev = sim.drainEvents();
  assert.equal(ev.filter((e) => e.t === 'hit').length, PLAYER.HP);
  assert.equal(ev.filter((e) => e.t === 'kill').length, 1);
  assert.equal(a.score, SCORE.HIT * PLAYER.HP + SCORE.KILL);
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

test('アイテム: 極太は 2 ダメージ、跳ね返りは壁で跳ね返る、追いかけは曲がって当たる', () => {
  const sim = ready();
  const [a, b] = sim.s.players;
  Object.assign(a, { x: -4, z: 2, y: 0 });
  Object.assign(b, { x: 4, z: 2, y: 0 });
  a.sp = ITEM.THICK;
  a.spN = 5;
  sim.fire(0, eye(a), chestDir(a, b), ITEM.THICK);
  run(sim, 0.8);
  assert.equal(b.hp, PLAYER.HP - ITEMS.THICK_DAMAGE);
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

test('ラウンド: 6 分で 1 ラウンド、会場が変わって 3 ラウンドで終わる。点はラウンドごとにも数える', () => {
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
  run(sim, ROUND.INTRO + 60);
  for (const e of sim.drainEvents()) ev[e.t] = (ev[e.t] || 0) + 1;
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
  assert.equal(a.hp, PLAYER.HP - 1);
  assert.equal(b.score, 1);
  assert.equal(sim.remoteHit(1, key, 0, [a.x, 0.6, a.z]), false, '同じ輪ゴムは 1 回だけ');
  const ev = sim.drainEvents();
  assert.ok(ev.some((e) => e.t === 'hit' && e.v === 0 && e.by === 1));
  // ホスト自身・CPU の輪ゴムは、今までどおりホストが当てる
  sim.fire(0, eye(a), chestDir(a, b));
  run(sim, 0.8);
  assert.equal(b.hp, PLAYER.HP - 1);
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
  assert.ok(packBin(sim.s, false, null).length < 240, '7 匹で 240 バイト未満（煙・ガムの数で少し変わる）');
});

test('アイテム: 回復おやつは体力が 3 回復（5 まで）、無敵スターは 10 秒間 輪ゴムもガムも効かない', () => {
  const sim = ready();
  const [a, b] = sim.s.players;
  a.hp = 1;
  a.item = ITEM.HEAL;
  assert.ok(sim.useItem(0, eye(a), [1, 0, 0]));
  assert.equal(a.hp, 1 + ITEMS.HEAL);
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
  assert.equal(b.hp, PLAYER.HP - 1);
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

test('スナイパー: 速くまっすぐ飛んで 3 ダメージ。3 発で補充。連射は遅い', () => {
  const sim = ready();
  const [a, b] = sim.s.players;
  a.weapon = WEAPON.SNIPER;
  a.ammo = WEAPONS[WEAPON.SNIPER].ammo;
  Object.assign(a, { x: -25, z: -1, y: 0 });
  Object.assign(b, { x: 10, z: -1, y: 0 });
  const d = [b.x - a.x, 0, 0];
  const l = Math.hypot(...d);
  assert.ok(sim.tryFire(a, eye(a), [d[0] / l, 0, 0]));
  assert.equal(sim.tryFire(a, eye(a), [1, 0, 0]), false, 'すぐには次を撃てない');
  run(sim, 0.8); // 40 先まで 0.6 秒くらい
  assert.equal(b.hp, PLAYER.HP - WEAPONS[WEAPON.SNIPER].dmg, '35 離れていても 3 ダメージ');
  run(sim, 2);
  sim.tryFire(a, eye(a), [1, 0, 0]);
  run(sim, 1.1);
  sim.tryFire(a, eye(a), [1, 0, 0]);
  assert.equal(a.ammo, 0);
  assert.ok(a.reload > 0, '3 発で補充');
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
  assert.equal(b.hp, PLAYER.HP - 1, '敵には当たる');
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
  assert.equal(boss.hp, boss.max - 1);
  assert.equal(a.score, 1);
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
