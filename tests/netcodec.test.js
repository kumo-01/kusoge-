// 通信の差分圧縮（src/core/netcodec.js と Rust の wasm/netcodec）。JavaScript 版と Rust 版が 1 バイトも違わないこと
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { initNetcodecSync, deltaEncode, deltaDecode, deltaEncodeJs, deltaDecodeJs, useWasmCodec, codecWasmActive, check16 } from '../src/core/netcodec.js';
import { encodeDeltaFrame, decodeFrame, FRAME_DELTA, NO_BASE } from '../src/core/binframe.js';

initNetcodecSync(readFileSync(new URL('../src/core/netcodec.wasm', import.meta.url)));

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) / 16777216;

function sample() {
  const n = Math.floor(rnd() * 600);
  const base = new Uint8Array(Math.floor(rnd() * 600)).map(() => (rnd() < 0.4 ? 0 : Math.floor(rnd() * 256)));
  const cur = new Uint8Array(n).map((_, i) => (i < base.length && rnd() < 0.85 ? base[i] : rnd() < 0.3 ? 0 : Math.floor(rnd() * 256)));
  return [base, cur];
}

test('Rust 版が使われている', () => {
  assert.equal(codecWasmActive(), true);
});

test('Rust 版と JavaScript 版の差分が同じで、どちらからも元に戻せる', () => {
  for (let k = 0; k < 400; k++) {
    const [base, cur] = sample();
    useWasmCodec(true);
    const a = deltaEncode(base, cur);
    const js = deltaEncodeJs(base, cur);
    assert.deepEqual([...a], [...js]);
    assert.deepEqual([...deltaDecode(base, a)], [...cur]);
    assert.deepEqual([...deltaDecodeJs(base, a)], [...cur]);
    assert.deepEqual([...deltaDecode(null, deltaEncode(null, cur))], [...cur]);
  }
});

test('ほとんど同じなら、とても小さくなる', () => {
  const base = new Uint8Array(400).map((_, i) => (i * 37) & 255);
  const cur = base.slice();
  cur[10] ^= 3;
  cur[300] ^= 1;
  const d = deltaEncode(base, cur);
  assert.ok(d.length < 16, `size ${d.length}`);
});

test('壊れた差分は null（Rust 版・JavaScript 版とも）', () => {
  const [base, cur] = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 9, 3, 4, 5])];
  const d = deltaEncode(base, cur);
  for (const bad of [d.slice(0, d.length - 1), new Uint8Array([...d, 7]), new Uint8Array([200]), new Uint8Array([3, 0, 0])]) {
    useWasmCodec(true);
    assert.equal(deltaDecode(base, bad), null);
    assert.equal(deltaDecodeJs(base, bad), null);
  }
});

test('差分の枠を読める', () => {
  const data = new Uint8Array([5, 0, 5, 1, 2, 3, 4, 5]);
  const f = decodeFrame(encodeDeltaFrame('m1', 3, 77, NO_BASE, check16(data), data));
  assert.equal(f.kind, FRAME_DELTA);
  assert.equal(f.seq, 77);
  assert.equal(f.base, NO_BASE);
  assert.deepEqual([...f.payload], [...data]);
});
