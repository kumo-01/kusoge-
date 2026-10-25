// 再参加情報（sessionStorage）と招待URLの読み書き。
//
// sessionStorage はタブごとに独立し、ページ更新では残るがタブを閉じると消える。
// そのため「同じタブでの更新」からの自動再参加だけを保証する。

const SESSION_KEY = 'wanwan.guestSession.v1';
const ROOM_RE = /^[A-Za-z0-9-]{8,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function saveGuestSession({ room, key, token }) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ room, key, token, savedAt: Date.now() }));
  } catch {
    // プライベートモード等で保存できなくてもゲームは続行できる（更新時の自動復帰ができないだけ）
  }
}

export function loadGuestSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !ROOM_RE.test(s.room) || !TOKEN_RE.test(s.key) || !TOKEN_RE.test(s.token)) return null;
    return { room: s.room, key: s.key, token: s.token };
  } catch {
    return null;
  }
}

export function clearGuestSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}

/** 現在の URL から招待情報 (?room=...&key=...) を読む */
export function readInviteParams() {
  const url = new URL(window.location.href);
  const room = url.searchParams.get('room');
  const key = url.searchParams.get('key');
  if (!room && !key) return null;
  if (!room || !key || !ROOM_RE.test(room) || !TOKEN_RE.test(key)) return { invalid: true };
  return { room, key };
}

/** 招待パラメータをアドレスバーから消す（解散後などに更新で再接続しないように） */
export function clearInviteParams() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('room') && !url.searchParams.has('key')) return;
  url.searchParams.delete('room');
  url.searchParams.delete('key');
  history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
}

/**
 * 招待URLを作る。GitHub Pages のサブディレクトリ配信でも壊れないよう、
 * 現在のページ URL を基準に URL オブジェクトで組み立てる。
 */
export function buildInviteUrl(room, key) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', room);
  url.searchParams.set('key', key);
  return url.toString();
}

/** 再接続間隔（だんだん伸ばす） */
export function backoffDelay(attempt, base = 800, max = 4000) {
  return Math.min(max, Math.round(base * Math.pow(1.5, attempt)));
}
