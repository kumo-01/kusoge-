// 追加アイテム: 2枚フリスビー・横一列バナナ・2個犬小屋・倒木
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/games/dogKart/track.js';
import { RaceSim, packNetBin, unpackNetBin, packNet, unpackNet, NetBinEncoder } from '../src/games/dogKart/race.js';
import { itemWeights, chooseItem, ITEM_INFO } from '../src/games/dogKart/items.js';
import { IN, ITEMS, KART } from '../src/games/dogKart/constants.js';

const DT = 1 / 60;
const track = new Track();
function race() {
  const sim = new RaceSim(track, { players: [0, 1], npcs: 0 });
  while (sim.s.phase === 'countdown') sim.step(DT, [0, 0]);
  for (let i = 0; i < 60; i++) sim.step(DT, [IN.UP, IN.UP]);
  sim.drainEvents();
  return sim;
}
const use = (sim, i) => {
  const inp = [0, 0];
  inp[i] = IN.ITEM;
  sim.step(DT, inp);
};

test('2枚フリスビー・2個犬小屋: 1 回使うと、普通のものが 1 つ残る。2 回目で無くなる', () => {
  const sim = race();
  const k = sim.s.karts[0];
  k.item = ITEMS.FRISBEE2;
  use(sim, 0);
  assert.equal(sim.s.proj.filter((p) => p.f).length, 1, '1 枚目が飛ぶ');
  assert.equal(k.item, ITEMS.FRISBEE, '1 枚残る');
  use(sim, 0);
  assert.equal(sim.s.proj.filter((p) => p.f).length, 2, '2 枚目も飛ぶ');
  assert.equal(k.item, 0);
  // 犬小屋: 1 位を狙うので、後ろの車が使う
  const back = sim.prog[0] < sim.prog[1] ? 0 : 1;
  sim.s.karts[back].item = ITEMS.HOUSE2;
  use(sim, back);
  assert.equal(sim.s.houses.length, 1);
  assert.equal(sim.s.karts[back].item, ITEMS.HOUSE);
  use(sim, back);
  assert.equal(sim.s.houses.length, 2);
  assert.equal(sim.s.karts[back].item, 0);
  assert.ok(ITEM_INFO[ITEMS.FRISBEE2] && ITEM_INFO[ITEMS.HOUSE2] && ITEM_INFO[ITEMS.BANANA_ROW] && ITEM_INFO[ITEMS.LOG]);
});

test('横一列バナナ: 自分の後ろに、道幅いっぱいに 7 本（すき間なし）', () => {
  const sim = race();
  const k = sim.s.karts[0];
  k.item = ITEMS.BANANA_ROW;
  const p = { ...track.project(k.x, k.z) }; // project は結果の入れ物を使い回すので写しておく
  use(sim, 0);
  const row = sim.s.bananas;
  assert.equal(row.length, ITEMS.BANANA_ROW_N);
  const q = row.map((b) => ({ ...track.project(b.x, b.z) }));
  for (const x of q) assert.ok(Math.abs(track.wrapDS(x.s - p.s) + ITEMS.BANANA_ROW_BACK) < 1.5, '少し後ろ');
  const lats = q.map((x) => x.lat).sort((a, b) => a - b);
  assert.ok(lats[0] < -track.roadHalf + 1.5 && lats[lats.length - 1] > track.roadHalf - 1.5, '道幅いっぱい');
  for (let i = 1; i < lats.length; i++) assert.ok(lats[i] - lats[i - 1] <= 2 * ITEMS.BANANA_HIT_R + 0.01, 'すき間なし');
});

test('倒木: 後ろに壁ができてレースの最後まで残る。ふさいだ側は通れず、反対側は通れる', () => {
  const sim = race();
  const k = sim.s.karts[0];
  k.item = ITEMS.LOG;
  use(sim, 0);
  assert.equal(sim.s.logs.length, 1);
  const lg = sim.s.logs[0];
  assert.ok(sim.drainEvents().some((e) => e.t === 'log'));
  assert.ok(Math.abs(lg.b - lg.a - 2 * track.wallDist * ITEMS.LOG_COVER) < 0.01, '道幅の 6 割');
  assert.ok(Math.abs(lg.a) === track.wallDist || Math.abs(lg.b) === track.wallDist, '片側の壁から');
  // 1 分たっても残る
  for (let i = 0; i < 60 * 60; i++) sim.step(DT, [0, 0]);
  assert.equal(sim.s.logs.length, 1);
  // ふさいだ側から突っ込むと止められる / 反対側は通れる
  const drive = (lat) => {
    const t = new Track();
    const s2 = new RaceSim(t, { players: [0, 1], npcs: 0 });
    while (s2.s.phase === 'countdown') s2.step(DT, [0, 0]);
    s2.s.logs.push({ ...lg });
    t.logs = s2.s.logs;
    const c = s2.s.karts[0];
    const start = t.pointAt(lg.s - 30, lat);
    const ahead = t.pointAt(lg.s - 29, lat);
    Object.assign(c, { x: start.x, z: start.z, h: Math.atan2(ahead.x - start.x, ahead.z - start.z), sp: 25 });
    s2.s.karts[1].x = 9999;
    let passed = false;
    for (let i = 0; i < 60 * 4; i++) {
      // まっすぐコースに沿って走る
      const q = t.project(c.x, c.z);
      const tgt = t.pointAt(q.s + 12, lat);
      let d = Math.atan2(tgt.x - c.x, tgt.z - c.z) - c.h;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      s2.step(DT, [IN.UP | (d > 0.05 ? IN.LEFT : d < -0.05 ? IN.RIGHT : 0), 0]);
      if (t.wrapDS(t.project(c.x, c.z).s - lg.s) > 5) passed = true;
    }
    return passed;
  };
  const mid = (lg.a + lg.b) / 2;
  const open = lg.a <= -track.roadHalf ? (lg.b + track.roadHalf) / 2 : (lg.a - track.roadHalf) / 2;
  assert.equal(drive(mid), false, 'ふさがれた側は通れない');
  assert.equal(drive(open), true, '反対側は通れる');
});

test('倒木の数には上限があり、上限になるとアイテムに出ない。最下位には横一列バナナ・倒木は出ない', () => {
  const s = { rng: 7, logs: Array.from({ length: ITEMS.LOG_MAX }, (_, i) => ({ id: i })) };
  for (let i = 0; i < 2000; i++) assert.notEqual(chooseItem(s, 1, 6), ITEMS.LOG);
  const w = itemWeights(6, 6);
  assert.equal(w[ITEMS.LOG], 0);
  assert.equal(w[ITEMS.BANANA_ROW], 0);
  assert.equal(itemWeights(1, 6)[ITEMS.FRISBEE2], 0, '1 位にはフリスビーは出ない');
  assert.ok(itemWeights(1, 6)[ITEMS.LOG] > itemWeights(5, 6)[ITEMS.LOG], '倒木は前の順位ほど出やすい');
  assert.ok(itemWeights(6, 6)[ITEMS.HOUSE2] > itemWeights(2, 6)[ITEMS.HOUSE2], '2個犬小屋は後ろほど出やすい');
});

test('倒木は配信（バイナリ・JSON・完全な状態）でそろい、載っていない配信では前の値を使う', () => {
  const sim = race();
  sim.s.karts[0].item = ITEMS.LOG;
  use(sim, 0);
  const lg = sim.s.logs[0];
  const close = (a, b) => ['a', 'b', 'x1', 'z1', 'x2', 'z2'].every((f) => Math.abs(a[f] - b[f]) < 0.011) && a.id === b.id;
  const bin = unpackNetBin(packNetBin(sim.s, [])).snap;
  assert.ok(close(bin.logs[0], lg));
  const js = unpackNet(JSON.parse(JSON.stringify(packNet(sim.s))));
  assert.ok(close(js.logs[0], lg));
  const client = new RaceSim(new Track(), { players: [0, 1], npcs: 0 });
  client.loadSnapshot(sim.getSnapshot());
  assert.ok(close(client.s.logs[0], lg));
  assert.equal(client.track.logs, client.s.logs, '当たり判定にも使われる');
  // 変わっていなければ、しばらくすると載らなくなる（受け取る側は前の値を使う）
  const enc = new NetBinEncoder();
  let last;
  for (let i = 0; i < 20; i++) last = enc.encode(sim.s, []);
  const withMem = unpackNetBin(last, { tick: sim.s.tick, logs: [{ ...lg }] }).snap;
  assert.ok(close(withMem.logs[0], lg));
  assert.ok(last.length < packNetBin(sim.s, []).length);
});

test('倒木: 近くにもう 1 本置くときは同じ側に倒れる（道がふさがらない）', () => {
  for (let trial = 0; trial < 20; trial++) {
    const sim = race();
    sim.s.rng = trial * 7919 + 1;
    const k = sim.s.karts[0];
    k.item = ITEMS.LOG;
    use(sim, 0);
    k.item = ITEMS.LOG;
    use(sim, 0);
    const [a, b] = sim.s.logs;
    assert.equal(sim.s.logs.length, 2);
    assert.equal(Math.sign(a.a + a.b), Math.sign(b.a + b.b), '同じ側');
  }
});
