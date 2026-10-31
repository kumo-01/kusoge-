// 2D のミニゲーム（人間感覚角度対決・都道府県県境バトル）の採点
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { angleError, anglePoints } from '../src/games/angleDuel/index.js';
import { prefLines, tolerance, scoreDrawing, packStrokes, unpackStrokes, eraseAt, MAX_POINTS, unitKm, lengthKm } from '../src/games/prefBattle/score.js';

const DATA = JSON.parse(fs.readFileSync(new URL('../src/games/prefBattle/japan-prefs.json', import.meta.url)));
const pref = (name) => DATA.prefs.find((p) => p.name === name);

test('角度: ずれは円の上での差（0〜180）', () => {
  assert.equal(angleError(90, 90), 0);
  assert.equal(angleError(350, 10), 20);
  assert.equal(angleError(10, 350), 20);
  assert.equal(angleError(0, 180), 180);
  assert.equal(angleError(359, 0), 1);
  // 0.1° 単位
  assert.equal(angleError(90.3, 90), 0.3);
  assert.equal(angleError(359.9, 0.2), 0.3);
  assert.equal(anglePoints(0, true), 120);
  assert.equal(anglePoints(10, false), 80);
  assert.equal(anglePoints(80, false), 0);
});

test('県境データ: 47 都道府県があり、県境は陸の境だけ（北海道・沖縄県は無し）、地図の範囲に収まる', () => {
  assert.equal(DATA.prefs.length, 47);
  assert.deepEqual(DATA.prefs.map((p) => p.code), Array.from({ length: 47 }, (_, i) => i + 1));
  assert.equal(pref('東京都').code, 13);
  assert.equal(pref('北海道').borders.length, 0);
  assert.equal(pref('沖縄県').borders.length, 0);
  for (const p of DATA.prefs) {
    if (p.code === 1 || p.code === 47) continue; // お題に出ない（北海道の東端は地図の範囲の外まである）
    const [x0, y0, x1, y1] = p.box;
    assert.ok(x0 >= 0 && y0 >= 0 && x1 <= DATA.view.w && y1 <= DATA.view.h, `${p.name} ${p.box}`);
    assert.ok(p.borders.length >= 1 && p.borders.every((r) => r.length >= 4 && r.length % 2 === 0), p.name);
    assert.ok(p.neighbors.length >= 1, `${p.name} のとなり`);
  }
  // となり同士は、同じ県境を共有している（埼玉と東京）
  assert.ok(pref('埼玉県').neighbors.includes(13) && pref('東京都').neighbors.includes(11));
  assert.ok(!pref('香川県').neighbors.includes(37));
  // 海で隔てられているだけの県は、となりではない（広島県と愛媛県）
  assert.ok(!pref('広島県').neighbors.includes(38));
});

test('一致率: 本物どおりは 100%、ずれるほど・半分だけ・塗りつぶし・別の県は低い', () => {
  const V = DATA.view;
  for (const name of ['埼玉県', '香川県', '長野県', '岐阜県', '青森県', '鹿児島県']) {
    const p = pref(name);
    const T = tolerance(p, V);
    const truth = prefLines(p);
    const k = unitKm(V, (p.box[1] + p.box[3]) / 2);
    const shift = (km) => truth.map((l) => l.map(([x, y]) => [x + km / k, y]));
    const s = (lines) => scoreDrawing(truth, lines, V, T).pct;
    assert.equal(s(truth), 100, name);
    // 満点の距離（T/4）以内のずれは 100%
    assert.equal(s(shift(T * 0.2)), 100, `${name} ずれ ${T * 0.2}km`);
    assert.ok(s(shift(T * 0.5)) > 50 && s(shift(T * 0.5)) < 98, `${name} ずれ T/2: ${s(shift(T * 0.5))}`);
    assert.ok(s(shift(T * 0.8)) < s(shift(T * 0.5)), `${name} 遠いほど低い`);
    assert.ok(s(truth.map((l) => l.slice(0, l.length >> 1))) < 85, `${name} 半分`);
    // 同じ所を 2 回なぞっても下がらない
    assert.equal(s([...truth, ...truth]), 100, `${name} 2 回なぞる`);
    const [x0, y0, x1, y1] = p.borderBox;
    const scribble = [Array.from({ length: 400 }, (_, i) => [x0 + ((i * 37) % 100) / 100 * (x1 - x0), y0 + ((i * 61) % 100) / 100 * (y1 - y0)])];
    assert.ok(s(scribble) < 15, `${name} 塗りつぶし ${s(scribble)}`);
    assert.equal(s([]), 0);
    // 平均のずれは km で測れている
    const r = scoreDrawing(truth, shift(3), V, T);
    assert.ok(r.dev > 0.5 && r.dev <= 3.05, `${name} 平均のずれ ${r.dev}`);
  }
  assert.ok(scoreDrawing(prefLines(pref('埼玉県')), prefLines(pref('鹿児島県')), V, tolerance(pref('埼玉県'), V)).pct === 0);
  // 海岸線まで描くと（県全体の形）、県境の外の線が多いので下がる
  const kana = pref('神奈川県');
  const T = tolerance(kana, V);
  const truth = prefLines(kana);
  const [x0, y0, x1, y1] = kana.box;
  const coast = [[x1, y0], [x1, y1], [x0, y1]];
  assert.ok(scoreDrawing(truth, [...truth, coast], V, T).pct < scoreDrawing(truth, truth, V, T).pct);
});

test('距離: メルカトルの縮尺を緯度で直して地上の km で測る', () => {
  const V = DATA.view;
  // 北ほど 1 単位が短い（青森は鹿児島より短い）
  assert.ok(unitKm(V, pref('青森県').box[1]) < unitKm(V, pref('鹿児島県').box[1]));
  // 地図の範囲の幅（経度 24°）は、北緯 36° で約 2160km
  const y36 = (() => { let lo = 0, hi = V.h; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; const Y = V.Y0 + m / V.S; const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180 / Math.PI; if (lat > 36) lo = m; else hi = m; } return lo; })();
  const len = lengthKm([[[0, y36], [1000, y36]]], V);
  assert.ok(Math.abs(len - 24 * 111.32 * Math.cos(36 * Math.PI / 180)) < 5, `${len}`);
});

test('描いた線: 送る形に詰めて戻せる。点が多すぎれば間引いて上限に収める。消しゴムで線が分かれる', () => {
  const line = Array.from({ length: 50 }, (_, i) => [100 + i, 200 + Math.sin(i / 3) * 5]);
  const back = unpackStrokes(packStrokes([line]));
  assert.equal(back.length, 1);
  assert.ok(Math.abs(back[0][0][0] - 100) < 0.1);
  const huge = [Array.from({ length: 9000 }, (_, i) => [i / 10, Math.sin(i) * 3 + 300])];
  const packed = packStrokes(huge);
  assert.ok(packed.reduce((n, r) => n + r.length / 2, 0) <= MAX_POINTS);
  assert.ok(JSON.stringify(packed).length < 40000, '1 通の大きさに収まる');
  // 壊れた値は捨てる
  assert.deepEqual(unpackStrokes([[1, 'a', NaN, 3], 'x', null]), []);
  // 消しゴム: 真ん中を消すと 2 本に分かれる
  const cut = eraseAt([line], 125, 200, 3);
  assert.equal(cut.length, 2);
  assert.ok(cut[0].length + cut[1].length < line.length);
  assert.equal(eraseAt([line], 0, 0, 1)[0], line, '何も消えなければそのまま');
});

test('反応速度: 速いほど高い。フライング・時間切れは 0', async () => {
  const { reactionPoints, reactionRank, FOUL, TIMEOUT } = await import('../src/games/reaction/index.js');
  assert.equal(reactionPoints(150, false), 100);
  assert.equal(reactionPoints(100, false), 100);
  assert.equal(reactionPoints(250, false), 80);
  assert.equal(reactionPoints(250, true), 100);
  assert.equal(reactionPoints(900, false), 0);
  assert.equal(reactionPoints(FOUL, true), 0);
  assert.equal(reactionPoints(TIMEOUT, false), 0);
  assert.match(reactionRank(FOUL), /フライング/);
});

test('リズム: お題の間隔ぴったりは 100%、ずれるほど低い。BPM を間隔から求める', async () => {
  const { rhythmScore } = await import('../src/games/rhythm/index.js');
  const exact = rhythmScore(Array(7).fill(500), 120);
  assert.equal(exact.acc, 100);
  assert.equal(exact.bpm, 120);
  const slow = rhythmScore(Array(7).fill(550), 120); // 10% 遅い
  assert.equal(slow.dev, 10);
  assert.equal(slow.acc, 60);
  assert.ok(Math.abs(slow.bpm - 109.1) < 0.1);
  // 平均は合っていても、ばらつくと下がる
  const wobble = rhythmScore([400, 600, 400, 600, 400, 600, 500], 120);
  assert.ok(wobble.acc < 80 && wobble.sd > 50);
  assert.equal(rhythmScore([], 120).acc, 0);
  assert.equal(rhythmScore(Array(7).fill(1000), 120).acc, 0); // 倍の間隔（半分のテンポ）
});
