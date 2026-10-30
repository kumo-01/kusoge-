// Cloudflare の中継サーバー（worker/relay/）を使うための、PeerJS 互換の薄い層。
//
// ホスト = RelayPeer(id) …… 1 本の WebSocket で部屋を開き、ゲストの接続を DataConnection 風の RelayConn として受ける
// ゲスト = RelayPeer()   …… peer.connect(部屋ID) のたびに 1 本の WebSocket を開く（通常用・高速用の 2 本）
// network.js は PeerJS の Peer / DataConnection と同じ書き方（on/off/send/close/open）で使える。
// 中継サーバーのメッセージ形式は worker/relay/index.js の先頭を参照。

/** ビルド時の環境変数 VITE_RELAY_URL（例: https://kusoge.example.workers.dev）。未設定なら null */
let baseOverride; // テスト用
export function _setRelayBaseForTest(v) {
  baseOverride = v;
}

export function relayBase() {
  const raw = baseOverride !== undefined ? baseOverride : import.meta.env?.VITE_RELAY_URL;
  if (!raw || typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol === 'https:') u.protocol = 'wss:';
    else if (u.protocol === 'http:') u.protocol = 'ws:';
    else if (u.protocol !== 'wss:' && u.protocol !== 'ws:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

export const RELAY_ROOM_PREFIX = 'wwr-';
export const isRelayRoom = (id) => typeof id === 'string' && id.startsWith(RELAY_ROOM_PREFIX);

class Ev {
  constructor() {
    this._h = new Map();
  }
  on(type, fn) {
    if (!this._h.has(type)) this._h.set(type, new Set());
    this._h.get(type).add(fn);
    return this;
  }
  off(type, fn) {
    this._h.get(type)?.delete(fn);
    return this;
  }
  emit(type, ...args) {
    for (const fn of [...(this._h.get(type) || [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[relay] "${type}" ハンドラでエラー`, err);
      }
    }
  }
}

/** WebSocket が開いているときだけ送る（閉じかけに send するとブラウザがコンソールにエラーを出すため） */
function wsSend(ws, data) {
  if (ws.readyState !== 1) throw new Error('relay socket is not open');
  ws.send(data);
}

/** DataConnection 1 本分 */
class RelayConn extends Ev {
  constructor(send, close, metadata = {}, socket = null) {
    super();
    this.open = false;
    this.metadata = metadata;
    this._send = send;
    this._close = close;
    this._socket = socket;
    this.closed = false;
  }
  /** 送信待ちのバイト数（ゲスト側は WebSocket の値。ホスト側は共有の WebSocket の値） */
  get dataChannel() {
    const ws = this._socket();
    return ws ? { bufferedAmount: ws.bufferedAmount || 0 } : null;
  }
  send(data) {
    if (!this.open || this.closed) throw new Error('relay connection is not open');
    this._send(data);
  }
  close() {
    if (this.closed) return;
    this._close();
    this._finish();
  }
  _finish() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit('close');
  }
  _opened() {
    if (this.closed || this.open) return;
    this.open = true;
    this.emit('open');
  }
}

export class RelayPeer extends Ev {
  /** new RelayPeer(roomId, { hostSecret }) = ホスト / new RelayPeer() = ゲスト */
  constructor(id, opts = {}) {
    super();
    this.id = typeof id === 'string' ? id : null;
    this.hostSecret = opts.hostSecret || null;
    this.open = false;
    this.destroyed = false;
    this.disconnected = false;
    this._ws = null;
    this._conns = new Map(); // ホスト: 接続 ID → RelayConn
    this._guestConns = new Set(); // ゲスト: 開いた接続
    this._base = relayBase();
    if (this.id) this._openHost();
    else
      // ゲストは接続のたびに WebSocket を開くので、Peer としてはすぐ使える
      Promise.resolve().then(() => {
        if (this.destroyed) return;
        this.open = true;
        this.emit('open', null);
      });
  }

  // ---- ホスト ----
  _openHost() {
    if (!this._base) {
      queueMicrotask(() => this.emit('error', Object.assign(new Error('relay-not-configured'), { type: 'server-error' })));
      return;
    }
    const url = `${this._base}/ws?room=${encodeURIComponent(this.id)}&role=host&hs=${encodeURIComponent(this.hostSecret || '')}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      queueMicrotask(() => this.emit('error', Object.assign(err, { type: 'server-error' })));
      return;
    }
    this._ws = ws;
    ws.onmessage = (ev) => this._onHostMessage(ws, ev.data);
    ws.onclose = (ev) => {
      if (this._ws !== ws) return;
      const wasOpen = this.open;
      const everOpened = this._everOpened;
      this.open = false;
      for (const c of [...this._conns.values()]) c._finish();
      this._conns.clear();
      if (this.destroyed) return;
      if (ev.code === 4403 && !wasOpen) {
        this.emit('error', Object.assign(new Error('unavailable-id'), { type: 'unavailable-id' }));
        return;
      }
      if (!everOpened) {
        // 一度もつながらなかった（中継が使えない）: すぐ分かるようにエラーにする
        this.emit('error', Object.assign(new Error('relay-unreachable'), { type: 'server-error' }));
        return;
      }
      this.disconnected = true;
      this.emit('disconnected', this.id);
    };
    ws.onerror = () => {
      /* onclose で扱う */
    };
  }

  _onHostMessage(ws, data) {
    if (this._ws !== ws || typeof data !== 'string') return;
    if (data === '!ok') {
      this.open = true;
      this._everOpened = true;
      this.disconnected = false;
      this.emit('open', this.id);
      return;
    }
    if (data === '!no') {
      // 同じ部屋 ID を別のホストが使っている（切断の知らせを待たずにエラーにする）
      if (!this._everOpened) {
        this._ws = null;
        try {
          ws.close();
        } catch {
          /* noop */
        }
        this.emit('error', Object.assign(new Error('unavailable-id'), { type: 'unavailable-id' }));
      }
      return;
    }
    if (data.startsWith('!c')) {
      const i = data.indexOf(':');
      const id = data.slice(2, i < 0 ? undefined : i);
      let meta = {};
      try {
        meta = i >= 0 && data.length > i + 1 ? JSON.parse(data.slice(i + 1)) : {};
      } catch {
        meta = {};
      }
      if (!id || this._conns.has(id)) return;
      const conn = new RelayConn(
        (d) => wsSend(ws, `${id}:${d}`),
        () => {
          try {
            wsSend(ws, `!x${id}`);
          } catch {
            /* noop */
          }
          this._conns.delete(id);
        },
        meta && typeof meta === 'object' ? meta : {},
        () => ws,
      );
      this._conns.set(id, conn);
      this.emit('connection', conn);
      // PeerJS と同じく、接続を受け取った側がハンドラを付けたあとで open にする
      queueMicrotask(() => conn._opened());
      return;
    }
    if (data.startsWith('!x')) {
      const c = this._conns.get(data.slice(2));
      if (c) {
        this._conns.delete(data.slice(2));
        c._finish();
      }
      return;
    }
    const i = data.indexOf(':');
    if (i < 1) return;
    this._conns.get(data.slice(0, i))?.emit('data', data.slice(i + 1));
  }

  /** ホストの WebSocket が切れたとき、つなぎ直す */
  reconnect() {
    if (this.destroyed || !this.id || this._ws?.readyState === 0 || this._ws?.readyState === 1) return;
    this._openHost();
  }

  // ---- ゲスト ----
  connect(roomId, opts = {}) {
    if (this.destroyed || this.id || !this._base) return null;
    const metadata = opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {};
    const meta = JSON.stringify(metadata);
    const url = `${this._base}/ws?room=${encodeURIComponent(roomId)}&role=guest&meta=${encodeURIComponent(meta)}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      return null;
    }
    const conn = new RelayConn(
      (d) => wsSend(ws, d),
      () => {
        try {
          ws.close(1000, 'bye');
        } catch {
          /* noop */
        }
      },
      metadata,
      () => ws,
    );
    ws.onmessage = (ev) => {
      const data = ev.data;
      if (typeof data !== 'string') return;
      if (data === '!ok') {
        conn._opened();
        return;
      }
      if (data === '!no') {
        // 部屋（ホスト）がない・いっぱい
        this.emit('error', Object.assign(new Error('peer-unavailable'), { type: 'peer-unavailable' }));
        conn._finish();
        return;
      }
      if (conn.open) conn.emit('data', data);
    };
    ws.onclose = () => {
      this._guestConns.delete(conn);
      conn._finish();
    };
    ws.onerror = () => {
      /* onclose で扱う */
    };
    this._guestConns.add(conn);
    return conn;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.open = false;
    const ws = this._ws;
    this._ws = null;
    for (const c of [...this._conns.values()]) c._finish();
    this._conns.clear();
    for (const c of [...this._guestConns]) c.close();
    this._guestConns.clear();
    try {
      ws?.close(1000, 'bye');
    } catch {
      /* noop */
    }
  }
}
