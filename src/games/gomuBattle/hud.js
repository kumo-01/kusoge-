// 画面の表示（照準・体力・残りの輪ゴム・アイテム・時間・点数・お知らせ）と、タッチ操作（左のスティック・右でなぞって視点・ボタン）
import { iconSvg, iconText } from '../../core/icons.js';
import { h } from '../../core/util.js';
import { ITEM_INFO, GUN, PLAYER, ROUND } from './constants.js';

export class GomuHud {
  constructor(root, { touch }) {
    this.root = h('div.gomu-hud');
    root.append(this.root);
    this.cross = h('div.gm-cross', null, h('i'), h('i'), h('i'), h('i'));
    this.round = h('div.gm-round');
    this.timer = h('div.gm-timer');
    this.board = h('div.gm-board');
    this.feed = h('div.gm-feed');
    this.hearts = h('div.gm-hearts');
    this.ammo = h('div.gm-ammo');
    this.reloadBar = h('div.gm-reload', null, h('i'));
    this.special = h('div.gm-special');
    this.itemIcon = h('div.gm-item-ic');
    this.itemName = h('div.gm-item-name');
    this.itemBox = h('div.gm-item', { 'data-ctl': '' }, this.itemIcon, this.itemName, h('div.gm-key', null, touch ? 'タップ' : 'E'));
    this.center = h('div.gm-center');
    this.status = h('div.gm-status');
    this.vignette = h('div.gm-vignette');
    this.smoke = h('div.gm-smoke');
    this.names = h('div.gm-names');
    this.hint = h('div.gm-hint');
    this.table = h('div.gm-table');
    this.root.append(this.smoke, this.vignette, this.names, this.cross, h('div.gm-top', null, this.round, this.timer), this.board, this.feed, h('div.gm-bl', null, this.hearts, this.status), h('div.gm-br', null, this.special, this.ammo, this.reloadBar), this.itemBox, this.center, this.table, this.hint);
    this.touch = touch ? new GomuTouch(this.root) : null;
    this.root.classList.toggle('is-touch', !!touch);
    this._nameEls = [];
    this._feedItems = [];
    this._key = {};
  }

  /** 中身を HTML で（key が変わったときだけ作り直す） */
  _setHtml(el, key, k, make) {
    if (this._key[key] === k) return;
    this._key[key] = k;
    el.innerHTML = make();
  }

  _set(el, key, text) {
    if (this._key[key] === text) return;
    this._key[key] = text;
    el.textContent = text;
  }

  /** 毎フレーム: me = 自分の状態、s = 試合の状態の要約 */
  update(v) {
    // ラウンドと時間
    this._set(this.round, 'round', `ROUND ${v.round + 1}/${ROUND.COUNT}　${v.arenaName}`);
    const left = Math.max(0, Math.ceil(ROUND.TIME - Math.max(0, v.t)));
    this._set(this.timer, 'timer', v.phase === 'play' ? `${left}` : '');
    this.timer.classList.toggle('is-low', v.phase === 'play' && left <= 10);
    // 体力
    const hpN = Math.max(0, v.me.hp);
    this._setHtml(this.hearts, 'hp', `${hpN}`, () => Array.from({ length: PLAYER.HP }, (_, k) => `<span class="gm-heart${k < hpN ? ' on' : ''}">${iconSvg('heart', 26)}</span>`).join(''));
    // 輪ゴム
    const ammoN = v.me.reload > 0 ? -1 : Math.max(0, v.me.ammo);
    this._setHtml(this.ammo, 'ammo', `${ammoN}`, () => (ammoN < 0 ? '' : Array.from({ length: GUN.AMMO }, (_, k) => `<span class="gm-band${k < ammoN ? ' on' : ''}">${iconSvg('ring', 24)}</span>`).join('')));
    this.reloadBar.hidden = !(v.me.reload > 0);
    if (v.me.reload > 0) this.reloadBar.firstChild.style.width = `${(1 - v.me.reload / GUN.RELOAD) * 100}%`;
    this._setHtml(this.special, 'sp', v.me.sp ? `${v.me.sp}:${v.me.spN}` : '', () => (v.me.sp ? `${iconSvg(ITEM_INFO[v.me.sp].icon, 18)} ${ITEM_INFO[v.me.sp].name} ×${v.me.spN}` : ''));
    // アイテム
    const it = v.me.item ? ITEM_INFO[v.me.item] : null;
    this._setHtml(this.itemIcon, 'itic', it ? it.icon : '', () => (it ? iconSvg(it.icon, 34) : ''));
    this._set(this.itemName, 'itn', it ? it.name : 'アイテムなし');
    this.itemBox.classList.toggle('has', !!it);
    // 状態（照準ぶれ・ゴム切れ・ネバネバ）
    const st = [v.me.shake > 0 ? 'spiral:照準ぶれ' : '', v.me.noAmmo > 0 ? 'scissors:ゴム切れ' : '', v.me.stuck > 0 ? 'candy:ネバネバ' : '', v.me.star > 0 ? `star:無敵 ${Math.ceil(v.me.star)}` : v.me.inv > 0 ? 'star:無敵' : ''].filter(Boolean);
    this._setHtml(this.status, 'st', st.join('|'), () => st.map((x) => { const [ic, t] = x.split(':'); return `<span class="gm-st">${iconSvg(ic, 18)}${t}</span>`; }).join(''));
    // 点数表（点の順）
    const rows = [...v.players].sort((a, b) => b.score - a.score || a.i - b.i);
    const bk = rows.map((p) => `${p.i}:${p.score}:${p.dead ? 1 : 0}`).join(',');
    if (this._key.board !== bk) {
      this._key.board = bk;
      this.board.replaceChildren(...rows.map((p) => h(`div.gm-row${p.i === v.meIndex ? '.me' : ''}${p.dead ? '.dead' : ''}`, { style: { '--c': p.css } }, h('b'), h('span', null, p.name), h('em', null, String(p.score)))));
    }
    // 真ん中の大きな文字
    let center = '';
    if (v.phase === 'intro') center = v.t < -0.05 ? String(Math.ceil(-v.t)) : '';
    else if (v.phase === 'play' && v.t < 0.8) center = 'GO!';
    else if (v.me.dead > 0) center = `やられた！ ${Math.ceil(v.me.dead)}`;
    this._set(this.center, 'center', center);
    this.center.classList.toggle('is-go', center === 'GO!');
    // ラウンドの終わり: そのラウンドの点の表
    const showTable = v.phase === 'end' || v.phase === 'done';
    this.table.hidden = !showTable;
    if (showTable) {
      const tk = `${v.round}:${rows.map((p) => `${p.i}:${p.rs.join('/')}`).join(',')}`;
      if (this._key.table !== tk) {
        this._key.table = tk;
        this.table.replaceChildren(
          h('h3', null, `ROUND ${v.round + 1} おわり！`),
          h('table', null,
            h('tr', null, h('th', null, ''), ...Array.from({ length: ROUND.COUNT }, (_, r) => h('th', null, `R${r + 1}`)), h('th', null, '合計')),
            ...rows.map((p) => h(`tr${p.i === v.meIndex ? '.me' : ''}`, null, h('td', { style: { color: p.css } }, p.name), ...p.rs.map((x, r) => h('td', null, r <= v.round ? String(x) : '-')), h('td', null, h('b', null, String(p.score)))))),
          h('p', null, v.round + 1 < ROUND.COUNT ? `次は ${v.nextArena}` : '結果発表！'));
      }
    }
    this.cross.classList.toggle('is-shake', v.me.shake > 0);
    this.cross.classList.toggle('is-off', v.me.noAmmo > 0 || v.me.reload > 0);
    this.smoke.classList.toggle('on', !!v.inSmoke);
    // フィードの期限切れ
    const now = performance.now();
    if (this._feedItems.length && this._feedItems[0].until < now) {
      this._feedItems = this._feedItems.filter((x) => x.until >= now);
      this.feed.replaceChildren(...this._feedItems.map((x) => x.el));
    }
  }

  /** 倒した・アイテムを使った などのお知らせ（右上に数秒） */
  pushFeed(text, cls = '') {
    const el = h(`div.gm-feed-item${cls ? `.${cls}` : ''}`, null, iconText(text, 18));
    this._feedItems.push({ el, until: performance.now() + 4000 });
    if (this._feedItems.length > 5) this._feedItems.shift();
    this.feed.replaceChildren(...this._feedItems.map((x) => x.el));
  }

  /** 当てた（照準に印） */
  hitMarker(kill = false) {
    this.cross.classList.remove('is-hit', 'is-kill');
    void this.cross.offsetWidth;
    this.cross.classList.add(kill ? 'is-kill' : 'is-hit');
  }

  /** 当てられた（画面のふちが赤く） */
  hurt() {
    this.vignette.classList.remove('on');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('on');
  }

  /** 照準が相手に重なっている（赤く） */
  setTarget(on) {
    if (this._key.tgt === on) return;
    this._key.tgt = on;
    this.cross.classList.toggle('is-on', on);
  }

  setHint(text) {
    this._set(this.hint, 'hint', text || '');
    this.hint.hidden = !text;
  }

  /** ほかの犬の名前（画面の座標。null なら隠す） */
  setNames(list) {
    while (this._nameEls.length < list.length) {
      const el = h('div.gm-name');
      this.names.append(el);
      this._nameEls.push(el);
    }
    this._nameEls.forEach((el, i) => {
      const n = list[i];
      if (!n) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      const k = `${n.text}|${n.hp ?? ''}`;
      if (el.dataset.k !== k) {
        el.dataset.k = k;
        // 名前と、体力の数だけ小さなハート
        el.innerHTML = '';
        el.append(n.text);
        if (n.hp != null) el.insertAdjacentHTML('beforeend', `<span class="gm-name-hp">${Array.from({ length: Math.max(0, n.hp) }, () => iconSvg('heart', 11)).join('')}</span>`);
      }
      el.style.transform = `translate(${n.x.toFixed(0)}px, ${n.y.toFixed(0)}px) translate(-50%, -100%)`;
      el.style.setProperty('--c', n.css);
    });
  }

  dispose() {
    this.touch?.dispose();
    this.root.remove();
  }
}

/**
 * タッチ操作: 左下のスティックで移動、右側をなぞって視点、ボタン（発射・ジャンプ・ダッシュ・伏せ・アイテム）
 * 複数の指を同時に使える（指ごとに Pointer Events で追う）
 */
/** 指を捕まえる（指がもう離れているなどで失敗しても、操作は続ける） */
function capture(el, id) {
  try {
    el.setPointerCapture?.(id);
  } catch {
    // 捕まえられなくても、その要素の上での操作は届く
  }
}

export class GomuTouch {
  constructor(root) {
    this.mx = 0; // 右へ -1..1
    this.mz = 0; // 前へ -1..1
    this.lookDX = 0; // たまった視点の動き（ピクセル）
    this.lookDY = 0;
    this.fire = false;
    this.jump = false;
    this.dash = false;
    this.crouch = false;
    this.item = false;
    this.knob = h('div.gt-knob');
    this.stick = h('div.gt-stick', null, this.knob);
    // 左下の広い範囲のどこを触っても、スティックを動かせる（丸は左下に止まったまま）
    this.zone = h('div.gt-zone', { 'data-ctl': '' }, this.stick);
    this.look = h('div.gt-look', { 'data-ctl': '' });
    const btn = (cls, text) => h(`div.gt-btn.${cls}`, { 'data-ctl': '' }, text);
    this.fireBtn = btn('gt-fire', '発射');
    this.jumpBtn = btn('gt-jump', 'ジャンプ');
    this.dashBtn = btn('gt-dash', 'ダッシュ');
    this.crouchBtn = btn('gt-crouch', '伏せ');
    this.el = h('div.gomu-touch', null, this.look, this.zone, this.fireBtn, this.jumpBtn, this.dashBtn, this.crouchBtn);
    root.append(this.el);
    this._bindStick();
    this._bindLook(this.look);
    // 発射ボタンは押している間ずっと撃つ。押したまま指を動かすと視点も動く
    this._hold(this.fireBtn, (on) => (this.fire = on), true);
    this._press(this.jumpBtn, () => (this.jump = true));
    this._press(this.dashBtn, () => (this.dash = true));
    this._press(this.crouchBtn, () => {
      this.crouch = !this.crouch;
      this.crouchBtn.classList.toggle('on', this.crouch);
    });
  }

  _bindStick() {
    const el = this.zone;
    const st = this.stick;
    let id = null;
    let cx = 0;
    let cy = 0;
    const R = 50;
    const DEAD = 0.12; // 真ん中の少しの揺れは止まっている扱い
    // スティックの丸は動かさない（左下の決まった場所）。左下の範囲のどこを触っても、丸の真ん中からの向きで進む
    const move = (e) => {
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) {
        dx = (dx / l) * R;
        dy = (dy / l) * R;
      }
      const m = Math.hypot(dx, dy) / R;
      const k = m < DEAD ? 0 : (m - DEAD) / (1 - DEAD) / (m || 1);
      this.mx = (dx / R) * k;
      this.mz = (-dy / R) * k;
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (id != null) return;
      id = e.pointerId;
      try {
        el.setPointerCapture?.(id);
      } catch {
        // 指を捕まえられなくても動かせる
      }
      const r = st.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      st.classList.add('on');
      move(e);
    });
    el.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    const end = (e) => {
      if (e && e.pointerId !== id) return;
      id = null;
      this.mx = this.mz = 0;
      this.knob.style.transform = '';
      st.classList.remove('on');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  /** なぞった分だけ視点を動かす（指ごとに、前の位置との差）。ほとんど動かさずに短く触れたら「タップ」= 1 発撃つ */
  _bindLook(el) {
    const last = new Map();
    const start = new Map();
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(el, e.pointerId);
      last.set(e.pointerId, [e.clientX, e.clientY]);
      start.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
    });
    el.addEventListener('pointermove', (e) => {
      const p = last.get(e.pointerId);
      if (!p) return;
      this.lookDX += e.clientX - p[0];
      this.lookDY += e.clientY - p[1];
      last.set(e.pointerId, [e.clientX, e.clientY]);
      const s = start.get(e.pointerId);
      if (s) s.moved = Math.max(s.moved, Math.hypot(e.clientX - s.x, e.clientY - s.y));
    });
    const end = (e) => {
      last.delete(e.pointerId);
      const s = start.get(e.pointerId);
      start.delete(e.pointerId);
      if (e.type === 'pointerup' && s && s.moved < 14 && performance.now() - s.t < 350) this.tap = true;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  _hold(el, set, look = false) {
    const last = new Map();
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(el, e.pointerId);
      set(true);
      el.classList.add('down');
      last.set(e.pointerId, [e.clientX, e.clientY]);
    });
    el.addEventListener('pointermove', (e) => {
      const p = last.get(e.pointerId);
      if (!p || !look) return;
      this.lookDX += e.clientX - p[0];
      this.lookDY += e.clientY - p[1];
      last.set(e.pointerId, [e.clientX, e.clientY]);
    });
    const up = (e) => {
      last.delete(e.pointerId);
      if (last.size) return;
      set(false);
      el.classList.remove('down');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  _press(el, fn) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fn();
      el.classList.add('down');
      setTimeout(() => el.classList.remove('down'), 120);
    });
  }

  /** 押した瞬間のもの（ジャンプ・ダッシュ・アイテム）を 1 回だけ取り出す */
  take() {
    const r = { jump: this.jump, dash: this.dash, item: this.item };
    this.jump = this.dash = this.item = false;
    return r;
  }

  /** 画面をタップした（1 回だけ取り出す） */
  takeTap() {
    const r = this.tap;
    this.tap = false;
    return !!r;
  }

  takeLook() {
    const r = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return r;
  }

  dispose() {
    this.el.remove();
  }
}
