// 通信プロトコル: メッセージ種別・エンコード・受信データの検証。
//
// すべてのメッセージは { type: string, ...payload } の JSON。
// PeerJS の DataConnection は serialization: 'raw' で使い、文字列の長さを
// パース前に確認してから JSON.parse する（巨大データでクラッシュさせないため）。

export const PROTOCOL_VERSION = 1;

/** 1 メッセージの最大文字数 */
export const MAX_MESSAGE_CHARS = 60000;

export const MSG = Object.freeze({
  // 接続・入室
  JOIN_REQUEST: 'join_request', // guest→host { v, key, token? }
  JOIN_ACCEPTED: 'join_accepted', // host→guest { token, room, rejoin }
  JOIN_REJECTED: 'join_rejected', // host→guest { reason }
  // 部屋の状態（画面遷移を含む部屋全体の正本。screen_change の役割も兼ねる）
  ROOM_STATE: 'room_state', // host→guest { room }
  READY_CHANGE: 'ready_change', // guest→host { ready }
  // ゲーム
  GAME_START: 'game_start', // host→guest { gameId, matchId, gen, snapshot } 初回開始・再接続時の完全同期
  PLAYER_INPUT: 'player_input', // guest→host { matchId, gen, seq, inputs[] }
  GAME_SNAPSHOT: 'game_snapshot', // host→guest { matchId, gen, seq, snap, ev[] } 定期配信
  GAME_MSG: 'game_msg', // 双方向 { matchId, gen, data } ゲーム固有メッセージ用
  GAME_RESULT: 'game_result', // host→guest { matchId, result }
  PAUSE: 'pause', // host→guest { matchId, gen, reason, snapshot }
  RESUME: 'resume', // host→guest { matchId, gen, delayMs }
  RESUME_ACK: 'resume_ack', // guest→host { matchId, gen } 状態の読み込み完了
  GAME_ABORT: 'game_abort', // host→guest { matchId }
  // 部屋の終了・退出
  ROOM_CLOSE: 'room_close', // host→guest { reason }
  LEAVE: 'leave', // guest→host ゲストが自分の意思で退出（枠を空ける）
  BYE: 'bye', // guest→host ページを閉じる/更新する直前の補助通知（枠は維持）
  // 生存確認
  PING: 'ping',
  PONG: 'pong',
  PRESENCE: 'presence', // { hidden } タブが非表示かどうか（生存確認の猶予を伸ばす）
});

export const REJECT_REASONS = Object.freeze({
  version: 'アプリのバージョンが異なります。ページを再読み込みしてください。',
  bad_key: '招待URLが正しくありません。ホストに新しいURLをもらってください。',
  room_full: 'この部屋はすでに2人そろっています。',
  bad_request: '参加リクエストが不正です。',
});

// ---- 値チェック用の小さなスキーマ ----
const str = (max) => (v) => typeof v === 'string' && v.length <= max;
const id = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const int = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const num = (min, max) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const bool = (v) => typeof v === 'boolean';
const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (max, item) => (v) => Array.isArray(v) && v.length <= max && (!item || v.every(item));
const opt = (f) => (v) => v === undefined || v === null || f(v);
const oneOf = (...vals) => (v) => vals.includes(v);

const MATCH = { matchId: id, gen: int(0, 1e9) };

const SCHEMAS = {
  join_request: { v: int(0, 1000), key: str(64), token: opt(str(64)) },
  join_accepted: { token: str(64), room: obj, rejoin: bool },
  join_rejected: { reason: str(32) },
  room_state: { room: obj },
  ready_change: { ready: bool },
  game_start: { gameId: id, snapshot: obj, ...MATCH },
  player_input: { ...MATCH, seq: int(0, 1e9), inputs: arr(32, int(0, 255)) },
  game_snapshot: { ...MATCH, seq: int(0, 1e9), snap: obj, ev: opt(arr(128, obj)) },
  game_msg: { ...MATCH, data: obj },
  game_result: { matchId: id, result: obj },
  pause: { ...MATCH, reason: str(16), snapshot: obj },
  resume: { ...MATCH, delayMs: num(0, 10000) },
  resume_ack: { ...MATCH },
  game_abort: { matchId: id },
  room_close: { reason: str(32) },
  leave: {},
  bye: {},
  ping: { t: num(0, 1e15) },
  pong: { t: num(0, 1e15) },
  presence: { hidden: bool },
};

export const FROM_GUEST = new Set([
  'join_request', 'ready_change', 'player_input', 'resume_ack', 'game_msg',
  'leave', 'bye', 'ping', 'pong', 'presence',
]);
export const FROM_HOST = new Set([
  'join_accepted', 'join_rejected', 'room_state', 'game_start', 'game_snapshot',
  'game_msg', 'game_result', 'pause', 'resume', 'game_abort', 'room_close',
  'ping', 'pong', 'presence',
]);

/** 小数を丸めて送信サイズを抑える */
function replacer(_key, v) {
  return typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v;
}

export function encode(msg) {
  return JSON.stringify(msg, replacer);
}

/**
 * 受信した生データを検証してメッセージにする。不正なら null。
 * @param {unknown} raw
 * @param {Set<string>} allowed 受け付ける type の集合
 */
export function decode(raw, allowed) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_MESSAGE_CHARS) return null;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj(msg) || typeof msg.type !== 'string' || !allowed.has(msg.type)) return null;
  const schema = SCHEMAS[msg.type];
  if (!schema) return null;
  for (const [key, check] of Object.entries(schema)) {
    if (!check(msg[key])) return null;
  }
  return msg;
}

// ---- 部屋の状態（ゲスト側で受信時に検証する） ----
const SCREENS = ['lobby', 'home', 'select', 'ready', 'game', 'result'];
const GUEST_LINK = ['none', 'connected', 'waiting', 'syncing'];
const MATCH_STATUS = ['loading', 'running', 'paused', 'resuming'];

export function sanitizeRoomState(r) {
  if (!obj(r)) return null;
  if (!oneOf(...SCREENS)(r.screen) || !oneOf(...GUEST_LINK)(r.guest)) return null;
  if (!int(0, 1e9)(r.rev) || !obj(r.ready)) return null;
  const room = {
    rev: r.rev,
    screen: r.screen,
    guest: r.guest,
    ready: { host: r.ready.host === true, guest: r.ready.guest === true },
    startInMs: num(0, 10000)(r.startInMs) ? r.startInMs : null,
    gameId: id(r.gameId) ? r.gameId : null,
    match: null,
    result: obj(r.result) ? r.result : null,
    hostHidden: r.hostHidden === true,
  };
  if (obj(r.match)) {
    const m = r.match;
    if (!id(m.matchId) || !int(0, 1e9)(m.gen) || !oneOf(...MATCH_STATUS)(m.status)) return null;
    room.match = {
      matchId: m.matchId,
      gen: m.gen,
      status: m.status,
      reason: str(16)(m.reason) ? m.reason : null,
      synced: m.synced === true,
      started: m.started === true,
    };
  }
  return room;
}

/** 結果オブジェクトを画面表示用に安全な形へ整える（文字列のみ・長さ制限） */
export function sanitizeResult(r) {
  const s = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  if (!obj(r)) return null;
  const player = (p) => ({
    headline: s(p?.headline, 24),
    detail: s(p?.detail, 60),
  });
  return {
    gameId: id(r.gameId) ? r.gameId : '',
    winner: r.winner === 'host' || r.winner === 'guest' ? r.winner : null,
    title: s(r.title, 60),
    host: player(r.host),
    guest: player(r.guest),
    stats: Array.isArray(r.stats)
      ? r.stats.slice(0, 16).filter(obj).map((x) => ({ label: s(x.label, 24), host: s(x.host), guest: s(x.guest) }))
      : [],
  };
}
