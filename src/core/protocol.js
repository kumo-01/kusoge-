// 通信プロトコル: メッセージ種別・エンコード・受信データの検証。
//
// すべてのメッセージは { type: string, ...payload } の JSON。
// PeerJS の DataConnection は serialization: 'raw' で使い、文字列の長さを
// パース前に確認してから JSON.parse する（巨大データでクラッシュさせないため）。

export const PROTOCOL_VERSION = 7; // 7: 車ごとの今の操作（in）を配信に入れた / 6: 6: 配信の形を小さく（車は変わった項目だけ）/ 5: 3 人対戦（部屋の状態・結果の形が変わった） / 4: 飼い主・豪雨・犬小屋のアイテム化で状態の形が変わった（3: ドッグフード・ボス犬・連戦）（古いページとは遊べないように）

/** 1 メッセージの最大文字数 */
export const MAX_MESSAGE_CHARS = 60000;

/** 部屋の人数（席 0 = ホスト, 1・2 = ゲスト） */
export const MAX_PLAYERS = 3;

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
  room_full: 'この部屋はすでに3人そろっています。',
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
  join_accepted: { token: str(64), room: obj, rejoin: bool, fast: opt(str(32)), slot: int(1, MAX_PLAYERS - 1) },
  join_rejected: { reason: str(32) },
  room_state: { room: obj },
  ready_change: { ready: bool },
  game_start: { gameId: id, snapshot: obj, server: opt(obj), ...MATCH }, // server: サーバー計算の試合のとき { gid, ticket }（snapshot は空）
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
  // ---- サーバー計算（試合ごとの Cloudflare Durable Object）との通信 ----
  // ホスト → サーバー（部屋の管理者だけが送れる）
  e_start: { matchId: id, gen: int(0, 1e9), options: obj, players: arr(3, int(0, 2)), tickets: arr(3, str(64)) },
  e_sync: { gen: int(0, 1e9) }, // 状態を揃える: 計算を止めて、全員に完全な状態を送る
  e_pause: {},
  e_resume: { gen: int(0, 1e9), delayMs: num(0, 10000) },
  e_abort: {},
  e_debug: { op: str(20), args: obj }, // 開発用（サーバー側の変数 ALLOW_DEBUG=1 のときだけ動く。本番では無視される）
  // 誰からでも
  e_sync_request: {}, // 自分に完全な状態を送ってほしい（再接続したときなど）
  e_ping: { t: num(0, 1e15) },
  // サーバー → 全員（game_snapshot は部屋の通信と同じ形）
  e_started: { matchId: id },
  e_full: { matchId: id, gen: int(0, 1e9), snapshot: obj },
  e_result: { matchId: id, result: obj },
  e_error: { reason: str(40) },
  e_pong: { t: num(0, 1e15), colo: opt(str(8)), dc: opt(str(8)) }, // colo: 自分がつながった Cloudflare の拠点、dc: 計算役の拠点（診断用）
};

export const FROM_GUEST = new Set([
  'join_request', 'ready_change', 'player_input', 'resume_ack', 'game_msg',
  'leave', 'bye', 'ping', 'pong', 'presence',
]);
/** サーバー計算の通信（worker/relay/game.js ⇔ src/core/engineClient.js） */
export const ENGINE_FROM_HOST = new Set(['e_start', 'e_sync', 'e_pause', 'e_resume', 'e_abort', 'e_debug', 'e_sync_request', 'e_ping', 'player_input']);
export const ENGINE_FROM_PLAYER = new Set(['e_sync_request', 'e_ping', 'player_input']);
export const ENGINE_TO_CLIENT = new Set(['e_started', 'e_full', 'game_snapshot', 'e_result', 'e_error', 'e_pong']);

/** 高速チャンネル（順不同）で受け付けるもの */
export const FAST_FROM_GUEST = new Set(['player_input']);
export const FAST_FROM_HOST = new Set(['game_snapshot']);

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

function cleanOptions(o) {
  const out = {};
  if (obj(o)) {
    for (const [k, v] of Object.entries(o).slice(0, 12)) {
      if (/^[A-Za-z]{1,16}$/.test(k) && (int(0, 99)(v) || str(16)(v) || bool(v))) out[k] = v;
    }
  }
  return out;
}

/** 連戦の途中経過（何戦目か・席ごとの合計ポイント・各レースのポイント） */
function cleanSeries(r) {
  if (!obj(r) || !int(2, 12)(r.total) || !int(1, 12)(r.round)) return null;
  const pt = (v) => (int(0, 99999)(v) ? v : 0);
  const name = (v) => (typeof v === 'string' ? v.slice(0, 30) : '');
  const pts = (a) => Array.from({ length: MAX_PLAYERS }, (_, i) => pt(Array.isArray(a) ? a[i] : 0));
  return {
    total: r.total,
    round: r.round,
    scores: pts(r.scores),
    final: r.final === true,
    history: Array.isArray(r.history) ? r.history.slice(0, 12).filter(obj).map((x) => ({ name: name(x.name), points: pts(x.points) })) : [],
  };
}

export function sanitizeRoomState(r) {
  if (!obj(r)) return null;
  if (!oneOf(...SCREENS)(r.screen) || !Array.isArray(r.players) || r.players.length !== MAX_PLAYERS) return null;
  if (!int(0, 1e9)(r.rev)) return null;
  const players = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = r.players[i];
    if (!obj(p) || !oneOf(...GUEST_LINK)(p.link)) return null;
    players.push({ link: i === 0 ? 'connected' : p.link, ready: p.ready === true });
  }
  const room = {
    rev: r.rev,
    screen: r.screen,
    players,
    startInMs: num(0, 10000)(r.startInMs) ? r.startInMs : null,
    gameId: id(r.gameId) ? r.gameId : null,
    options: cleanOptions(r.options),
    match: null,
    series: cleanSeries(r.series),
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
      server: m.server === true, // サーバーが計算する試合か
      players: Array.isArray(m.players) ? m.players.filter((v, i, a) => int(0, MAX_PLAYERS - 1)(v) && a.indexOf(v) === i).slice(0, MAX_PLAYERS) : [0, 1],
      opts: cleanOptions(m.opts), // このレースで実際に使う設定（ランダムは確定した値）
    };
  }
  return room;
}

/** 結果オブジェクトを画面表示用に安全な形へ整える（文字列のみ・長さ制限）。values / points は人間の順（players の順） */
export function sanitizeResult(r) {
  const s = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  if (!obj(r)) return null;
  const players = Array.isArray(r.players) ? r.players.slice(0, MAX_PLAYERS).filter(obj) : [];
  if (players.length < 2) return null;
  const n = players.length;
  const rows = (a, max) =>
    Array.isArray(a)
      ? a.slice(0, max).filter(obj).map((x) => (typeof x.text === 'string' ? { label: s(x.label, 24), text: s(x.text, 120) } : { label: s(x.label, 24), values: Array.from({ length: n }, (_, i) => s(Array.isArray(x.values) ? x.values[i] : '')) }))
      : [];
  const pts = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(99999, Math.round(v))) : 0);
  return {
    gameId: id(r.gameId) ? r.gameId : '',
    winner: int(0, MAX_PLAYERS - 1)(r.winner) ? r.winner : null,
    title: s(r.title, 60),
    players: players.map((p) => ({ slot: int(0, MAX_PLAYERS - 1)(p.slot) ? p.slot : 0, headline: s(p.headline, 24), detail: s(p.detail, 60) })),
    stats: rows(r.stats, 16),
    score: rows(r.score, 10),
    course: s(r.course, 30),
    points: Array.isArray(r.points) ? Array.from({ length: n }, (_, i) => pts(r.points[i])) : null,
  };
}
