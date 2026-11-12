// 当たり判定の Rust（WebAssembly）版が、JavaScript 版と 1 ビットも違わないこと
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARENAS, ROOM, segmentHit, segmentHitJs } from '../src/games/gomuBattle/arena.js';
import { initCollideSync, wasmActive, useWasm } from '../src/games/gomuBattle/collide.js';
import { movableBox } from '../src/games/gomuBattle/physics.js';

initCollideSync(readFileSync(new URL('../src/games/gomuBattle/collide.wasm', import.meta.url)));

// 決まった乱数（毎回同じ線分で比べる）
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

test('Rust（WebAssembly）の当たり判定: 3 つの会場のいろいろな線分で、JavaScript と結果が完全に同じ', () => {
  assert.ok(wasmActive(), 'WebAssembly が読みこめた');
  let hits = 0;
  for (const a of ARENAS) {
    const mov = a.movables.map(movableBox);
    const cw = { boxes: [...a.boxes, ...mov] };
    for (let k = 0; k < 6000; k++) {
      // 押せるものは途中で動かす（動く箱も毎回正しく渡っているか）
      if (k % 500 === 0) for (const m of mov) { m.x0 += 0.3; m.x1 += 0.3; }
      const ax = (rnd() - 0.5) * ROOM.W;
      const az = (rnd() - 0.5) * ROOM.D;
      const ay = rnd() * 4;
      const len = rnd() < 0.5 ? rnd() * 2 : rnd() * 60;
      const yaw = rnd() * Math.PI * 2;
      const pitch = (rnd() - 0.5) * 1.6;
      const bx = ax + Math.sin(yaw) * Math.cos(pitch) * len;
      const by = ay + Math.sin(pitch) * len;
      const bz = az + Math.cos(yaw) * Math.cos(pitch) * len;
      const r = rnd() < 0.3 ? 0 : rnd() * 0.3;
      const o1 = {};
      const o2 = {};
      const t1 = segmentHit(cw, ax, ay, az, bx, by, bz, r, o1);
      const t2 = segmentHitJs(cw, ax, ay, az, bx, by, bz, r, o2);
      assert.equal(Object.is(t1, t2), true, `t が違う ${t1} ${t2}`);
      assert.deepEqual([o1.nx, o1.ny, o1.nz], [o2.nx, o2.ny, o2.nz]);
      if (t1 < 1) hits++;
    }
  }
  assert.ok(hits > 3000, `当たる線分も十分に比べた (${hits})`);
});

test('Rust を切ると JavaScript の計算に戻る', () => {
  useWasm(false);
  try {
    assert.equal(wasmActive(), false);
    const a = ARENAS[0];
    assert.equal(segmentHit(a, 0, 0.5, 0, 0, -1, 0), segmentHitJs(a, 0, 0.5, 0, 0, -1, 0));
  } finally {
    useWasm(true);
  }
});
