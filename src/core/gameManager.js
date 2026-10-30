// ミニゲームの起動・ループ・一時停止・状態同期を受け持つ共通システム。
//
// ミニゲームモジュールは createGame() で次のライフサイクルを持つオブジェクトを返す:
//   start(context)          初期化（DOM/3D の生成）。context は下記参照
//   update(dt)              固定時間ステップでの更新（ホスト: 正本のシミュレーション / ゲスト: 予測など）
//   render(alpha, frameDt)  描画（requestAnimationFrame ごと）
//   onMessage(message)      ゲスト入力やゲーム固有メッセージ
//   getSnapshot()           シリアライズ可能な状態（ホスト）
//   loadSnapshot(snapshot)  状態の完全復元（再接続・一時停止時）
//   applyNetSnapshot(snap, events)  定期配信の受信（ゲスト）
//   drainNetEvents()        前回配信以降に起きた演出イベント（ホスト、任意）
//   pause() / resume()      一時停止と再開
//   end()                   終了処理（任意）
//   destroy()               3D オブジェクト・イベントリスナーの解放
//
// 画面遷移や勝敗の確定はホストの部屋管理（room.js）が行い、ゲームは context.finish(result) で結果を返す。

import { Emitter, h, now } from './util.js';
import { EngineClient } from './engineClient.js';

export const LOOP_CONFIG = {
  FIXED_DT: 1 / 60, // ゲーム更新 60Hz
  SNAPSHOT_HZ: 30, // ネットワーク配信（毎秒30回）
  MAX_FRAME_DT: 0.25, // 長いフレームでも物理が暴走しないように
  MAX_STEPS: 8,
  HISTORY_SEC: 6, // 切断時に巻き戻せる範囲
  MIN_RENDER_MS: 14, // 描画は最大 60fps（120Hz の画面では 1 フレームおきに描いて電池と発熱を抑える）
};

const NET_EVERY = Math.max(1, Math.round(1 / LOOP_CONFIG.FIXED_DT / LOOP_CONFIG.SNAPSHOT_HZ)); // 60Hz ÷ 30Hz = 2 tick ごと

export class GameManager extends Emitter {
  constructor({ role, slot = null, net, input, sound, music, layer }) {
    super();
    this.role = role;
    this.slot = slot; // 部屋の席（ホスト 0 / ゲスト 1・2）
    this.net = net;
    this.input = input;
    this.sound = sound;
    this.music = music;
    this.layer = layer;
    this.game = null;
    this.def = null;
    this.matchId = null;
    this.gen = 0;
    this.running = false;
    this._token = 0;
    this._raf = 0;
    this._runTimer = null;
    this._history = [];
    this._netSeq = 0;
    this._renderErrors = 0;
  }

  get isHost() {
    return this.role === 'host';
  }

  /** ゲームモジュールを読み込んで起動する（一時停止状態で開始） */
  /** players: この試合に参加する席（ホストが先頭）。車の番号はこの順 */
  async create(def, matchId, gen, options = {}, players = [0, 1], server = null) {
    this.destroy();
    const token = ++this._token;
    const mod = await def.load();
    if (token !== this._token) return null; // 読み込み中に中止された
    const container = h('div.game-root');
    this.layer.append(container);
    const game = mod.createGame();
    this.game = game;
    this.def = def;
    this.matchId = matchId;
    this.gen = gen;
    this.players = players;
    // server: サーバー計算の試合 { base, gid, slot, key }。ホストも他の人と同じ「操作を送って状態を受け取る側」になる
    this.serverSim = !!server;
    this.running = false;
    this._history = [];
    this._container = container;
    const context = {
      role: this.role,
      isHost: this.isHost,
      serverSim: this.serverSim,
      players, // 参加する席。車の番号 i の人は players[i] の席
      playerIndex: Math.max(0, players.indexOf(this.slot ?? 0)), // 自分の車の番号
      container,
      input: this.input,
      sound: this.sound,
      music: this.music,
      options, // 準備画面でホストが決めたゲーム設定（例: NPC の台数）
      fixedDt: LOOP_CONFIG.FIXED_DT,
      // ゲスト → ホストへの操作入力
      sendInput: (seq, inputs) => {
        if (this.game !== game || !this.running) return;
        if (this.serverSim) {
          this.engine?.send({ type: 'player_input', matchId, gen: this.gen, seq, inputs });
          return;
        }
        if (this.isHost) return;
        // 連続入力は順不同の高速チャンネルで送る（重複・欠落は seq と重ね送りで吸収）
        this.net.sendFast({ type: 'player_input', matchId, gen: this.gen, seq, inputs });
      },
      // ゲーム固有メッセージ（双方向）
      sendGameMessage: (data) => {
        if (this.game !== game) return;
        this.net.send({ type: 'game_msg', matchId, gen: this.gen, data });
      },
      // ホストのみ: 勝敗確定
      finish: (result) => {
        if (!this.isHost || this.game !== game) return;
        this.running = false;
        setTimeout(() => this.emit('finish', result), 0);
      },
      getNetInfo: () => ({ rtt: this.serverSim ? this.engine?.rtt ?? null : this.net.rtt, running: this.running }),
    };
    if (server) {
      this.engine = new EngineClient(server);
      this.engine.on('message', (msg) => this._onEngineMessage(msg, matchId));
      this.engine.on('open', ({ reopened }) => {
        // 途中で切れてつなぎ直したら、完全な状態を取り直して追いつく
        if (reopened && this.game === game && this.running) {
          this.fetchFull().then((f) => this.loadSnapshot(f.snapshot)).catch(() => {});
        }
      });
      this.engine.on('failed', () => this.emit('engine-lost'));
    }
    try {
      game.start(context);
    } catch (err) {
      console.error('[game] 起動に失敗しました', err);
      this.destroy();
      throw err;
    }
    this._last = now();
    this._acc = 0;
    this._netAcc = 0;
    this._renderDt = 1;
    // 最初のフレームの描画（シェーダーのコンパイル等で重い）が終わるまで待てるようにする
    // （タブが非表示で描画されない場合に備えて、一定時間で打ち切る）
    this.firstFrame = new Promise((resolve) => {
      this._resolveFirstFrame = resolve;
      setTimeout(resolve, 5000);
    });
    this._raf = requestAnimationFrame((t) => this._frame(t));
    return game;
  }

  setGen(gen) {
    this.gen = gen;
  }

  // ---- サーバー計算 ----
  /** サーバーのメッセージ（スナップショットは通常の経路に流す） */
  _onEngineMessage(msg, matchId) {
    if (matchId !== this.matchId) return;
    if (msg.type === 'game_snapshot') this.handleMessage(msg);
    else if (msg.type === 'e_result') {
      if (this.isHost && this.game) {
        this.running = false;
        setTimeout(() => this.emit('finish', msg.result), 0);
      }
    } else if (msg.type === 'e_full') this.emit('full', msg);
    else if (msg.type === 'e_started') this.emit('started', msg);
    else if (msg.type === 'e_error') this.emit('engine-error', msg.reason);
  }

  /** サーバーに完全な状態を送ってもらう（読み込み・再接続・一時停止からの同期） */
  fetchFull(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (!this.engine) return reject(new Error('no-engine'));
      const t = setTimeout(() => done(reject, new Error('full-timeout')), timeoutMs);
      const off = this.on('full', (m) => done(resolve, m));
      const offErr = this.on('engine-error', (r) => done(reject, new Error(r)));
      const done = (fn, v) => {
        clearTimeout(t);
        off();
        offErr();
        fn(v);
      };
      this.engine.whenOpen(timeoutMs).then(() => this.engine.send({ type: 'e_sync_request' })).catch((e) => done(reject, e));
    });
  }

  /** ホストだけ: 試合の開始をサーバーに伝えて、始まるのを待つ */
  startOnServer(msg, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      if (!this.engine) return reject(new Error('no-engine'));
      const t = setTimeout(() => done(reject, new Error('start-timeout')), timeoutMs);
      const off = this.on('started', () => done(resolve));
      const offErr = this.on('engine-error', (r) => done(reject, new Error(r)));
      const done = (fn, v) => {
        clearTimeout(t);
        off();
        offErr();
        fn(v);
      };
      this.engine.whenOpen(timeoutMs).then(() => this.engine.send({ type: 'e_start', ...msg })).catch((e) => done(reject, e));
    });
  }

  /** ホストだけ: サーバーへの指示（e_sync / e_pause / e_resume / e_abort） */
  engineCommand(msg) {
    return this.engine?.send(msg) || false;
  }

  /** 進行を開始/再開（delayMs 後） */
  runAfter(delayMs) {
    clearTimeout(this._runTimer);
    if (!this.game) return;
    if (delayMs > 0) this._runTimer = setTimeout(() => this.run(), delayMs);
    else this.run();
  }

  run() {
    clearTimeout(this._runTimer);
    if (!this.game || this.running) return;
    this.running = true;
    this._acc = 0;
    this._netAcc = 0;
    this._last = now();
    this.input.setEnabled(true);
    try {
      this.game.resume();
    } catch (err) {
      console.error(err);
    }
  }

  pause() {
    clearTimeout(this._runTimer);
    if (!this.game) return;
    const was = this.running;
    this.running = false;
    this.input.setEnabled(false);
    if (was) {
      try {
        this.game.pause();
      } catch (err) {
        console.error(err);
      }
    }
  }

  getSnapshot() {
    return this.game ? this.game.getSnapshot() : null;
  }

  loadSnapshot(snapshot) {
    if (!this.game) return;
    this.game.loadSnapshot(snapshot);
    this._history = [];
  }

  /** ホスト: 指定時刻（performance.now）以前の最新スナップショットへ戻す */
  rollbackTo(time) {
    if (!this.game) return false;
    for (let i = this._history.length - 1; i >= 0; i--) {
      if (this._history[i].t <= time) {
        const snap = this._history[i].snap;
        this.game.loadSnapshot(snap);
        this._history.length = i + 1;
        return true;
      }
    }
    return false;
  }

  /** 受信したゲーム関連メッセージを振り分ける。slot: ホストが受け取ったときの送り主の席 */
  handleMessage(msg, slot = null) {
    const game = this.game;
    if (!game || msg.matchId !== this.matchId) return;
    if (msg.gen !== this.gen) return; // 古い世代（一時停止・再同期前）のメッセージは無視
    try {
      if (msg.type === 'player_input' && this.isHost) {
        const player = this.players.indexOf(slot);
        if (this.running && player > 0) game.onMessage({ type: 'player_input', player, seq: msg.seq, inputs: msg.inputs });
      } else if (msg.type === 'game_snapshot' && (!this.isHost || this.serverSim)) {
        if (this.running) game.applyNetSnapshot(msg.snap, msg.ev || [], msg.seq);
      } else if (msg.type === 'game_msg') {
        game.onMessage({ type: 'game_msg', data: msg.data });
      }
    } catch (err) {
      console.warn('[game] メッセージ処理でエラー', err);
    }
  }

  _frame(t) {
    const game = this.game;
    if (!game) return;
    this._raf = requestAnimationFrame((tt) => this._frame(tt));
    const dt = Math.min(Math.max(0, (t - this._last) / 1000), LOOP_CONFIG.MAX_FRAME_DT);
    this._last = t;
    const FIXED = LOOP_CONFIG.FIXED_DT;

    if (this.running) {
      this._acc += dt;
      let steps = 0;
      while (this._acc >= FIXED && steps < LOOP_CONFIG.MAX_STEPS) {
        game.update(FIXED);
        this._acc -= FIXED;
        steps++;
        // 配信は「2 tick ごと」に、その tick の状態で送る（描画のタイミングで送ると配信の間隔が不揃いになり、相手の動きが揺れる）
        if (this.isHost && !this.serverSim && this.running && this.game === game && (this._netTick = (this._netTick | 0) + 1) % NET_EVERY === 0) this._sendSnapshot();
        if (this.game !== game || !this.running) break;
      }
      if (steps >= LOOP_CONFIG.MAX_STEPS) this._acc = 0;
    }
    if (this.game !== game) return;
    // 画面の更新間隔を測り、120Hz などの高リフレッシュの画面だけ描画を間引く
    // （60Hz の画面で間引くと、揺れた拍に 2 フレーム分あいてカクつくので、間引かない）
    this._rafAvg = this._rafAvg ? this._rafAvg * 0.95 + dt * 0.05 : dt;
    this._renderDt += dt;
    if (this._rafAvg < 0.0105 && this._renderDt * 1000 < LOOP_CONFIG.MIN_RENDER_MS) return;
    const frameDt = this._renderDt;
    this._renderDt = 0;
    try {
      game.render(this.running ? this._acc / FIXED : 1, frameDt);
      this._renderErrors = 0;
    } catch (err) {
      // 描画が失敗してもゲーム進行（ホストの正本）は止めない
      if (this._renderErrors++ === 0) console.error('[game] 描画エラー', err);
    }
    if (this._resolveFirstFrame) {
      const r = this._resolveFirstFrame;
      this._resolveFirstFrame = null;
      setTimeout(r, 0);
    }
  }

  _sendSnapshot() {
    const snap = this.game.getSnapshot();
    const ev = this.game.drainNetEvents ? this.game.drainNetEvents() : [];
    const t = now();
    this._history.push({ t, snap });
    const keepAfter = t - LOOP_CONFIG.HISTORY_SEC * 1000;
    while (this._history.length && this._history[0].t < keepAfter) this._history.shift();
    if (this.net.congested && ev.length === 0) return; // 送信が詰まっているときは位置更新を間引く
    const payload = this.game.encodeNetSnapshot ? this.game.encodeNetSnapshot(snap) : snap;
    this.net.sendFast({ type: 'game_snapshot', matchId: this.matchId, gen: this.gen, seq: ++this._netSeq, snap: payload, ev });
  }

  destroy() {
    this._token++;
    this._resolveFirstFrame?.();
    this._resolveFirstFrame = null;
    clearTimeout(this._runTimer);
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this.running = false;
    this.input.setEnabled(false);
    const game = this.game;
    this.game = null;
    this.matchId = null;
    this._history = [];
    if (game) {
      try {
        game.end?.();
      } catch (err) {
        console.error(err);
      }
      try {
        game.destroy();
      } catch (err) {
        console.error(err);
      }
    }
    this.engine?.close();
    this.engine = null;
    this.serverSim = false;
    this._container?.remove();
    this._container = null;
    this.sound.setEngine(false);
  }
}
