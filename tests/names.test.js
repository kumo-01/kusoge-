// プレイヤー名（整え方）と、吹き出しの置き場所
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, NAME_MAX, sanitizeRoomState } from '../src/core/protocol.js';
import { bubbleLayout } from '../src/games/dogKart/bubble.js';

test('プレイヤー名: 前後の空白・制御文字を除き、10 文字まで。文字列でなければ空', () => {
  assert.equal(cleanName('  ポチ  '), 'ポチ');
  assert.equal(cleanName('a\u0000b\nc'), 'abc');
  assert.equal(cleanName('ぽ'.repeat(30)).length, NAME_MAX);
  assert.equal(cleanName('🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶'), '🐶'.repeat(10), '絵文字は 1 文字として数える');
  assert.equal(cleanName(12), '');
  assert.equal(cleanName(null), '');
  const room = sanitizeRoomState({ rev: 1, screen: 'ready', players: [{ link: 'connected', ready: false, name: ' たろう ' }, { link: 'connected', ready: true, name: 5 }, { link: 'none', ready: false }, { link: 'none', ready: false }], options: {} });
  assert.deepEqual(room.players.map((p) => p.name), ['たろう', '', '', '']);
});

test('吹き出し: 画面の中なら頭の上、外なら画面のはし（はみ出さない）。カメラの後ろは反対側のはし', () => {
  const W = 800;
  const H = 600;
  const bw = 80;
  const bh = 30;
  const a = bubbleLayout(0, 0, 0.5, W, H, bw, bh);
  assert.equal(a.edge, false);
  assert.equal(a.x, 400);
  assert.ok(a.y < 300, '頭の上');
  const inBox = (L) => L.x - bw / 2 >= 0 && L.x + bw / 2 <= W && L.y - bh / 2 >= 0 && L.y + bh / 2 <= H;
  // 右の外
  const r = bubbleLayout(3, 0, 0.5, W, H, bw, bh);
  assert.equal(r.edge, true);
  assert.ok(inBox(r));
  assert.ok(r.x > 600 && Math.abs(r.y - 300) < 1);
  assert.ok(Math.abs(r.a) < 0.01, 'しっぽは右向き');
  // 左上の外
  const lu = bubbleLayout(-5, 5, 0.5, W, H, bw, bh);
  assert.ok(inBox(lu) && lu.x < 400 && lu.y < 300);
  // カメラの後ろ（右に写っている = 実際は左後ろ）→ 左のはし
  const b = bubbleLayout(0.3, -0.2, 1.3, W, H, bw, bh);
  assert.equal(b.edge, true);
  assert.ok(inBox(b) && b.x < 400);
});
