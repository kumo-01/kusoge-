// PeerJS / WebRTC DataChannel による 2 人用の接続管理。
//
// - HostNetwork: 部屋を作り、ゲストを 1 人だけ受け入れる（招待シークレット＋再参加トークンで判定）
// - GuestNetwork: 招待URLの部屋に参加し、切断時は自動で再接続する
// - Link: DataConnection 1 本分のラッパー（生存確認・RTT 計測・受信検証）
//
// PeerJS のシグナリングサーバー（PeerJS Cloud）との接続と、P2P のデータ接続は別物として扱う。
// シグナリングが切れてもデータ接続が生きていればゲームは続行できる。

import Peer from 'peerjs';
import { Emitter, randomHex, randomToken, safeEqual, now } from './util.js';
import { PROTOCOL_VERSION, FROM_GUEST, FROM_HOST, FAST_FROM_GUEST, FAST_FROM_HOST, encode, decode } from './protocol.js';
import { buildInviteUrl, saveGuestSession, backoffDelay } from './reconnect.js';

export const NET_CONFIG = {
  HEARTBEAT_MS: 1000, // ping 送信間隔
  LIVENESS_MS: 6000, // これだけ何も受信しなければ切断扱い（通常画面）
  LIVENESS_GAME_MS: 3500, // ゲーム進行中（常にデータが流れているので短め）
  LIVENESS_HIDDEN_MS: 120000, // 相手のタブが非表示のとき（ブラウザがタイマーを間引くため）
  CONNECT_TIMEOUT_MS: 9000, // DataConnection が open するまでの待ち時間
  JOIN_TIMEOUT_MS: 6000, // join_request / join_accepted の待ち時間
  PEER_OPEN_TIMEOUT_MS: 12000, // シグナリングサーバー接続の待ち時間
  PENDING_LIMIT: 4, // 認証前の同時接続数の上限
  FIRST_JOIN_GIVEUP_MS: 25000, // 初回参加をあきらめるまで
  RECONNECT_GIVEUP_MS: 60000, // 再接続をあきらめるまで
  CONGESTED_BYTES: 256 * 1024, // 送信バッファがこれを超えたら定期スナップショットを間引く
};

/** PeerJS の接続オプション。既定は PeerJS Cloud。環境変数で自前の PeerServer も指定可能 */
export function peerOptions() {
  const env = import.meta.env || {};
  const o = { debug: 0 };
  if (env.VITE_PEER_HOST) {
    o.host = env.VITE_PEER_HOST;
    o.port = Number(env.VITE_PEER_PORT || 443);
    o.path = env.VITE_PEER_PATH || '/';
    o.secure = env.VITE_PEER_SECURE !== 'false';
  }
  // ICE サーバーは PeerJS の既定値（Google の STUN と PeerJS 公開 TURN）を使う。
  // 公開 TURN は可用性が保証されないため、すべてのネットワークで接続できるとは限らない。
  return o;
}

const ERROR_TEXT = {
  'browser-incompatible': 'このブラウザは WebRTC に対応していません。',
  network: 'シグナリングサーバーに接続できません。ネットワークを確認してください。',
  'server-error': 'PeerJS サーバーに接続できません。しばらくしてから再度お試しください。',
  'socket-error': 'PeerJS サーバーとの通信でエラーが発生しました。',
  'socket-closed': 'PeerJS サーバーとの接続が切れました。',
  'unavailable-id': '部屋IDが重複しました。もう一度お試しください。',
  'peer-unavailable': '部屋が見つかりません。ホストが部屋を閉じた可能性があります。',
  webrtc: 'WebRTC の接続でエラーが発生しました。',
  timeout: '接続がタイムアウトしました。ネットワークが P2P 接続を通していない可能性があります。',
  closed: 'ホストとの接続を確立できませんでした。部屋が閉じられたか、ネットワークが P2P 接続を通していない可能性があります。',
};
export const describePeerError = (type) => ERROR_TEXT[type] || `接続エラー (${type || '不明'})`;

function waitPeerOpen(peer, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (peer.open) return resolve();
    const t = setTimeout(() => done(reject, Object.assign(new Error('timeout'), { type: 'timeout' })), timeoutMs);
    const onOpen = () => done(resolve);
    const onErr = (err) => done(reject, err);
    function done(fn, v) {
      clearTimeout(t);
      peer.off('open', onOpen);
      peer.off('error', onErr);
      fn(v);
    }
    peer.on('open', onOpen);
    peer.on('error', onErr);
  });
}

/** DataConnection 1 本分。生存確認と受信データの検証を行う */
export class Link extends Emitter {
  constructor(conn, allowedTypes) {
    super();
    this.conn = conn;
    this.allowed = allowedTypes;
    this.open = !!conn.open;
    this.closed = false;
    this.lastRecv = now();
    this.rtt = null;
    this.peerHidden = false;
    this.timeoutMs = NET_CONFIG.LIVENESS_MS;
    this.badCount = 0;

    this._onData = (raw) => this._handle(raw);
    this._onOpen = () => {
      this.open = true;
      this.lastRecv = now();
      this._sendPresence();
      this.emit('open');
    };
    this._onClose = () => this.close('closed');
    this._onError = () => this.close('error');
    this._onVisibility = () => this._sendPresence();
    conn.on('data', this._onData);
    conn.on('open', this._onOpen);
    conn.on('close', this._onClose);
    conn.on('error', this._onError);
    document.addEventListener('visibilitychange', this._onVisibility);
    this._lastTick = now();
    this._timer = setInterval(() => this._tick(), NET_CONFIG.HEARTBEAT_MS);
  }

  _handle(raw) {
    if (this.closed) return;
    const msg = decode(raw, this.allowed);
    if (!msg) {
      // 不正データは無視。大量に来る場合は接続を切る
      if (++this.badCount > 200) this.close('bad-data');
      return;
    }
    this.lastRecv = now();
    switch (msg.type) {
      case 'ping':
        this.send({ type: 'pong', t: msg.t });
        return;
      case 'pong': {
        const rtt = now() - msg.t;
        if (rtt >= 0 && rtt < 60000) this.rtt = this.rtt == null ? rtt : this.rtt * 0.7 + rtt * 0.3;
        return;
      }
      case 'presence':
        this.peerHidden = msg.hidden;
        return;
      default:
        this.emit('message', msg);
    }
  }

  _tick() {
    if (!this.open || this.closed) return;
    const t = now();
    // 自分のスレッドが重い処理で止まっていた場合、届いているはずのデータが未処理なだけなので猶予を与える
    if (t - this._lastTick > NET_CONFIG.HEARTBEAT_MS * 2) this.lastRecv = Math.max(this.lastRecv, t - NET_CONFIG.HEARTBEAT_MS);
    this._lastTick = t;
    this.send({ type: 'ping', t });
    const limit = this.peerHidden ? NET_CONFIG.LIVENESS_HIDDEN_MS : this.timeoutMs;
    if (now() - this.lastRecv > limit) this.close('timeout');
  }

  _sendPresence() {
    this.send({ type: 'presence', hidden: document.visibilityState === 'hidden' });
  }

  /** ゲーム中は生存確認を短くする */
  setGameMode(inGame) {
    this.timeoutMs = inGame ? NET_CONFIG.LIVENESS_GAME_MS : NET_CONFIG.LIVENESS_MS;
    this.lastRecv = Math.max(this.lastRecv, now() - 500);
  }

  get congested() {
    const dc = this.conn.dataChannel;
    return !!dc && dc.bufferedAmount > NET_CONFIG.CONGESTED_BYTES;
  }

  send(msg) {
    if (!this.open || this.closed) return false;
    try {
      this.conn.send(encode(msg));
      return true;
    } catch (err) {
      console.warn('[net] 送信に失敗しました', err?.message);
      return false;
    }
  }

  /**
   * 高速チャンネル（順不同の DataConnection）を付ける。
   * 位置の定期配信・連続入力をここに流すと、1 パケットの遅れで後続が詰まる（ヘッドオブラインブロッキング）のを避けられる。
   * 開けなかった・切れた場合は通常の接続で送る。
   */
  attachFast(conn, allowedTypes) {
    this.fast?.close();
    const f = { conn, open: !!conn.open };
    const onData = (raw) => {
      if (this.closed) return;
      const msg = decode(raw, allowedTypes);
      if (!msg) return;
      this.lastRecv = now();
      this.emit('message', msg);
    };
    const onOpen = () => (f.open = true);
    const onEnd = () => f.close();
    f.close = () => {
      if (f.closed) return;
      f.closed = true;
      f.open = false;
      conn.off('data', onData);
      conn.off('open', onOpen);
      conn.off('close', onEnd);
      conn.off('error', onEnd);
      try {
        conn.close();
      } catch {
        /* noop */
      }
      if (this.fast === f) this.fast = null;
    };
    conn.on('data', onData);
    conn.on('open', onOpen);
    conn.on('close', onEnd);
    conn.on('error', onEnd);
    this.fast = f;
  }

  get fastOpen() {
    return !!this.fast?.open;
  }

  /** 高速チャンネルがあればそちらで送る */
  sendFast(msg) {
    const f = this.fast;
    if (f?.open && !this.closed) {
      const dc = f.conn.dataChannel;
      if (!dc || dc.bufferedAmount < NET_CONFIG.CONGESTED_BYTES) {
        try {
          f.conn.send(encode(msg));
          return true;
        } catch {
          f.close();
        }
      }
    }
    return this.send(msg);
  }

  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.fast?.close();
    clearInterval(this._timer);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.conn.off('data', this._onData);
    this.conn.off('open', this._onOpen);
    this.conn.off('close', this._onClose);
    this.conn.off('error', this._onError);
    try {
      this.conn.close();
    } catch {
      /* noop */
    }
    this.emit('close', reason);
    this.removeAllListeners();
  }
}

// ======================================================================
// ホスト
// ======================================================================
export class HostNetwork extends Emitter {
  /** @param {{ getRoomState: () => object }} opts */
  constructor({ getRoomState }) {
    super();
    this.getRoomState = getRoomState;
    this.peer = null;
    this.roomId = null;
    this.inviteKey = null;
    this.guestToken = null; // 現在のゲストに紐付いた再参加トークン（null = ゲスト枠が空き）
    this.guest = null; // 認証済みの Link
    this.pending = new Set();
    this.signaling = 'connecting'; // 'online' | 'reconnecting'
    this.destroyed = false;
    this._sigAttempt = 0;
    this._sigTimer = null;
    this._watchdog = null;
  }

  get inviteUrl() {
    return this.roomId ? buildInviteUrl(this.roomId, this.inviteKey) : '';
  }
  get guestConnected() {
    return !!this.guest && this.guest.open;
  }
  get guestSlotTaken() {
    return !!this.guestToken;
  }
  get rtt() {
    return this.guest?.rtt ?? null;
  }

  async create() {
    this.inviteKey = randomToken(18);
    let lastErr;
    for (let i = 0; i < 3; i++) {
      const id = `wwk-${randomHex(12)}`;
      const peer = new Peer(id, peerOptions());
      try {
        await waitPeerOpen(peer, NET_CONFIG.PEER_OPEN_TIMEOUT_MS);
        if (this.destroyed) {
          peer.destroy();
          return;
        }
        this.peer = peer;
        this.roomId = id;
        this._bindPeer(peer);
        this._setSignaling('online');
        return;
      } catch (err) {
        lastErr = err;
        peer.destroy();
        if (err?.type !== 'unavailable-id') break;
      }
    }
    throw lastErr || new Error('peer-open-failed');
  }

  _bindPeer(peer) {
    peer.on('connection', (conn) => this._onConnection(conn));
    peer.on('open', () => {
      this._sigAttempt = 0;
      this._setSignaling('online');
    });
    peer.on('disconnected', () => {
      if (this.destroyed) return;
      this._setSignaling('reconnecting');
      this._scheduleSignalingReconnect();
    });
    peer.on('error', (err) => {
      if (this.destroyed) return;
      // peer-unavailable 等、データ接続に関係しないエラーは表示だけ
      if (['network', 'server-error', 'socket-error', 'socket-closed', 'unavailable-id'].includes(err?.type)) {
        this._setSignaling('reconnecting');
        this._scheduleSignalingReconnect();
      }
      this.emit('peer-error', err?.type);
    });
    // reconnect() が応答しないまま止まった場合の保険
    this._watchdog = setInterval(() => {
      if (!this.destroyed && this.peer?.disconnected && !this._sigTimer) this._scheduleSignalingReconnect();
    }, 5000);
  }

  _setSignaling(state) {
    if (this.signaling === state) return;
    this.signaling = state;
    this.emit('signaling', state);
  }

  _scheduleSignalingReconnect() {
    if (this._sigTimer || this.destroyed) return;
    const delay = Math.min(15000, 1000 * Math.pow(2, this._sigAttempt++));
    this._sigTimer = setTimeout(() => {
      this._sigTimer = null;
      const peer = this.peer;
      if (this.destroyed || !peer || peer.destroyed) return;
      if (peer.disconnected) {
        try {
          peer.reconnect();
        } catch {
          this._scheduleSignalingReconnect();
        }
      }
    }, delay);
  }

  _onConnection(conn) {
    // ゲストの高速チャンネル: join_accepted で渡した使い捨て ID が一致するときだけ受け入れる
    const fastId = conn.metadata && typeof conn.metadata.fast === 'string' ? conn.metadata.fast : null;
    if (fastId) {
      const g = this.guest;
      if (!this.destroyed && g && g.fastId && safeEqual(fastId, g.fastId)) g.attachFast(conn, FAST_FROM_GUEST);
      else {
        try {
          conn.close();
        } catch {
          /* noop */
        }
      }
      return;
    }
    if (this.destroyed || this.pending.size >= NET_CONFIG.PENDING_LIMIT) {
      try {
        conn.close();
      } catch {
        /* noop */
      }
      return;
    }
    const link = new Link(conn, FROM_GUEST);
    this.pending.add(link);
    const timer = setTimeout(() => link.close('join-timeout'), NET_CONFIG.CONNECT_TIMEOUT_MS + NET_CONFIG.JOIN_TIMEOUT_MS);
    const offMsg = link.on('message', (msg) => {
      offMsg();
      clearTimeout(timer);
      this.pending.delete(link);
      if (msg.type !== 'join_request') {
        link.close('bad-request');
        return;
      }
      this._admit(link, msg);
    });
    link.on('close', () => {
      clearTimeout(timer);
      this.pending.delete(link);
    });
  }

  _admit(link, msg) {
    const reject = (reason) => {
      link.send({ type: 'join_rejected', reason });
      setTimeout(() => link.close('rejected'), 400);
    };
    if (msg.v !== PROTOCOL_VERSION) return reject('version');
    if (!safeEqual(msg.key, this.inviteKey)) return reject('bad_key');
    let rejoin = false;
    if (this.guestToken) {
      // ゲスト枠が埋まっている: 正しい再参加トークンを持つ本人だけ受け入れる
      if (!msg.token || !safeEqual(msg.token, this.guestToken)) return reject('room_full');
      rejoin = true;
    } else {
      this.guestToken = randomToken(24);
    }
    const old = this.guest;
    this.guest = link;
    if (old) old.close('replaced'); // 古い接続を切り替える（close ハンドラは this.guest !== old なので何もしない）
    if (this._gameMode) link.setGameMode(true);

    link.on('message', (m) => this._onGuestMessage(link, m));
    link.on('close', (reason) => {
      if (this.guest !== link) return;
      this.guest = null;
      this.emit('guest-disconnected', reason);
    });
    link.fastId = randomToken(12);
    link.send({ type: 'join_accepted', token: this.guestToken, rejoin, room: this.getRoomState(), fast: link.fastId });
    this.emit('guest-connected', { rejoin, replaced: !!old });
  }

  _onGuestMessage(link, msg) {
    if (msg.type === 'leave') {
      // ゲストが自分の意思で退出: 枠を空ける
      this.guestToken = null;
      this.guest = null;
      link.close('leave');
      this.emit('guest-left');
      return;
    }
    if (msg.type === 'bye') {
      // タブを閉じる/更新する直前の通知。枠は維持して切断扱いにする
      link.close('bye');
      return;
    }
    this.emit('message', msg);
  }

  setGameMode(inGame) {
    this.guest?.setGameMode(inGame);
    this._gameMode = inGame;
  }

  send(msg) {
    return this.guest ? this.guest.send(msg) : false;
  }

  sendFast(msg) {
    return this.guest ? this.guest.sendFast(msg) : false;
  }

  get congested() {
    return !!this.guest?.congested;
  }

  /** ゲスト枠を空けて新しいゲストを受け付けられるようにする */
  freeGuestSlot() {
    this.guestToken = null;
    const g = this.guest;
    this.guest = null;
    if (g) {
      g.send({ type: 'room_close', reason: 'kicked' });
      setTimeout(() => g.close('kicked'), 300);
    }
  }

  /** 部屋を閉じる（ゲストには通知してから切断） */
  close(reason = 'closed') {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this._sigTimer);
    clearInterval(this._watchdog);
    const g = this.guest;
    this.guest = null;
    if (g) g.send({ type: 'room_close', reason });
    for (const p of this.pending) p.close('room-closed');
    this.pending.clear();
    const peer = this.peer;
    setTimeout(() => {
      g?.close('room-closed');
      try {
        peer?.destroy();
      } catch {
        /* noop */
      }
    }, 300);
    this.removeAllListeners();
  }
}

// ======================================================================
// ゲスト
// ======================================================================
export class GuestNetwork extends Emitter {
  constructor({ roomId, inviteKey, token }) {
    super();
    this.roomId = roomId;
    this.inviteKey = inviteKey;
    this.token = token || null;
    this.peer = null;
    this.link = null;
    this.state = 'idle'; // 'connecting' | 'connected' | 'reconnecting' | 'failed'
    this.destroyed = false;
    this.attemptId = 0;
    this.retryCount = 0;
    this.lostAt = 0;
    this.everJoined = false;
    this.lastError = null;
    this._retryTimer = null;
  }

  get rtt() {
    return this.link?.rtt ?? null;
  }

  start() {
    this.lostAt = now();
    this._setState(this.token ? 'reconnecting' : 'connecting');
    this._attempt();
  }

  /** 失敗表示からの「もう一度試す」 */
  retry() {
    if (this.destroyed || this.state === 'connected') return;
    this.lostAt = now();
    this.retryCount = 0;
    this._setState(this.everJoined || this.token ? 'reconnecting' : 'connecting');
    this._attempt();
  }

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', s);
  }

  async _attempt() {
    if (this.destroyed) return;
    clearTimeout(this._retryTimer);
    const my = ++this.attemptId;
    try {
      if (!this.peer || this.peer.destroyed || !this.peer.open) {
        try {
          this.peer?.destroy();
        } catch {
          /* noop */
        }
        this.peer = new Peer(peerOptions());
        this.peer.on('error', (err) => {
          this.lastError = err?.type;
          if (err?.type === 'peer-unavailable') this.sawUnavailable = true;
        });
        await waitPeerOpen(this.peer, NET_CONFIG.PEER_OPEN_TIMEOUT_MS);
      }
      if (my !== this.attemptId || this.destroyed) return;
      this.sawUnavailable = false;
      await this._connectOnce(my);
    } catch (err) {
      if (my !== this.attemptId || this.destroyed) return;
      if (err?.rejected) {
        this._fail('rejected', err.reason);
        return;
      }
      this.lastError = err?.type || err?.message || 'unknown';
      if (err?.type && err.type !== 'peer-unavailable' && err.type !== 'timeout') {
        // シグナリングの致命的エラー時は次回作り直す
        try {
          this.peer?.destroy();
        } catch {
          /* noop */
        }
      }
      this._scheduleRetry();
    }
  }

  _connectOnce(my) {
    return new Promise((resolve, reject) => {
      const peer = this.peer;
      let conn;
      try {
        conn = peer.connect(this.roomId, { serialization: 'raw', reliable: true });
      } catch (err) {
        reject(err);
        return;
      }
      if (!conn) {
        reject(Object.assign(new Error('connect-failed'), { type: 'webrtc' }));
        return;
      }
      const link = new Link(conn, FROM_HOST);
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.off('error', onPeerErr);
        offMsg();
        offClose();
        offOpen();
        fn(v);
      };
      const timer = setTimeout(() => {
        link.close('timeout');
        finish(reject, Object.assign(new Error('timeout'), { type: 'timeout' }));
      }, NET_CONFIG.CONNECT_TIMEOUT_MS + NET_CONFIG.JOIN_TIMEOUT_MS);
      const onPeerErr = (err) => {
        if (err?.type === 'peer-unavailable') {
          link.close('unavailable');
          finish(reject, err);
        }
      };
      peer.on('error', onPeerErr);
      const offOpen = link.on('open', () => {
        link.send({ type: 'join_request', v: PROTOCOL_VERSION, key: this.inviteKey, token: this.token || undefined });
      });
      const offClose = link.on('close', () => finish(reject, Object.assign(new Error('closed'), { type: 'closed' })));
      const offMsg = link.on('message', (msg) => {
        if (msg.type === 'join_accepted') {
          finish(resolve);
          if (my !== this.attemptId || this.destroyed) {
            link.close('stale');
            return;
          }
          // 次のメッセージを取りこぼさないよう、同期的にハンドラを付け替える
          this._onJoined(link, msg);
        } else if (msg.type === 'join_rejected') {
          finish(reject, { rejected: true, reason: msg.reason });
          link.close('rejected');
        }
      });
    });
  }

  _onJoined(link, msg) {
    this.link = link;
    this.token = msg.token;
    this.everJoined = true;
    this.retryCount = 0;
    this.lastError = null;
    saveGuestSession({ room: this.roomId, key: this.inviteKey, token: msg.token });
    if (this._gameMode) link.setGameMode(true);
    link.on('message', (m) => this.emit('message', m));
    if (msg.fast) this._openFast(link, msg.fast);
    link.on('close', (reason) => {
      if (this.link !== link) return;
      this.link = null;
      if (this.destroyed) return;
      this.lostAt = now();
      this._setState('reconnecting');
      this.emit('lost', reason);
      this._retryTimer = setTimeout(() => this._attempt(), 300);
    });
    this._setState('connected');
    this.emit('joined', msg);
  }

  /** 高速チャンネルを開く（失敗しても通常の接続で続行できる） */
  _openFast(link, fastId) {
    try {
      if (!this.peer?.open) return;
      const conn = this.peer.connect(this.roomId, { serialization: 'raw', reliable: false, metadata: { fast: fastId } });
      if (conn) link.attachFast(conn, FAST_FROM_HOST);
    } catch {
      /* 通常の接続だけで続行 */
    }
  }

  _scheduleRetry() {
    const giveUp = this.everJoined || this.token ? NET_CONFIG.RECONNECT_GIVEUP_MS : NET_CONFIG.FIRST_JOIN_GIVEUP_MS;
    if (now() - this.lostAt > giveUp) {
      this._fail('unreachable', this.lastError);
      return;
    }
    this._retryTimer = setTimeout(() => this._attempt(), backoffDelay(this.retryCount++));
  }

  _fail(kind, reason) {
    clearTimeout(this._retryTimer);
    if (kind === 'unreachable' && this.sawUnavailable) reason = 'peer-unavailable';
    this._setState('failed');
    this.emit('failed', { kind, reason });
  }

  setGameMode(inGame) {
    this._gameMode = inGame;
    this.link?.setGameMode(inGame);
  }

  send(msg) {
    return this.link ? this.link.send(msg) : false;
  }

  sendFast(msg) {
    return this.link ? this.link.sendFast(msg) : false;
  }

  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this._retryTimer);
    this.attemptId++;
    const link = this.link;
    this.link = null;
    link?.close('closed');
    const peer = this.peer;
    setTimeout(() => {
      try {
        peer?.destroy();
      } catch {
        /* noop */
      }
    }, 200);
    this.removeAllListeners();
  }
}
