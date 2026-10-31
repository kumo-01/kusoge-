// 2D のミニゲーム（人間感覚角度対決・都道府県県境バトル）の採点
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { angleError, anglePoints } from '../src/games/angleDuel/index.js';
import { prefLines, tolerance, scoreDrawing, packStrokes, unpackStrokes, eraseAt, MAX_POINTS } from '../src/games/prefBattle/score.js';

const DATA = JSON.parse(fs.readFileSync(new URL('../src/games/prefBattle/japan-prefs.json', import.meta.url)));
const pref = (name) => DATA.prefs.find((p) => p.name === name);

test('角度: ずれは円の上での差（0〜180）', () => {
  assert.equal(angleError(90, 90), 0);
  assert.equal(angleError(350, 10), 20);
  assert.equal(angleError(10, 350), 20);
  assert.equal(angleError(0, 180), 180);
  assert.equal(angleError(359, 0), 1);
  assert.equal(anglePoints(0, true), 120);
  assert.equal(anglePoints(10, false), 80);
  assert.equal(anglePoints(80, false), 0);
});

test('県境データ: 47 都道府県があり、名前とコードがそろい、地図の範囲に収まる', () => {
  assert.equal(DATA.prefs.length, 47);
  assert.deepEqual(DATA.prefs.map((p) => p.code), Array.from({ length: 47 }, (_, i) => i + 1));
  assert.equal(pref('東京都').code, 13);
  for (const p of DATA.prefs) {
    assert.ok(p.rings.length >= 1 && p.rings.every((r) => r.length >= 6 && r.length % 2 === 0), p.name);
    const [x0, y0, x1, y1] = p.box;
    assert.ok(x0 >= 0 && y0 >= 0 && x1 <= DATA.view.w && y1 <= DATA.view.h, `${p.name} ${p.box}`);
  }
  // 沖縄県は左上の拡大枠の中
  const ok = pref('沖縄県').box;
  const ins = DATA.view.inset;
  assert.ok(ok[0] >= ins.x && ok[2] <= ins.x + ins.w && ok[1] >= ins.y && ok[3] <= ins.y + ins.h);
});

test('一致率: 本物どおりは 100%、ずれるほど・半分だけ・塗りつぶし・別の県は低い', () => {
  for (const name of ['埼玉県', '香川県', '長野県', '北海道']) {
    const p = pref(name);
    const T = tolerance(p);
    const truth = prefLines(p);
    const shift = (d) => truth.map((l) => l.map(([x, y]) => [x + d, y]));
    const s = (lines) => scoreDrawing(truth, lines, T).pct;
    assert.equal(s(truth), 100, name);
    assert.ok(s(shift(2)) > 70 && s(shift(2)) < 95, `${name} ずれ 2: ${s(shift(2))}`);
    assert.ok(s(shift(4)) < s(shift(2)), `${name} ずれ 4 は 2 より低い`);
    assert.ok(s(truth.map((l) => l.slice(0, l.length >> 1))) < 85, `${name} 半分`);
    const [x0, y0, x1, y1] = p.box;
    const scribble = [Array.from({ length: 400 }, (_, i) => [x0 + ((i * 37) % 100) / 100 * (x1 - x0), y0 + ((i * 61) % 100) / 100 * (y1 - y0)])];
    assert.ok(s(scribble) < 15, `${name} 塗りつぶし ${s(scribble)}`);
    assert.equal(s([]), 0);
  }
  assert.ok(scoreDrawing(prefLines(pref('埼玉県')), prefLines(pref('鹿児島県')), tolerance(pref('埼玉県'))).pct === 0);
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
