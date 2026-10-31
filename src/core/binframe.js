// ゲーム中の頻繁なメッセージ（位置の定期配信・操作）を、JSON ではなくバイナリで送るための枠。
// サーバー計算（WebSocket）と P2P（WebRTC の DataChannel）で使う。中継（Cloudflare の部屋の中継）は文字しか通さないので JSON のまま。
//
//   [0] 0xB7（目印） [1] 種類（1 = 位置の定期配信 / 2 = 操作） [2..3] 世代 gen [4..7] 試合 ID のハッシュ [8..] 種類ごとの中身
//   1: [8..11] 配信の通し番号 seq、[12..] ゲームが詰めた状態（ゲームモジュールの encodeNetBinary / decodeNetBinary）
//   2: [8..11] 最後の操作の seq、[12] 操作の数 n、[13..] 操作のビット（古い順に n 個）

const MAGIC = 0xb7;
export const FRAME_SNAPSHOT = 1;
export const FRAME_INPUT = 2;

/** 試合 ID の 32bit ハッシュ（FNV-1a）。前の試合の配信を取り違えないため */
export function matchHash(id) {
  let h = 0x811c9dc5;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function header(buf, kind, matchId, gen) {
  const dv = new DataView(buf);
  dv.setUint8(0, MAGIC);
  dv.setUint8(1, kind);
  dv.setUint16(2, gen & 0xffff, true);
  dv.setUint32(4, matchHash(matchId), true);
  return dv;
}

/** 位置の定期配信。payload: ゲームが詰めた Uint8Array */
export function encodeSnapshotFrame(matchId, gen, seq, payload) {
  const buf = new ArrayBuffer(12 + payload.length);
  const dv = header(buf, FRAME_SNAPSHOT, matchId, gen);
  dv.setUint32(8, seq >>> 0, true);
  new Uint8Array(buf, 12).set(payload);
  return buf;
}

/** 操作。inputs: 直近の操作ビット（古い順）、seq: 最後の操作の番号 */
export function encodeInputFrame(matchId, gen, seq, inputs) {
  const n = Math.min(255, inputs.length);
  const list = inputs.slice(inputs.length - n);
  const buf = new ArrayBuffer(13 + n);
  const dv = header(buf, FRAME_INPUT, matchId, gen);
  dv.setUint32(8, seq >>> 0, true);
  dv.setUint8(12, n);
  for (let i = 0; i < n; i++) dv.setUint8(13 + i, list[i] & 255);
  return buf;
}

/** 受け取ったバイナリが、このアプリの枠か */
export function isFrame(data) {
  return (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) && data.byteLength >= 12 && new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer, data.byteOffset || 0, 1)[0] === MAGIC;
}

/**
 * 枠を読む。壊れていれば null。
 * @returns {{ kind: number, gen: number, hash: number, seq: number, payload?: Uint8Array, inputs?: number[] } | null}
 */
export function decodeFrame(data) {
  try {
    const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (u8.length < 12 || u8[0] !== MAGIC) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const f = { kind: u8[1], gen: dv.getUint16(2, true), hash: dv.getUint32(4, true), seq: dv.getUint32(8, true) };
    if (f.kind === FRAME_SNAPSHOT) {
      f.payload = u8.subarray(12);
      return f;
    }
    if (f.kind === FRAME_INPUT) {
      const n = u8[12];
      if (u8.length < 13 + n) return null;
      f.inputs = Array.from(u8.subarray(13, 13 + n));
      return f;
    }
    return null;
  } catch {
    return null;
  }
}
