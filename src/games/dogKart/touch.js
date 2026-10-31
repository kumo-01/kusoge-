// スマホ・タブレット用のタッチ操作（ハンドル・アクセル・ブレーキ・アイテム）
// 複数の指を同時に使えるよう、ボタンごとに Pointer Events で押している間だけ有効にする。

import { h } from '../../core/util.js';
import { IN } from './constants.js';

const AUTO_KEY = 'wanwan.autoAccel';

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
    this.tools = h('div.touch-tools', null, this.autoBtn);
    this.root.append(this.steer, this.pedals, this.tools);

    this._bindSteer();
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
    if (this.left) b |= IN.LEFT;
    if (this.right) b |= IN.RIGHT;
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
    for (const el of [this.padL, this.padR, this.brakeBtn, this.accelBtn]) el.classList.remove('down');
  }

  destroy() {
    window.removeEventListener('blur', this._release);
    document.removeEventListener('visibilitychange', this._release);
  }
}
