// 試合ごとの Durable Object: 「操作を受け取り、計算して、結果を全員に送る」だけをする計算役（サーバー計算）。
//
// 部屋の管理（ロビー・準備・設定・連戦・一時停止の判断・結果の表示）はこれまでどおりホストが行い、
// この Durable Object は試合の間だけ、ホストの「開始」の指示で作られて、計算と配信だけをする。
// 試合の名前（gid）はホストが決めた推測できない値で、参加者にだけ伝わる。
//
// つなぎ方: wss://<Worker>/game?gid=<試合ID>&slot=<席 0〜2>&key=<鍵>
//   席 0（ホスト）の鍵 = 管理用の鍵（最初につないだホストが決める）。席 1・2 の鍵 = ホストが開始のときに渡したチケット。
// メッセージは src/core/protocol.js の e_* と player_input / game_snapshot（JSON の文字列）。

import { DogKartEngine } from '../../src/games/dogKart/engine.js';
import { decode, encode, ENGINE_FROM_HOST, ENGINE_FROM_PLAYER } from '../../src/core/protocol.js';

const FIXED_DT = 1 / 60;
const NET_EVERY = 2; // 60Hz ÷ 2 = 毎秒 30 回配信
const MAX_STEPS = 8;
const MAX_FRAME_DT = 0.25;
const TICK_MS = 16;
const MAX_MATCH_MS = 20 * 60 * 1000; // 1 試合の上限（止め忘れの保険）
const IDLE_STOP_MS = 30 * 1000; // 誰もつながっていない時間がこれを超えたら計算をやめる
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export class Game {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.adminKey = null;
    this.tickets = []; // 席ごとのチケット
    this.engine = null;
    this.matchId = null;
    this.gen = 0;
    this.players = []; // 参加する席（車の番号の順）
    this.running = false;
    this.seq = 0;
    this.socks = new Set(); // { ws, slot }
    this._timer = null;
    this._startTimer = null;
    this._idleTimer = null;
    this._acc = 0;
    this._last = 0;
    this._netTick = 0;
    this._startedAt = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const slot = Number(url.searchParams.get('slot'));
    const key = url.searchParams.get('key') || '';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const refuse = (reason) => {
      try {
        server.send(encode({ type: 'e_error', reason }));
        server.close(4403, reason);
      } catch {
        /* noop */
      }
      return new Response(null, { status: 101, webSocket: client });
    };
    if (!Number.isInteger(slot) || slot < 0 || slot > 2 || !KEY_RE.test(key)) return refuse('bad-request');
    if (slot === 0) {
      // ホスト（管理者）: 最初につないだ鍵がこの試合の管理用の鍵になる
      if (!this.adminKey) this.adminKey = key;
      else if (key !== this.adminKey) return refuse('forbidden');
    } else if (!this.tickets[slot] || key !== this.tickets[slot]) {
      return refuse('forbidden');
    }
    // 同じ席の古い接続は閉じて、新しい接続に切り替える（再接続）
    for (const c of [...this.socks]) {
      if (c.slot === slot) {
        this.socks.delete(c);
        try {
          c.ws.close(4000, 'replaced');
        } catch {
          /* noop */
        }
      }
    }
    const conn = { ws: server, slot };
    this.socks.add(conn);
    clearTimeout(this._idleTimer);
    this._idleTimer = null;
    server.addEventListener('message', (ev) => this.onMessage(conn, ev.data));
    const gone = () => this.onGone(conn);
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(conn, msg) {
    try {
      conn.ws.send(typeof msg === 'string' ? msg : encode(msg));
    } catch {
      /* 切れかけ。close のイベントで片付く */
    }
  }

  broadcast(msg) {
    const text = encode(msg);
    for (const c of this.socks) this.send(c, text);
  }

  onGone(conn) {
    if (!this.socks.delete(conn)) return; // 置き換え済み
    if (!this.socks.size) {
      // 全員いなくなった: しばらく待って、戻ってこなければ計算をやめる
      this._idleTimer = setTimeout(() => this.stop(), IDLE_STOP_MS);
    }
  }

  onMessage(conn, raw) {
    const host = conn.slot === 0;
    const msg = decode(raw, host ? ENGINE_FROM_HOST : ENGINE_FROM_PLAYER);
    if (!msg) return;
    switch (msg.type) {
      case 'e_ping':
        this.send(conn, { type: 'e_pong', t: msg.t });
        break;
      case 'e_start':
        if (host) this.start(conn, msg);
        break;
      case 'e_sync':
        if (host && this.engine) {
          this.pause();
          this.gen = msg.gen;
          // 全員に完全な状態を送る。受け取った人は読み込んで、ホストに「読み込みました」と伝える（部屋の通信で）
          for (const c of this.socks) this.sendFull(c);
        }
        break;
      case 'e_sync_request':
        if (this.engine) this.sendFull(conn);
        break;
      case 'e_pause':
        if (host) this.pause();
        break;
      case 'e_resume':
        if (host && this.engine) this.resume(msg.gen, msg.delayMs);
        break;
      case 'e_abort':
        if (host) this.stop();
        break;
      case 'e_debug':
        // 開発・テスト用: ALLOW_DEBUG=1 のときだけ（本番では設定されていないので無視される）
        if (host && this.env.ALLOW_DEBUG === '1' && this.engine) this.debug(msg.op, msg.args || {});
        break;
      case 'player_input': {
        if (!this.running || !this.engine || msg.matchId !== this.matchId || msg.gen !== this.gen) break;
        const player = this.players.indexOf(conn.slot);
        if (player >= 0) this.engine.receiveInput(player, msg.seq, msg.inputs);
        break;
      }
      default:
        break;
    }
  }

  debug(op, a) {
    const sim = this.engine.sim;
    if (op === 'nearFinish') {
      // 車 a.kart を最終ラップのゴール手前に置き、ほかの車は止める
      for (const k of sim.s.karts) k.sp = 0;
      const k = sim.s.karts[a.kart | 0];
      const p = sim.track.pointAt(sim.track.length - 12, 0);
      Object.assign(k, { x: p.x, z: p.z, h: p.h, sp: 26, kx: 0, kz: 0, lap: 2, cp: sim.track.checkpoints - 1 });
      k.stats.foods = 4;
      k.stats.bumps = 1;
    } else if (op === 'item') {
      sim.s.karts[a.kart | 0].item = a.item | 0;
    }
  }

  sendFull(conn) {
    this.send(conn, { type: 'e_full', matchId: this.matchId, gen: this.gen, snapshot: this.engine.getSnapshot() });
  }

  start(conn, msg) {
    if (this.engine) {
      // 同じ試合の再送は無視。別の試合なら作り直す
      if (this.matchId === msg.matchId) return this.send(conn, { type: 'e_started', matchId: this.matchId });
      this.stop(false);
    }
    const players = msg.players.filter((v, i, a) => a.indexOf(v) === i);
    if (players.length < 2 || players[0] !== 0) return this.send(conn, { type: 'e_error', reason: 'bad-players' });
    const o = msg.options || {};
    const int = (v, d, lo, hi) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d);
    try {
      this.engine = new DogKartEngine({ course: int(o.course, 0, 0, 99), npcs: int(o.npcs, 0, 0, 9), boss: int(o.boss, 0, 0, 1), players });
    } catch (err) {
      return this.send(conn, { type: 'e_error', reason: 'engine-failed' });
    }
    this.matchId = msg.matchId;
    this.gen = msg.gen;
    this.players = players;
    this.tickets = [null, null, null];
    for (const slot of players) if (slot > 0 && KEY_RE.test(msg.tickets[slot] || '')) this.tickets[slot] = msg.tickets[slot];
    this.seq = 0;
    this._startedAt = Date.now();
    this.send(conn, { type: 'e_started', matchId: this.matchId });
  }

  pause() {
    clearTimeout(this._startTimer);
    this._startTimer = null;
    this.running = false;
    clearInterval(this._timer);
    this._timer = null;
    this.engine?.clearQueues();
  }

  resume(gen, delayMs) {
    this.pause();
    this.gen = gen;
    this._startTimer = setTimeout(() => {
      this._startTimer = null;
      this.running = true;
      this._acc = 0;
      this._last = performance.now();
      this._timer = setInterval(() => this.tick(), TICK_MS);
    }, delayMs);
  }

  tick() {
    if (!this.running || !this.engine) return;
    const now = performance.now();
    const dt = Math.min(Math.max(0, (now - this._last) / 1000), MAX_FRAME_DT);
    this._last = now;
    this._acc += dt;
    let steps = 0;
    let due = false;
    while (this._acc >= FIXED_DT && steps < MAX_STEPS && this.running) {
      this.engine.step(FIXED_DT);
      this._acc -= FIXED_DT;
      steps++;
      if (++this._netTick % NET_EVERY === 0) due = true;
      const result = this.engine.takeResult();
      if (result) {
        this.pause();
        this.broadcast({ type: 'game_snapshot', matchId: this.matchId, gen: this.gen, seq: ++this.seq, snap: this.engine.encode(), ev: this.engine.drainNetEvents() });
        this.broadcast({ type: 'e_result', matchId: this.matchId, result });
        return;
      }
    }
    // 配信は 1 回の呼び出しで 1 回だけ（遅れを取り戻すために続けて計算したときも、同じ時刻の状態を何通も送らない。届く間隔が揃う）
    if (due && this.running) {
      this.broadcast({ type: 'game_snapshot', matchId: this.matchId, gen: this.gen, seq: ++this.seq, snap: this.engine.encode(), ev: this.engine.drainNetEvents() });
    }
    if (steps >= MAX_STEPS) this._acc = 0;
    if (Date.now() - this._startedAt > MAX_MATCH_MS) this.stop();
  }

  /** 計算をやめて、みんなの接続も閉じる */
  stop(closeSockets = true) {
    this.pause();
    clearTimeout(this._idleTimer);
    this._idleTimer = null;
    this.engine = null;
    this.matchId = null;
    this.tickets = [];
    if (closeSockets) {
      for (const c of [...this.socks]) {
        this.socks.delete(c);
        try {
          c.ws.close(1000, 'done');
        } catch {
          /* noop */
        }
      }
      this.adminKey = null;
    }
  }
}
