// TURN（中継）の認証情報の取得と、それを配る Worker の単体テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeIceServers, loadIceServers, _resetIceCache } from '../src/core/ice.js';
import worker from '../worker/turn/index.js';

const okResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const GOOD = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }] };

test('sanitizeIceServers: 正しい形だけ通し、不正な URL・認証なしの TURN は捨てる', () => {
  const s = sanitizeIceServers(GOOD);
  assert.equal(s.length, 1);
  assert.equal(s[0].username, 'u');
  assert.equal(sanitizeIceServers(null), null);
  assert.equal(sanitizeIceServers({}), null);
  assert.equal(sanitizeIceServers({ iceServers: [{ urls: ['http://evil.example/'] }] }), null);
  assert.equal(sanitizeIceServers({ iceServers: [{ urls: ['turn:x.example:3478'] }] }), null, 'turn needs credentials');
  assert.deepEqual(sanitizeIceServers([{ urls: 'stun:a.example:3478' }]), [{ urls: ['stun:a.example:3478'] }]);
  const many = { iceServers: Array.from({ length: 20 }, () => ({ urls: ['stun:a.example:1'] })) };
  assert.ok(sanitizeIceServers(many).length <= 6);
});

test('loadIceServers: URL 未設定なら null（PeerJS の既定値のまま）', async () => {
  _resetIceCache();
  assert.equal(await loadIceServers({ url: '' }), null);
});

test('loadIceServers: 取得できれば STUN の既定値＋TURN を返し、しばらくは使い回す', async () => {
  _resetIceCache();
  let calls = 0;
  const fetchImpl = async () => (calls++, okResponse(GOOD));
  const a = await loadIceServers({ url: 'https://x.example/', fetchImpl, now: () => 1000 });
  assert.ok(a.length >= 2);
  assert.ok(a.some((s) => s.username === 'u'));
  assert.ok(a[0].urls.some((u) => u.startsWith('stun:')));
  const b = await loadIceServers({ url: 'https://x.example/', fetchImpl, now: () => 2000 });
  assert.equal(calls, 1, 'cached');
  assert.equal(b, a);
  await loadIceServers({ url: 'https://x.example/', fetchImpl, now: () => 1000 + 21 * 60 * 1000 });
  assert.equal(calls, 2, 'refetched after the cache time');
});

test('loadIceServers: 失敗・不正な返事・遅すぎるときは null（遊べなくならない）。前回の値があればそれを使う', async () => {
  _resetIceCache();
  assert.equal(await loadIceServers({ url: 'https://x.example/', fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await loadIceServers({ url: 'https://x.example/', fetchImpl: async () => okResponse({}, 500) }), null);
  assert.equal(await loadIceServers({ url: 'https://x.example/', fetchImpl: async () => okResponse({ iceServers: 'x' }) }), null);
  // 遅すぎる（中断される）
  const slow = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  const t0 = Date.now();
  assert.equal(await loadIceServers({ url: 'https://x.example/', fetchImpl: slow }), null);
  assert.ok(Date.now() - t0 < 5000);
  // 一度取れたあとに失敗しても、前回の値を使う
  _resetIceCache();
  const first = await loadIceServers({ url: 'https://x.example/', fetchImpl: async () => okResponse(GOOD), now: () => 0 });
  const later = await loadIceServers({ url: 'https://x.example/', fetchImpl: async () => { throw new Error('x'); }, now: () => 60 * 60 * 1000 });
  assert.equal(later, first);
});

test('Worker: 許可したサイトだけに認証情報を返し、TURN のキーは返さない', async () => {
  const env = { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'secret-token', ALLOWED_ORIGINS: 'https://ok.example' };
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.authorization, body: init.body });
    return { ok: true, json: async () => GOOD };
  };
  try {
    const ok = await worker.fetch(new Request('https://w.example/', { headers: { Origin: 'https://ok.example' } }), env);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://ok.example');
    const text = await ok.text();
    assert.ok(!text.includes('secret-token'), 'api token is never returned');
    assert.equal(JSON.parse(text).iceServers[0].username, 'u');
    assert.equal(seen.length, 1);
    assert.ok(seen[0].url.includes('/turn/keys/kid/credentials/generate-ice-servers'));
    assert.equal(seen[0].auth, 'Bearer secret-token');
    assert.ok(JSON.parse(seen[0].body).ttl > 3600);
    // 許可されていないサイトは拒否（Cloudflare へも問い合わせない）
    const ng = await worker.fetch(new Request('https://w.example/', { headers: { Origin: 'https://evil.example' } }), env);
    assert.equal(ng.status, 403);
    assert.equal(seen.length, 1);
    // OPTIONS（CORS の事前確認）と、GET 以外
    assert.equal((await worker.fetch(new Request('https://w.example/', { method: 'OPTIONS', headers: { Origin: 'https://ok.example' } }), env)).status, 204);
    assert.equal((await worker.fetch(new Request('https://w.example/', { method: 'POST' }), env)).status, 405);
    // 未設定
    assert.equal((await worker.fetch(new Request('https://w.example/'), { ALLOWED_ORIGINS: '' })).status, 503);
    // Cloudflare 側のエラー
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    assert.equal((await worker.fetch(new Request('https://w.example/', { headers: { Origin: 'https://ok.example' } }), env)).status, 502);
  } finally {
    globalThis.fetch = real;
  }
});
