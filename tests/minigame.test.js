// レース中のミニゲーム「リズムを真似しろ！」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/games/dogKart/track.js';
import { RaceSim, packNetBin, unpackNetBin, packNet, unpackNet, sanitizeSnapshot } from '../src/games/dogKart/race.js';
import { MG, mgScore, mgTimes, mgPhase, mgBoost, mgRanks, makePattern } from '../src/games/dogKart/minigame.js';
import { IN } from '../src/games/dogKart/constants.js';

const DT = 1 / 60;
const track = new Track();

test('採点: そのまま真似すると 100%、間隔がずれるほど・回数が違うと低い。最初の 1 回の時刻は関係ない', () => {
  const pat = [0, 0.5, 0.75, 1.25, 2, 2.5];
  assert.equal(mgScore(pat.map((b) => b + 3.7), pat), 100);
  assert.equal(mgScore(pat.map((b, i) => b + 1 + (i % 2 ? 0.02 : -0.02)), pat), 100);
  const a = mgScore(pat.map((b, i) => b + (i % 2 ? 0.07 : -0.07)), pat);
  const b = mgScore(pat.map((b, i) => b + (i % 2 ? 0.12 : -0.12)), pat);
  assert.ok(a > b && a < 100, `${a} ${b}`);
  assert.ok(mgScore(pat.slice(0, 3), pat) <= 50, '半分しか押さない');
  assert.ok(mgScore([...pat, 0.25, 1.0, 1.6, 2.2], pat) < 70, '押しすぎ');
  assert.equal(mgScore([], pat), 0);
  // 一定の間隔で連打しても、お手本のリズムでなければ低い
  assert.ok(mgScore([0, 1, 1.25, 1.5, 2.25, 2.75], pat) < 60, `ちがうリズム ${mgScore([0, 1, 1.25, 1.5, 2.25, 2.75], pat)}`);
});

test('ブースト: 1 位ほど長く、下位ほど短い', () => {
  const sc = [40, 90, 70, 10];
  assert.deepEqual(mgRanks(sc), [3, 1, 2, 4]);
  assert.equal(mgBoost(sc, 1), MG.BOOST_MAX);
  assert.equal(mgBoost(sc, 3), MG.BOOST_MIN);
  assert.ok(mgBoost(sc, 2) > mgBoost(sc, 0));
});

test('レース中に最大 2 回始まり、全員止まる → お手本 → 真似 → 採点 → 3・2・1 → ブーストして再開。レースの時計は止まる', () => {
  let seen = 0;
  for (let trial = 0; trial < 6; trial++) {
    const sim = new RaceSim(track, { players: [0, 1], npcs: 2, boss: 1, mg: 1 });
    assert.ok(sim.s.mgAt.length >= 1 && sim.s.mgAt.length <= 2);
    while (sim.s.phase === 'countdown') sim.step(DT, [0, 0]);
    let started = 0;
    for (let i = 0; i < 60 * 400 && sim.s.phase === 'racing' && started < sim.s.mgAt.length; i++) {
      sim.step(DT, [IN.UP, IN.UP]);
      if (!sim.s.mg) continue;
      started++;
      const mg = sim.s.mg;
      assert.ok(sim.s.karts.every((k) => k.sp === 0), '全員止まる');
      const t0 = sim.s.t;
      const pos = sim.s.karts.map((k) => [k.x, k.z]);
      const T = mgTimes(mg.pat);
      // 人 0 はお手本どおり、人 1 は何もしない
      const want = mg.pat.map((b) => Math.round((T.playStart + 0.5 + b) * 60));
      let tick = Math.round(mg.t * 60);
      let boosted = null;
      while (sim.s.mg) {
        tick++;
        sim.step(DT, [want.includes(tick) ? IN.TAP | IN.UP : IN.UP, IN.UP]);
        if (sim.s.mg && mgPhase(sim.s.mg) === 'count' && !boosted) boosted = sim.s.mg.sc.slice();
      }
      assert.equal(sim.s.t, t0, 'レースの時計は止まっていた');
      assert.deepEqual(sim.s.karts.map((k) => [k.x, k.z]), pos, '止まっていた');
      assert.ok(boosted[0] >= 95, `お手本どおり ${boosted[0]}`);
      assert.equal(boosted[1], 0, '何もしない');
      assert.ok(sim.s.karts[0].boost > sim.s.karts[1].boost, '上手いほうが長いブースト');
      assert.equal(sim.s.karts[1].boost, MG.BOOST_MIN);
    }
    assert.equal(started, sim.s.mgAt.length, '決めた回数だけ始まる');
    seen += started;
  }
  assert.ok(seen >= 6);
});

test('ミニゲームなしの設定では始まらない / 状態は配信形式（JSON・バイナリ）と完全な状態で復元できる', () => {
  const off = new RaceSim(track, { mg: 0 });
  assert.equal(off.s.mgAt.length, 0);
  const sim = new RaceSim(track, { npcs: 1, mg: 1 });
  sim.s.mg = { t: 7.5, pat: makePattern(sim.s), taps: [[1, 2], []], sc: [80, 0, 55] };
  const b = unpackNetBin(packNetBin(sim.s), null).snap;
  assert.ok(Math.abs(b.mg.t - 7.5) < 0.01);
  assert.deepEqual(b.mg.pat, sim.s.mg.pat);
  assert.deepEqual(b.mg.sc, [80, 0, 55]);
  const j = unpackNet(JSON.parse(JSON.stringify(packNet(sim.s))));
  assert.deepEqual(j.mg.sc, [80, 0, 55]);
  const c = sanitizeSnapshot(b, sim.s, sim.boxPos.length);
  assert.deepEqual(c.mg.sc, [80, 0, 55]);
  const full = sanitizeSnapshot(JSON.parse(JSON.stringify(sim.getSnapshot())), sim.s, sim.boxPos.length);
  assert.deepEqual(full.mg.taps[0], [1, 2]);
  sim.s.mg = null;
  assert.equal(unpackNetBin(packNetBin(sim.s), null).snap.mg, null);
});
