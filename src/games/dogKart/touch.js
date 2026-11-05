// スマホ・タブレット用のタッチ操作（ハンドル・アクセル・ブレーキ・アイテム）
// 複数の指を同時に使えるよう、ボタンごとに Pointer Events で押している間だけ有効にする。

import { h } from '../../core/util.js';
import { IN } from './constants.js';

const AUTO_KEY = 'wanwan.autoAccel';
const WHEEL_KEY = 'wanwan.steerWheel';
const WHEEL_MAX = Math.PI * 0.75; // ハンドルを回せる角度（左右それぞれ 135°）
const WHEEL_FULL = Math.PI / 2; // これだけ回すと、いっぱいに曲がる（90°）

/** ハンドルの絵（SVG） */
const WHEEL_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(40,30,60,.75)" stroke-width="11"/>
  <circle cx="50" cy="50" r="44" fill="none" stroke="#fff" stroke-width="5"/>
  <path d="M8 52 Q50 40 92 52" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
  <path d="M50 52 L50 92" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
  <circle cx="50" cy="52" r="12" fill="#ff8a3d" stroke="#fff" stroke-width="4"/>
  <rect x="45" y="3" width="10" height="9" rx="3" fill="#ff4d5e"/>
</svg>`;

export class TouchControls {
  constructor(root) {
    this.root = root;
    this.left = false;
    this.right = false;
    this.brake = false;
    this.accel = false;
    this.visible = false;
    this.item = false; // 押した瞬間だけ
    try {
      this.auto = localStorage.getItem(AUTO_KEY) !== '0'; // 既定はオートアクセル
    } catch {
      this.auto = true;
    }

    const arrow = (cls, text) => h(`div.touch-key.${cls}`, null, text);
    this.padL = arrow('ts-l', '◀');
    this.padR = arrow('ts-r', '▶');
    this.steer = h('div.touch-steer', { 'data-ctl': '' }, this.padL, this.padR);
    this.brakeBtn = h('div.touch-pedal.tp-brake', { 'data-ctl': '' }, 'ブレーキ');
    this.accelBtn = h('div.touch-pedal.tp-accel', { 'data-ctl': '' }, 'アクセル');
    this.pedals = h('div.touch-pedals', null, this.brakeBtn, this.accelBtn);
    this.autoLabel = h('small', null, 'オート');
    this.autoBtn = h('div.touch-small', { 'data-ctl': '', title: 'オートアクセル' }, '🚗', this.autoLabel);
    // ハンドル（指でぐりぐり回して曲がる）。ボタンとどちらかを選ぶ
    this.wheelImg = h('div.touch-wheel-img', { html: WHEEL_SVG });
    this.wheel = h('div.touch-wheel', { 'data-ctl': '', hidden: true }, this.wheelImg);
    this.wheelAngle = 0; // 今の角度（右回りが +）
    this._wheelHeld = false;
    this._pwm = 0; // 角度を「押している割合」にするための積み立て
    this.wheelLabel = h('small', null, 'ボタン');
    this.wheelBtn = h('div.touch-small', { 'data-ctl': '', title: 'ハンドル操作に切り替え' }, '🎡', this.wheelLabel);
    this.tools = h('div.touch-tools', null, this.autoBtn, this.wheelBtn);
    this.root.append(this.steer, this.wheel, this.pedals, this.tools);

    this._bindSteer();
    this._bindWheel();
    this._tap(this.wheelBtn, () => this.setWheel(!this.useWheel));
    let wheelOn = false;
    try {
      wheelOn = localStorage.getItem(WHEEL_KEY) === '1';
    } catch {
      /* noop */
    }
    this.setWheel(wheelOn, false);
    this._hold(this.brakeBtn, (on) => (this.brake = on));
    this._hold(this.accelBtn, (on) => (this.accel = on));
    this._tap(this.autoBtn, () => this.setAuto(!this.auto));
    this.setAuto(this.auto, false);

    this._release = () => this.clear();
    window.addEventListener('blur', this._release);
    document.addEventListener('visibilitychange', this._release);
  }

  setAuto(on, save = true) {
    this.auto = on;
    this.autoLabel.textContent = on ? 'オートON' : 'オートOFF';
    this.autoBtn.classList.toggle('on', on);
    this.pedals.classList.toggle('auto', on);
    if (save) {
      try {
        localStorage.setItem(AUTO_KEY, on ? '1' : '0');
      } catch {
        /* noop */
      }
    }
  }

  /** 押している間だけ true にするボタン */
  _hold(el, set) {
    const up = (e) => {
      set(false);
      el.classList.remove('down');
      if (e && el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      set(true);
      el.classList.add('down');
    });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', () => up(null));
  }

  _tap(el, fn) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fn();
      el.classList.add('down');
      setTimeout(() => el.classList.remove('down'), 120);
    });
  }

  /** ハンドル操作とボタン操作を切り替える（端末に保存） */
  setWheel(on, save = true) {
    this.useWheel = on;
    this.wheel.hidden = !on;
    this.steer.hidden = on;
    this.wheelLabel.textContent = on ? 'ハンドル' : 'ボタン';
    this.wheelBtn.classList.toggle('on', on);
    this.left = this.right = false;
    this.wheelAngle = 0;
    this._drawWheel();
    if (save) {
      try {
        localStorage.setItem(WHEEL_KEY, on ? '1' : '0');
      } catch {
        /* noop */
      }
    }
  }

  _drawWheel() {
    this.wheelImg.style.transform = `rotate(${this.wheelAngle.toFixed(3)}rad)`;
  }

  /** ハンドル: 指で円を回すように動かすと、その分だけ回る。離すと真ん中に戻る */
  _bindWheel() {
    const el = this.wheel;
    let startFinger = 0;
    let startWheel = 0;
    const fingerAngle = (e) => {
      const r = el.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      this._wheelHeld = true;
      startFinger = fingerAngle(e);
      startWheel = this.wheelAngle;
    });
    el.addEventListener('pointermove', (e) => {
      if (!this._wheelHeld) return;
      let d = fingerAngle(e) - startFinger;
      // 角度の境目（±180°）をまたいでも続けて回せるように
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const a = startWheel + d;
      // 大きく回しすぎたら、そこを新しい基準に（端で止まる）
      this.wheelAngle = Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, a));
      if (a !== this.wheelAngle) {
        startFinger = fingerAngle(e);
        startWheel = this.wheelAngle;
      }
      this._drawWheel();
    });
    const end = (e) => {
      this._wheelHeld = false;
      if (e && el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', () => end(null));
  }

  /** ハンドルの角度から、この tick に左右どちらを押すか（回した角度の割合だけ押す。車のハンドルは滑らかに動くので、細かく曲がり具合を変えられる） */
  _wheelBits() {
    if (!this._wheelHeld && this.wheelAngle !== 0) {
      // 離したら真ん中へ戻る
      this.wheelAngle *= 0.75;
      if (Math.abs(this.wheelAngle) < 0.02) this.wheelAngle = 0;
      this._drawWheel();
    }
    const v = Math.max(-1, Math.min(1, this.wheelAngle / WHEEL_FULL));
    if (Math.abs(v) < 0.06) {
      this._pwm = 0;
      return 0;
    }
    this._pwm += Math.abs(v);
    if (this._pwm < 1) return 0;
    this._pwm -= 1;
    return v > 0 ? IN.RIGHT : IN.LEFT;
  }

  /** 指のある位置で左右を決める（指を滑らせて切り替えられる） */
  _bindSteer() {
    const pad = this.steer;
    const apply = (e) => {
      const r = pad.getBoundingClientRect();
      const left = e.clientX < r.left + r.width / 2;
      this.left = left;
      this.right = !left;
      this.padL.classList.toggle('down', left);
      this.padR.classList.toggle('down', !left);
    };
    const end = (e) => {
      this.left = this.right = false;
      this.padL.classList.remove('down');
      this.padR.classList.remove('down');
      if (e && pad.hasPointerCapture?.(e.pointerId)) pad.releasePointerCapture(e.pointerId);
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pad.setPointerCapture?.(e.pointerId);
      apply(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (pad.hasPointerCapture?.(e.pointerId)) apply(e);
    });
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('lostpointercapture', () => end(null));
  }

  /** アイテムボタン（HUD のスロット）から呼ぶ */
  pressItem() {
    this.item = true;
  }

  /** 今の入力ビット（押している間のもの） */
  bits() {
    if (!this.visible) return 0;
    let b = 0;
    if (this.useWheel) b |= this._wheelBits();
    else {
      if (this.left) b |= IN.LEFT;
      if (this.right) b |= IN.RIGHT;
    }
    if (this.brake) b |= IN.DOWN;
    else if (this.auto || this.accel) b |= IN.UP;
    if (this.item) b |= IN.ITEM;
    this.item = false;
    return b;
  }

  setVisible(on) {
    this.visible = on;
    if (!on) this.clear();
    this.root.classList.toggle('is-touch', on);
  }

  clear() {
    this.left = this.right = this.brake = this.accel = false;
    this._wheelHeld = false;
    for (const el of [this.padL, this.padR, this.brakeBtn, this.accelBtn]) el.classList.remove('down');
  }

  destroy() {
    window.removeEventListener('blur', this._release);
    document.removeEventListener('visibilitychange', this._release);
  }
}
