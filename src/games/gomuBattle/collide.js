// 当たり判定（線分と箱）を Rust（WebAssembly）で計算する。Rust のもとは wasm/collide/src/lib.rs。
// collide.wasm は `npm run build:wasm` で作り直す（コミットしてあるので、ふだんのビルドに Rust はいらない）。
//
// 読みこみはページを開いたときに始まり、終わるまでと、読みこめなかったときは JavaScript の計算（arena.js）を使う。
// 2 つは同じ順番の浮動小数の演算なので、結果は 1 ビットも変わらない（tests/gomu.test.js で確かめている）。

const STRIDE = 6; // 箱 1 つ = x0, x1, y0, y1, z0, z1

let ex = null; // WebAssembly の関数
let boxesF = null; // 箱を書きこむ場所（Float64Array）
let outF = null; // 当たった面の向き
let maxBoxes = 0;
let cur = null; // いま書きこんである箱の配列
let curN = -1;
let curW = 0;
let curD = 0;
let movIdx = []; // 押せるもの（動く箱）の番号。毎回書き直す
let enabled = true;

/** WebAssembly のバイト列（または WebAssembly.Module）から使えるようにする（同期。テスト用） */
export function initCollideSync(src) {
  const mod = src instanceof WebAssembly.Module ? src : new WebAssembly.Module(src);
  setInstance(new WebAssembly.Instance(mod, {}));
}

/** ブラウザ: collide.wasm を読みこむ（終わるまでは JavaScript の計算） */
export async function initCollide(url = new URL('./collide.wasm', import.meta.url)) {
  if (ex) return true;
  try {
    const res = await fetch(url);
    const { instance } = WebAssembly.instantiateStreaming && res.headers.get('content-type')?.includes('wasm') ? await WebAssembly.instantiateStreaming(res, {}) : await WebAssembly.instantiate(await res.arrayBuffer(), {});
    setInstance(instance);
    return true;
  } catch {
    return false; // 読みこめなくても遊べる（JavaScript の計算のまま）
  }
}

function setInstance(inst) {
  ex = inst.exports;
  maxBoxes = ex.max_boxes();
  boxesF = new Float64Array(ex.memory.buffer, ex.boxes_ptr(), maxBoxes * STRIDE);
  outF = new Float64Array(ex.memory.buffer, ex.out_ptr(), 3);
  cur = null;
}

/** Rust の計算を使うか（比べるテスト用） */
export function useWasm(on) {
  enabled = !!on;
}

/** いま Rust の計算を使っているか */
export const wasmActive = () => !!ex && enabled;

function write(k, b) {
  const o = k * STRIDE;
  boxesF[o] = b.x0;
  boxesF[o + 1] = b.x1;
  boxesF[o + 2] = b.y0;
  boxesF[o + 3] = b.y1;
  boxesF[o + 4] = b.z0;
  boxesF[o + 5] = b.z1;
}

/** 箱を WebAssembly の場所へ（配列が変わったときは全部、同じなら動く箱だけ） */
function sync(boxes, W, D) {
  if (boxes !== cur || boxes.length !== curN || W !== curW || D !== curD) {
    cur = boxes;
    curN = boxes.length;
    curW = W;
    curD = D;
    movIdx = [];
    const n = Math.min(boxes.length, maxBoxes);
    for (let k = 0; k < n; k++) {
      write(k, boxes[k]);
      if (boxes[k].mv) movIdx.push(k);
    }
    ex.set_world(n, W, D);
    return;
  }
  for (const k of movIdx) write(k, boxes[k]);
}

/**
 * Rust で segmentHit。使えないとき（読みこみ前・箱が多すぎる・切ってある）は null を返す（呼んだ側が JavaScript で計算する）
 */
export function wasmSegmentHit(boxes, W, D, ax, ay, az, bx, by, bz, r, out) {
  if (!ex || !enabled || boxes.length > maxBoxes) return null;
  sync(boxes, W, D);
  const t = ex.segment_hit(ax, ay, az, bx, by, bz, r);
  if (out) {
    out.t = t;
    out.nx = outF[0];
    out.ny = outF[1];
    out.nz = outF[2];
  }
  return t;
}

// ブラウザでは開いたときに読みこみを始める
if (typeof window !== 'undefined' && typeof fetch === 'function') initCollide();

// テスト用: ブラウザで Rust の計算が使われているかを見る
if (typeof window !== 'undefined' && import.meta.env?.VITE_TEST_HOOKS === '1') window.__gomuCollide = { active: wasmActive };
