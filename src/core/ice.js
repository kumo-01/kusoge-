// ICE サーバー（STUN / TURN）の取得。
//
// 通常は P2P（ホストとゲストが直接つながる）で、遅くなりません。直接つなげないネットワークのときだけ
// TURN（中継）を使います。TURN の認証情報は Cloudflare Realtime TURN（無料枠あり）の短時間だけ有効な
// ものを、小さな Cloudflare Worker（worker/turn/）から取ります。Worker の URL はビルド時の環境変数
// VITE_TURN_URL で指定します。未設定・取得失敗のときは PeerJS の既定値（STUN など）のまま遊べます。

const DEFAULT_STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const FETCH_TIMEOUT_MS = 3000;
const CACHE_MS = 20 * 60 * 1000; // 認証情報の再取得までの時間（Worker 側の有効期限より十分短い）

let cache = null; // { at, servers }
let inflight = null;

const SCHEME = /^(stun|stuns|turn|turns):[^\s]{1,200}$/;

/** Worker が返した iceServers を検証して、安全な形だけ取り出す。不正なら null */
export function sanitizeIceServers(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.iceServers) ? raw.iceServers : raw?.iceServers ? [raw.iceServers] : null;
  if (!list) return null;
  const out = [];
  for (const s of list.slice(0, 6)) {
    if (!s || typeof s !== 'object') continue;
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => typeof u === 'string' && SCHEME.test(u)).slice(0, 8);
    if (!urls.length) continue;
    const needsAuth = urls.some((u) => u.startsWith('turn'));
    if (needsAuth && !(typeof s.username === 'string' && typeof s.credential === 'string' && s.username.length < 300 && s.credential.length < 300)) continue;
    out.push(needsAuth ? { urls, username: s.username, credential: s.credential } : { urls });
  }
  return out.length ? out : null;
}

/**
 * 使う ICE サーバーの一覧を返す。TURN を設定していない・取得できないときは null
 * （null のときは PeerJS の既定値をそのまま使う）。
 * @param {{ url?: string, fetchImpl?: typeof fetch, now?: () => number }} [opts]
 */
export async function loadIceServers(opts = {}) {
  const url = opts.url ?? import.meta.env?.VITE_TURN_URL;
  if (!url) return null;
  const nowMs = (opts.now || Date.now)();
  if (cache && nowMs - cache.at < CACHE_MS) return cache.servers;
  if (inflight) return inflight;
  const doFetch = opts.fetchImpl || globalThis.fetch;
  inflight = (async () => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await doFetch(url, { cache: 'no-store', signal: ctl?.signal });
      if (!res.ok) return cache?.servers ?? null;
      const turn = sanitizeIceServers(await res.json());
      if (!turn) return cache?.servers ?? null;
      const servers = [...DEFAULT_STUN, ...turn];
      cache = { at: nowMs, servers };
      return servers;
    } catch {
      return cache?.servers ?? null; // 取れなくても、いつもの接続（STUN）で遊べる
    } finally {
      clearTimeout(timer);
      inflight = null;
    }
  })();
  return inflight;
}

/** テスト用 */
export function _resetIceCache() {
  cache = null;
  inflight = null;
}
