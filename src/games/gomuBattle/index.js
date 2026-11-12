// いぬいぬゴム鉄砲バトル: 犬になって輪ゴム鉄砲で撃ち合う、一人称視点の 3D ゲーム（3 ラウンドの合計点）。
//
// 計算はホスト（sim.js）。自分の犬の移動だけは自分の端末で計算してホストへ送る（撃ち合いの操作感のため）。
// 撃つときは、自分の画面に見えているとおりの向きで撃ち、ホストへ「撃った」を送る（当たりはホストが決める）。
// ゲストの画面の輪ゴムは、ホストから届いた「撃った」をもとに、同じ計算で飛ばして見せる（当たって消えるのはホストの知らせで）。

import { PLAYERS } from '../../screens/common.js';
import { device } from '../../core/device.js';
import { GomuSim } from './sim.js';
import { ARENAS } from './arena.js';
import { createBody, stepMove, stepBand, bandSpec, aimDir, eyeOf, heightOf, movableBox, segCylinder, rayCylinder } from './physics.js';
import { GomuWorld } from './world.js';
import { GomuHud } from './hud.js';
import { packPilot, unpackPilot, packState, unpackState, packBin, unpackBin, toB64, fromB64 } from './net.js';
import { GUN, PLAYER, ITEM, ITEMS, ITEM_INFO, ROUND, BOT } from './constants.js';
import { canSee } from './arena.js';

const SLOT_CSS = ['#ff4d5e', '#3d8bff', '#ff5fb0', '#22b573'];
const BOT_DOGS = [
  { kind: 'chihuahua', name: 'チワワ', css: '#ffb703' },
  { kind: 'dachs', name: 'ダックス', css: '#8338ec' },
  { kind: 'husky', name: 'ハスキー', css: '#06d6a0' },
  { kind: 'beagle', name: 'ビーグル', css: '#fb8500' },
  { kind: 'golden', name: 'ゴールデン', css: '#8d99ae' },
];
const FUR = { shiba: 0xf2a04b, corgi: 0xe8893a, poodle: 0xfff3f6, pug: 0xead1a4 };
// キーボードで向きを変える速さ（ラジアン/秒）。押し始めはゆっくり（細かく狙える）、押し続けると速くなる
const KEY_TURN_MIN = 1.1;
const KEY_TURN_MAX = 3.2;
const KEY_PITCH_MIN = 0.7;
const KEY_PITCH_MAX = 1.6;
const KEY_RAMP = 0.4; // 速くなりきるまでの秒数
const LOOK = 0.0024; // マウスの感度（ラジアン / ピクセル）
const TOUCH_LOOK = 0.006; // タッチの感度（ゆっくりなぞると細かく、速くなぞると大きく回る）
const AIM_RANGE = 45; // 照準が相手に重なっているかを調べる距離
const PITCH_MAX = 1.35;

export function createGame() {
  return new GomuGame();
}

class GomuGame {
  start(ctx) {
    this.ctx = ctx;
    this.isHost = ctx.isHost;
    this.me = ctx.playerIndex;
    this.humans = ctx.players.length;
    this.nBots = Math.max(0, Math.min(BOT.MAX, ctx.options?.bots ?? 2));
    this.n = this.humans + this.nBots;
    const names = ctx.getNames?.() || [];
    this.idents = Array.from({ length: this.n }, (_, i) => {
      if (i < this.humans) {
        const slot = ctx.players[i];
        const p = PLAYERS[slot] || PLAYERS[0];
        return { slot, kind: p.kind, name: names[slot] || p.name, css: SLOT_CSS[slot] || '#999', bot: false };
      }
      const b = BOT_DOGS[(i - this.humans) % BOT_DOGS.length];
      return { slot: null, kind: b.kind, name: `${b.name}（CPU）`, css: b.css, bot: true };
    });
    this.paused = false;
    this.seenEv = new Set();
    this.netEvents = [];
    this.evSeq = 0;
    this.bands = []; // ゲスト: 見せる輪ゴム
    this.cid = 0;
    this._judged = new Set(); // 自分の画面で当てた輪ゴム（ゲスト）
    this.buffer = []; // ゲスト: 受け取った要約（ほかの犬を滑らかに動かすため）
    this.last = null;
    this.round = -1;
    this.pilot = { ...createBody(), ammo: GUN.AMMO, reload: 0, fireCd: 0, sp: 0, spN: 0, g: -1, moving: false };
    this.prevPos = null;
    this.fireHeld = false;
    this.shakeT = 0;
    this._fired = false;
    this._sendN = 0;
    this._seq = 0;
    this._finished = false;
    this._smooth = []; // ホスト: ほかの人の犬の見た目の位置（報告は毎秒 30 回なので、なめらかにする）
    this._los = [];
    this._frame = 0;
    this._starT = []; // 無敵スターの残り（見た目のため。番号ごと）
    this._keyHeld = 0; // 矢印キーを押し続けている秒数
    this._onTarget = false;
    try {
      this.world = new GomuWorld(ctx.container);
      this.world.ensureDogs(this.idents.map((d) => d.kind), this.idents.map((d) => parseInt(d.css.slice(1), 16)));
    } catch (err) {
      console.warn('[gomu] 3D を始められませんでした', err);
      this.world = null;
    }
    this.hud = new GomuHud(ctx.container, { touch: device.coarse });
    this.hud.itemBox.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._wantItem = true;
    });
    this._bindMouse();
    if (this.isHost) {
      this.sim = new GomuSim({ humans: this.humans, bots: this.nBots });
      // ゲストが撃った輪ゴムの当たりは、撃った人の画面で決める（その人が見ているとおりに当たる。遅れがない）
      this.sim.clientJudge = (i) => i > 0 && i < this.humans && i !== this.me;
      this._hostEvents(this.sim.drainEvents());
    }
  }

  // ---- 入力（マウス: 画面をクリックすると視点を固定。動かすと向きが変わる） ----
  _bindMouse() {
    const cv = this.world?.renderer.domElement || this.ctx.container;
    this._cv = cv;
    this._onDown = (e) => {
      if (e.pointerType !== 'mouse' || this.paused) return;
      if (document.pointerLockElement !== cv) {
        cv.requestPointerLock?.()?.catch?.(() => {});
        return;
      }
      if (e.button === 0) this.fireHeld = true;
    };
    this._onUp = (e) => {
      if (e.button === 0) this.fireHeld = false;
    };
    this._onMove = (e) => {
      if (document.pointerLockElement !== cv || this.paused) return;
      this._turn(e.movementX * LOOK, e.movementY * LOOK);
    };
    this._onLock = () => {
      if (document.pointerLockElement !== cv) this.fireHeld = false;
    };
    cv.addEventListener('pointerdown', this._onDown);
    window.addEventListener('mouseup', this._onUp);
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('pointerlockchange', this._onLock);
  }

  _turn(dx, dy) {
    const p = this.pilot;
    p.yaw -= dx;
    p.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p.pitch - dy));
  }

  // ---- 状態 ----
  /** 自分の犬の、ホストが持っている状態（体力・倒れた・ゴム切れなど） */
  _myRec() {
    if (this.isHost) return this.sim.s.players[this.me];
    return this.last?.players[this.me] || null;
  }

  get phase() {
    return this.isHost ? this.sim.s.phase : this.last?.phase || 'intro';
  }

  get roundT() {
    if (this.isHost) return this.sim.s.t;
    if (!this.last) return -ROUND.INTRO;
    return this.last.t + (this.paused ? 0 : Math.min(0.5, (performance.now() - this._lastAt) / 1000));
  }

  get arena() {
    return ARENAS[Math.max(0, this.round) % ARENAS.length];
  }

  /** ぶつかる物すべて（家具 + 押せるもの）。ホストは計算の正本、ゲストは自分の手元の写し */
  get cw() {
    if (this.isHost) return this.sim.cw;
    return (this._gcw ||= { boxes: [...this.arena.boxes, ...this.mov] });
  }

  /** 押せるもの（ホストは計算の正本、ゲストは手元の写し） */
  get movList() {
    return this.isHost ? this.sim.s.mov || [] : this.mov;
  }

  _setRound(r) {
    if (r === this.round) return;
    this.round = r;
    this.bands = [];
    this.buffer = [];
    this._starT = [];
    this.mov = (this.arena.movables || []).map(movableBox);
    this._gcw = null;
    this.world?.setArena(ARENAS[r % ARENAS.length]);
  }

  /** 自分の犬を (x, y, z) へ（出発・復活） */
  _placePilot(x, y, z, yaw, g) {
    Object.assign(this.pilot, createBody(x, z, yaw), { y, g, ammo: GUN.AMMO, reload: 0, fireCd: 0 });
    this.prevPos = null;
  }

  // ---- 1 tick ----
  update(dt) {
    if (this.paused) return;
    if (!this.isHost && !this.last) return; // 最初の要約が届くまで待つ
    const i = this.ctx.input;
    const t = this.hud.touch;
    const tk = t ? t.take() : { jump: false, dash: false, item: false };
    const rec = this._myRec();
    const phase = this.phase;
    const dead = !!rec && rec.dead > 0;
    const act = phase === 'play' && !dead;
    const p = this.pilot;
    // 移動
    const fx = (i.isDown('KeyD') ? 1 : 0) - (i.isDown('KeyA') ? 1 : 0) + (t ? t.mx : 0);
    const fz = (i.isDown('KeyW') ? 1 : 0) - (i.isDown('KeyS') ? 1 : 0) + (t ? t.mz : 0);
    // キーボードだけでも遊べるように: 矢印キーで向き（← → で左右、↑ ↓ で上下）
    if (!this.paused) {
      const kx = (i.isDown('ArrowRight') ? 1 : 0) - (i.isDown('ArrowLeft') ? 1 : 0);
      const ky = (i.isDown('ArrowDown') ? 1 : 0) - (i.isDown('ArrowUp') ? 1 : 0);
      this._keyHeld = kx || ky ? this._keyHeld + dt : 0;
      const ramp = Math.min(1, this._keyHeld / KEY_RAMP);
      if (kx || ky) this._turn(kx * (KEY_TURN_MIN + (KEY_TURN_MAX - KEY_TURN_MIN) * ramp) * dt, ky * (KEY_PITCH_MIN + (KEY_PITCH_MAX - KEY_PITCH_MIN) * ramp) * dt);
    }
    const jump = i.consume('Space') || tk.jump;
    const dash = i.consume('ShiftLeft', 'ShiftRight', 'KeyQ') || tk.dash;
    const crouch = i.isDown('KeyC') || !!t?.crouch;
    const wantItem = i.consume('KeyE') || tk.item || this._wantItem;
    this._wantItem = false;
    const slow = !act ? 0 : rec?.stuck > 0 ? 0 : rec?.stun > 0 ? PLAYER.STUN_SPEED : 1;
    this.prevPos = { x: p.x, y: p.y, z: p.z, crouch: p.crouch };
    const mv = stepMove(p, act ? { fx, fz, jump, dash, crouch } : { crouch: false }, dt, this.cw, slow);
    if (mv.dashed) this.ctx.sound.play('boost');
    p.moving = Math.hypot(p.vx, p.vz) > 0.6;
    // 輪ゴム（弾数は自分の端末で数える）
    p.fireCd = Math.max(0, p.fireCd - dt);
    if (p.reload > 0) {
      p.reload = Math.max(0, p.reload - dt);
      if (p.reload === 0) p.ammo = GUN.AMMO;
    }
    // 撃つ: クリック（マウス固定中）・発射ボタン・F / Enter キー、または画面のタップ（1 発。すぐ撃てないときは少しだけ待つ）
    if (t?.takeTap()) this._tapFire = 0.3;
    if (i.consume('Enter', 'NumpadEnter')) this._tapFire = 0.3;
    this._tapFire = Math.max(0, (this._tapFire || 0) - dt);
    const firing = this.fireHeld || !!t?.fire || i.isDown('KeyF') || this._tapFire > 0;
    if (firing && act && !(rec?.noAmmo > 0) && p.reload <= 0 && p.fireCd <= 0 && p.ammo > 0) {
      this._fire();
      this._tapFire = 0;
    }
    if (i.consume('KeyR') && p.ammo < GUN.AMMO && p.reload <= 0) p.reload = GUN.RELOAD; // 自分で補充
    if (wantItem && act && rec?.item) this._useItem();
    this.shakeT += dt;
    // 自分の位置をホストへ
    if (this.isHost) {
      this.sim.setPilot(this.me, { ...p, g: this.sim.s.players[this.me].g });
      this.sim.step(dt);
      this._hostEvents(this.sim.drainEvents());
      if (this.sim.s.phase === 'done' && !this._finished) {
        this._finished = true;
        this.ctx.finish(this.result());
      }
    } else {
      // 自分の位置は毎 tick（毎秒 60 回）送る（小さいので。ホストの計算・ほかの人の画面への遅れを減らす）
      this.ctx.sendInput(++this._seq, packPilot(p));
      this._stepGuestBands(dt);
    }
  }

  /** 照準ぶれの揺れ（ラジアン） */
  _shake() {
    const rec = this._myRec();
    if (!(rec?.shake > 0)) return [0, 0];
    const t = this.shakeT;
    return [Math.sin(t * 6.3) * 0.09 + Math.sin(t * 15.1) * 0.03, Math.sin(t * 5.1 + 1) * 0.06 + Math.sin(t * 13.7) * 0.02];
  }

  _aim() {
    const p = this.pilot;
    const [sx, sy] = this._shake();
    const o = [p.x, p.y + eyeOf(p), p.z];
    return { o, d: aimDir(p.yaw + sx, Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p.pitch + sy))) };
  }

  _fire() {
    const p = this.pilot;
    const kind = p.sp && p.spN > 0 ? p.sp : 0;
    p.ammo--;
    p.fireCd = GUN.FIRE_GAP;
    if (p.ammo <= 0) p.reload = GUN.RELOAD;
    if (kind) {
      p.spN--;
      if (p.spN <= 0) p.sp = 0;
    }
    const cid = ++this.cid;
    const { o, d } = this._aim();
    this._fired = true;
    this.ctx.sound.play('throw');
    if (this.isHost) {
      this.sim.fire(this.me, o, d, kind, cid);
      return;
    }
    this.ctx.sendGameMessage({ t: 'f', o: o.map((v) => Math.round(v * 1000) / 1000), d: d.map((v) => Math.round(v * 10000) / 10000), k: kind, c: cid });
    // 自分の画面ではすぐに飛ばす（ホストの知らせが来たら、それと結びつける）
    const yaw = Math.atan2(d[0], d[2]);
    const pitch = Math.asin(d[1]);
    const spec = bandSpec(kind);
    const offs = kind === ITEM.TRIPLE ? [-ITEMS.TRIPLE_SPREAD, 0, ITEMS.TRIPLE_SPREAD] : [0];
    offs.forEach((off, idx) => {
      const v = aimDir(yaw + off, pitch);
      this.bands.push({ id: 0, cid: cid * 4 + idx, o: this.me, kind, x: o[0] + v[0] * GUN.MUZZLE, y: o[1] + v[1] * GUN.MUZZLE - 0.08, z: o[2] + v[2] * GUN.MUZZLE, vx: v[0] * spec.speed, vy: v[1] * spec.speed, vz: v[2] * spec.speed, r: spec.r, bounce: spec.bounce, life: spec.life, age: 0, mine: performance.now() });
    });
  }

  _useItem() {
    const { o, d } = this._aim();
    if (this.isHost) this.sim.useItem(this.me, o, d);
    else this.ctx.sendGameMessage({ t: 'u', o, d });
  }

  /**
   * ゲスト: 見せる輪ゴムを進める。自分が撃った輪ゴムは、自分の画面に見えている相手に当たったら、その場で当たり（ホストへ知らせる）。
   * ほかの人の輪ゴムが消えるのはホストの知らせで（届かなければ時間で消す）
   */
  _stepGuestBands(dt) {
    const st = this.last;
    const views = this.bands.some((b) => b.o === this.me) ? this._remoteViews() : null;
    const target = (b) => {
      if (b.kind !== ITEM.HOMING || !st) return null;
      let best = null;
      let bd = ITEMS.HOMING_RANGE;
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      for (const q of st.players) {
        if (q.i === b.o || q.dead > 0) continue;
        const pos = q.i === this.me ? this.pilot : q;
        const tx = pos.x - b.x;
        const ty = pos.y + 0.5 - b.y;
        const tz = pos.z - b.z;
        const dd = Math.hypot(tx, ty, tz);
        if (dd > bd || (tx * b.vx + ty * b.vy + tz * b.vz) / (dd * sp) < Math.cos(ITEMS.HOMING_CONE)) continue;
        bd = dd;
        best = { x: pos.x, y: pos.y + 0.5, z: pos.z };
      }
      return best;
    };
    for (let n = this.bands.length - 1; n >= 0; n--) {
      const b = this.bands[n];
      const ax = b.x;
      const ay = b.y;
      const az = b.z;
      const res = stepBand(b, dt, this.cw, target);
      if (b.o === this.me && views && this._localHit(b, ax, ay, az, views)) {
        this.bands.splice(n, 1);
        continue;
      }
      if (res === 'end' || b.age > b.life + 0.5) {
        if (b.age < b.life) this.world?.burst(b.x, b.y, b.z, 0xffffff, 4, 1.5, 0.04);
        this.bands.splice(n, 1);
      }
    }
  }

  /** 自分の輪ゴムが、画面に見えている相手（views）に当たったか。当たったら、その場で印を出してホストへ知らせる */
  _localHit(b, ax, ay, az, views) {
    let hit = -1;
    let ht = 2;
    views.forEach((q, i) => {
      if (i === this.me || !q || q.dead > 0 || q.inv > 0) return;
      const t = segCylinder(ax, ay, az, b.x, b.y, b.z, q, heightOf(q), PLAYER.HIT_RADIUS + b.r);
      if (t >= 0 && t < ht) {
        ht = t;
        hit = i;
      }
    });
    if (hit < 0) return false;
    const hx = ax + (b.x - ax) * ht;
    const hy = ay + (b.y - ay) * ht;
    const hz = az + (b.z - az) * ht;
    this.ctx.sendGameMessage({ t: 'h', c: b.cid, v: hit, p: [hx, hy, hz].map((x) => Math.round(x * 1000) / 1000) });
    this.hud.hitMarker(false);
    this.ctx.sound.play('pickup');
    this.world?.burst(hx, hy, hz, 0xffd23f, 12, 3, 0.07);
    this._judged.add(b.cid); // ホストからの「当たった」の知らせで、印と音を 2 回出さない
    return true;
  }

  // ---- 起きたこと ----
  /** ホスト: 計算で起きたことを、自分の画面に反映して、ゲストへ配る準備をする */
  _hostEvents(evs) {
    for (const e of evs) {
      e.id = ++this.evSeq;
      this.netEvents.push({ e, n: 3 });
    }
    if (this.netEvents.length > 300) this.netEvents.splice(0, this.netEvents.length - 300);
    this._handleEvents(evs);
  }

  _handleEvents(evs) {
    const name = (i) => this.idents[i]?.name || '?';
    for (const e of evs) {
      switch (e.t) {
        case 'round':
          this._setRound(e.r);
          break;
        case 'spawn':
          if (e.i === this.me) {
            const first = this.pilot.g < 0;
            this._placePilot(e.x, e.y, e.z, e.yaw, e.g);
            if (!first && this.phase === 'play') this.ctx.sound.play('respawn');
          }
          break;
        case 'shot':
          if (!this.isHost) this._guestShot(e);
          else if (e.o !== this.me) this._near(e) && this.ctx.sound.play('throw');
          break;
        case 'end': {
          if (!this.isHost) {
            const k = this.bands.findIndex((b) => b.id === e.id);
            if (k >= 0) this.bands.splice(k, 1);
          }
          this.world?.burst(e.x, e.y, e.z, e.h >= 0 ? 0xffd23f : 0xffffff, e.h >= 0 ? 12 : 5, e.h >= 0 ? 3 : 1.6, e.h >= 0 ? 0.07 : 0.04);
          break;
        }
        case 'hit':
          if (e.v === this.me) {
            this.hud.hurt();
            this.ctx.sound.play('hit');
            this.pilot.vx += e.kx; // 押される
            this.pilot.vz += e.kz;
          }
          if (e.by === this.me && this.isHost) {
            this.hud.hitMarker(false);
            this.ctx.sound.play('pickup');
          }
          break;
        case 'kill':
          this.hud.pushFeed(`💥 ${name(e.by)} が ${name(e.v)} を倒した！`, e.by === this.me ? 'mine' : e.v === this.me ? 'bad' : '');
          if (e.by === this.me) {
            this.hud.hitMarker(true);
            this.ctx.sound.play('bark');
          }
          if (e.v === this.me) this.ctx.sound.play('lose');
          break;
        case 'block':
          if (e.by === this.me) this.ctx.sound.play('bump');
          break;
        case 'pick':
          if (e.i === this.me) {
            this.ctx.sound.play('itemReady');
            this.hud.pushFeed(`🎁 ${ITEM_INFO[e.item]?.name} を拾った！`, 'mine');
          }
          break;
        case 'use':
          if (e.i !== this.me) this.hud.pushFeed(`🎁 ${name(e.i)} が ${ITEM_INFO[e.item]?.name} を使った！`);
          else this.ctx.sound.play('drop');
          break;
        case 'sp':
          if (e.i === this.me) {
            this.pilot.sp = e.k;
            this.pilot.spN = e.n;
          }
          break;
        case 'smoke':
          this.world?.addSmoke(e.id, e.x, e.y, e.z);
          this.ctx.sound.play('slip');
          break;
        case 'gum':
          this.world?.addGum(e.id, e.x, e.y, e.z);
          break;
        case 'gumEnd':
          this.world?.removeGum(e.id);
          break;
        case 'stuck':
          this.world?.removeGum(e.id);
          if (e.i === this.me) {
            this.ctx.sound.play('slip');
            this.hud.pushFeed('🍬 ネバネバを踏んだ！2秒うごけない', 'bad');
          }
          break;
        case 'heal':
          if (e.i === this.me) {
            this.ctx.sound.play('respawn');
            this.hud.pushFeed(`🍖 体力が回復した！`, 'mine');
          }
          break;
        case 'star':
          this._starT[e.i] = e.d;
          if (e.i === this.me) {
            this.ctx.sound.play('boost');
            this.hud.pushFeed(`⭐ ${e.d}秒間 無敵！`, 'mine');
          }
          break;
        case 'fx':
          if (e.by !== this.me) {
            this.ctx.sound.play('thunder');
            this.hud.pushFeed(e.k === ITEM.SHAKE ? '🌀 照準がゆらゆら！' : '✂️ ゴム切れ！3秒撃てない', 'bad');
          }
          break;
        case 'phase':
          if (e.ph === 'play') this.ctx.sound.play('go');
          else if (e.ph === 'end') this.ctx.sound.play('finish');
          break;
        default:
          break;
      }
    }
  }

  _near(e) {
    const p = this.pilot;
    return Math.hypot(e.x - p.x, e.z - p.z) < 14;
  }

  /** ゲスト: ホストからの「撃った」。自分が撃ったものは、すでに飛ばしている輪ゴムと結びつける */
  _guestShot(e) {
    if (e.o === this.me) {
      // 自分が撃った輪ゴム: すでに自分の画面で飛ばしているもの（同じ番号）と結びつける。もう当てた・消えたものは出さない
      const b = this.bands.find((x) => x.cid === e.cid && !x.id);
      if (b) b.id = e.id;
      return;
    }
    if (this.bands.some((x) => x.id === e.id)) return;
    const spec = bandSpec(e.k);
    const b = { id: e.id, o: e.o, kind: e.k, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, r: spec.r, bounce: spec.bounce, life: spec.life, age: 0 };
    // ホストで撃たれてから届くまでの時間（片道）だけ先へ進めて出す（相手の輪ゴムが遅れて見えないように）
    const ahead = Math.min(0.25, this._oneWay());
    for (let t = 0; t < ahead - 1e-6 && !(stepBand(b, Math.min(1 / 60, ahead - t), this.cw) === 'end'); t += 1 / 60);
    this.bands.push(b);
    if (this._near(e)) this.ctx.sound.play('throw');
  }

  /** ホストとの片道の遅れ（秒）の見積もり */
  _oneWay() {
    const rtt = this.ctx.getNetInfo?.()?.rtt;
    return Number.isFinite(rtt) ? Math.max(0, rtt / 2000) : 0.05;
  }

  // ---- 通信 ----
  onMessage(msg) {
    if (!this.isHost) return;
    if (msg.type === 'player_input') {
      const st = unpackPilot(msg.inputs);
      if (st && msg.player > 0 && msg.player < this.humans) this.sim.setPilot(msg.player, st);
      return;
    }
    if (msg.type !== 'game_msg' || !msg.data || !(msg.player > 0)) return;
    const d = msg.data;
    if (d.t === 'f') this.sim.fire(msg.player, d.o, d.d, d.k | 0, d.c | 0);
    else if (d.t === 'h') this.sim.remoteHit(msg.player, d.c | 0, d.v | 0, d.p); // 撃った人の画面で当たった
    else if (d.t === 'u') this.sim.useItem(msg.player, d.o, d.d);
    this._hostEvents(this.sim.drainEvents());
  }

  get netEvery() {
    return 1.5; // 毎秒 40 回
  }

  /** ラウンドごとの点は 10 回に 1 回だけ載せる（めったに変わらない） */
  _withRs() {
    this._rsN = ((this._rsN | 0) + 1) % 10;
    return this._rsN === 1 || this.sim.s.phase !== 'play';
  }

  /** 中継（文字だけ通る）: バイト列を base64 で（起きたことは別に送られる） */
  encodeNetSnapshot() {
    return { b: toB64(packBin(this.sim.s, this._withRs(), null)) };
  }

  /** P2P: バイト列（起きたことも一緒に） */
  encodeNetBinary(ev) {
    return packBin(this.sim.s, this._withRs(), ev);
  }

  decodeNetBinary(u8) {
    const d = unpackBin(u8, this.n, this.last?.players.map((p) => p.rs));
    return d ? { snap: { st: d.st }, ev: d.ev } : null;
  }

  drainNetEvents() {
    const out = [];
    for (const x of this.netEvents) {
      if (out.length >= 120) break;
      out.push(x.e);
      x.n--;
    }
    this.netEvents = this.netEvents.filter((x) => x.n > 0);
    return out;
  }

  applyNetSnapshot(snap, events) {
    if (this.isHost) return;
    const evs = [];
    for (const e of events || []) {
      if (!e || typeof e !== 'object' || !Number.isInteger(e.id) || this.seenEv.has(e.id)) continue;
      this.seenEv.add(e.id);
      evs.push(e);
    }
    if (this.seenEv.size > 800) this.seenEv = new Set([...this.seenEv].slice(-400));
    evs.sort((a, b) => a.id - b.id);
    const prevRs = this.last?.players.map((p) => p.rs);
    const st = snap?.st || (typeof snap?.b === 'string' ? unpackBin(fromB64(snap.b), this.n, prevRs)?.st : unpackState(snap, this.n));
    if (st) {
      // 「ラウンドが変わった」の知らせを取りこぼしても、要約で合わせる
      if (st.round !== this.round && !evs.some((e) => e.t === 'round')) this._setRound(st.round);
    }
    this._handleEvents(evs);
    if (!st) return;
    if (this.last && st.round === this.last.round && st.t < this.last.t - 0.001) return; // 順番が入れ替わった古いもの
    // 届く間隔とそのゆれを測る（ほかの犬を描く遅れを、できるだけ小さく決めるため）
    const now = performance.now();
    if (this._lastAt && this.last && st.round === this.last.round) {
      const gap = (now - this._lastAt) / 1000;
      this._ivl = this._ivl == null ? gap : this._ivl * 0.9 + gap * 0.1;
      this._jit = this._jit == null ? 0 : this._jit * 0.9 + Math.abs(gap - this._ivl) * 0.1;
    }
    this.last = st;
    this._lastAt = now;
    this.buffer.push({ t: st.t, st });
    if (this.buffer.length > 30) this.buffer.shift();
    // 復活の知らせを取りこぼしたとき: 要約の位置に合わせる
    const mine = st.players[this.me];
    if (mine && mine.g !== this.pilot.g && !(mine.dead > 0)) this._placePilot(mine.x, mine.y, mine.z, mine.yaw, mine.g);
    // 押せるもの: ホストの位置に合わせる。ただし自分が押している（すぐ近くの）ものは、手元で押した位置のまま
    if (st.round === this.round && this.mov) {
      st.mov.forEach(([x, z], k) => {
        const b = this.mov[k];
        if (!b) return;
        const cx = (b.x0 + b.x1) / 2;
        const cz = (b.z0 + b.z1) / 2;
        const near = Math.hypot(this.pilot.x - cx, this.pilot.z - cz) < Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2 + 1.2;
        if (near && Math.hypot(x - cx, z - cz) < 1.5) return;
        b.x0 += x - cx;
        b.x1 += x - cx;
        b.z0 += z - cz;
        b.z1 += z - cz;
      });
    }
  }

  getSnapshot() {
    return this.isHost ? this.sim.getSnapshot() : null;
  }

  loadSnapshot(snap) {
    if (!snap || !Array.isArray(snap.players)) return;
    if (this.isHost) {
      this.sim.loadSnapshot(snap);
      this.netEvents = [];
    } else {
      this.last = unpackState(packState(snap), this.n);
      this._lastAt = performance.now();
      this.buffer = [];
      this.bands = (snap.bands || []).map((b) => ({ ...b }));
    }
    this._setRound(snap.round | 0);
    const me = snap.players[this.me];
    if (me) this._placePilot(me.x, me.y, me.z, me.yaw, me.g);
  }

  pause() {
    this.paused = true;
    this.fireHeld = false;
    if (document.pointerLockElement === this._cv) document.exitPointerLock?.();
  }

  resume() {
    this.paused = false;
  }

  // ---- 描画 ----
  /** ゲスト: ほかの犬の、少し前の時刻の位置（2 つの要約の間をなめらかに） */
  _remoteViews() {
    const buf = this.buffer;
    if (!buf.length) return this.last?.players || [];
    // 描く時刻: 最新の要約より「届く間隔 + ゆれ」だけ前（ふつうは 0.03〜0.06 秒。回線がゆれるときだけ長く）
    const delay = Math.max(0.03, Math.min(0.15, (this._ivl ?? 0.025) * 1.2 + (this._jit ?? 0.01) * 2.5));
    const rt = this.roundT - delay;
    let a = buf[0];
    let b = buf[buf.length - 1];
    for (let k = buf.length - 1; k >= 0; k--) {
      if (buf[k].t <= rt) {
        a = buf[k];
        b = buf[Math.min(k + 1, buf.length - 1)];
        break;
      }
    }
    const f = b.t > a.t ? Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t))) : 1;
    const lerpA = (x, y) => x + Math.atan2(Math.sin(y - x), Math.cos(y - x)) * f;
    return b.st.players.map((q, i) => {
      const pa = a.st.players[i] || q;
      if (Math.hypot(q.x - pa.x, q.z - pa.z) > 4) return q; // 復活などの瞬間移動
      return { ...q, x: pa.x + (q.x - pa.x) * f, y: pa.y + (q.y - pa.y) * f, z: pa.z + (q.z - pa.z) * f, yaw: lerpA(pa.yaw, q.yaw) };
    });
  }

  render(alpha, frameDt) {
    const dt = Math.min(0.1, frameDt || 1 / 60);
    const t = this.hud.touch;
    if (t && !this.paused) {
      const [dx, dy] = t.takeLook();
      const k = TOUCH_LOOK * (0.75 + Math.min(1, Math.hypot(dx, dy) / 30)); // ゆっくりなぞると細かく、速くなぞると大きく
      this._turn(dx * k, dy * k);
    }
    if (!this.isHost && !this.last) {
      this.hud.setHint('つないでいます…');
      return;
    }
    const p = this.pilot;
    const rec = this._myRec() || { hp: PLAYER.HP, dead: 0, item: 0 };
    const pv = this.prevPos || p;
    const al = Math.max(0, Math.min(1, alpha));
    const cx = pv.x + (p.x - pv.x) * al;
    const cy = pv.y + (p.y - pv.y) * al;
    const cz = pv.z + (p.z - pv.z) * al;
    // 目の高さ（伏せはなめらかに）
    const eyeT = p.crouch ? PLAYER.CROUCH_EYE : PLAYER.EYE;
    this._eye = this._eye == null ? eyeT : this._eye + (eyeT - this._eye) * Math.min(1, dt * 14);
    const dead = rec.dead > 0;
    const [sx, sy] = this._shake();
    // ほかの犬
    let views;
    if (this.isHost) {
      views = this.sim.s.players.map((q) => {
        if (q.bot || q.i === this.me) return q;
        const sm = (this._smooth[q.i] ||= { x: q.x, y: q.y, z: q.z, yaw: q.yaw });
        const k = Math.hypot(q.x - sm.x, q.z - sm.z) > 4 ? 1 : Math.min(1, dt * 35); // 報告は毎秒 60 回なので、ほんの少しだけならす
        sm.x += (q.x - sm.x) * k;
        sm.y += (q.y - sm.y) * k;
        sm.z += (q.z - sm.z) * k;
        sm.yaw += Math.atan2(Math.sin(q.yaw - sm.yaw), Math.cos(q.yaw - sm.yaw)) * k;
        return { ...q, x: sm.x, y: sm.y, z: sm.z, yaw: sm.yaw };
      });
    } else views = this._remoteViews();
    const w = this.world;
    if (w) {
      for (let k = 0; k < this._starT.length; k++) if (this._starT[k] > 0) this._starT[k] = Math.max(0, this._starT[k] - dt);
      w.updateDogs(views.map((q, i) => (i === this.me ? { hide: true } : { x: q.x, y: q.y, z: q.z, yaw: q.yaw, crouch: q.crouch, moving: q.moving, dead: q.dead > 0, inv: q.inv > 0, star: this._starT[i] > 0 && q.inv > 0, stuck: q.stuck > 0, stun: q.stun > 0 })), dt);
      const bands = this.isHost ? this.sim.s.bands : this.bands;
      w.updateBands(bands, dt);
      const boxes = this.isHost ? this.sim.s.boxes.map((x) => x <= 0) : this.arena.items.map((_, k) => !!((this.last?.boxes ?? 0) & (1 << k)));
      w.updateItemBoxes(boxes, dt);
      w.updateMovables(this.movList);
      // 煙・ガム（知らせを取りこぼしても、要約に合わせる）
      const smokes = this.isHost ? this.sim.s.smokes : this.last?.smokes || [];
      for (const s of smokes) if (!w.smokes.has(s.id)) w.addSmoke(s.id, s.x, s.y, s.z);
      const gums = this.isHost ? this.sim.s.gums : this.last?.gums || [];
      const gids = new Set(gums.map((g) => g.id));
      for (const g of gums) if (!w.gums.has(g.id)) w.addGum(g.id, g.x, g.y, g.z);
      for (const id of [...w.gums.keys()]) if (!gids.has(id)) w.removeGum(id);
      // カメラ（倒れているときは床に転がる）
      const ey = dead ? 0.25 : this._eye;
      w.setCamera(cx, cy + ey, cz, p.yaw + sx, Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p.pitch + sy)));
      w.camera.rotation.z = dead ? 0.35 : 0;
      w.setViewModel({ fired: this._fired, reloading: p.reload > 0 || rec.noAmmo > 0, kind: p.sp && p.spN > 0 ? p.sp : 0, moving: p.moving && p.ground, visible: !dead, furColor: FUR[this.idents[this.me].kind] ?? 0xf2a04b }, dt);
      this._fired = false;
      w.render(dt);
      // 名前（見えている犬だけ）
      this._frame++;
      const names = views.map((q, i) => {
        if (i === this.me || q.dead > 0) return null;
        if (this._frame % 8 === i % 8) this._los[i] = canSee(this.cw, cx, cy + ey, cz, q.x, q.y + heightOf(q) * 0.8, q.z) && Math.hypot(q.x - cx, q.z - cz) < 45;
        if (!this._los[i]) return null;
        const s = w.project(q.x, q.y + heightOf(q) + 0.35, q.z);
        return s ? { x: s.x, y: s.y, text: this.idents[i].name, hp: q.hp, css: this.idents[i].css } : null;
      });
      this.hud.setNames(names);
      // 照準が相手に重なっていたら、照準を赤く（当たる目安）
      if (this._frame % 2 === 0) this._onTarget = !dead && this.phase === 'play' && this._aimOnTarget(views);
      this.hud.setTarget(this._onTarget);
    }
    const st = this.isHost ? null : this.last;
    const players = (this.isHost ? this.sim.s.players : st.players).map((q, i) => ({ i, name: this.idents[i].name, css: this.idents[i].css, score: q.score, dead: q.dead > 0, rs: q.rs }));
    const round = this.isHost ? this.sim.s.round : st.round;
    this.hud.update({
      round,
      arenaName: ARENAS[round % ARENAS.length].name,
      nextArena: ARENAS[(round + 1) % ARENAS.length].name,
      phase: this.phase,
      t: this.roundT,
      meIndex: this.me,
      players,
      inSmoke: w ? w.inSmoke(cx, cy + this._eye, cz) : false,
      me: { hp: rec.hp, dead: rec.dead, item: rec.item, ammo: p.ammo, reload: p.reload, sp: p.sp && p.spN > 0 ? p.sp : 0, spN: p.spN, shake: rec.shake, noAmmo: rec.noAmmo, stuck: rec.stuck, inv: rec.inv, star: rec.inv > 0 ? this._starT[this.me] || 0 : 0 },
    });
    // 3・2・1 の音
    if (this.phase === 'intro') {
      const n = Math.ceil(-this.roundT);
      if (n !== this._cd && n >= 1 && n <= 3) this.ctx.sound.play('beep');
      this._cd = n;
    }
    const locked = document.pointerLockElement === this._cv;
    this.hud.setHint(this.paused || t ? '' : locked ? '' : '画面をクリックして操作開始（マウスで狙う・Esc で解除）');
  }

  /** 照準の先（まっすぐ AIM_RANGE まで）に、見えている相手がいるか */
  _aimOnTarget(views) {
    const { o, d } = this._aim();
    let ht = Infinity;
    views.forEach((q, i) => {
      if (i === this.me || !q || q.dead > 0) return;
      const t = rayCylinder(o, d, q, heightOf(q), PLAYER.HIT_RADIUS);
      if (t >= 0 && t < ht) ht = t;
    });
    if (ht > AIM_RANGE) return false;
    return canSee(this.cw, o[0], o[1], o[2], o[0] + d[0] * ht, o[1] + d[1] * ht, o[2] + d[2] * ht);
  }

  // ---- 結果 ----
  result() {
    const st = this.sim.standings();
    const ps = this.sim.s.players;
    const humans = ps.filter((q) => !q.bot);
    const top = st[0];
    const rankOf = (q) => 1 + ps.filter((o) => o.score > q.score).length;
    const acc = (q) => (q.shots ? `${Math.round((q.landed / q.shots) * 100)}%` : '-');
    const solo = this.humans === 1;
    const winner = top && !top.bot && (st.length < 2 || st[1].score < top.score) ? this.idents[top.i].slot : null;
    const players = humans.map((q) => {
      const r = rankOf(q);
      return {
        slot: this.idents[q.i].slot,
        headline: r === 1 && (st.length < 2 || st.filter((o) => o.score === q.score).length === 1) ? '優勝！' : `${r}位`,
        detail: `合計 ${q.score} 点（当てた ${q.hits}・倒した ${q.kills}）`,
      };
    });
    const v = (f) => humans.map(f);
    return {
      gameId: 'gomuBattle',
      winner,
      title: top ? `${this.idents[top.i].name}の優勝！ ${top.score} 点` : '試合終了',
      course: `${ARENAS.map((a) => a.name).join(' → ')}`,
      players,
      stats: [
        ...Array.from({ length: ROUND.COUNT }, (_, r) => ({ label: `ROUND ${r + 1}（${ARENAS[r].name}）`, values: v((q) => `${q.rs[r]} 点`) })),
        { label: '合計', values: v((q) => `${q.score} 点`) },
        { label: '当てた数', values: v((q) => `${q.hits} 回`) },
        { label: '倒した数', values: v((q) => `${q.kills} 匹`) },
        { label: '倒された数', values: v((q) => `${q.deaths} 回`) },
        { label: '命中率', values: v(acc) },
        { label: '順位', text: st.map((q, k) => `${k + 1}. ${this.idents[q.i].name}（${q.score}点）`).join('　') },
      ],
      points: humans.map((q) => q.score),
      cpu: [],
      solo,
    };
  }

  destroy() {
    const cv = this._cv;
    cv?.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('mouseup', this._onUp);
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('pointerlockchange', this._onLock);
    if (document.pointerLockElement === cv) document.exitPointerLock?.();
    this.hud?.dispose();
    this.world?.dispose();
  }
}
