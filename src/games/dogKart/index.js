// わんわん爆走カート: ミニゲームモジュール本体
//
// ホスト: RaceSim を 60Hz で進める正本。ゲスト入力はキューに積み、1 tick に 1 つずつ適用する。
// 受け取る側（ゲスト。サーバーが計算するときはホストも）: 自分の車はクライアント予測し、確定状態との誤差を滑らかに補正する。
//         ほかの車・飛んでいるアイテムは、自分の車と同じ時刻まで先へ計算して描く（netview.js）。

import { Track } from './track.js';
import { RaceSim, sanitizeSnapshot, unpackNet, kartName, packNetBin, unpackNetBin, NET_EVENT_TYPES } from './race.js';
import { DogKartEngine } from './engine.js';
import { Predictor, RemoteKarts } from './netview.js';
import { stepKart } from './physics.js';
import { World } from './world.js';
import { ChaseCamera } from './camera.js';
import { Hud } from './hud.js';
import { RACE, NET, IN, ITEMS, KART, RAIN, FOOD } from './constants.js';
import { lerp, lerpAngle, angleDiff } from '../../core/util.js';
import { spinAngleOf } from './kart.js';
import { stepTiming } from './timing.js';
import { keepAwake, getQualityPref } from '../../core/device.js';

const CAMERA_KEY = 'wanwan.kartCamera';

export function createGame() {
  return new DogKartGame();
}

const EVENT_TYPES = new Set(NET_EVENT_TYPES);

function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !EVENT_TYPES.has(e.t)) return null;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const idx = (v) => (Number.isInteger(v) && v >= 0 && v < RACE.MAX_KARTS ? v : 0);
  return { id: n(e.id), t: e.t, k: idx(e.k), by: idx(e.by), r: idx(e.r), v: idx(e.v), x: n(e.x), z: n(e.z), s: n(e.s), b: Math.max(0, Math.min(64, n(e.b) | 0)), item: n(e.item) | 0, lap: n(e.lap) | 0, q: Math.max(-1, Math.min(2, n(e.q) | 0)), grant: !!e.grant, big: !!e.big, n: Math.max(0, Math.min(99, n(e.n) | 0)) };
}

const lerpKart = (a, b, f) => ({
  ...b,
  x: lerp(a.x, b.x, f),
  z: lerp(a.z, b.z, f),
  y: lerp(a.y, b.y, f),
  h: lerpAngle(a.h, b.h, f),
  sp: lerp(a.sp, b.sp, f),
  st: lerp(a.st, b.st, f),
  spin: b.spin > 0 && a.spin > 0 ? lerp(a.spin, b.spin, f) : b.spin,
});

class DogKartGame {
  start(ctx) {
    this.ctx = ctx;
    this.isHost = ctx.isHost;
    this.serverSim = !!ctx.serverSim; // サーバーが計算する試合か
    this.me = ctx.playerIndex; // 自分の車の番号（人間は部屋の席の順に 0, 1, 2）
    this.sound = ctx.sound;
    this.track = new Track(ctx.options?.course ?? 0);
    // auth: この端末が計算役か。ホストが計算するときだけ（サーバーが計算するときは、ホストも他の人と同じ「受け取る側」）
    this.auth = ctx.isHost && !ctx.serverSim;
    const simOpts = { npcs: ctx.options?.npcs ?? 0, boss: ctx.options?.boss ?? 0, players: ctx.players };
    if (this.auth) {
      this.engine = new DogKartEngine({ ...simOpts, track: this.track });
      this.sim = this.engine.sim;
    } else {
      this.sim = new RaceSim(this.track, simOpts);
    }
    this.paused = true;
    this.hud = new Hud(ctx.container, this.track, this.me, { round: ctx.options?.round, races: ctx.options?.races });
    this.world = null;
    this.hud.setQualityLabel(getQualityPref());
    // 何戦目かとコース名、ボス犬の参戦をカウントダウン中に知らせる
    const races = ctx.options?.races ?? 1;
    this.hud.flash(races > 1 ? `第${ctx.options?.round || 1}戦 / 全${races}戦　${this.track.name}` : this.track.name, 'plain', 3200);
    if (this.sim.boss) setTimeout(() => this.hud.flash('👑 ボス犬 ドーベルマン参戦！', 'final', 2200), 3300);
    this.hud.onQuality = () => {
      const order = ['auto', 'high', 'light'];
      const next = order[(order.indexOf(this.world?.qualityPref || getQualityPref()) + 1) % order.length];
      this.world?.setQualityPref(next);
      this.hud.setQualityLabel(next);
    };
    this._releaseAwake = keepAwake(); // 遊んでいる間は画面が暗くならないように
    try {
      this.world = new World(ctx.container, this.track, this.sim.boxPos);
      this.cam = new ChaseCamera(this.world.camera);
    } catch (err) {
      // WebGL が使えなくてもゲーム（特にホストの正本）は動かし続ける
      console.error('[dogKart] 3D の初期化に失敗しました', err);
      this.world = null;
      this.hud.setFallback(true);
    }
    // ホスト用
    this.prev = this.sim.s.karts.map((k) => ({ x: k.x, z: k.z, y: k.y, h: k.h }));

    // ゲスト用
    this.seenEvents = new Set();
    this.sentInputs = [];
    this._same = 0;
    this._lastBits = 0;
    this.buffer = [];
    this.clock = 0;
    this.clockInit = false;
    this.lateMax = 0;
    this.interp = NET.INTERP_DELAY; // 今の補間遅延（通信の揺れに合わせて増減）
    this.pred = new Predictor();
    // 通信の診断（画面の隅に出せる。snaps: 瞬間移動で合わせた回数、nohist: 履歴がなく補正できなかった回数、corr: 直近の補正の最大）
    this.diag = { snaps: 0, respawns: 0, lastSnap: '', nohist: 0, corr: 0, corrT: 0, corrShown: 0, lead: 0, catchup: 0, resync: 0, slowed: 0, frames: 0, long: 0, fps: 0, fpsT: 0 };
    try {
      this.diagOn = /[?&]diag=1/.test(location.search) || localStorage.getItem('wanwan.diag') === '1';
      if (/[?&]diag=1/.test(location.search)) localStorage.setItem('wanwan.diag', '1');
      else if (/[?&]diag=0/.test(location.search)) localStorage.removeItem('wanwan.diag');
    } catch {
      this.diagOn = false;
    }
    this.remote = new RemoteKarts();
    this.seq = 0;
    this.pending = [];
    this.lastCd = null;
    try {
      this.cameraMode = localStorage.getItem(CAMERA_KEY) === 'first' ? 'first' : 'third';
    } catch {
      this.cameraMode = 'third';
    }
    this.hud.onCameraToggle = () => this.toggleCamera();
    this.hud.setCameraMode(this.cameraMode);
    this._prevY = [];
    this._onPad = [];
    this.tapPressed = false;
    this._prevTw = 0;
    this._rainLevel = 0;
    // 画面を押す（クリック・タップ）とタイミングブースト。ボタンの上は除く
    this._onPointer = (e) => {
      if (this.paused || e.button > 0) return;
      if (e.target instanceof Element && e.target.closest('button, a, input, [data-ctl]')) return;
      this.tapPressed = true;
    };
    ctx.container.addEventListener('pointerdown', this._onPointer);
  }

  /** カメラ切り替え（三人称 ⇔ 一人称）。自分だけの設定で、相手には影響しない */
  toggleCamera() {
    this.cameraMode = this.cameraMode === 'first' ? 'third' : 'first';
    try {
      localStorage.setItem(CAMERA_KEY, this.cameraMode);
    } catch {
      /* noop */
    }
    this.cam?.reset();
    this.hud.setCameraMode(this.cameraMode);
    this.sound.play('click');
  }

  // ---- 入力 ----
  _readInput() {
    const i = this.ctx.input;
    let b = 0;
    if (i.isDown('KeyW', 'ArrowUp')) b |= IN.UP;
    if (i.isDown('KeyS', 'ArrowDown')) b |= IN.DOWN;
    if (i.isDown('KeyA', 'ArrowLeft')) b |= IN.LEFT;
    if (i.isDown('KeyD', 'ArrowRight')) b |= IN.RIGHT;
    if (i.consume('Space')) b |= IN.ITEM;
    if (i.consume('Enter', 'NumpadEnter', 'KeyE') || this.tapPressed) b |= IN.TAP;
    this.tapPressed = false;
    if (i.consume('KeyC')) this.toggleCamera();
    b |= this.hud.touch.bits();
    return b;
  }

  /** msg.player: 入力を送ってきた人の車の番号（ホストが、つながっている相手から決める） */
  onMessage(msg) {
    if (!this.auth || msg.type !== 'player_input' || !(msg.player > 0)) return;
    this.engine.receiveInput(msg.player, msg.seq, msg.inputs);
  }

  // ---- 固定ステップ更新 ----
  update(dt) {
    if (this.auth) {
      const ks = this.sim.s.karts;
      while (this.prev.length < ks.length) this.prev.push({ x: 0, z: 0, y: 0, h: 0 });
      for (let i = 0; i < ks.length; i++) {
        const p = this.prev[i];
        p.x = ks[i].x;
        p.z = ks[i].z;
        p.y = ks[i].y;
        p.h = ks[i].h;
      }
      const ev = this.engine.step(dt, { 0: this._readInput() });
      if (ev.length) this._handleEvents(ev);
      const result = this.engine.takeResult();
      if (result) this.ctx.finish(result);
    } else {
      const bits = this._readInput();
      const ack = this.sim.s.acks[this.me] || 0;
      // サーバーより先に進みすぎている（サーバーの計算が遅い・詰まった）なら、ときどき 1 tick 止まって合わせる。
      // 先に進みすぎると、操作がサーバーで使われるまでの待ちが長くなる（操作が遅れて効く）
      const rttTicks = ((this.ctx.getNetInfo().rtt ?? 100) / 1000) * 60;
      this._leadHigh = this.seq - ack > rttTicks + NET.LEAD_SLACK ? (this._leadHigh || 0) + 1 : 0;
      if (this._leadHigh > 120 && !(bits & IN.ONESHOT) && (this._skipN = (this._skipN | 0) + 1) % 4 === 0) {
        this.diag.slowed++;
        return;
      }
      this._stepLocal(dt, bits);
      // サーバーの時間に遅れていたら（端末が止まっていた・とても重い）、同じ操作のまま先へ進めて追いつく。
      // 遅れたままだと、確定状態と照らし合わせる履歴がなくなり、自分の車が補正されずにずれてから瞬間移動する
      const lead = this.seq - ack;
      if (this.pred.k && lead < NET.CATCHUP_LEAD) {
        const behind = ack + NET.CATCHUP_LEAD - this.seq;
        const dg = this.diag;
        if (behind > NET.CATCHUP_RESYNC) {
          // 遅れすぎ: 確定状態に合わせ直す
          this.seq = ack + NET.CATCHUP_LEAD - 1;
          this.pred.reset(this.sim.s.karts[this.me]);
          this.remote.reset();
          this.pending = [];
          dg.resync++;
        } else {
          const n = Math.min(behind, NET.CATCHUP_PER_FRAME);
          for (let i = 0; i < n; i++) this._stepLocal(dt, bits & IN.HELD);
          dg.catchup += n;
        }
        this.predPrev = this.pred.k ? { x: this.pred.k.x, z: this.pred.k.z, y: this.pred.k.y, h: this.pred.k.h } : null;
      }
    }
  }

  /** 受け取る側の 1 tick: 操作を記録して送り、自分の車を予測し、ほかの車の推定も進める */
  _stepLocal(dt, bits) {
    // 1 回の描画の間に進めた tick 数（端末が止まったあとの追いつき）。描画のときに、飛んだ分を少しずつ追いつかせる
    if (!this._burstN && this.pred.k) {
      const k = this.pred.k;
      this._burstFrom = { x: k.x + this.pred.off.x, z: k.z + this.pred.off.z, others: this.remote.g.map((g) => g && { x: g.x, z: g.z }) };
    }
    this._burstN = (this._burstN | 0) + 1;
    this.seq++;
    this.pending.push(bits);
    // 順番どおり確実に届く通信（WebSocket）なら、新しい分だけ送る。取りこぼしがある通信（P2P の高速チャンネル）は、直近の分を重ねて送る
    const reliable = !!this.ctx.reliableInput;
    if (!reliable) {
      this.sentInputs.push(bits);
      if (this.sentInputs.length > NET.INPUT_REDUNDANCY) this.sentInputs.shift();
    }
    // 入力が変わらない間は送る回数を減らす（変わったらすぐ送る）。受け取る側は押しっぱなしを保つので、見た目や操作感は変わらない
    this._same = bits === this._lastBits && !(bits & IN.ONESHOT) ? this._same + 1 : 0;
    this._lastBits = bits;
    // （何も押していない間は 1 秒に 2 回、押しっぱなしの間は約 8 回。サーバーは前の入力を保つ）
    const every = this._same >= 30 && bits === 0 ? 30 : this._same >= 8 ? 8 : NET.INPUT_SEND_EVERY;
    if (this.pending.length >= every || bits & IN.ONESHOT) {
      this.ctx.sendInput(this.seq, reliable ? this.pending.slice() : this.sentInputs.slice());
      this.pending = [];
    }
    if (NET.PREDICTION && this.pred.k && this.sim.s.karts[this.me].ow > 0) {
      // 飼い主モード中は自動で走る（操作はできない）。自分の車も、ほかの車と同じく確定状態から同じ時刻まで先を推定して使う
      // （確定状態をそのまま使うと、自分の車とまわりが数メートル後ろへ飛び、終わったときに前へ飛ぶ）
      const s = this.sim.s;
      const run = s.phase === 'racing';
      const pk = this.pred.k;
      this.predPrev = { x: pk.x, z: pk.z, y: pk.y, h: pk.h };
      this.remote.step(this.track, run, dt);
      const g = this.remote.g[this.me];
      if (g) this.pred.reset(g);
      else stepKart(pk, s.karts[this.me].in, dt, this.track, run, true);
    } else if (NET.PREDICTION && this.pred.k) {
      const s = this.sim.s;
      const pk = this.pred.k;
      this.predPrev = { x: pk.x, z: pk.z, y: pk.y, h: pk.h };
      this._predStep(pk, bits);
      this.pred.record(this.seq, bits);
      this.remote.step(this.track, this._predActive() && s.phase !== 'finished', dt);
    }
  }

  /** 自分の車の予測が動ける状態か（レース中、またはカウントダウンが終わった瞬間） */
  _predActive() {
    const s = this.sim.s;
    return s.phase === 'racing' || (s.phase === 'countdown' && this._guestRaceTime() >= 0);
  }

  /** 自分の車の予測を 1 tick 進める（毎 tick と、確定状態からの計算し直しで同じものを使う） */
  _predStep(k, bits) {
    const s = this.sim.s;
    const run = this._predActive() && s.phase !== 'finished';
    // タイミングブーストのリングは自分の車の予測で出す（判定はサーバーが操作の順番どおりに行う）
    if (run) stepTiming(k, this.sim.progressOf(k), s.tc, !!(bits & IN.TAP), this.ctx.fixedDt, null);
    // ブーストのアイテムは、押した瞬間に自分の画面でも加速する（サーバーの useItem と同じ計算。結果は確定状態で確かめる）
    if (run && bits & IN.ITEM && k.item === ITEMS.BOOST && !(k.roll > 0) && !(k.ow > 0)) {
      k.item = 0;
      k.boost = ITEMS.BOOST_TIME;
      k.sp = Math.min(KART.BOOST_SPEED, Math.max(k.sp, KART.MAX_SPEED * 0.85) + 6);
    }
    stepKart(k, bits, this.ctx.fixedDt, this.track, run);
  }

  _guestRaceTime() {
    const s = this.sim.s;
    if (!this.clockInit) return s.t;
    return s.t + Math.max(0, this.clock - s.tick * this.ctx.fixedDt);
  }

  // ---- 同期 ----
  getSnapshot() {
    return this.sim.getSnapshot();
  }

  drainNetEvents() {
    return this.engine ? this.engine.drainNetEvents() : [];
  }

  /** 定期配信用に小さく詰める */
  encodeNetSnapshot() {
    return this.engine.encode();
  }

  /** 定期配信用にバイナリで詰める（P2P のホスト。ev: この配信に載せる演出イベント） */
  encodeNetBinary(ev) {
    return packNetBin(this.sim.s, ev);
  }

  /** バイナリの定期配信を読む。{ snap, ev } または null */
  decodeNetBinary(u8) {
    return unpackNetBin(u8);
  }

  loadSnapshot(snap) {
    this.sim.loadSnapshot(snap);
    const s = this.sim.s;
    this.world?.effects.clear();
    if (this.auth) {
      // 巻き戻し: 未処理のゲスト入力は破棄して確定済みの seq から受け直す
      this.prev = s.karts.map((k) => ({ x: k.x, z: k.z, y: k.y, h: k.h }));
      this.engine.resetQueues();
    } else {
      this.sentInputs = [];
      this.buffer = [{ t: s.tick * this.ctx.fixedDt, s }];
      this.clockInit = false;
      this._rt = undefined;
      this.pred.reset(s.karts[this.me]);
      this.remote.reset();
      this.seq = s.acks[this.me] || 0;
      this.pending = [];
    }
    this.cam?.reset();
  }

  applyNetSnapshot(snap, events) {
    if (this.auth) return;
    // 演出イベントは古いスナップショットに載っていても、まだ見ていなければ処理する
    const ev = [];
    for (const e of events) {
      const c = cleanEvent(e);
      if (!c || this.seenEvents.has(c.id)) continue;
      this.seenEvents.add(c.id);
      ev.push(c);
    }
    if (this.seenEvents.size > 400) this.seenEvents = new Set([...this.seenEvents].slice(-200));
    const raw = snap.p ? unpackNet(snap) : snap; // p があれば配信用に詰めた形、なければ完全な状態
    const s = raw ? sanitizeSnapshot(raw, this.sim.s, this.sim.boxPos.length) : this.sim.s;
    const t = s.tick * this.ctx.fixedDt;
    const last = this.buffer[this.buffer.length - 1];
    if (s === this.sim.s || (last && t <= last.t)) {
      // 順序が逆転した古いデータ（位置は使わない）
      if (ev.length) this._handleEvents(ev.sort((a, b) => a.id - b.id));
      return;
    }
    this.buffer.push({ t, s });
    while (this.buffer.length > 2 && this.buffer[1].t < t - 1) this.buffer.shift();
    // 受信時刻にゆっくり合わせる時計（受信のゆらぎを吸収）
    if (!this.clockInit || Math.abs(this.clock - t) > 0.5) {
      this.clock = t;
      this.clockInit = true;
      this.lateMax = 0;
    } else {
      // 配信が遅れて届いた分（ローカル時計が配信時刻より先に進んでいた量）を覚え、表示の遅延を自動で増やす。
      // 揺れが収まればゆっくり戻す（遅延を増やすと滑らかになるが、相手の車の表示が少し遅れる）
      const lead = Math.max(0, this.clock - t);
      this.lateMax = Math.max(lead, this.lateMax * 0.97);
      const target = Math.min(NET.INTERP_MAX, NET.INTERP_DELAY + this.lateMax * 1.2);
      this.interp += (target - this.interp) * (target > this.interp ? 0.3 : 0.03);
      this.clock += (t - this.clock) * 0.08;
    }
    this.sim.s = s;
    if (NET.PREDICTION) {
      const r = this.pred.reconcile(s.karts[this.me], s.acks[this.me] || 0, this._predStepFn || (this._predStepFn = (k, b) => this._predStep(k, b)));
      const dg = this.diag;
      // 飼い主モード中（自動で走るので予測しない）と復帰（もともと瞬間移動）は、問題の数に入れない
      if (!(s.karts[this.me].ow > 0) && !this.remote.g[this.me]) {
        if (r.kind === 'snap') {
          dg.snaps++;
          dg.lastSnap = `${r.why}${r.d.toFixed(0)}m`;
        } else if (r.kind === 'respawn') dg.respawns++;
        else if (r.kind === 'nohist') dg.nohist++;
        if (r.kind === 'ok' && r.d > dg.corr) dg.corr = r.d;
      }
      dg.lead = this.seq - (s.acks[this.me] || 0);
      // ほかの車を、自分の車と同じ時刻まで進める（自分の操作がサーバーで使われるのは ack の何 tick 後か = 自分の車がどれだけ先か）
      const ahead = Math.max(0, Math.min(NET.REMOTE_AHEAD_MAX, this.seq - (s.acks[this.me] || 0)));
      const active = s.phase === 'racing' || (s.phase === 'countdown' && this._guestRaceTime() >= 0);
      // 飼い主モード中は自分の車も同じように推定する（操作できないので）
      const wasAuto = !!this.remote.g[this.me];
      this.remote.sync(s.karts, s.karts[this.me].ow > 0 ? -1 : this.me, ahead, this.track, active && s.phase !== 'finished', this.ctx.fixedDt);
      // 予測 ⇔ 推定の切り替えで、自分の車の見た目が飛ばないよう、見た目のずれを引き継ぐ
      const g = this.remote.g[this.me];
      const ro = this.remote.off[this.me];
      const po = this.pred.off;
      if (!wasAuto && g && ro) {
        Object.assign(ro, { x: this.pred.k.x + po.x - g.x, z: this.pred.k.z + po.z - g.z, h: angleDiff(g.h, this.pred.k.h + po.h), vx: po.vx, vz: po.vz, vh: po.vh });
      } else if (wasAuto && !g && ro) {
        Object.assign(po, { x: ro.x, z: ro.z, h: ro.h, vx: ro.vx, vz: ro.vz, vh: ro.vh });
      }
    }
    if (ev.length) this._handleEvents(ev.sort((a, b) => a.id - b.id));
  }

  pause() {
    this.paused = true;
    this.sound.setEngine(false);
    this.sound.setRain(0);
    this.tapPressed = false;
    if (this.auth) this.engine.clearQueues();
    else this.pending = [];
  }

  resume() {
    this.paused = false;
    if (!this.auth) {
      this.clockInit = false;
      this._rt = undefined;
      this.buffer = this.buffer.slice(-1);
      if (this.pred.k) this.pred.hist = [];
      this.remote.reset();
    }
  }

  // ---- 演出イベント ----
  _handleEvents(ev) {
    const fx = this.world?.effects;
    const snd = this.sound;
    const me = this.me;
    const kartPos = (i) => this.sim.s.karts[i];
    for (const e of ev) {
      switch (e.t) {
        case 'box': {
          const p = this.sim.boxPos[e.b];
          if (p) fx?.sparkle(p.x, 1.6, p.z, 12);
          if (p) fx?.ring(p.x, 1.6, p.z, 0xffe066, 3.5);
          if (e.k === me && e.grant) snd.play('pickup');
          break;
        }
        case 'item':
          if (e.k === me) snd.play('itemReady');
          break;
        case 'food': {
          // ドッグフードを拾った（拾った本人は音も鳴らす）
          fx?.sparkle(e.x, 1.2, e.z, 5);
          if (e.k === me) snd.play('food');
          if (e.k === me && e.n >= FOOD.MAX) this.hud.flash('🍖 ドッグフードいっぱい！ スピードアップ', 'good', 1400);
          break;
        }
        case 'use': {
          const k = kartPos(e.k);
          if (!k) break;
          if (e.item === ITEMS.BONE) {
            snd.play('throw');
            fx?.text('ワン!', k.x, 3.5, k.z, 3);
          } else if (e.item === ITEMS.FRISBEE) {
            snd.play('throw');
            fx?.text('ピュン!', k.x, 3.5, k.z, 3);
          } else if (e.item === ITEMS.GUARD) {
            snd.play('itemReady');
            fx?.ring(k.x, 0.8, k.z, 0x7fd0ff, 5);
          } else if (e.item === ITEMS.BANANA) {
            snd.play('drop');
          } else if (e.item === ITEMS.BOOST) {
            snd.play('boost');
            fx?.text('ブーン!', k.x, 3.5, k.z, 3.5);
            fx?.ring(k.x, 0.5, k.z, 0xffd23f, 5);
          } else if (e.item === ITEMS.OWNER) {
            snd.play('boost');
            fx?.ring(k.x, 0.5, k.z, 0xffd23f, 7);
            fx?.sparkle(k.x, 1.5, k.z, 14);
          } else if (e.item === ITEMS.HOUSE) {
            snd.play('throw');
            fx?.text('ヒュー…', k.x, 3.5, k.z, 3.5);
            // 文字は本人にだけ（落とした人と、狙われた人）
            const target = this.sim.s.houses.find((x) => x.o === e.k)?.t ?? this.sim.s.karts.findIndex((_, i) => this.sim.rankOf(i) === 1);
            if (e.k === me) this.hud.flash('🏠 犬小屋を落とした！ 1位にまっしぐら', 'good', 1800);
            else if (target === me) this.hud.flash('🏠 犬小屋が降ってくる！', 'bad', 1800);
          }
          break;
        }
        case 'house':
          snd.play('hit');
          fx?.puff(e.x, 1, e.z, { n: 14, size: 1.6, spread: 5 });
          fx?.ring(e.x, 0.4, e.z, 0xc98a4b, ITEMS.HOUSE_RADIUS);
          fx?.text('ドーン!', e.x, 5, e.z, 5);
          this.cam?.addShake(e.v === me ? 1 : 0.4);
          break;
        case 'hit':
          snd.play('hit');
          fx?.stars(e.x, 1.8, e.z, 10, 1.1);
          fx?.text('キャイン!', e.x, 4, e.z, 4);
          if (e.k === me) this.cam?.addShake(0.8);
          if (e.by === me && e.k !== me) this.hud.flash('🦴 命中！', 'good');
          if (e.k === me) this.hud.flash('くらった〜！', 'bad', 900);
          break;
        case 'slip':
          snd.play('slip');
          fx?.text('ツルッ!', e.x, 3.5, e.z, 4);
          fx?.puff(e.x, 0.5, e.z, { color: 0xfff3a0, n: 6, size: 0.8, spread: 2 });
          if (e.by === me && e.k !== me) this.hud.flash('🍌 ひっかかった！', 'good');
          if (e.k === me) this.cam?.addShake(0.5);
          break;
        case 'block': {
          fx?.text('ガード!', e.x, 3.5, e.z, 3);
          break;
        }
        case 'bump': {
          const power = Math.min(2, e.s / 12);
          snd.play(e.big ? 'bigBump' : 'bump');
          fx?.stars(e.x, 1.5, e.z, e.big ? 14 : 6, 0.6 + power * 0.5);
          fx?.ring(e.x, 1.2, e.z, 0xffffff, e.big ? 7 : 4);
          fx?.text(e.big ? 'ドカーン!' : 'ゴツン!', e.x, 4.2, e.z, e.big ? 5 : 3.2);
          this.cam?.addShake(e.big ? 1.1 : 0.4);
          if (e.big && e.r === me) this.hud.flash('💥 体当たり成功！', 'good', 1000);
          break;
        }
        case 'wall':
          if (e.k === me) {
            snd.play('wall');
            this.cam?.addShake(Math.min(0.6, e.s / 30));
          }
          fx?.stars(e.x, 1, e.z, 4, 0.5);
          fx?.sparks(e.x, 0.8, e.z, 10, 0xffb347);
          if (e.s > 15) fx?.text('ゴツン!', e.x, 3, e.z, 2.8);
          break;
        case 'lap':
          if (e.k === me) {
            const k = kartPos(e.k);
            fx?.sparkle(k.x, 2, k.z, 18);
          }
          if (e.k === me && e.lap < RACE.LAPS) {
            if (e.lap === RACE.LAPS - 1) {
              snd.play('finalLap');
              this.ctx.music?.setTempoScale(1.12); // ファイナルラップは BGM を速く
              this.hud.flash('FINAL LAP!', 'final', 1600);
            } else {
              snd.play('lap');
              this.hud.flash(`LAP ${e.lap + 1}`, 'lap', 1300);
            }
          }
          break;
        case 'finish': {
          const k = kartPos(e.k);
          if (!k) break;
          fx?.confetti(k.x, 3, k.z, e.k < 2 ? 80 : 30);
          if (e.k === me) {
            snd.play('finish');
            this.hud.flash('🏁 ゴール！！', 'goal', 3500);
          } else if (e.k < 2) {
            snd.play('lose');
            this.hud.flash('あいてが先にゴール…', 'bad', 3500);
          } else {
            this.hud.flash(`${kartName(kartPos(e.k))}がゴール！`, 'plain', 1500);
          }
          break;
        }
        case 'respawn': {
          const k = kartPos(e.k);
          if (!k) break;
          fx?.puff(k.x, 1, k.z, { n: 8, size: 1, spread: 2.5 });
          if (e.k === me) snd.play('respawn');
          break;
        }
        case 'boing':
          fx?.text('ボヨン!', e.x, 2.5, e.z, 2.4);
          break;
        case 'timing': {
          const k = kartPos(e.k) || e;
          if (e.q > 0) {
            fx?.ring(k.x, 0.6, k.z, e.q === 2 ? 0xffe066 : 0x7ad7ff, e.q === 2 ? 7 : 4.5);
            fx?.text(e.q === 2 ? 'ジャスト!' : 'ナイス!', k.x, 4, k.z, e.q === 2 ? 4.2 : 3.2);
            if (e.q === 2) fx?.sparkle(k.x, 1.5, k.z, 16);
          }
          if (e.k === me) {
            this.hud.timingResult(e.q);
            snd.play(e.q === 2 ? 'perfect' : e.q === 1 ? 'good' : 'miss');
            if (e.q > 0) {
              snd.play('boost');
              this.cam?.addShake(0.3);
            }
          }
          break;
        }
        case 'rain': {
          snd.play('thunder');
          this.hud.thunder();
          break;
        }
        case 'poof':
          fx?.puff(e.x, 1, e.z, { n: 5, size: 0.7, spread: 1 });
          break;
        default:
          break;
      }
    }
  }

  // ---- 描画 ----
  _renderState(dt, alpha = 1) {
    const s = this.sim.s;
    if (this.auth) {
      return { karts: s.karts, items: s };
    }
    // 他の車を描く時刻。補間の遅延が増えたり、端末が一瞬止まったりしても、時刻は戻さない
    // （戻すと、速い車が数メートル後ろへ飛ぶ）。目標との差は、進む速さを変えて少しずつ縮める
    // 端末が止まったあとの追いつき（1 回の描画の間に何 tick も進めた）は、自分の車もほかの車も急に飛ばさず、少しずつ追いつかせる
    const burst = this._burstN | 0;
    this._burstN = 0;
    if (burst >= NET.BURST_MIN && this._burstFrom && this.pred.k) {
      const f = this._burstFrom;
      const k = this.pred.k;
      const o = this.pred.off;
      const r = (burst - 1) / burst; // 1 tick 分は通常の動き
      const jx = (f.x - (k.x + o.x)) * r;
      const jz = (f.z - (k.z + o.z)) * r;
      if (Math.hypot(jx, jz) < NET.CATCHUP_SMOOTH) {
        o.x += jx;
        o.z += jz;
        this.remote.absorb(f.others, r);
      }
    }
    this._burstFrom = null;
    const target = this.clock - this.interp;
    let renderT = target;
    if (this._rt !== undefined && !this.paused) {
      const diff = target - this._rt - dt; // 実時間どおり進めたあとの、目標とのずれ
      renderT = Math.abs(diff) > 0.5 ? target : this._rt + dt * Math.min(1.6, Math.max(0, 1 + diff / 0.25));
    }
    this._rt = renderT;
    const b = this.buffer;
    let a = b[b.length - 1];
    let n = a;
    let f = 0;
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t <= renderT) {
        a = b[i];
        n = b[i + 1] || b[i];
        f = n === a ? 0 : Math.min(1, (renderT - a.t) / (n.t - a.t));
        break;
      }
      if (i === 0) {
        a = n = b[0];
      }
    }
    if (!a) return { karts: s.karts, items: s };
    const karts = n.s.karts.map((k, i) => (a.s.karts[i] ? lerpKart(a.s.karts[i], k, f) : k));
    // 配信が途切れて最新の状態より先を描くときは、止めずに速度で少し先まで進める（カクッと止まって飛ぶのを防ぐ）
    const over = renderT - n.t;
    if (n === b[b.length - 1] && over > 0) {
      const ex = Math.min(over, 0.25);
      for (let i = 0; i < karts.length; i++) {
        const k = karts[i];
        karts[i] = { ...k, x: k.x + (Math.sin(k.h) * k.sp + k.kx) * ex, z: k.z + (Math.cos(k.h) * k.sp + k.kz) * ex };
      }
    }
    // 自分の車を予測しているときは、ほかの車・飛んでいるアイテムも自分の車と同じ時刻で描く（見た目と当たる位置を一致させる）
    const present = NET.PREDICTION && this.pred.k;
    // 飼い主モード中（自動で走る）は、自分の車もほかの車と同じ推定で描く
    const auto = s.karts[this.me]?.ow > 0 && !!this.remote.g[this.me];
    const al = this.predPrev && !this.paused ? Math.max(0, Math.min(1, alpha)) : 1;
    if (present && this.remote.g.length) {
      this.remote.decay(dt);
      for (let i = 0; i < karts.length; i++) {
        const v = i === this.me && !auto ? null : this.remote.view(i, al);
        if (v) karts[i] = v;
      }
    }
    if (present && !auto) {
      this.pred.decay(dt);
      const k = this.pred.k;
      // 画面の更新と 60Hz の更新はずれるので、直前の位置との間を補間して動きを滑らかにする
      const p = this.predPrev;
      const px = p ? lerp(p.x, k.x, al) : k.x;
      const pz = p ? lerp(p.z, k.z, al) : k.z;
      const py = p ? lerp(p.y, k.y, al) : k.y;
      const ph = p ? lerpAngle(p.h, k.h, al) : k.h;
      karts[this.me] = { ...k, x: px + this.pred.off.x, z: pz + this.pred.off.z, y: py, h: ph + this.pred.off.h };
    }
    let proj;
    let bananas = n.s.bananas;
    if (present) {
      // 最新の確定状態から、自分の車と同じ時刻まで進める（ホネはまっすぐ、フリスビーはコースに沿って）
      const ahead = Math.max(0, this.seq - 1 + al - (s.acks[this.me] || 0)) * this.ctx.fixedDt;
      proj = s.proj.map((p) => {
        if (!p.f) return { ...p, x: p.x + p.vx * ahead, z: p.z + p.vz * ahead };
        const q = this.track.project(p.x, p.z);
        const np = this.track.pointAt(q.s + Math.hypot(p.vx, p.vz) * ahead, q.lat);
        return { ...p, x: np.x, z: np.z };
      });
      bananas = s.bananas;
    } else {
      // 飛んでいるホネは id で対応付けて補間
      const prevProj = new Map(a.s.proj.map((p) => [p.id, p]));
      proj = n.s.proj.map((p) => {
        const q = prevProj.get(p.id);
        return q ? { ...p, x: lerp(q.x, p.x, f), z: lerp(q.z, p.z, f) } : p;
      });
    }
    const prevHouse = new Map(a.s.houses.map((p) => [p.id, p]));
    const houses = (present ? s.houses : n.s.houses).map((p) => {
      // 落ちる前の犬小屋は狙った車の真上を追いかけるので、その車を描いている位置の上に出す
      if (present && !p.hit && karts[p.t]) return { ...p, x: karts[p.t].x, z: karts[p.t].z };
      const q = prevHouse.get(p.id);
      return q ? { ...p, x: lerp(q.x, p.x, f), z: lerp(q.z, p.z, f) } : p;
    });
    return { karts, items: { boxes: s.boxes, proj, bananas, houses, foods: s.foods } };
  }

  /** 車ごとの追加演出（ドリフトの火花・着地の土煙・ブースト煙など） */
  _kartEffects(karts, dt) {
    const fx = this.world.effects;
    karts.forEach((k, i) => {
      const fxx = Math.sin(k.h);
      const fzz = Math.cos(k.h);
      const sp = Math.abs(k.sp);
      // 着地
      const py = this._prevY[i] ?? k.y;
      if (py > 0.6 && k.y <= 0.05) fx.puff(k.x, 0.3, k.z, { n: 6, size: 0.8, spread: 2.5, up: 1, color: k.grass ? 0xc8e6a0 : 0xffffff });
      this._prevY[i] = k.y;
      // ブーストパッドを踏んだ瞬間（描画している位置で判定。通信の遅れで音が遅れない）
      const onPad = k.y < 0.8 && this.track.onPad(k.x, k.z);
      if (onPad && !this._onPad[i]) {
        fx.sparks(k.x, 0.4, k.z, 10, 0xffe066, 1.2);
        fx.ring(k.x, 0.2, k.z, 0xffd23f, 4);
        if (i === this.me && !this.paused) this.sound.play('pad');
      }
      this._onPad[i] = onPad;
      if (k.boost > 0 && Math.random() < 0.5) {
        fx.puff(k.x - fxx * 2.4, 0.6, k.z - fzz * 2.4, { color: 0xffd27a, size: 0.35, up: 0.5, life: 0.25, alpha: 0.5 });
        if (Math.random() < 0.5) fx.sparks(k.x - fxx * 2.2, 0.6, k.z - fzz * 2.2, 2, 0xffe066, 0.5);
      } else if (k.grass && sp > 8 && Math.random() < 0.3) {
        fx.puff(k.x - fxx * 1.6, 0.3, k.z - fzz * 1.6, { color: 0xc8e6a0, size: 0.5, up: 0.8 });
      } else if (k.spin > 0 && Math.random() < 0.4) {
        fx.puff(k.x, 0.3, k.z, { color: 0xffffff, size: 0.6, up: 1 });
      }
      // 高速で大きくハンドルを切るとタイヤから火花
      if (!k.grass && sp > KART.MAX_SPEED * 0.7 && Math.abs(k.st) > 0.75 && k.y < 0.1 && Math.random() < 0.6) {
        const side = k.st > 0 ? -1 : 1; // 外側のタイヤ
        const rx = k.x - fxx * 1.0 + fzz * side * 1.0;
        const rz = k.z - fzz * 1.0 - fxx * side * 1.0;
        fx.sparks(rx, 0.15, rz, 2, sp > KART.MAX_SPEED * 0.95 ? 0x7ad7ff : 0xffb347, 0.4);
      }
    });
  }

  render(alpha, dt) {
    const s = this.sim.s;
    if (!this.auth && !this.paused && this.clockInit) this.clock += dt;
    const st = this._renderState(dt, alpha);
    let karts = st.karts;
    if (this.auth) {
      karts = s.karts.map((k, i) => {
        const p = this.prev[i];
        if (this.paused || !p) return k;
        return { ...k, x: lerp(p.x, k.x, alpha), z: lerp(p.z, k.z, alpha), y: lerp(p.y, k.y, alpha), h: lerpAngle(p.h, k.h, alpha) };
      });
    }
    const mine = karts[this.me];
    // テスト用: 画面に出す位置を記録する（VITE_TEST_HOOKS=1 でビルドしたときだけ）
    if (import.meta.env?.VITE_TEST_HOOKS && globalThis.__wanwanProbe && !this.paused) globalThis.__wanwanProbe.push([performance.now(), this.auth ? s.tick : this.seq - 1 + Math.max(0, Math.min(1, alpha)), karts.map((k) => [k.x, k.z, k.h, k.sp]), s.acks?.[this.me] || 0, this.diag.snaps, this.diag.nohist, s.tick]);
    const raceT = this.auth ? s.t : this._guestRaceTime();

    // カウントダウンの音（双方とも自分の時計で鳴らす）
    if (s.phase === 'countdown') {
      if (!this.paused) {
        const n = Math.max(1, Math.ceil(-raceT));
        if (n !== this.lastCd && n <= 3) this.sound.play('beep');
        this.lastCd = n;
      }
    } else if (this.lastCd !== null) {
      this.lastCd = null;
      this.sound.play('go');
      this.hud.flash('GO!', 'go', 1000);
    }

    const firstPerson = this.cameraMode === 'first';
    if (this.world) {
      const w = this.world;
      const winner = s.winner;
      w.ensureKarts(karts.map((k) => (k.boss ? 6 : k.style ?? 0)));
      karts.forEach((k, i) => {
        const mood = winner < 0 ? 0 : k.npc ? (k.fin ? 1 : 0) : winner === i ? 1 : -1;
        w.karts[i].setFirstPerson(firstPerson && i === this.me);
        w.karts[i].own = i === this.me;
        w.karts[i].update(k, dt, mood);
      });
      w.updateItems(st.items, dt);
      if (!this.paused) {
        this._kartEffects(karts, dt);
        // 飛んでいるホネのキラキラの軌跡
        for (const p of st.items.proj) if (Math.random() < 0.35) w.effects.sparks(p.x, 1.1, p.z, 1, 0xfff6c8, 0.3);
      }
      this.cam.update({ x: mine.x, y: mine.y, z: mine.z, h: mine.h, sp: mine.sp, boost: mine.boost, st: mine.st, spinAngle: spinAngleOf(mine) }, dt, this.cameraMode);
      w.followSun(mine.x, mine.z);
      w.effects.update(dt, w.camera);
      w.updateAmbient(dt);
      w.render();
    }

    // HUD
    const info = this.ctx.getNetInfo();
    const rtt = info.rtt != null ? `${Math.round(info.rtt)}ms` : '';
    // 診断表示（URL に ?diag=1 をつけて開くと出る。先行: 自分の操作の番号がサーバーより何 tick 先か / 補正: 直近 3 秒の自分の車の補正の最大 / 飛: 瞬間移動 / 追: 追いついた tick 数 / 履: 履歴がなく補正できなかった回数）
    const dg = this.diag;
    dg.frames++;
    dg.fpsT += dt;
    if (dt > 0.1) dg.long++;
    if (dg.fpsT >= 1) {
      dg.fps = Math.round(dg.frames / dg.fpsT);
      dg.frames = 0;
      dg.fpsT = 0;
    }
    if ((dg.corrT += dt) > 3) {
      dg.corrT = 0;
      dg.corrShown = dg.corr;
      dg.corr = 0;
    }
    const diag = this.diagOn && !this.auth ? ` | ${info.route ? `経路${info.route} ` : ''}${dg.fps}fps 長${dg.long} 先行${dg.lead}t 補正${(dg.corrShown ?? dg.corr).toFixed(1)}m 飛${dg.snaps}${dg.lastSnap ? `(${dg.lastSnap})` : ''} 復${dg.respawns} 追${dg.catchup} 待${dg.slowed} 履${dg.nohist} 再${dg.resync}` : '';
    const sk = s.karts[this.me]; // 周回・アイテムは確定状態を表示
    // タイミングブーストと豪雨は、ゲストは自分の予測（押したタイミングがそのまま判定に使われる）で表示する
    const pk = !this.auth && NET.PREDICTION && this.pred.k ? this.pred.k : sk;
    const tw = s.phase === 'racing' ? pk.tw : 0;
    if (tw > 0 && this._prevTw <= 0 && !this.paused) this.sound.play('chance');
    this._prevTw = tw;
    const rank = this.sim.rankOf(this.me);
    // 雨の強さ（降り始めと止み際はなめらかに）
    const rainTarget = s.rain > 0 ? Math.min(1, s.rain / 0.8, (RAIN.DURATION - s.rain) / 0.5 + 0.2) : 0;
    this._rainLevel += (rainTarget - this._rainLevel) * Math.min(1, dt * 4);
    this.world?.setRain(this._rainLevel);
    this.sound.setRain(this.paused ? 0 : this._rainLevel);
    this.hud.update(
      {
        rank,
        total: s.karts.length,
        lap: sk.lap,
        time: s.phase === 'countdown' ? raceT : sk.fin ? sk.ft : raceT,
        speed: mine.sp,
        boost: mine.boost,
        item: sk.item,
        roll: sk.roll,
        wrong: sk.wrong,
        phase: s.phase,
        tw,
        wet: mine.wet || 0,
        food: sk.fd || 0,
        karts,
        netText: this.paused ? '⏸ 一時停止中' : `📶 ${this.serverSim ? 'サーバー' : this.isHost ? 'ゲスト' : 'ホスト'}と接続中 ${rtt}${diag}`,
        netTone: this.paused ? 'warn' : info.rtt != null && info.rtt > 250 ? 'warn' : 'ok',
      },
      dt,
    );

    const ratio = Math.abs(mine.sp) / KART.MAX_SPEED;
    this.sound.setEngine(!this.paused && s.phase !== 'finished', ratio, mine.boost > 0);
  }

  end() {
    this.sound.setEngine(false);
    this.sound.setRain(0);
  }

  destroy() {
    this.sound.setEngine(false);
    this.sound.setRain(0);
    this.ctx.container.removeEventListener('pointerdown', this._onPointer);
    this._releaseAwake?.();
    this.world?.dispose();
    this.world = null;
    this.hud.dispose();
  }
}
