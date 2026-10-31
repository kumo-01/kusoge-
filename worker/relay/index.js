// Cloudflare Worker + Durable Object: 通信の中継サーバー（ロビー）と、試合ごとの計算役（game.js）。
//
// ホストとゲストを、Cloudflare の中継（WebSocket）でつなぐ。1 つの部屋 = 1 つの Durable Object。
// 無料プランで動く（SQLite 版の Durable Object。WebSocket Hibernation を使い、待機中は課金対象の実行時間を使わない）。
// メッセージの中身は見ない・保存しない（そのまま相手へ渡すだけ）。
//
// 接続:  wss://<このWorker>/ws?room=<部屋ID>&role=host&hs=<ホストの合言葉>
//        wss://<このWorker>/ws?room=<部屋ID>&role=guest&meta=<JSON>
//   ホストは 1 本の接続で、複数の「ゲスト側の接続」をまとめて受ける（PeerJS の DataConnection と同じ使い方）。
//
// ホストへの 1 メッセージ（文字列）の形式:
//   "!c<id>:<meta>"  ゲスト側の接続 <id> ができた
//   "!x<id>"         ゲスト側の接続 <id> が切れた
//   "<id>:<本文>"    ゲスト <id> からの本文
// ホストからの送信:
//   "<id>:<本文>"    ゲスト <id> へ送る
//   "!x<id>"         ゲスト <id> の接続を切る
// ゲストへは本文をそのまま渡す。最初に "!ok"（接続できた）か "!no"（ホスト不在など）が届く。

// サーバーの版。ゲームの計算（src/games/dogKart/ の engine・race・physics など）を変えたら、ここも上げる。
// Cloudflare の自動ビルドは worker/relay/ の変更でしか動かないことがあるため（/health で今の版を確認できる）
const SERVER_VERSION = '2026-10-31.2';

const ROOM_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_MESSAGE = 70000; // アプリ側の上限（60000 文字）より少し大きく
const MAX_GUEST_CONNECTIONS = 12; // 同時に受ける「ゲスト側の接続」の数
const MAX_META = 300;
const IDLE_CLEANUP_MS = 10 * 60 * 1000; // ホストがいなくなってから部屋の記録を消すまで

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'wanwan-relay', version: SERVER_VERSION }), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
    }
    if (url.pathname !== '/ws' && url.pathname !== '/game') return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });

    // ブラウザからは許可したサイトだけ（他のサイトのページに無料枠を使われないように）
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    if (allowed.length && origin && !allowed.includes(origin)) return new Response('forbidden', { status: 403 });

    if (url.pathname === '/game') {
      // サーバー計算（試合ごと）。試合 ID（gid）は推測できない値で、参加者にだけ渡される
      const gid = url.searchParams.get('gid') || '';
      if (!/^[A-Za-z0-9]{24,64}$/.test(gid)) return new Response('bad request', { status: 400 });
      // 診断用: その人がつながった Cloudflare の拠点（空港コード）を試合の計算役へ渡す
      const fwd = new Request(request);
      fwd.headers.set('x-edge-colo', String(request.cf?.colo || '').slice(0, 8));
      return env.GAMES.get(env.GAMES.idFromName(gid)).fetch(fwd);
    }
    const room = url.searchParams.get('room') || '';
    const role = url.searchParams.get('role');
    if (!ROOM_RE.test(room) || (role !== 'host' && role !== 'guest')) return new Response('bad request', { status: 400 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
    return stub.fetch(request);
  },
};

export { Game } from './game.js';

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  /** いま使えるホストの接続（切れかけのものは除く。新しいものを優先） */
  hostSocket() {
    const list = this.state.getWebSockets('host').filter((w) => w.readyState === 1);
    return list[list.length - 1] || null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (role === 'host') {
      const hs = (url.searchParams.get('hs') || '').slice(0, 100);
      const saved = await this.state.storage.get('hs');
      if (saved && saved !== hs) {
        // すでに別のホストが使っている部屋 ID
        this.state.acceptWebSocket(server, ['reject']);
        server.send('!no');
        server.close(4403, 'taken');
        return new Response(null, { status: 101, webSocket: client });
      }
      if (!saved) await this.state.storage.put('hs', hs);
      await this.state.storage.deleteAlarm();
      const old = this.hostSocket();
      if (old) {
        // ホストの再接続: 古い接続は閉じる。古い接続につながっていたゲストは、つなぎ直してもらう
        try {
          old.close(4000, 'replaced');
        } catch {
          /* noop */
        }
        this.closeGuests('host-replaced');
      }
      this.state.acceptWebSocket(server, ['host']);
      server.send('!ok');
      return new Response(null, { status: 101, webSocket: client });
    }

    // ゲスト側の接続
    const host = this.hostSocket();
    const count = this.state.getWebSockets('guest').length;
    if (!host || count >= MAX_GUEST_CONNECTIONS) {
      this.state.acceptWebSocket(server, ['reject']);
      server.send('!no');
      server.close(4404, host ? 'full' : 'no-host');
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
    const meta = (url.searchParams.get('meta') || '').slice(0, MAX_META);
    this.state.acceptWebSocket(server, ['guest', `g${id}`]);
    try {
      host.send(`!c${id}:${meta}`);
    } catch {
      /* ホストが切れかけ。ゲスト側は webSocketClose で後始末される */
    }
    server.send('!ok');
    return new Response(null, { status: 101, webSocket: client });
  }

  closeGuests(reason) {
    for (const g of this.state.getWebSockets('guest')) {
      try {
        g.close(4001, reason);
      } catch {
        /* noop */
      }
    }
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) {
      try {
        ws.close(1009, 'bad message');
      } catch {
        /* noop */
      }
      return;
    }
    const tags = this.state.getTags(ws);
    if (tags[0] === 'host') {
      if (message.startsWith('!x')) {
        const g = this.state.getWebSockets(`g${message.slice(2)}`)[0];
        if (g) {
          try {
            g.close(1000, 'closed by host');
          } catch {
            /* noop */
          }
        }
        return;
      }
      const i = message.indexOf(':');
      if (i < 1 || i > 12) return;
      const g = this.state.getWebSockets(`g${message.slice(0, i)}`)[0];
      if (g) {
        try {
          g.send(message.slice(i + 1));
        } catch {
          /* noop */
        }
      }
    } else if (tags[0] === 'guest') {
      const host = this.hostSocket();
      if (host) {
        try {
          host.send(`${tags[1].slice(1)}:${message}`);
        } catch {
          /* noop */
        }
      }
    }
  }

  async webSocketClose(ws) {
    await this.onGone(ws);
  }

  async webSocketError(ws) {
    await this.onGone(ws);
  }

  async onGone(ws) {
    const tags = this.state.getTags(ws);
    try {
      ws.close();
    } catch {
      /* noop */
    }
    if (tags[0] === 'host') {
      // ホストがいなくなったら、ゲスト側の接続は全部切る（つなぎ直してもらう）。しばらくしたら部屋の記録も消す
      if (!this.hostSocket()) {
        this.closeGuests('host-gone');
        await this.state.storage.setAlarm(Date.now() + IDLE_CLEANUP_MS);
      }
    } else if (tags[0] === 'guest') {
      const host = this.hostSocket();
      if (host) {
        try {
          host.send(`!x${tags[1].slice(1)}`);
        } catch {
          /* noop */
        }
      }
    }
  }

  async alarm() {
    if (!this.hostSocket()) await this.state.storage.deleteAll();
  }
}
