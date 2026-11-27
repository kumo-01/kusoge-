// がけっぷち長距離トラック: 周りに何もない崖の上の一本道を、なっっっがいトラックでどこまでも進む。
// 落ちたり横転したら、やり直し。進んだいちばん長い距離で勝負。ホストが「終わらせる」まで、何度でもやり直せる。
//
// トラックの動きは各自の端末だけで計算する（ほかの人のトラックは見えない。道は全員同じ = ホストが決めた種）。
// ホスト（common2d.js の HostedGame）は、全員のいちばん長い距離を集めて、終わらせたときに結果を出す。
// ゲスト → ホスト: { b: いちばん長い距離 }、{ c: 1 }（「終わらせてくれー！」の文句）。効果音はなし。

import { h } from '../../core/util.js';
import { PLAYERS } from '../../screens/common.js';
import { HostedGame, SLOT_COLORS } from '../common2d.js';
import { Road } from './road.js';
import { newTruck, stepTruck, startWreck, stepWreck } from './truck.js';
import { CliffWorld } from './world.js';

export function createGame() {
  return new CliffTruck();
}

const RESULT_DELAY = 2; // 落ちてから結果を出すまで（秒）
const WHEEL_MAX = Math.PI * 0.9; // ハンドルをこれだけ回すと、いっぱいに切ったことになる（ラジアン）
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const fmt = (m) => `${Math.max(0, Math.floor(m)).toLocaleString('ja-JP')} m`;

class CliffTruck extends HostedGame {
  initState() {
    return { t: 0, seed: (Math.random() * 2 ** 31) >>> 0 || 1, best: Array.from({ length: this.n }, () => 0), done: false };
  }

  sanitize(r) {
    if (!r || typeof r !== 'object') return null;
    const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return {
      t: num(r.t, 0, 0, 1e7),
      seed: num(r.seed, 1, 1, 2 ** 31) >>> 0,
      best: Array.from({ length: this.n }, (_, i) => num(Array.isArray(r.best) ? r.best[i] : 0, 0, 0, 1e7)),
      done: !!r.done,
    };
  }

  light() {
    const s = this.s;
    return { t: s.t, seed: s.seed, best: s.best.map((b) => Math.floor(b)) };
  }

  mergeLight(r) {
    if (typeof r.seed === 'number' && r.seed > 0) {
      this.s.seed = r.seed >>> 0;
      this._seedOk = true;
    }
    if (Array.isArray(r.best)) this.s.best = this.s.best.map((b, i) => Math.max(b, Number(r.best[i]) || 0));
  }

  onState() {
    if (this.s.seed) this._seedOk = this._seedOk || this.isHost || !!this._rx;
  }

  step() {}

  /** 名前（準備画面で入れた名前。なければ犬の名前） */
  nameOf(i) {
    const slot = this.slots[i] ?? i;
    return this.ctx.getNames?.()?.[slot] || PLAYERS[slot]?.name || `プレイヤー${i + 1}`;
  }

  onGameMessage(d, player) {
    if (!this.isHost || !d || typeof d !== 'object' || this.s.done) return;
    if (!(player >= 0 && player < this.n)) return;
    if (typeof d.b === 'number' && Number.isFinite(d.b)) this.s.best[player] = Math.max(this.s.best[player], Math.min(1e7, Math.max(0, d.b)));
    if (d.c && player !== this.me) this._peek(player);
  }

  /** ホスト: 終わらせる（結果へ） */
  _finish() {
    if (!this.isHost || this.s.done) return;
    this._reportBest();
    this.s.done = true;
    this.ctx.finish(this.result());
  }

  result() {
    const s = this.s;
    const order = s.best.map((_, i) => i).sort((a, b) => s.best[b] - s.best[a] || a - b);
    const rank = (i) => 1 + s.best.filter((x) => Math.floor(x) > Math.floor(s.best[i])).length;
    const solo = this.n === 1;
    const top = order[0];
    const tie = order.length > 1 && Math.floor(s.best[order[1]]) === Math.floor(s.best[top]);
    return {
      gameId: 'cliffTruck',
      winner: solo || tie ? null : this.slots[top],
      title: solo ? `いちばん遠くまで ${fmt(s.best[0])}` : tie ? `引き分け！ ${fmt(s.best[top])}` : `${this.nameOf(top)}の勝ち！ ${fmt(s.best[top])}`,
      course: '崖の上の一本道',
      players: s.best.map((b, i) => ({
        slot: this.slots[i],
        headline: solo ? '記録' : rank(i) === 1 ? (tie ? '引き分け' : '🏆 いちばん遠く！') : `${rank(i)}位`,
        detail: fmt(b),
      })),
      stats: [{ label: 'いちばん長い距離', values: s.best.map(fmt) }, solo ? null : { label: '順位', text: order.map((i, k) => `${k + 1}. ${this.nameOf(i)}（${fmt(s.best[i])}）`).join('　') }].filter(Boolean),
      score: [{ label: '距離', values: s.best.map((b) => `${Math.floor(b)} pt`) }],
      points: s.best.map((b) => Math.floor(b)),
      cpu: [],
    };
  }

  // ---- 画面 ----
  mount() {
    this.root.className = 'ct-root';
    this._seedOk = this.isHost;
    this.world = null;
    this.truck = null;
    this.prev = null;
    this.wreck = null;
    this.myBest = 0; // この試合の、自分のいちばん長い距離
    this._sentBest = 0;
    this._sentAt = 0;
    this._overAt = 0;
    this._t = 0; // 自分の時計（秒）
    this.steerIn = 0; // ハンドル（-1〜1。右が正）
    this.wheelA = 0; // 画面のハンドルの回り具合（ラジアン）
    this._wheelPtr = null;
    this.gas = false;
    this.brk = false;
    const host = this.isHost;
    const el = (this.el = {
      dist: h('div.ct-dist', null, 'つないでいます…'),
      wheel: h('div.ct-wheel', { 'aria-label': 'ハンドル' }, wheelSvg()),
      brake: h('div.ct-pedal.ct-brake', { 'aria-label': 'ブレーキ' }, pedalLines(3)),
      gas: h('div.ct-pedal.ct-gas', { 'aria-label': 'アクセル' }, pedalLines(5)),
      menuBtn: h('button.ct-menu-btn', { type: 'button', 'aria-label': 'メニュー' }, h('span'), h('span'), h('span')),
      menu: h('div.ct-menu', { hidden: true }),
      over: h('div.ct-over', { hidden: true }),
      peeks: h('div.ct-peeks'),
    });
    // メニュー（左上）: やり直す・終わらせる（ホスト・ひとり）/ 文句を言う（ゲスト）
    el.menu.append(
      h('button.ct-btn', { type: 'button', onclick: () => (this._closeMenu(), this._retry()) }, 'やり直す'),
      host ? h('button.ct-btn.ct-btn-end', { type: 'button', onclick: () => this._finish() }, '終わらせる') : h('button.ct-btn.ct-btn-end', { type: 'button', onclick: (e) => this._complain(e.currentTarget) }, '終わらせてくれー！と文句を言う'),
    );
    el.menuBtn.addEventListener('click', () => {
      el.menu.hidden = !el.menu.hidden;
    });
    this.root.append(el.dist, el.menuBtn, el.menu, el.wheel, h('div.ct-pedals', null, el.brake, el.gas), el.over, el.peeks);
    this._bindControls();
  }

  unmount() {
    this._unbind?.();
    this.world?.destroy();
    this.world = null;
  }

  _closeMenu() {
    this.el.menu.hidden = true;
  }

  /** 道と 3D を用意する（ゲストはホストの種が届いてから） */
  _ensureWorld() {
    if (this.world || !this._seedOk) return !!this.world;
    this.road = new Road(this.s.seed);
    this.world = new CliffWorld(this.root, this.road);
    this.root.prepend(this.world.renderer.domElement);
    this._retry(true);
    return true;
  }

  _retry(first = false) {
    if (!this.road) return;
    if (!first && this.s.done) return;
    this.truck = newTruck(this.road);
    this.prev = { ...this.truck };
    this.wreck = null;
    this._overAt = 0;
    this.el.over.hidden = true;
    this.world.setTruck(this.truck, this.prev, 1);
    this.world.updateRoad(this.truck.hints[0]);
    this.world.chaseCamera(0, true);
  }

  /** 自分のいちばん長い距離をホストへ（ホストは自分で書きこむ） */
  _reportBest(force = false) {
    const b = Math.floor(this.myBest);
    if (this.isHost) {
      this.s.best[this.me] = Math.max(this.s.best[this.me], this.myBest);
      return;
    }
    const now = performance.now();
    if (b > this._sentBest && (force || now - this._sentAt > 700)) {
      this._sentBest = b;
      this._sentAt = now;
      this.sendToHost({ b });
    }
  }

  _complain(btn) {
    const now = performance.now();
    if (now - (this._cmpAt || 0) < 2500) return;
    this._cmpAt = now;
    this.sendToHost({ c: 1 });
    if (btn) {
      const old = btn.textContent;
      btn.textContent = '文句を言った！';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = old;
        btn.disabled = false;
      }, 2500);
    }
  }

  /** ホスト: 画面のはしから、にょいっと「終わらせてくれー！」 */
  _peek(i) {
    const slot = this.slots[i] ?? i;
    const box = h('div.ct-peek', { style: { '--c': SLOT_COLORS[slot] || '#888', top: `${18 + ((this._peekN = ((this._peekN | 0) + 1) % 5) * 13)}%` } }, h('b', null, this.nameOf(i)), h('span', null, '終わらせてくれー！'));
    this.el.peeks.append(box);
    setTimeout(() => box.remove(), 3600);
  }

  // ---- 操作 ----
  _bindControls() {
    const { wheel, gas, brake } = this.el;
    const offs = [];
    const on = (t, ev, fn, o) => {
      t.addEventListener(ev, fn, o);
      offs.push(() => t.removeEventListener(ev, fn, o));
    };
    // ハンドル: つかんで回す（指・マウスの角度の変わり方だけ回る）
    const ang = (e) => {
      const r = wheel.getBoundingClientRect();
      return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));
    };
    on(wheel, 'pointerdown', (e) => {
      e.preventDefault();
      wheel.setPointerCapture?.(e.pointerId);
      this._wheelPtr = { id: e.pointerId, a: ang(e) };
    });
    on(wheel, 'pointermove', (e) => {
      const p = this._wheelPtr;
      if (!p || p.id !== e.pointerId) return;
      const a = ang(e);
      this.wheelA = Math.max(-WHEEL_MAX * 1.15, Math.min(WHEEL_MAX * 1.15, this.wheelA + angDiff(p.a, a)));
      p.a = a;
    });
    const up = (e) => {
      if (this._wheelPtr && this._wheelPtr.id === e.pointerId) this._wheelPtr = null;
    };
    on(wheel, 'pointerup', up);
    on(wheel, 'pointercancel', up);
    // ペダル: 押している間
    for (const [elx, key] of [
      [gas, 'gas'],
      [brake, 'brk'],
    ]) {
      const ids = new Set();
      const set = () => {
        this[key] = ids.size > 0;
        elx.classList.toggle('on', ids.size > 0);
      };
      on(elx, 'pointerdown', (e) => {
        e.preventDefault();
        elx.setPointerCapture?.(e.pointerId);
        ids.add(e.pointerId);
        set();
      });
      const rel = (e) => {
        ids.delete(e.pointerId);
        set();
      };
      on(elx, 'pointerup', rel);
      on(elx, 'pointercancel', rel);
      on(elx, 'lostpointercapture', rel);
    }
    on(this.root, 'contextmenu', (e) => e.preventDefault());
    this._unbind = () => offs.forEach((f) => f());
  }

  /** いまの操作（キーボードと画面のハンドル・ペダル） */
  _input(dt) {
    const i = this.ctx.input;
    const kl = i.isDown('KeyA', 'ArrowLeft');
    const kr = i.isDown('KeyD', 'ArrowRight');
    if (kl || kr) {
      // キーボード: 押している間だけ、少しずつ切る（離すと戻る）
      const want = (kr ? 1 : 0) - (kl ? 1 : 0);
      this.steerIn += Math.max(-dt * 1.6, Math.min(dt * 1.6, want - this.steerIn));
      this.wheelA = this.steerIn * WHEEL_MAX;
    } else if (this._wheelPtr) {
      this.steerIn = Math.max(-1, Math.min(1, this.wheelA / WHEEL_MAX));
    } else {
      // 手を離すと、ハンドルはまっすぐへ戻る
      const back = dt * 3.2;
      this.wheelA = Math.abs(this.wheelA) <= back ? 0 : this.wheelA - Math.sign(this.wheelA) * back;
      this.steerIn = Math.max(-1, Math.min(1, this.wheelA / WHEEL_MAX));
    }
    return {
      steer: this.steerIn,
      throttle: this.gas || i.isDown('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.brk || i.isDown('KeyS', 'ArrowDown', 'Space') ? 1 : 0,
    };
  }

  update(dt) {
    super.update(dt);
    if (this.paused || !this._ensureWorld() || !this.truck) return;
    this._t += dt;
    if (this.wreck) {
      stepWreck(this.wreck, dt, this.road);
      if (!this._shown && this._t - this._overAt >= RESULT_DELAY) this._showOver();
      return;
    }
    const inp = this._input(dt);
    const t = this.truck;
    Object.assign(this.prev, t);
    const over = stepTruck(t, inp, dt, this.road);
    const before = this.myBest;
    this.myBest = Math.max(this.myBest, t.prog);
    if (this.myBest > before) this._reportBest();
    if (over) {
      this._prevBest = this._runBest ?? 0; // この走りの前までのいちばん
      this._runBest = this.myBest;
      this._reportBest(true);
      this.wreck = startWreck(t, this.road);
      this._overAt = this._t;
      this._shown = false;
    }
  }

  /** 落下・横転の結果（2 秒後） */
  _showOver() {
    this._shown = true;
    const t = this.truck;
    const d = t.over.at;
    const rec = Math.floor(d) > Math.floor(this._prevBest || 0) && d >= 1;
    const host = this.isHost;
    const o = this.el.over;
    o.replaceChildren(
      h('div.ct-over-card', null,
        h('div.ct-over-title', null, t.over.kind === 'roll' ? '横転した！' : '落下した！'),
        h('div.ct-over-dist', null, fmt(d)),
        h('div.ct-over-rec', null, rec ? '新記録更新！' : `過去最大：${fmt(this._prevBest || 0)}`),
        h('div.ct-over-btns', null,
          h('button.ct-btn.ct-btn-main', { type: 'button', onclick: () => this._retry() }, 'やり直す'),
          host
            ? h('button.ct-btn.ct-btn-end', { type: 'button', onclick: () => this._finish() }, '終わらせる')
            : h('button.ct-btn.ct-btn-end', { type: 'button', onclick: (e) => this._complain(e.currentTarget) }, 'ホストに「終わらせてくれー！」と文句を言う'))),
    );
    o.hidden = false;
    this._closeMenu();
  }

  draw(dt) {
    if (!this.world) {
      this._ensureWorld();
      if (!this.world) return;
    }
    const w = this.world;
    const t = this.truck;
    if (this.wreck) {
      w.setWreck(this.wreck);
      w.followCamera(this.wreck, dt || 1 / 60);
    } else if (t) {
      w.setTruck(t, this.prev, 1);
      w.chaseCamera(dt || 1 / 60);
      w.updateRoad(t.hints[0]);
    }
    w.render();
    // 距離（上の真ん中）とハンドルの回り具合
    const d = t ? fmt(t.prog) : '';
    if (d !== this._dTxt) {
      this._dTxt = d;
      this.el.dist.textContent = d;
    }
    const wa = Math.round(this.wheelA * 100) / 100;
    if (wa !== this._wa) {
      this._wa = wa;
      this.el.wheel.firstChild.style.transform = `rotate(${wa}rad)`;
    }
  }
}

/** ハンドルの絵（丸と 3 本のスポーク、上に赤い印） */
function wheelSvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.innerHTML =
    '<circle cx="50" cy="50" r="42" fill="none" stroke="#3b3f45" stroke-width="10"/>' +
    '<path d="M8 50h84M50 50v42" stroke="#3b3f45" stroke-width="7" fill="none"/>' +
    '<circle cx="50" cy="50" r="9" fill="#3b3f45"/>' +
    '<rect x="46" y="3" width="8" height="10" rx="2" fill="#e04a3c"/>';
  return svg;
}

/** ペダルのすべり止めの線 */
function pedalLines(n) {
  return Array.from({ length: n }, () => h('i'));
}
