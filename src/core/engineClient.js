// サーバー計算の試合（worker/relay/game.js）への接続。操作を送り、状態を受け取る。
// 切れたら自動でつなぎ直す（つなぎ直したあとの「完全な状態の取り直し」は GameManager が行う）。

import { Emitter, now } from './util.js';
import { encode, decode, ENGINE_TO_CLIENT } from './protocol.js';

const RECONNECT_DELAYS = [400, 800, 1500, 2500, 4000, 4000, 4000, 4000, 4000, 4000];

export class EngineClient extends Emitter {
  /** @param {{ base: string, gid: string, slot: number, key: string }} o  base は wss://… の形（relayBase()） */
  constructor({ base, gid, slot, key }) {
    super();
    this.url = `${base}/game?gid=${encodeURIComponent(gid)}&slot=${slot}&key=${encodeURIComponent(key)}`;
    this.ws = null;
    this.open = false;
    this.closed = false; // 自分から閉じた
    this.everOpened = false;
    this.rtt = null;
    this._attempt = 0;
    this._retry = null;
    this._ping = null;
    this._connect();
  }

  _connect() {
    if (this.closed) return;
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this._scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      const reopened = this.everOpened;
      this.open = true;
      this.everOpened = true;
      this._attempt = 0;
      clearInterval(this._ping);
      this._ping = setInterval(() => this.send({ type: 'e_ping', t: now() }), 1000);
      this.emit('open', { reopened });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      const msg = decode(ev.data, ENGINE_TO_CLIENT);
      if (!msg) return;
      if (msg.type === 'e_pong') {
        const rtt = now() - msg.t;
        if (rtt >= 0 && rtt < 60000) this.rtt = this.rtt == null ? rtt : this.rtt * 0.7 + rtt * 0.3;
        return;
      }
      this.emit('message', msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      const was = this.open;
      this.open = false;
      clearInterval(this._ping);
      if (this.closed) return;
      // 4403: 鍵が違う・まだ試合がない（再接続しても無駄）
      if (ev.code === 4403) {
        this.emit('refused');
        return;
      }
      if (was) this.emit('lost');
      this._scheduleRetry();
    };
    ws.onerror = () => {
      /* onclose で扱う */
    };
  }

  _scheduleRetry() {
    if (this.closed) return;
    if (this._attempt >= RECONNECT_DELAYS.length) {
      this.emit('failed');
      return;
    }
    this._retry = setTimeout(() => this._connect(), RECONNECT_DELAYS[this._attempt++]);
  }

  /** つながるまで待つ（つながらなければ reject） */
  whenOpen(timeoutMs = 6000) {
    if (this.open) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => done(reject, new Error('engine-open-timeout')), timeoutMs);
      const offOpen = this.on('open', () => done(resolve));
      const offRef = this.on('refused', () => done(reject, new Error('engine-refused')));
      function done(fn, v) {
        clearTimeout(t);
        offOpen();
        offRef();
        fn(v);
      }
    });
  }

  send(msg) {
    if (!this.open || this.ws?.readyState !== 1) return false;
    try {
      this.ws.send(encode(msg));
      return true;
    } catch {
      return false;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    clearTimeout(this._retry);
    clearInterval(this._ping);
    try {
      this.ws?.close(1000, 'bye');
    } catch {
      /* noop */
    }
    this.removeAllListeners();
  }
}
