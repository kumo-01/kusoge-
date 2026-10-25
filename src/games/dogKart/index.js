// わんわん爆走カート: ミニゲームモジュール本体
//
// ホスト: RaceSim を 60Hz で進める正本。ゲスト入力はキューに積み、1 tick に 1 つずつ適用する。
// ゲスト: 受信したスナップショットを補間して表示。自分の車だけクライアント予測し、
//         ホストの確定状態との誤差を少しずつ補正する。

import { Track } from './track.js';
import { RaceSim, sanitizeSnapshot } from './race.js';
import { stepKart, PHYS_KEYS } from './physics.js';
import { World } from './world.js';
import { ChaseCamera } from './camera.js';
import { Hud } from './hud.js';
import { RACE, NET, IN, ITEMS, KART } from './constants.js';
import { lerp, lerpAngle, angleDiff } from '../../core/util.js';

export function createGame() {
  return new DogKartGame();
}

const EVENT_TYPES = new Set(['go', 'box', 'item', 'use', 'hit', 'slip', 'block', 'bump', 'wall', 'lap', 'finish', 'respawn', 'boing', 'poof']);

function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !EVENT_TYPES.has(e.t)) return null;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { t: e.t, k: e.k === 1 ? 1 : 0, by: e.by === 1 ? 1 : 0, r: e.r === 1 ? 1 : 0, v: e.v === 1 ? 1 : 0, x: n(e.x), z: n(e.z), s: n(e.s), b: Math.max(0, Math.min(64, n(e.b) | 0)), item: n(e.item) | 0, lap: n(e.lap) | 0, grant: !!e.grant, big: !!e.big };
}

/** ゲスト自身の車のクライアント予測 */
class Predictor {
  constructor() {
    this.k = null;
    this.hist = [];
    this.off = { x: 0, z: 0, y: 0, h: 0 };
  }

  reset(k) {
    this.k = structuredClone(k);
    this.hist = [];
    this.off = { x: 0, z: 0, y: 0, h: 0 };
  }

  record(seq) {
    const e = { seq };
    for (const key of PHYS_KEYS) e[key] = this.k[key];
    this.hist.push(e);
    if (this.hist.length > 240) this.hist.shift();
  }

  /** server: ホストが確定したゲストの車, ack: そのとき適用済みだった入力 seq */
  reconcile(server, ack) {
    if (!this.k) {
      this.reset(server);
      return;
    }
    for (const f of ['lap', 'cp', 'item', 'roll', 'fin', 'ft', 'lapStart', 'best', 'stats', 'spinDur', 'wrong', 'bump']) this.k[f] = server[f];
    while (this.hist.length && this.hist[0].seq < ack) this.hist.shift();
    const e = this.hist[0];
    if (!e || e.seq !== ack) {
      // 対応する履歴がない（再開直後など）: 大きくずれていれば合わせる
      if (Math.hypot(server.x - this.k.x, server.z - this.k.z) > NET.SNAP_DIST * 2) this.reset(server);
      return;
    }
    const dx = server.x - e.x;
    const dz = server.z - e.z;
    const dh = angleDiff(e.h, server.h);
    if (Math.hypot(dx, dz) > NET.SNAP_DIST || Math.abs(dh) > 1.5) {
      // 復帰などの瞬間移動はそのまま合わせる
      for (const key of PHYS_KEYS) this.k[key] = server[key];
      this.hist = [];
      this.off = { x: 0, z: 0, y: 0, h: 0 };
      return;
    }
    for (const key of PHYS_KEYS) {
      const d = key === 'h' ? dh : server[key] - e[key];
      if (Math.abs(d) < 1e-7) continue;
      this.k[key] += d;
      for (const h of this.hist) h[key] += d;
    }
    for (const key of ['spin', 'boost', 'slow', 'inv', 'rc']) this.k[key] = Math.max(0, this.k[key]);
    if (this.k.y < 0) this.k.y = 0;
    // 見た目は急に動かさず、補正量を少しずつ反映する
    this.off.x -= dx;
    this.off.z -= dz;
    this.off.h -= dh;
  }

  decay(dt) {
    const f = Math.exp(-dt * 9);
    this.off.x *= f;
    this.off.z *= f;
    this.off.h *= f;
  }
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
    this.me = ctx.playerIndex;
    this.sound = ctx.sound;
    this.track = new Track();
    this.sim = new RaceSim(this.track);
    this.paused = true;
    this.finished = false;
    this.hud = new Hud(ctx.container, this.track, this.me);
    this.world = null;
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
    this.guestQueue = [];
    this.guestHeld = 0;
    this.lastQueuedSeq = 0;
    this.starved = true;
    this.carryOneshot = 0;
    this.netEvents = [];
    // ゲスト用
    this.buffer = [];
    this.clock = 0;
    this.clockInit = false;
    this.pred = new Predictor();
    this.seq = 0;
    this.pending = [];
    this.lastCd = null;
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
    if (i.consume('KeyR')) b |= IN.RESPAWN;
    return b;
  }

  /** ホスト: キューからゲスト入力を 1 tick 分取り出す */
  _nextGuestInput() {
    const q = this.guestQueue;
    // 溜まりすぎたら古い入力を捨てて追いつく（押した瞬間の入力は引き継ぐ）
    if (q.length > NET.INPUT_BUFFER_MAX) {
      while (q.length > 2) {
        const e = q.shift();
        this.carryOneshot |= e.bits & IN.ONESHOT;
        this.sim.s.ack = e.seq;
      }
    }
    if (!q.length || (this.starved && q.length < 2)) {
      this.starved = true;
      return this.guestHeld;
    }
    this.starved = false;
    const e = q.shift();
    this.guestHeld = e.bits & IN.HELD;
    this.sim.s.ack = e.seq;
    const bits = e.bits | this.carryOneshot;
    this.carryOneshot = 0;
    return bits;
  }

  onMessage(msg) {
    if (!this.isHost || msg.type !== 'player_input') return;
    const n = msg.inputs.length;
    for (let i = 0; i < n; i++) {
      const seq = msg.seq - n + 1 + i;
      if (seq <= this.lastQueuedSeq) continue; // 古い入力は無視
      this.guestQueue.push({ seq, bits: msg.inputs[i] & 63 });
      this.lastQueuedSeq = seq;
    }
    if (this.guestQueue.length > 120) this.guestQueue.splice(0, this.guestQueue.length - 120);
  }

  // ---- 固定ステップ更新 ----
  update(dt) {
    if (this.isHost) {
      const ks = this.sim.s.karts;
      for (let i = 0; i < 2; i++) {
        const p = this.prev[i];
        p.x = ks[i].x;
        p.z = ks[i].z;
        p.y = ks[i].y;
        p.h = ks[i].h;
      }
      const hostIn = this._readInput();
      const guestIn = this._nextGuestInput();
      this.sim.step(dt, [hostIn, guestIn]);
      const ev = this.sim.drainEvents();
      if (ev.length) {
        this._handleEvents(ev);
        for (const e of ev) this.netEvents.push(e);
        if (this.netEvents.length > 100) this.netEvents.splice(0, this.netEvents.length - 100);
      }
      const s = this.sim.s;
      if (s.phase === 'finished' && s.endT <= 0 && !this.finished) {
        this.finished = true;
        this.ctx.finish(this.sim.buildResult());
      }
    } else {
      const bits = this._readInput();
      this.seq++;
      this.pending.push(bits);
      if (this.pending.length >= NET.INPUT_SEND_EVERY || bits & IN.ONESHOT) {
        this.ctx.sendInput(this.seq, this.pending);
        this.pending = [];
      }
      if (NET.PREDICTION && this.pred.k) {
        const s = this.sim.s;
        const raceT = this._guestRaceTime();
        const active = s.phase === 'racing' || (s.phase === 'countdown' && raceT >= 0);
        stepKart(this.pred.k, bits, dt, this.track, active && s.phase !== 'finished');
        this.pred.record(this.seq);
      }
    }
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
    const e = this.netEvents;
    this.netEvents = [];
    return e;
  }

  loadSnapshot(snap) {
    this.sim.loadSnapshot(snap);
    const s = this.sim.s;
    this.world?.effects.clear();
    if (this.isHost) {
      // 巻き戻し: 未処理のゲスト入力は破棄して確定済みの seq から受け直す
      this.prev = s.karts.map((k) => ({ x: k.x, z: k.z, y: k.y, h: k.h }));
      this.guestQueue = [];
      this.lastQueuedSeq = s.ack;
      this.starved = true;
      this.finished = false;
      this.netEvents = [];
    } else {
      this.buffer = [{ t: s.tick * this.ctx.fixedDt, s }];
      this.clockInit = false;
      this.pred.reset(s.karts[1]);
      this.seq = s.ack;
      this.pending = [];
    }
    this.cam?.reset();
  }

  applyNetSnapshot(snap, events) {
    if (this.isHost) return;
    const s = sanitizeSnapshot(snap, this.sim.s, this.sim.boxPos.length);
    if (s === this.sim.s) return;
    const t = s.tick * this.ctx.fixedDt;
    const last = this.buffer[this.buffer.length - 1];
    if (last && t < last.t) return; // 順序が逆転した古いデータ
    this.buffer.push({ t, s });
    while (this.buffer.length > 2 && this.buffer[1].t < t - 1) this.buffer.shift();
    // 受信時刻にゆっくり合わせる時計（受信のゆらぎを吸収）
    if (!this.clockInit || Math.abs(this.clock - t) > 0.5) {
      this.clock = t;
      this.clockInit = true;
    } else {
      this.clock += (t - this.clock) * 0.08;
    }
    this.sim.s = s;
    if (NET.PREDICTION) this.pred.reconcile(s.karts[1], s.ack);
    const ev = [];
    for (const e of events) {
      const c = cleanEvent(e);
      if (c) ev.push(c);
    }
    if (ev.length) this._handleEvents(ev);
  }

  pause() {
    this.paused = true;
    this.sound.setEngine(false);
    if (this.isHost) {
      this.guestQueue = [];
      this.lastQueuedSeq = this.sim.s.ack;
      this.guestHeld = 0;
      this.starved = true;
    } else {
      this.pending = [];
    }
  }

  resume() {
    this.paused = false;
    if (!this.isHost) {
      this.clockInit = false;
      this.buffer = this.buffer.slice(-1);
      if (this.pred.k) this.pred.hist = [];
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
          if (e.k === me && e.grant) snd.play('pickup');
          break;
        }
        case 'item':
          if (e.k === me) snd.play('itemReady');
          break;
        case 'use': {
          const k = kartPos(e.k);
          if (e.item === ITEMS.BONE) {
            snd.play('throw');
            fx?.text('ワン!', k.x, 3.5, k.z, 3);
          } else if (e.item === ITEMS.BANANA) {
            snd.play('drop');
          } else if (e.item === ITEMS.BOOST) {
            snd.play('boost');
            fx?.text('ブーン!', k.x, 3.5, k.z, 3.5);
            fx?.ring(k.x, 0.5, k.z, 0xffd23f, 5);
          }
          break;
        }
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
          if (e.s > 15) fx?.text('ゴツン!', e.x, 3, e.z, 2.8);
          break;
        case 'lap':
          if (e.k === me && e.lap < RACE.LAPS) {
            if (e.lap === RACE.LAPS - 1) {
              snd.play('finalLap');
              this.hud.flash('FINAL LAP!', 'final', 1600);
            } else {
              snd.play('lap');
              this.hud.flash(`LAP ${e.lap + 1}`, 'lap', 1300);
            }
          }
          break;
        case 'finish': {
          const k = kartPos(e.k);
          fx?.confetti(k.x, 3, k.z, 80);
          if (e.k === me) {
            snd.play('finish');
            this.hud.flash('🏁 ゴール！！', 'goal', 3500);
          } else {
            snd.play('lose');
            this.hud.flash('あいてが先にゴール…', 'bad', 3500);
          }
          break;
        }
        case 'respawn': {
          const k = kartPos(e.k);
          fx?.puff(k.x, 1, k.z, { n: 8, size: 1, spread: 2.5 });
          if (e.k === me) snd.play('respawn');
          break;
        }
        case 'boing':
          fx?.text('ボヨン!', e.x, 2.5, e.z, 2.4);
          break;
        case 'poof':
          fx?.puff(e.x, 1, e.z, { n: 5, size: 0.7, spread: 1 });
          break;
        default:
          break;
      }
    }
  }

  // ---- 描画 ----
  _renderState(dt) {
    const s = this.sim.s;
    if (this.isHost) {
      return { karts: s.karts, items: s };
    }
    const renderT = this.clock - NET.INTERP_DELAY;
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
    const karts = [lerpKart(a.s.karts[0], n.s.karts[0], f), lerpKart(a.s.karts[1], n.s.karts[1], f)];
    if (NET.PREDICTION && this.pred.k) {
      this.pred.decay(dt);
      const k = this.pred.k;
      karts[1] = { ...k, x: k.x + this.pred.off.x, z: k.z + this.pred.off.z, h: k.h + this.pred.off.h };
    }
    // 飛んでいるホネは id で対応付けて補間
    const prevProj = new Map(a.s.proj.map((p) => [p.id, p]));
    const proj = n.s.proj.map((p) => {
      const q = prevProj.get(p.id);
      return q ? { ...p, x: lerp(q.x, p.x, f), z: lerp(q.z, p.z, f) } : p;
    });
    return { karts, items: { boxes: s.boxes, proj, bananas: n.s.bananas } };
  }

  render(alpha, dt) {
    const s = this.sim.s;
    if (!this.isHost && !this.paused && this.clockInit) this.clock += dt;
    const st = this._renderState(dt);
    let karts = st.karts;
    if (this.isHost) {
      karts = s.karts.map((k, i) => {
        const p = this.prev[i];
        if (this.paused) return k;
        return { ...k, x: lerp(p.x, k.x, alpha), z: lerp(p.z, k.z, alpha), y: lerp(p.y, k.y, alpha), h: lerpAngle(p.h, k.h, alpha) };
      });
    }
    const mine = karts[this.me];
    const raceT = this.isHost ? s.t : this._guestRaceTime();

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

    if (this.world) {
      const w = this.world;
      const winner = s.winner;
      karts.forEach((k, i) => w.karts[i].update(k, dt, winner < 0 ? 0 : winner === i ? 1 : -1));
      w.updateItems(st.items, dt);
      // ブースト中・芝生の土煙
      for (const k of karts) {
        if (k.boost > 0 && Math.random() < 0.6) w.effects.puff(k.x - Math.sin(k.h) * 2.2, 0.6, k.z - Math.cos(k.h) * 2.2, { color: 0xffd27a, size: 0.5, up: 0.5 });
        else if (k.grass && Math.abs(k.sp) > 8 && Math.random() < 0.3) w.effects.puff(k.x - Math.sin(k.h) * 1.6, 0.3, k.z - Math.cos(k.h) * 1.6, { color: 0xc8e6a0, size: 0.5, up: 0.8 });
        else if (k.spin > 0 && Math.random() < 0.4) w.effects.puff(k.x, 0.3, k.z, { color: 0xffffff, size: 0.6, up: 1 });
      }
      this.cam.update({ x: mine.x, y: mine.y, z: mine.z, h: mine.h, sp: mine.sp, boost: mine.boost }, dt);
      w.followSun(mine.x, mine.z);
      w.effects.update(dt, w.camera);
      w.updateAmbient(dt);
      w.render();
    }

    // HUD
    const info = this.ctx.getNetInfo();
    const rtt = info.rtt != null ? `${Math.round(info.rtt)}ms` : '';
    const leader = this.sim.leaderIndex();
    const sk = s.karts[this.me]; // 周回・アイテムは確定状態を表示
    this.hud.update(
      {
        rank: leader === this.me ? 1 : 2,
        lap: sk.lap,
        time: s.phase === 'countdown' ? raceT : sk.fin ? sk.ft : raceT,
        speed: mine.sp,
        boost: mine.boost,
        item: sk.item,
        roll: sk.roll,
        wrong: sk.wrong,
        phase: s.phase,
        karts,
        netText: this.paused ? '⏸ 一時停止中' : `📶 ${this.isHost ? 'ゲスト' : 'ホスト'}と接続中 ${rtt}`,
        netTone: this.paused ? 'warn' : 'ok',
      },
      dt,
    );

    const ratio = Math.abs(mine.sp) / KART.MAX_SPEED;
    this.sound.setEngine(!this.paused && s.phase !== 'finished', ratio, mine.boost > 0);
  }

  end() {
    this.sound.setEngine(false);
  }

  destroy() {
    this.sound.setEngine(false);
    this.world?.dispose();
    this.world = null;
    this.hud.dispose();
  }
}
