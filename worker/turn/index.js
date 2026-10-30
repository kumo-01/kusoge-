// Cloudflare Worker: Cloudflare Realtime TURN の「短時間だけ有効な認証情報」を配る。
//
// TURN のキー（TURN_KEY_API_TOKEN）はこの Worker の中だけに置き、ブラウザには渡しません。
// ブラウザには、数時間で切れる接続用の ID とパスワードだけを返します。
//   GET /  →  { "iceServers": [ { urls: [...], username, credential }, ... ] }
//
// 設定（wrangler の secret / vars）:
//   TURN_KEY_ID         Cloudflare ダッシュボードで作った TURN キーの ID
//   TURN_KEY_API_TOKEN  その TURN キーの API トークン（secret）
//   ALLOWED_ORIGINS     呼び出しを許可するサイト（カンマ区切り。例: https://user.github.io）。空なら制限なし

const TTL_SECONDS = 6 * 60 * 60; // 認証情報の有効期間
const CACHE_SECONDS = 60 * 60; // Worker 側で使い回す時間（Cloudflare API の呼び出しを減らす）

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // ブラウザ以外（Origin なし）は通す。ブラウザからは許可したサイトだけ
    const originOk = allowed.length === 0 || !origin || allowed.includes(origin);
    const cors = corsHeaders(allowed.length === 0 ? '*' : originOk ? origin : allowed[0]);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: cors });
    if (!originOk) return new Response('forbidden', { status: 403, headers: cors });
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return new Response('not configured', { status: 503, headers: cors });

    const cacheKey = new Request(`https://turn-credentials.invalid/${env.TURN_KEY_ID}`);
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const hit = cache ? await cache.match(cacheKey) : null;
    if (hit) return new Response(hit.body, { status: 200, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });

    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    });
    if (!res.ok) return new Response('upstream error', { status: 502, headers: cors });
    const data = await res.json();
    const iceServers = Array.isArray(data?.iceServers) ? data.iceServers : data?.iceServers ? [data.iceServers] : [];
    const body = JSON.stringify({ iceServers });
    if (cache) await cache.put(cacheKey, new Response(body, { headers: { 'cache-control': `max-age=${CACHE_SECONDS}` } }));
    return new Response(body, { status: 200, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });
  },
};
