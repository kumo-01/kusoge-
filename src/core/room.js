// 部屋の状態管理。ホストが正本を持ち、ゲストは受信した状態を表示するだけ。
//
// room state（ゲストへ room_state で配信）:
//   screen: 'lobby'（ゲスト待ち） | 'home' | 'select' | 'ready' | 'game' | 'result'
//   players: 席ごとの [{ link, ready }]（席 0 = ホスト, 1・2 = ゲスト）。
//            link: 'none'（空き） | 'connected' | 'waiting'（復帰待ち） | 'syncing'（状態復元中）
//   gameId, match: { matchId, gen, status: 'loading'|'running'|'paused'|'resuming', reason, synced, started, players（参加する席）, opts }
//   series: 連戦の途中経過 { total, round, scores（席ごと）, final, history } または null（1 レースだけのとき）
//   result
//
// 通信状態（guest フィールド・ゲスト側の linkState）は画面状態とは独立して管理する。
// ゲームの一時停止は画面遷移ではなく match.status で表す。

import { Emitter, randomHex, randomToken, now } from './util.js';
import { relayBase } from './relay.js';
import { HostNetwork, GuestNetwork, describePeerError } from './network.js';
import { GameManager } from './gameManager.js';
import { getGame, defaultOptions, validOptions, resolveMatchOptions } from '../games/registry.js';
import { sanitizeRoomState, sanitizeResult, REJECT_REASONS, MAX_PLAYERS } from './protocol.js';
import { clearGuestSession } from './reconnect.js';

/** ゲームを始められなかった理由を、画面に出す文にする（原因ごとに言い分ける） */
function startFailText(err) {
  const m = String(err?.message || err || '');
  if (/dynamically imported module|Importing a module script|Loading chunk|Failed to fetch/i.test(m)) return 'ゲームの読み込みに失敗しました。ページを再読み込みしてからもう一度お試しください。';
  if (/full-timeout|no-engine|engine|socket|refused/i.test(m)) return 'ゲームサーバーにつなげませんでした。もう一度お試しください。';
  if (/WebGL|context/i.test(m)) return 'ゲームの起動に失敗しました（3D表示が使えません。画面は簡易表示になります）';
  return `ゲームの起動に失敗しました（${m.slice(0, 60) || '原因不明'}）`;
}

/** 席の呼び名（トーストなどに使う） */
export const PLAYER_LABEL = ['ホスト', 'ゲスト1', 'ゲスト2'];

export const ROOM_CONFIG = {
  SYNC_RETRY_MS: 4000, // 状態を送ってから ACK が来ないとき、送り直すまでの時間
  START_DELAY_MS: 2500, // 2人準備完了 → ゲーム画面へ移るまで
  RESUME_COUNTDOWN_MS: 3000, // 一時停止からの再開カウントダウン
};

// ======================================================================
// ホスト
// ======================================================================
export class HostRoom extends Emitter {
  constructor({ sound, music, input, layer }) {
    super();
    this.role = 'host';
    this.slot = 0;
    this.sound = sound;
    this.state = {
      rev: 0,
      screen: 'lobby',
      players: Array.from({ length: MAX_PLAYERS }, (_, i) => ({ link: i === 0 ? 'connected' : 'none', ready: false })),
      gameId: null,
      options: {},
      match: null,
      series: null,
      result: null,
      hostHidden: document.visibilityState === 'hidden',
    };
    this.signaling = 'connecting';
    this.lastMsgAt = Array.from({ length: MAX_PLAYERS }, () => 0); // 席ごとの最後の受信時刻（巻き戻しに使う）
    this.resumeAt = 0;
    this._startAt = 0;
    this._startTimer = null;
    this._resumeTimer = null;
    this._acks = new Set(); // いまの世代の状態を読み込んだ（ACK した）席
    this._srv = null; // サーバー計算の試合のとき { base, gid, ak, tickets }
    this._hostLoaded = false; // サーバー計算: ホスト自身も、いまの世代の状態を読み込んだか
    this._syncSentAt = {}; // 席ごとに、いまの世代の状態を送った時刻（ACK が来なければ送り直す）
    this._hostSyncAt = 0;
    this._syncTimer = setInterval(() => this._resendStaleSync(), 1000);
    this._used = {}; // 連戦でこれまでに使った設定（ランダムのコースを重ねないため）
    this.closed = false;
    this.net = new HostNetwork({ getRoomState: () => this.publicState() });
    this.gm = new GameManager({ role: 'host', slot: 0, net: this.net, input, sound, music, layer });
    this._onVisibility = () => this._visibilityChanged();
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  get inviteUrl() {
    return this.net.inviteUrl;
  }
  get rtt() {
    return this.net.rtt;
  }

  /** 席 0（ホスト）を含めて、使われている席（つながっていなくても戻りを待っている席も含む） */
  get occupied() {
    return this.state.players.map((p, i) => (p.link !== 'none' ? i : -1)).filter((i) => i >= 0);
  }
  /** 使われている席がすべてつながっているか */
  get allConnected() {
    return this.state.players.every((p) => p.link === 'none' || p.link === 'connected');
  }
  /** 席の数が 2 人以上そろっているか */
  get enoughPlayers() {
    return this.occupied.length >= 2;
  }

  async create() {
    await this.net.create();
    const net = this.net;
    net.on('guest-connected', (info) => this._guestConnected(info));
    net.on('guest-disconnected', ({ slot }) => this._guestLost(slot, 'waiting'));
    net.on('guest-left', ({ slot }) => {
      this._toast(`${PLAYER_LABEL[slot]}が退出しました`);
      this._guestLost(slot, 'none');
    });
    net.on('message', (msg, slot) => {
      this.lastMsgAt[slot] = now();
      this._onGuestMessage(msg, slot);
    });
    net.on('signaling', (s) => {
      this.signaling = s;
      this.emit('change');
    });
    this.gm.on('finish', (result) => this._onGameFinished(result));
    this.gm.on('full', (msg) => this._onEngineFull(msg));
    this.gm.on('engine-lost', () => {
      if (this.state.screen !== 'game' || !this._srv) return;
      this._toast('サーバーとの通信が切れたため、ゲームを中止しました');
      this.abortGame();
    });
    this.signaling = net.signaling;
    this._changed();
  }

  publicState() {
    const s = this.state;
    return {
      ...s,
      players: s.players.map((p) => ({ ...p })),
      options: { ...s.options },
      match: s.match ? { ...s.match, players: [...s.match.players], opts: { ...s.match.opts } } : null,
      series: s.series ? { ...s.series, scores: [...s.series.scores], history: s.series.history.map((x) => ({ ...x, points: [...x.points] })) } : null,
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

  /** 試合に参加しているゲストの席（ホストを除く） */
  _guestsInMatch() {
    return (this.state.match?.players || []).filter((slot) => slot > 0);
  }

  // ---- 接続イベント ----
  _guestConnected({ slot, rejoin, replaced }) {
    this.sound.play('join');
    this._toast(rejoin ? `${PLAYER_LABEL[slot]}が戻ってきました！` : `${PLAYER_LABEL[slot]}が参加しました！`);
    const s = this.state;
    const me = s.players[slot];
    if (s.screen === 'lobby') s.screen = 'home';
    if (s.screen === 'ready') this._resetReady();
    const inMatch = s.screen === 'game' && s.match && s.match.players.includes(slot);
    if (inMatch) {
      // 再接続したゲストは状態を失っている可能性があるので、必ず一時停止して全員に完全同期する
      if (s.match.status === 'running' || s.match.status === 'resuming') this._pauseMatch('disconnect', replaced, slot);
      me.link = 'syncing';
      if (this.gm.game && this.gm.matchId === s.match.matchId) this._sendFullSync();
    } else {
      me.link = 'connected';
    }
    this.lastMsgAt[slot] = now(); // 巻き戻し（古い接続の最終受信時刻を使う）の後で更新する
    this._changed();
  }

  _guestLost(slot, next) {
    const s = this.state;
    const me = s.players[slot];
    if (me.link === next) return;
    if (next === 'waiting') this._toast(`${PLAYER_LABEL[slot]}との通信が切れました。再接続を待っています…`);
    me.link = next;
    me.ready = false;
    if (s.screen === 'ready') this._resetReady();
    this._acks.delete(slot);
    // 参加者がいなくなったら一時停止（戻ってくるのを待つか、ホストがゲームを中止する）
    if (s.screen === 'game' && s.match && s.match.players.includes(slot)) this._pauseMatch('disconnect', true, slot);
    this._changed();
  }

  _onGuestMessage(msg, slot) {
    const s = this.state;
    switch (msg.type) {
      case 'ready_change':
        if (s.screen === 'ready') this._setReady(slot, msg.ready);
        break;
      case 'resume_ack': {
        const m = s.match;
        if (!m || msg.matchId !== m.matchId || msg.gen !== m.gen || !m.players.includes(slot)) return;
        this._acks.add(slot);
        s.players[slot].link = 'connected';
        this._updateSynced();
        if (m.synced && !m.started && !s.hostHidden) {
          this._startRunning(0); // 初回開始はレース内のカウントダウンがあるので即開始
        } else {
          this._changed();
        }
        break;
      }
      case 'player_input':
      case 'game_msg':
        if (s.screen === 'game') this.gm.handleMessage(msg, slot);
        break;
      default:
        break;
    }
  }

  /** 試合の参加者（ゲスト）全員が、いまの世代の状態を読み込んだか */
  _updateSynced() {
    const m = this.state.match;
    if (!m) return;
    const hostOk = !this._srv || this._hostLoaded; // サーバー計算では、ホストも状態を受け取る側
    m.synced = hostOk && this._guestsInMatch().every((slot) => this._acks.has(slot) && this.state.players[slot].link === 'connected');
  }

  /** サーバー計算にするか。中継（Cloudflare）でつながっていて、サーバー計算が無効でなければ使う */
  _serverPlan() {
    if (this.net.transport !== 'relay' || !relayBase() || import.meta.env?.VITE_SERVER_SIM === '0') return null;
    return { base: relayBase(), gid: randomHex(12), ak: randomToken(18), tickets: ['', randomToken(18), randomToken(18)] };
  }

  /** サーバー計算: サーバーから届いた完全な状態をホスト自身が読み込む */
  _onEngineFull(msg) {
    const m = this.state.match;
    if (!m || !this._srv || msg.matchId !== m.matchId || msg.gen !== m.gen) return;
    this.gm.loadSnapshot(msg.snapshot);
    this._hostLoaded = true;
    this._updateSynced();
    if (m.synced && !m.started && !this.state.hostHidden) this._startRunning(0);
    else this._changed();
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
    for (const p of this.state.players) p.ready = false;
    this._cancelStart();
  }

  _cancelStart() {
    clearTimeout(this._startTimer);
    this._startTimer = null;
    this._startAt = 0;
  }

  /** 使われている席の全員がつながっていて準備完了なら、開始のカウントを始める */
  _setReady(slot, value) {
    const s = this.state;
    s.players[slot].ready = value;
    const ok = this.enoughPlayers && this.allConnected && this.occupied.every((i) => s.players[i].ready);
    if (ok) {
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
    s.series = null;
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
    s.options = defaultOptions(getGame(id));
    s.screen = 'ready';
    this._resetReady();
    this._changed();
  }

  /** 準備画面でゲーム設定を変える（ホストのみ）。変えたら準備状態はやり直し */
  setOption(key, value) {
    const s = this.state;
    if (s.screen !== 'ready') return;
    const next = validOptions(getGame(s.gameId), { ...s.options, [key]: value });
    if (next[key] !== value || s.options[key] === value) return;
    s.options = next;
    this._resetReady();
    this._changed();
  }

  setReady(value) {
    if (this.state.screen === 'ready') this._setReady(0, value);
  }

  async _beginMatch() {
    const s = this.state;
    this._startTimer = null;
    this._startAt = 0;
    const def = getGame(s.gameId);
    if (s.screen !== 'ready' || !def || !this.enoughPlayers || !this.allConnected || !this.occupied.every((i) => s.players[i].ready)) {
      this._changed();
      return;
    }
    // 連戦（設定 races が 2 以上）は、結果画面から「次のレースへ」で続ける
    const races = validOptions(def, s.options).races | 0;
    s.series = races > 1 ? { total: races, round: 1, scores: Array.from({ length: MAX_PLAYERS }, () => 0), final: false, history: [] } : null;
    this._used = {};
    await this._launchMatch(def);
  }

  /** 1 レースぶんのゲームを起動する（最初のレースも、連戦の次のレースも同じ） */
  async _launchMatch(def) {
    const s = this.state;
    const matchId = randomHex(8);
    const players = this.occupied; // 参加する席（ホストが先頭）。車はこの順
    const opts = { ...resolveMatchOptions(def, s.options, this._used), round: s.series?.round ?? 1 };
    for (const opt of def.options || []) if (opt.choices.some((c) => c.random)) (this._used[opt.key] ||= []).push(opts[opt.key]);
    s.screen = 'game';
    for (const p of s.players) p.ready = false;
    s.result = null;
    let srv = this._serverPlan();
    s.match = { matchId, gen: 1, status: 'loading', reason: null, synced: false, started: false, players, server: !!srv, opts };
    this._acks.clear();
    this._hostLoaded = false;
    this._srv = srv;
    this._changed();
    try {
      if (srv) {
        try {
          await this.gm.create(def, matchId, 1, opts, players, { base: srv.base, gid: srv.gid, slot: 0, key: srv.ak });
          await this.gm.startOnServer({ matchId, gen: 1, options: opts, players, tickets: srv.tickets });
        } catch (err) {
          // サーバーが使えない（無料枠の上限・障害など）: これまでどおり、ホストの端末で計算する
          console.warn('[room] サーバー計算を始められませんでした。ホストの端末で計算します', err);
          this.gm.destroy();
          srv = null;
          this._srv = null;
          if (s.match?.matchId === matchId) s.match.server = false;
          await this.gm.create(def, matchId, 1, opts, players);
        }
      } else {
        await this.gm.create(def, matchId, 1, opts, players);
      }
      await this.gm.firstFrame;
    } catch (err) {
      console.error(err);
      this._toast(startFailText(err));
      this.abortGame();
      return;
    }
    if (s.match?.matchId !== matchId || !this.gm.game) return; // 読み込み中に中止された
    if (this.net.guestConnected) this._sendFullSync();
    this._changed();
  }

  /** 連戦: 結果画面から次のレースを始める（ホストのみ） */
  nextRace() {
    const s = this.state;
    const def = getGame(s.gameId);
    if (s.screen !== 'result' || !s.series || s.series.final || !def || !this.enoughPlayers || !this.allConnected) return;
    s.series.round++;
    this._launchMatch(def);
  }

  /** 試合に参加しているゲスト全員へ完全な状態を送り、ACK を待つ */
  _sendFullSync() {
    const m = this.state.match;
    if (!m || !this.gm.game) return;
    m.gen++;
    m.synced = false;
    this._acks.clear();
    this.gm.setGen(m.gen);
    const srv = this._srv;
    if (srv) {
      // サーバー計算: サーバーが全員（ホストも）に完全な状態を送る。参加者には、サーバーの試合 ID と自分のチケットだけ伝える
      this._hostLoaded = false;
      this.gm.engineCommand({ type: 'e_sync', gen: m.gen });
    }
    this._hostSyncAt = now();
    for (const slot of this._guestsInMatch()) {
      if (!this.net.isConnected(slot)) continue;
      this.state.players[slot].link = 'syncing';
      this._syncSentAt[slot] = now();
      this.net.sendTo(slot, this._fullSyncMsg(slot));
    }
    this._updateSynced();
  }

  /** ゲスト slot へ送る「いまの世代の完全な状態」（サーバー計算では、サーバーの試合 ID と席のチケットだけ） */
  _fullSyncMsg(slot) {
    const m = this.state.match;
    const srv = this._srv;
    const base = { type: 'game_start', gameId: this.state.gameId, matchId: m.matchId, gen: m.gen };
    return srv ? { ...base, snapshot: {}, server: { gid: srv.gid, ticket: srv.tickets[slot] } } : { ...base, snapshot: this.gm.getSnapshot() };
  }

  /**
   * 同期の安全装置（1 秒ごと）: 状態を送ったのに ACK が来ないゲストへ、いまの世代の状態をもう一度送る。
   * 接続が切り替わる瞬間に送ると届かないことがあり、そのままだと「状態復元中」のまま再開できなくなる
   */
  _resendStaleSync() {
    const m = this.state.match;
    if (this.closed || !m || !this.gm.game || m.synced || this.state.screen !== 'game') return;
    const t = now();
    if (this._srv && !this._hostLoaded && t - this._hostSyncAt > ROOM_CONFIG.SYNC_RETRY_MS) {
      this._hostSyncAt = t;
      this.gm.engineCommand({ type: 'e_sync_request' });
    }
    for (const slot of this._guestsInMatch()) {
      if (this._acks.has(slot) || !this.net.isConnected(slot) || this.state.players[slot].link !== 'syncing') continue;
      if (t - (this._syncSentAt[slot] || 0) < ROOM_CONFIG.SYNC_RETRY_MS) continue;
      this._syncSentAt[slot] = t;
      this.net.sendTo(slot, this._fullSyncMsg(slot));
    }
  }

  _startRunning(delayMs) {
    const m = this.state.match;
    if (!m) return;
    clearTimeout(this._resumeTimer);
    m.started = true;
    m.reason = null;
    if (this._srv) this.gm.engineCommand({ type: 'e_resume', gen: m.gen, delayMs });
    this.net.send({ type: 'resume', matchId: m.matchId, gen: m.gen, delayMs });
    if (delayMs > 0) {
      m.status = 'resuming';
      this.resumeAt = now() + delayMs;
      // ゲスト側はメッセージ受信から delayMs 後に再開するので、片道の遅延ぶんだけ遅らせて揃える
      const oneWay = this._srv ? 0 : Math.min(300, (this.net.rtt || 0) / 2);
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

  /** ゲームを一時停止する。rollback=true なら、席 slot の切断を検出する前の状態へ巻き戻す */
  _pauseMatch(reason, rollback = false, slot = 0) {
    const m = this.state.match;
    if (!m) return;
    clearTimeout(this._resumeTimer);
    const wasRunning = m.status === 'running';
    if (m.status === 'running' || m.status === 'resuming') {
      this.gm.pause();
      if (rollback && wasRunning && this.gm.rollbackTo(this.lastMsgAt[slot] - 50)) {
        this._toast('通信が切れる直前の状態に戻しました');
      }
      m.status = 'paused';
    } else if (m.status === 'loading' && m.started) {
      m.status = 'paused';
    }
    m.reason = reason;
    m.synced = false;
    this._acks.clear();
    if (this._srv) {
      // サーバー計算: サーバーの計算を止める。接続中の一時停止（ホストの操作・タブが裏）なら、全員で状態を揃え直す
      if (reason === 'disconnect') this.gm.engineCommand({ type: 'e_pause' });
      else {
        m.gen++;
        this.gm.setGen(m.gen);
        this._hostLoaded = false;
        this.gm.engineCommand({ type: 'e_sync', gen: m.gen });
      }
    }
    if (reason !== 'disconnect' && this.net.guestConnected && this.gm.game) {
      // 接続中の一時停止: ゲストに停止時点の状態を渡して揃えてもらう
      if (!this._srv) {
        m.gen++;
        this.gm.setGen(m.gen);
      }
      const msg = { type: 'pause', matchId: m.matchId, gen: m.gen, reason, snapshot: this._srv ? {} : this.gm.getSnapshot() };
      this._hostSyncAt = now();
      for (const g of this._guestsInMatch()) {
        if (!this.net.isConnected(g)) continue;
        this.state.players[g].link = 'syncing';
        this._syncSentAt[g] = now();
        this.net.sendTo(g, msg);
      }
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
    return !!m && m.status === 'paused' && m.synced && this.state.players.every((p, i) => !m.players.includes(i) || p.link === 'connected') && !this.state.hostHidden;
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
    if (this._srv) this.gm.engineCommand({ type: 'e_abort' });
    this._srv = null;
    this.gm.destroy();
    if (matchId) this.net.send({ type: 'game_abort', matchId });
    s.match = null;
    s.series = null;
    s.screen = 'select';
    s.gameId = null;
    for (const p of s.players) if (p.link === 'syncing') p.link = 'connected';
    this._changed();
  }

  _onGameFinished(result) {
    const s = this.state;
    if (s.screen !== 'game' || !s.match) return;
    const matchId = s.match.matchId;
    this._srv = null;
    this.gm.destroy();
    s.result = sanitizeResult(result);
    const se = s.series;
    if (se && s.result?.points) {
      // 連戦: このレースのポイントを席ごとに足す
      const pts = Array.from({ length: MAX_PLAYERS }, () => 0);
      s.result.players.forEach((p, i) => {
        pts[p.slot] = s.result.points[i] || 0;
        se.scores[p.slot] += pts[p.slot];
      });
      se.history.push({ name: s.result.course, points: pts });
      se.final = se.round >= se.total;
    }
    this.net.send({ type: 'game_result', matchId, result: s.result });
    s.match = null;
    s.screen = 'result';
    for (const p of s.players) if (p.link === 'syncing') p.link = 'connected';
    this._changed();
  }

  /** 戻ってこないゲストの席を空けて、新しいゲストを招待できるようにする */
  freeGuestSlot(slot) {
    if (!(slot >= 1 && slot < MAX_PLAYERS)) return;
    this.net.freeGuestSlot(slot);
    this._guestLost(slot, 'none');
    this._toast('席を空けました。招待URLを送り直してください');
  }

  /** 部屋を解散する */
  disband(reason = 'disband') {
    if (this.closed) return;
    this.closed = true;
    this._cancelStart();
    clearTimeout(this._resumeTimer);
    clearInterval(this._syncTimer);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this._srv) this.gm.engineCommand({ type: 'e_abort' });
    this._srv = null;
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
  constructor({ invite, token, sound, music, input, layer }) {
    super();
    this.role = 'guest';
    this.slot = null; // 部屋の席（join_accepted で決まる。1・2）
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
    this.gm = new GameManager({ role: 'guest', net: this.net, input, sound, music, layer });

    this.net.on('state', (st) => {
      this.linkState = st;
      if (st !== 'connected') this.gm.pause(); // 通信が切れたら即座に止める（片方だけ進まないように）
      this.emit('change');
    });
    this.net.on('lost', () => this._toast('ホストとの通信が切れました。再接続しています…'));
    this.net.on('joined', (msg) => {
      this.failure = null;
      this.slot = msg.slot;
      this.gm.slot = msg.slot;
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
        // サーバー計算の試合: サーバーの試合 ID と自分のチケットでつなぎ、状態もサーバーから受け取る
        let server = null;
        if (msg.server) {
          const gid = msg.server.gid;
          const ticket = msg.server.ticket;
          if (!relayBase() || typeof gid !== 'string' || typeof ticket !== 'string' || !/^[A-Za-z0-9]{24,64}$/.test(gid) || !/^[A-Za-z0-9_-]{8,64}$/.test(ticket)) {
            this._toast('サーバー計算の試合につなげませんでした');
            return;
          }
          server = { base: relayBase(), gid, slot: this.slot, key: ticket };
        }
        if (!this.gm.game || this.gm.matchId !== msg.matchId) {
          try {
            await this.gm.create(def, msg.matchId, msg.gen, { ...validOptions(def, this.state?.options), ...this.state?.match?.opts }, this.state?.match?.players, server);
            await this.gm.firstFrame; // 重い初回描画を済ませてから ACK する
          } catch (err) {
            console.error(err);
            this._toast(startFailText(err));
            return;
          }
          if (this.closed || this.state?.screen !== 'game') {
            this.gm.destroy();
            return;
          }
        }
        await this._loadFrom(msg);
        break;
      }
      case 'pause':
        if (this.gm.matchId !== msg.matchId) return;
        await this._loadFrom(msg);
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

  /** 状態を読み込んで ACK する。サーバー計算の試合では、状態はサーバーから受け取る */
  async _loadFrom(msg) {
    if (!this.gm.serverSim) return this._loadAndAck(msg);
    this.gm.pause();
    this.gm.setGen(msg.gen);
    try {
      const full = await this.gm.fetchFull();
      if (this.closed || this.gm.matchId !== msg.matchId || full.matchId !== msg.matchId) return;
      this._loadAndAck({ ...msg, snapshot: full.snapshot });
    } catch (err) {
      console.error('[room] サーバーから状態を受け取れませんでした', err);
      this._toast('サーバーから状態を受け取れませんでした。ホストの操作を待ってください');
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
    // 他の人の切断などでホストが一時停止したら、自分も止める（再開は完全同期のあとでホストが指示する）
    if (room.match?.status === 'paused' && this.gm.game) this.gm.pause();
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
