// 管理パネル（ホストだけ・管理モードのときだけ）。画面の上を指やマウスで動かせる。
// 車を選んで、好きなアイテムを渡す・2 つ目の枠に入れる・今すぐ使わせる・消す、ができる。
import { h } from '../../core/util.js';
import { ITEM_INFO } from './items.js';
import { ITEMS } from './constants.js';

const POS_KEY = 'wanwan.adminPos';

export class AdminPanel {
  /**
   * @param {HTMLElement} root 置く場所
   * @param {(op: string, args: object) => void} send 操作を送る（ホストの計算 or サーバーへ）
   */
  constructor(root, send) {
    this.send = send;
    this.sel = 0; // 選んでいる車
    this.mode = 'give'; // 'give' = 渡してすぐ使う / 'set1' = 1 つ目に入れる / 'set2' = 2 つ目に入れる
    this.rows = [];
    this.list = h('div.adm-list');
    const modeBtn = (m, label) => h(`button.adm-mode${m === this.mode ? '.on' : ''}`, { type: 'button', 'data-m': m, onclick: () => this._setMode(m) }, label);
    this.modes = h('div.adm-modes', null, modeBtn('give', '渡してすぐ使う'), modeBtn('set1', '1つ目に入れる'), modeBtn('set2', '2つ目に入れる'));
    this.items = h('div.adm-items',
      null,
      Object.keys(ITEM_INFO)
        .map(Number)
        .filter((i) => i > 0 && i < ITEMS.COUNT)
        .map((i) => h('button.adm-item', { type: 'button', title: ITEM_INFO[i].name, onclick: () => this._pick(i) }, h('span.ic', null, ITEM_INFO[i].icon), h('small', null, ITEM_INFO[i].name))));
    this.actions = h('div.adm-actions', null,
      h('button.adm-act', { type: 'button', onclick: () => this.send('use', { kart: this.sel }) }, '▶ 今持っているのを使わせる'),
      h('button.adm-act.danger', { type: 'button', onclick: () => this.send('clear', { kart: this.sel }) }, '✖ アイテムを消す'));
    this.head = h('div.adm-head', null, h('span', null, '🔧 管理モード'), (this.minBtn = h('button.adm-min', { type: 'button', title: 'たたむ', onclick: () => this._toggleMin() }, '－')));
    this.body = h('div.adm-body', null, this.list, this.modes, this.items, this.actions);
    this.el = h('div.adm-panel', { 'data-ctl': '' }, this.head, this.body);
    root.append(this.el);
    this._bindDrag();
    this._restorePos();
    this._t = 0;
  }

  _setMode(m) {
    this.mode = m;
    for (const b of this.modes.children) b.classList.toggle('on', b.dataset.m === m);
  }

  _pick(item) {
    if (this.mode === 'give') this.send('give', { kart: this.sel, item });
    else this.send('item', { kart: this.sel, slot: this.mode === 'set2' ? 2 : 1, item });
  }

  _toggleMin() {
    this.body.hidden = !this.body.hidden;
    this.minBtn.textContent = this.body.hidden ? '＋' : '－';
  }

  /** 車の一覧を今の状態に合わせる（数回に 1 回で十分） */
  update(karts, names, dt) {
    this._t += dt;
    if (this._t < 0.2 && this.rows.length === karts.length) return;
    this._t = 0;
    if (this.rows.length !== karts.length) {
      this.rows = karts.map((_, i) => {
        const name = h('span.adm-name');
        const it = h('span.adm-its');
        const row = h('button.adm-row', { type: 'button', onclick: () => this._select(i) }, name, it);
        return { row, name, it, key: '' };
      });
      this.list.replaceChildren(...this.rows.map((r) => r.row));
      this._select(Math.min(this.sel, karts.length - 1));
    }
    karts.forEach((k, i) => {
      const r = this.rows[i];
      const icon = (v) => (v ? ITEM_INFO[v]?.icon || '?' : '・');
      const key = `${names[i]}|${k.item}|${k.item2}|${k.roll > 0 || k.roll2 > 0 ? 1 : 0}`;
      if (key === r.key) return;
      r.key = key;
      r.name.textContent = names[i];
      r.it.textContent = `${icon(k.item)} ${icon(k.item2)}${k.roll > 0 || k.roll2 > 0 ? ' 🎰' : ''}`;
    });
  }

  _select(i) {
    this.sel = i;
    this.rows.forEach((r, j) => r.row.classList.toggle('on', j === i));
  }

  _bindDrag() {
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    let drag = false;
    this.head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      drag = true;
      this.head.setPointerCapture?.(e.pointerId);
      const r = this.el.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      ox = r.left;
      oy = r.top;
    });
    this.head.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this._place(ox + e.clientX - sx, oy + e.clientY - sy);
    });
    const end = () => {
      if (!drag) return;
      drag = false;
      try {
        localStorage.setItem(POS_KEY, JSON.stringify([parseFloat(this.el.style.left), parseFloat(this.el.style.top)]));
      } catch {
        /* noop */
      }
    };
    this.head.addEventListener('pointerup', end);
    this.head.addEventListener('pointercancel', end);
  }

  /** 画面の外へ出ないように置く */
  _place(x, y) {
    const w = this.el.offsetWidth || 260;
    const hh = this.head.offsetHeight || 32;
    x = Math.max(0, Math.min(window.innerWidth - w, x));
    y = Math.max(0, Math.min(window.innerHeight - hh, y));
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  _restorePos() {
    let p = null;
    try {
      p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    } catch {
      p = null;
    }
    requestAnimationFrame(() => (Array.isArray(p) ? this._place(p[0], p[1]) : this._place(12, Math.round(window.innerHeight * 0.18))));
  }

  dispose() {
    this.el.remove();
  }
}
