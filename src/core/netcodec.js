// 通信の差分圧縮（前に相手へ届いた配信との XOR と、0 の連続のまとめ）。Rust のもとは wasm/netcodec/src/lib.rs。
// netcodec.wasm は `npm run build:wasm` で作り直す（コミットしてあるので、ふだんのビルドに Rust はいらない）。
//
// 形: [varint: 元の長さ n] のあと [varint: 0 の数][varint: そのままのバイトの数 L][L バイト] を繰り返す。
// 読みこみ前と、読みこめなかったときは、下の JavaScript 版を使う。2 つは 1 バイトも違わない結果を作る（tests/netcodec.test.js）。

let ex = null;
let mem = null;
let cap = 0;
let enabled = true;

export function initNetcodecSync(src) {
  const mod = src instanceof WebAssembly.Module ? src : new WebAssembly.Module(src);
  setInstance(new WebAssembly.Instance(mod, {}));
}

export async function initNetcodec(url = new URL('./netcodec.wasm', import.meta.url)) {
  if (ex) return true;
  try {
    const res = await fetch(url);
    const { instance } = WebAssembly.instantiateStreaming && res.headers.get('content-type')?.includes('wasm') ? await WebAssembly.instantiateStreaming(res, {}) : await WebAssembly.instantiate(await res.arrayBuffer(), {});
    setInstance(instance);
    return true;
  } catch {
    return false;
  }
}

function setInstance(inst) {
  ex = inst.exports;
  cap = ex.cap();
  mem = null;
}

const view = () => {
  if (!mem || mem.buffer !== ex.memory.buffer) mem = new Uint8Array(ex.memory.buffer);
  return mem;
};

/** Rust を使うか（比べるテスト用） */
export function useWasmCodec(on) {
  enabled = !!on;
}
export const codecWasmActive = () => !!ex && enabled;

// ---- JavaScript 版 ----
function putVarint(out, o, v) {
  for (;;) {
    const b = v & 0x7f;
    v >>>= 7;
    if (v === 0) {
      out[o] = b;
      return o + 1;
    }
    out[o] = b | 0x80;
    o++;
  }
}

export function deltaEncodeJs(base, cur) {
  const n = cur.length;
  const bl = base.length;
  const out = new Uint8Array(n + (n >> 1) + 16);
  const x = (i) => cur[i] ^ (i < bl ? base[i] : 0);
  let o = putVarint(out, 0, n);
  let i = 0;
  while (i < n) {
    const z0 = i;
    while (i < n && x(i) === 0) i++;
    const z = i - z0;
    const l0 = i;
    while (i < n) {
      if (x(i) === 0 && (i + 1 >= n || x(i + 1) === 0)) break;
      i++;
    }
    o = putVarint(out, o, z);
    o = putVarint(out, o, i - l0);
    for (let k = l0; k < i; k++) out[o++] = x(k);
  }
  return out.slice(0, o);
}

export function deltaDecodeJs(base, data) {
  let o = 0;
  const get = () => {
    let v = 0;
    let shift = 0;
    for (;;) {
      if (o >= data.length || shift > 28) return -1;
      const b = data[o++];
      v |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return v >>> 0;
      shift += 7;
    }
  };
  const n = get();
  if (n < 0 || n > 65536) return null;
  const bl = base.length;
  const out = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const z = get();
    const l = get();
    if (z < 0 || l < 0 || z + l === 0 || i + z + l > n || o + l > data.length) return null;
    for (let k = 0; k < z; k++, i++) out[i] = i < bl ? base[i] : 0;
    for (let k = 0; k < l; k++, i++) out[i] = data[o + k] ^ (i < bl ? base[i] : 0);
    o += l;
  }
  return o === data.length ? out : null;
}

// ---- 使う側 ----
const EMPTY = new Uint8Array(0);

/** base（相手が持っている前の配信。なければ空）から cur への差分 */
export function deltaEncode(base, cur) {
  base = base || EMPTY;
  if (ex && enabled && base.length <= cap && cur.length <= cap) {
    const m = view();
    m.set(base, ex.base_ptr());
    m.set(cur, ex.cur_ptr());
    const n = ex.encode(base.length, cur.length);
    if (n >= 0) return view().slice(ex.out_ptr(), ex.out_ptr() + n);
  }
  return deltaEncodeJs(base, cur);
}

/** 差分を元に戻す。壊れていれば null */
export function deltaDecode(base, data) {
  base = base || EMPTY;
  if (ex && enabled && base.length <= cap && data.length <= cap) {
    const m = view();
    m.set(base, ex.base_ptr());
    m.set(data, ex.cur_ptr());
    const n = ex.decode(base.length, data.length);
    return n < 0 ? null : view().slice(ex.out_ptr(), ex.out_ptr() + n);
  }
  return deltaDecodeJs(base, data);
}

/** 16 ビットの確かめ用の値（違う元から戻してしまったときに気づくため） */
export function check16(u8) {
  let h = 0x811c9dc5;
  for (let i = 0; i < u8.length; i++) {
    h ^= u8[i];
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 16) ^ h) & 0xffff;
}

if (typeof window !== 'undefined' && typeof fetch === 'function') initNetcodec();
if (typeof window !== 'undefined' && import.meta.env?.VITE_TEST_HOOKS === '1') window.__netcodec = { active: codecWasmActive };
