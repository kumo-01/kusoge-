// 部屋の状態管理。ホストが正本を持ち、ゲストは受信した状態を表示するだけ。
//
// room state（ゲストへ room_state で配信）:
//   screen: 'lobby'（ゲスト待ち） | 'home' | 'select' | 'ready' | 'game' | 'result'
//   guest:  'none' | 'connected' | 'waiting'（復帰待ち） | 'syncing'（状態復元中）
//   ready:  { host, guest }
//   gameId, match: { matchId, gen, status: 'loading'|'running'|'paused'|'resuming', reason, synced, started }
//   result
//
// 通信状態（guest フィールド・ゲスト側の linkState）は画面状態とは独立して管理する。
// ゲームの一時停止は画面遷移ではなく match.status で表す。

import { Emitter, randomHex, now } from './util.js';
import { HostNetwork, GuestNetwork, describePeerError } from './network.js';
import { GameManager } from './gameManager.js';
import { getGame } from '../games/registry.js';
import { sanitizeRoomState, sanitizeResult, REJECT_REASONS } from './protocol.js';
import { clearGuestSession } from './reconnect.js';

export const ROOM_CONFIG = {
  START_DELAY_MS: 2500, // 2人準備完了 → ゲーム画面へ移るまで
  RESUME_COUNTDOWN_MS: 3000, // 一時停止からの再開カウントダウン
};

// ======================================================================
// ホスト
// ======================================================================
export class HostRoom extends Emitter {
  constructor({ sound, input, layer }) {
    super();
    this.role = 'host';
    this.sound = sound;
    this.state = {
      rev: 0,
      screen: 'lobby',
      guest: 'none',
      ready: { host: false, guest: false },
      gameId: null,
      match: null,
      result: null,
      hostHidden: document.visibilityState === 'hidden',
    };
    this.signaling = 'connecting';
    this.lastGuestMsgAt = 0;
    this.resumeAt = 0;
    this._startAt = 0;
    this._startTimer = null;
    this._resumeTimer = null;
    this.closed = false;
    this.net = new HostNetwork({ getRoomState: () => this.publicState() });
    this.gm = new GameManager({ role: 'host', net: this.net, input, sound, layer });
    this._onVisibility = () => this._visibilityChanged();
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  get inviteUrl() {
    return this.net.inviteUrl;
  }
  get rtt() {
    return this.net.rtt;
  }

  async create() {
    await this.net.create();
    const net = this.net;
    net.on('guest-connected', (info) => this._guestConnected(info));
    net.on('guest-disconnected', () => this._guestLost('waiting'));
    net.on('guest-left', () => {
      this._toast('ゲストが退出しました');
      this._guestLost('none');
    });
    net.on('message', (msg) => {
      this.lastGuestMsgAt = now();
      this._onGuestMessage(msg);
    });
    net.on('signaling', (s) => {
      this.signaling = s;
      this.emit('change');
    });
    this.gm.on('finish', (result) => this._onGameFinished(result));
    this.signaling = net.signaling;
    this._changed();
  }

  publicState() {
    const s = this.state;
    return {
      ...s,
      ready: { ...s.ready },
      match: s.match ? { ...s.match } : null,
      startInMs: this._startAt ? Math.max(0, this._startAt - now()) : null,
    };
  }

  _changed() {
    // 生存確認を短くするのはゲームが実際に進行している間だけ（読み込み中の重い処理で誤検出しないように）
    this.net.setGameMode(this.state.match?.status === 'running');
    this.state.rev++;
    this.net.send({ type: 'room_state', room: this.publicState() });
    this.emit('change');
  }

  _toast(text) {
    this.emit('toast', text);
  }

  // ---- 接続イベント ----
  _guestConnected({ rejoin, replaced }) {
    this.sound.play('join');
    this._toast(rejoin ? 'ゲストが戻ってきました！' : 'ゲストが参加しました！');
    this.lastGuestMsgAt = now();
    const s = this.state;
    if (s.screen === 'lobby') s.screen = 'home';
    if (s.screen === 'ready') this._resetReady();
    if (s.screen === 'game' && s.match) {
      // 再接続したゲストは状態を失っている可能性があるので、必ず一時停止して完全同期する
      if (s.match.status === 'running' || s.match.status === 'resuming') this._pauseMatch('disconnect', replaced);
      s.guest = 'syncing';
      if (this.gm.game && this.gm.matchId === s.match.matchId) this._sendFullSync();
    } else {
      s.guest = 'connected';
    }
    this._changed();
  }

  _guestLost(next) {
    const s = this.state;
    if (s.guest === next) return;
    if (next === 'waiting') this._toast('ゲストとの通信が切れました。再接続を待っています…');
    s.guest = next;
    if (s.screen === 'ready') this._resetReady();
    if (s.screen === 'game' && s.match) this._pauseMatch('disconnect', true);
    this._changed();
  }

  _onGuestMessage(msg) {
    const s = this.state;
    switch (msg.type) {
      case 'ready_change':
        if (s.screen === 'ready') this._setReady('guest', msg.ready);
        break;
      case 'resume_ack': {
        const m = s.match;
        if (!m || msg.matchId !== m.matchId || msg.gen !== m.gen) return;
        m.synced = true;
        s.guest = 'connected';
        if (!m.started && !s.hostHidden) {
          this._startRunning(0); // 初回開始はレース内のカウントダウンがあるので即開始
        } else {
          this._changed();
        }
        break;
      }
      case 'player_input':
      case 'game_msg':
        if (s.screen === 'game') this.gm.handleMessage(msg);
        break;
      default:
        break;
    }
  }

  _visibilityChanged() {
    const hidden = document.visibilityState === 'hidden';
    const s = this.state;
    s.hostHidden = hidden;
    // ホストのタブが裏に回るとブラウザが描画ループを止めるため、ゲームは一時停止する
    if (hidden && s.match && (s.match.status === 'running' || s.match.status === 'resuming')) {
      this._pauseMatch('hidden');
    }
    if (!hidden && s.match && !s.match.started && s.match.synced) {
      this._startRunning(0);
      return;
    }
    if (!this.closed) this._changed();
  }

  // ---- 準備 ----
  _resetReady() {
    this.state.ready = { host: false, guest: false };
    this._cancelStart();
  }

  _cancelStart() {
    clearTimeout(this._startTimer);
    this._startTimer = null;
    this._startAt = 0;
  }

  _setReady(who, value) {
    const s = this.state;
    s.ready[who] = value;
    if (s.ready.host && s.ready.guest && s.guest === 'connected') {
      if (!this._startTimer) {
        this._startAt = now() + ROOM_CONFIG.START_DELAY_MS;
        this._startTimer = setTimeout(() => this._beginMatch(), ROOM_CONFIG.START_DELAY_MS);
      }
    } else {
      this._cancelStart();
    }
    this._changed();
  }

  // ---- ホストの操作 ----
  goSelect() {
    const s = this.state;
    if (!['home', 'result', 'ready'].includes(s.screen)) return;
    this._resetReady();
    s.screen = 'select';
    s.result = null;
    s.gameId = null;
    this._changed();
  }

  goHome() {
    const s = this.state;
    if (s.screen !== 'select') return;
    s.screen = 'home';
    this._changed();
  }

  chooseGame(id) {
    const s = this.state;
    if (s.screen !== 'select' || !getGame(id)) return;
    s.gameId = id;
    s.screen = 'ready';
    this._resetReady();
    this._changed();
  }

  setReady(value) {
    if (this.state.screen === 'ready') this._setReady('host', value);
  }

  async _beginMatch() {
    const s = this.state;
    this._startTimer = null;
    this._startAt = 0;
    const def = getGame(s.gameId);
    if (s.screen !== 'ready' || !def || !(s.ready.host && s.ready.guest) || s.guest !== 'connected') {
      this._changed();
      return;
    }
    const matchId = randomHex(8);
    s.screen = 'game';
    s.ready = { host: false, guest: false };
    s.match = { matchId, gen: 1, status: 'loading', reason: null, synced: false, started: false };
    this._changed();
    try {
      await this.gm.create(def, matchId, 1);
      await this.gm.firstFrame;
    } catch (err) {
      console.error(err);
      this._toast('ゲームの起動に失敗しました（WebGL が使えない可能性があります）');
      this.abortGame();
      return;
    }
    if (s.match?.matchId !== matchId || !this.gm.game) return; // 読み込み中に中止された
    if (this.net.guestConnected) this._sendFullSync();
    this._changed();
  }

  /** ゲストへ完全な状態を送り、ACK を待つ */
  _sendFullSync() {
    const m = this.state.match;
    if (!m || !this.gm.game) return;
    m.gen++;
    m.synced = false;
    this.gm.setGen(m.gen);
    this.state.guest = 'syncing';
    this.net.send({ type: 'game_start', gameId: this.state.gameId, matchId: m.matchId, gen: m.gen, snapshot: this.gm.getSnapshot() });
  }

  _startRunning(delayMs) {
    const m = this.state.match;
    if (!m) return;
    clearTimeout(this._resumeTimer);
    m.started = true;
    m.reason = null;
    this.net.send({ type: 'resume', matchId: m.matchId, gen: m.gen, delayMs });
    if (delayMs > 0) {
      m.status = 'resuming';
      this.resumeAt = now() + delayMs;
      // ゲスト側はメッセージ受信から delayMs 後に再開するので、片道の遅延ぶんだけ遅らせて揃える
      const oneWay = Math.min(300, (this.net.rtt || 0) / 2);
      this._resumeTimer = setTimeout(() => {
        if (this.state.match !== m || m.status !== 'resuming') return;
        m.status = 'running';
        this.gm.run();
        this._changed();
      }, delayMs + oneWay);
    } else {
      m.status = 'running';
      this.gm.run();
    }
    this._changed();
  }

  /** ゲームを一時停止する。rollback=true なら切断を検出する前の状態へ巻き戻す */
  _pauseMatch(reason, rollback = false) {
    const m = this.state.match;
    if (!m) return;
    clearTimeout(this._resumeTimer);
    const wasRunning = m.status === 'running';
    if (m.status === 'running' || m.status === 'resuming') {
      this.gm.pause();
      if (rollback && wasRunning && this.gm.rollbackTo(this.lastGuestMsgAt - 50)) {
        this._toast('通信が切れる直前の状態に戻しました');
      }
      m.status = 'paused';
    } else if (m.status === 'loading' && m.started) {
      m.status = 'paused';
    }
    m.reason = reason;
    m.synced = false;
    if (reason !== 'disconnect' && this.net.guestConnected && this.gm.game) {
      // 接続中の一時停止: ゲストに停止時点の状態を渡して揃えてもらう
      m.gen++;
      this.gm.setGen(m.gen);
      this.state.guest = 'syncing';
      this.net.send({ type: 'pause', matchId: m.matchId, gen: m.gen, reason, snapshot: this.gm.getSnapshot() });
    }
  }

  pauseGame() {
    const m = this.state.match;
    if (!m || (m.status !== 'running' && m.status !== 'resuming')) return;
    this._pauseMatch('host');
    this._changed();
  }

  get canResume() {
    const m = this.state.match;
    return !!m && m.status === 'paused' && m.synced && this.state.guest === 'connected' && !this.state.hostHidden;
  }

  resumeGame() {
    if (!this.canResume) return;
    this._startRunning(ROOM_CONFIG.RESUME_COUNTDOWN_MS);
  }

  abortGame() {
    const s = this.state;
    if (s.screen !== 'game') return;
    clearTimeout(this._resumeTimer);
    const matchId = s.match?.matchId;
    this.gm.destroy();
    if (matchId) this.net.send({ type: 'game_abort', matchId });
    s.match = null;
    s.screen = 'select';
    s.gameId = null;
    if (s.guest === 'syncing') s.guest = 'connected';
    this._changed();
  }

  _onGameFinished(result) {
    const s = this.state;
    if (s.screen !== 'game' || !s.match) return;
    const matchId = s.match.matchId;
    this.gm.destroy();
    s.result = sanitizeResult(result);
    this.net.send({ type: 'game_result', matchId, result: s.result });
    s.match = null;
    s.screen = 'result';
    if (s.guest === 'syncing') s.guest = 'connected';
    this._changed();
  }

  /** 戻ってこないゲストの枠を空けて、新しいゲストを招待できるようにする */
  freeGuestSlot() {
    this.net.freeGuestSlot();
    this._guestLost('none');
    this._toast('ゲスト枠を空けました。招待URLを送り直してください');
  }

  /** 部屋を解散する */
  disband(reason = 'disband') {
    if (this.closed) return;
    this.closed = true;
    this._cancelStart();
    clearTimeout(this._resumeTimer);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.gm.destroy();
    this.net.close(reason);
    this.emit('closed', { reason });
    this.removeAllListeners();
  }
}

// ======================================================================
// ゲスト
// ======================================================================
export class GuestRoom extends Emitter {
  constructor({ invite, token, sound, input, layer }) {
    super();
    this.role = 'guest';
    this.sound = sound;
    this.state = null; // ホストから受け取った部屋の状態
    this.linkState = 'connecting'; // 'connecting' | 'connected' | 'reconnecting' | 'failed'
    this.failure = null;
    this.synced = null; // { matchId, gen } 最後に ACK した世代
    this.resumeAt = 0;
    this.closed = false;
    this.joinedOnce = false;
    this._queue = Promise.resolve();
    this.net = new GuestNetwork({ roomId: invite.room, inviteKey: invite.key, token });
    this.gm = new GameManager({ role: 'guest', net: this.net, input, sound, layer });

    this.net.on('state', (st) => {
      this.linkState = st;
      if (st !== 'connected') this.gm.pause(); // 通信が切れたら即座に止める（片方だけ進まないように）
      this.emit('change');
    });
    this.net.on('lost', () => this._toast('ホストとの通信が切れました。再接続しています…'));
    this.net.on('joined', (msg) => {
      this.failure = null;
      this.sound.play('join');
      this._toast(this.joinedOnce || msg.rejoin ? '部屋に戻りました！' : '部屋に参加しました！');
      this.joinedOnce = true;
      this._enqueue({ type: 'room_state', room: msg.room });
    });
    this.net.on('message', (msg) => this._enqueue(msg));
    this.net.on('failed', ({ kind, reason }) => {
      let text;
      if (kind === 'rejected') {
        text = REJECT_REASONS[reason] || '参加を拒否されました。';
        clearGuestSession();
      } else if (this.joinedOnce) {
        text = 'ホストに再接続できませんでした。ホストがページを閉じたか更新した場合、以前の部屋には戻れません。';
      } else {
        text = `部屋に接続できませんでした。${reason ? describePeerError(reason) : ''}`;
      }
      this.failure = { kind, reason, text };
      this.emit('change');
    });
    this._onPageHide = () => this.net.send({ type: 'bye' });
    window.addEventListener('pagehide', this._onPageHide);
  }

  get rtt() {
    return this.net.rtt;
  }

  start() {
    this.net.start();
  }

  retry() {
    this.failure = null;
    this.net.retry();
    this.emit('change');
  }

  _toast(text) {
    this.emit('toast', text);
  }

  _enqueue(msg) {
    // 受信順に 1 つずつ処理する（ゲーム読み込み中に後続メッセージが追い越さないように）
    this._queue = this._queue
      .then(() => this._handle(msg))
      .catch((err) => console.error('[room] メッセージ処理でエラー', err));
  }

  async _handle(msg) {
    if (this.closed) return;
    switch (msg.type) {
      case 'room_state':
        this._applyRoom(sanitizeRoomState(msg.room));
        break;
      case 'game_start': {
        const def = getGame(msg.gameId);
        if (!def || this.state?.screen !== 'game') return;
        if (!this.gm.game || this.gm.matchId !== msg.matchId) {
          try {
            await this.gm.create(def, msg.matchId, msg.gen);
            await this.gm.firstFrame; // 重い初回描画を済ませてから ACK する
          } catch (err) {
            console.error(err);
            this._toast('ゲームの起動に失敗しました（WebGL が使えない可能性があります）');
            return;
          }
          if (this.closed || this.state?.screen !== 'game') {
            this.gm.destroy();
            return;
          }
        }
        this._loadAndAck(msg);
        break;
      }
      case 'pause':
        if (this.gm.matchId !== msg.matchId) return;
        this._loadAndAck(msg);
        break;
      case 'resume':
        if (this.gm.matchId !== msg.matchId || this.gm.gen !== msg.gen) return;
        this.resumeAt = now() + msg.delayMs;
        this.gm.runAfter(msg.delayMs);
        this.emit('change');
        break;
      case 'game_snapshot':
      case 'game_msg':
        this.gm.handleMessage(msg);
        break;
      case 'game_result':
        break; // 結果は room_state.result で受け取る
      case 'game_abort':
        if (this.gm.matchId === msg.matchId) {
          this.gm.destroy();
          this._toast('ホストがゲームを中止しました');
        }
        break;
      case 'room_close':
        this.close(msg.reason === 'kicked' ? 'kicked' : msg.reason === 'host_left' ? 'host_left' : 'disband');
        break;
      default:
        break;
    }
  }

  _loadAndAck(msg) {
    const snapshot = msg.snapshot;
    this.gm.pause();
    this.gm.setGen(msg.gen);
    try {
      this.gm.loadSnapshot(snapshot);
    } catch (err) {
      console.error('[room] 状態の復元に失敗', err);
      return;
    }
    this.synced = { matchId: msg.matchId, gen: msg.gen };
    this.net.send({ type: 'resume_ack', matchId: msg.matchId, gen: msg.gen });
    this.emit('change');
  }

  _applyRoom(room) {
    if (!room) return;
    if (this.state && room.rev < this.state.rev) return; // 古い状態
    this.state = room;
    if (room.screen !== 'game' && this.gm.game) this.gm.destroy();
    this.net.setGameMode(room.match?.status === 'running');
    if (room.result) room.result = sanitizeResult(room.result);
    if (room.startInMs != null) this.startAt = now() + room.startInMs;
    else this.startAt = 0;
    this.emit('change');
  }

  /** ゲストが同期済みか（現在の世代の状態を読み込んで ACK 済み） */
  get isSynced() {
    const m = this.state?.match;
    return !!m && !!this.synced && this.synced.matchId === m.matchId && this.synced.gen === m.gen;
  }

  setReady(value) {
    this.net.send({ type: 'ready_change', ready: value });
  }

  /** 自分の意思で退出（ゲスト枠を空ける） */
  leave() {
    this.net.send({ type: 'leave' });
    this.close('left');
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('pagehide', this._onPageHide);
    clearGuestSession();
    this.gm.destroy();
    const net = this.net;
    setTimeout(() => net.close(), 150);
    this.emit('closed', { reason });
    this.removeAllListeners();
  }
}
