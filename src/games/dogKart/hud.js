// ゲーム中の HUD（DOM）。周回・順位・速度・アイテム・時間・接続状態・ミニマップ
import { h, formatTime } from '../../core/util.js';
import { ITEM_INFO } from './items.js';
import { RACE, TIMING, FOOD } from './constants.js';
import { TouchControls } from './touch.js';
import { device } from '../../core/device.js';

export const KART_COLORS = ['#ff4d5e', '#3d8bff', '#ff8fd0', '#ffc93c', '#22b573', '#8a63ff'];
const BOSS_COLOR = '#2b2b3a';

export class Hud {
  /** @param {{ round?: number, races?: number }} series 連戦のとき、何戦目か */
  constructor(container, track, me, series = {}) {
    this.track = track;
    this.me = me;
    this._last = {};
    this.root = h('div.kart-hud');
    this.rank = h('div.hud-rank', null, '1', h('small', null, '位'));
    this.lap = h('div.hud-lap', null, 'LAP 1/3');
    this.time = h('div.hud-time', null, '0:00.00');
    this.speed = h('div.hud-speed-num', null, '0');
    this.speedBar = h('div.hud-speed-bar-fill');
    this.itemIcon = h('div.hud-item-icon', null, '');
    this.itemName = h('div.hud-item-name', null, 'アイテムなし');
    this.itemSlot = h('div.hud-item', { 'data-ctl': '', onpointerdown: (e) => { e.preventDefault(); this.touch?.pressItem(); } }, this.itemIcon, this.itemName, h('div.hud-item-key', null, 'Space'), h('div.hud-item-tap', null, 'タップ'));
    this.net = h('div.hud-net', null, '');
    this.center = h('div.hud-center');
    this.cdBox = h('div.hud-cd');
    this.warn = h('div.hud-warn', { hidden: true }, '⚠ 逆走してるワン！');
    this.boostEdge = h('div.hud-boost-edge');
    this.speedLines = h('div.hud-speedlines');
    this.camBtn = h('button.hud-cam-btn', { onclick: () => this.onCameraToggle?.(), title: 'カメラ切り替え（C）' }, '');
    this.camBtn.append(h('span.ic', null, '🎥'), (this.camLabel = h('span.lb', null, '三人称')));
    this.rankTotal = h('div.hud-rank-total', null, '/2');
    this.round = series.races > 1 ? h('div.hud-round', null, `第${series.round || 1}戦 / 全${series.races}戦`) : null;
    this.foodNum = h('b', null, '0');
    this.food = h('div.hud-food', { title: 'ドッグフード（多いほど少し速い）' }, h('span.hud-food-ic', null, '🍖'), this.foodNum, h('small', null, `/${FOOD.MAX}`));
    this.qualityBtn = h('button.hud-cam-btn.hud-quality-btn', { onclick: () => this.onQuality?.(), title: '画質の切り替え' }, '');
    this.qualityBtn.append(h('span.ic', null, '⚙'), (this.qualityLabel = h('span.lb', null, '画質: 自動')));
    this.fsBtn = document.fullscreenEnabled || document.webkitFullscreenEnabled
      ? h('button.hud-cam-btn.hud-fs-btn', { onclick: () => this._toggleFullscreen(), title: '全画面' }, h('span.ic', null, '⛶'), h('span.lb', null, '全画面'))
      : null;
    this.rotateHint = h('div.hud-rotate', { 'data-ctl': '', onpointerdown: (e) => { e.preventDefault(); this.rotateHint.hidden = true; } }, '📱 横向きにすると遊びやすいワン！（タップで閉じる）');
    this.mapCanvas = h('canvas.hud-map', { width: 180, height: 180 });
    // タイミングブースト: 外側のリングが縮んで的に重なったら押す
    this.timingRing = h('div.hud-timing-ring');
    this.timing = h(
      'div.hud-timing',
      { hidden: true },
      h('div.hud-timing-target'),
      this.timingRing,
      h('div.hud-timing-label', null, 'ここだ！で画面をタップ', h('small', null, 'クリック / タップ / Enter')),
    );
    this.rainBtn = h('button.hud-rain-btn', { hidden: true, onclick: () => this.onRain?.(), title: '豪雨をよぶ（Q）' }, '☔ 豪雨をよぶ', h('small', null, 'Q'));
    this.wetBadge = h('div.hud-wet', { hidden: true }, '☔ ずぶぬれ… スピードダウン');
    this.thunderEl = h('div.hud-thunder');
    this.fallback = h('div.hud-fallback', { hidden: true }, '3D表示を開始できなかったため、簡易表示で遊んでいます');

    this.trBox = h('div.hud-tr', null, this.net, this.mapCanvas, this.camBtn, this.qualityBtn, this.fsBtn);
    this.root.append(
      this.speedLines,
      this.boostEdge,
      h('div.hud-tl', null, h('div.hud-rank-wrap', null, this.rank, this.rankTotal), h('div.hud-lt', null, this.round, this.lap, this.time)),
      this.trBox,
      h('div.hud-bl', null, h('div.hud-speed', null, this.speed, h('span', null, 'わんkm/h')), h('div.hud-speed-bar', null, this.speedBar), this.food),
      h('div.hud-br', null, this.rainBtn, this.itemSlot),
      h('div.hud-bc', null, 'W/↑ アクセル　S/↓ ブレーキ　A D/← → ハンドル　Space アイテム　R 復帰　C カメラ　Enter/タップ タイミング　Q 豪雨'),
      this.rotateHint,
      this.thunderEl,
      this.wetBadge,
      this.timing,
      this.cdBox,
      this.center,
      this.warn,
      this.fallback,
    );
    // タッチ操作（スマホ・タブレット。PC でも画面を触ったら出す）
    this.touch = new TouchControls(this.root);
    this.setTouch(device.coarse);
    this._onTouchPointer = (e) => {
      if (e.pointerType === 'touch' && !this.touch.visible) this.setTouch(true);
    };
    window.addEventListener('pointerdown', this._onTouchPointer, { capture: true });
    container.append(this.root);
    this._buildMapBase();
    this._mapTimer = 0;
  }

  setTouch(on) {
    this.touch.setVisible(on);
    this.root.classList.toggle('is-touch', on);
    // タッチ操作のときはカメラ・画質・全画面のボタンを左上の道具列へ（右側は地図とアイテムで埋まるため）
    const host = on ? this.touch.tools : this.trBox;
    for (const b of [this.camBtn, this.qualityBtn, this.fsBtn]) if (b) host.append(b);
    this.root.classList.toggle('is-phone', on && device.phone);
  }

  _toggleFullscreen() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else {
        const el = document.documentElement;
        Promise.resolve((el.requestFullscreen || el.webkitRequestFullscreen).call(el))
          .then(() => screen.orientation?.lock?.('landscape')) // 対応端末では横向きに固定
          .catch(() => {});
      }
    } catch {
      /* 全画面にできなくても遊べる */
    }
  }

  setQualityLabel(pref) {
    this.qualityLabel.textContent = `画質:${pref === 'high' ? '高' : pref === 'light' ? 'かるい' : '自動'}`;
  }

  _buildMapBase() {
    const t = this.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.n; i++) {
      minX = Math.min(minX, t.x[i]);
      maxX = Math.max(maxX, t.x[i]);
      minZ = Math.min(minZ, t.z[i]);
      maxZ = Math.max(maxZ, t.z[i]);
    }
    const size = 180;
    const pad = 14;
    const scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    // 3D のカメラと同じ向きに見えるよう x を反転（上から見下ろしたとき +x が左）
    this._map = (x, z) => [size - pad - (x - minX) * scale - ((size - pad * 2) - (maxX - minX) * scale) / 2, size - pad - (z - minZ) * scale - ((size - pad * 2) - (maxZ - minZ) * scale) / 2];
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    x.lineJoin = 'round';
    x.beginPath();
    for (let i = 0; i <= t.n; i++) {
      const [px, py] = this._map(t.x[i % t.n], t.z[i % t.n]);
      if (i === 0) x.moveTo(px, py);
      else x.lineTo(px, py);
    }
    x.strokeStyle = 'rgba(255,255,255,0.95)';
    x.lineWidth = 10;
    x.stroke();
    x.strokeStyle = '#8a86a3';
    x.lineWidth = 6;
    x.stroke();
    // トンネルの区間は暗く描く
    x.strokeStyle = '#3b3560';
    for (const tn of t.tunnels) {
      x.beginPath();
      let first = true;
      for (let i = 0; i < t.n; i++) {
        if (t.cum[i] < tn.a || t.cum[i] > tn.b) continue;
        const [px, py] = this._map(t.x[i], t.z[i]);
        if (first) x.moveTo(px, py);
        else x.lineTo(px, py);
        first = false;
      }
      x.stroke();
    }
    const [sx, sy] = this._map(t.x[0], t.z[0]);
    x.fillStyle = '#222';
    x.fillRect(sx - 4, sy - 4, 8, 8);
    this._mapBase = c;
  }

  _set(key, el, value, prop = 'textContent') {
    if (this._last[key] === value) return;
    this._last[key] = value;
    el[prop] = value;
  }

  setFallback(on) {
    this.fallback.hidden = !on;
    this.root.classList.toggle('is-fallback', on);
  }

  /** @param {object} d 表示データ */
  update(d, dt) {
    this._set('rank', this.rank.firstChild, String(d.rank), 'nodeValue');
    this.rank.classList.toggle('is-first', d.rank === 1);
    this._set('total', this.rankTotal, `/${d.total || 2}`);
    // 速いときは集中線
    const fast = Math.abs(d.speed) > 30 || d.boost > 0;
    this.speedLines.classList.toggle('on', fast);
    this.speedLines.classList.toggle('boost', d.boost > 0);
    this._set('lap', this.lap, `LAP ${Math.min(RACE.LAPS, d.lap + 1)}/${RACE.LAPS}`);
    this._set('time', this.time, formatTime(Math.max(0, d.time)));
    const kmh = Math.round(Math.abs(d.speed) * 3.6);
    this._set('speed', this.speed, String(kmh));
    this._set('food', this.foodNum, String(d.food || 0));
    this.food.classList.toggle('is-max', (d.food || 0) >= FOOD.MAX);
    const bar = Math.round(Math.min(100, (Math.abs(d.speed) / 40) * 100));
    if (bar !== this._last.bar) {
      this._last.bar = bar;
      this.speedBar.style.width = `${bar}%`;
    }
    this.speedBar.classList.toggle('boost', d.boost > 0);
    this.boostEdge.classList.toggle('on', d.boost > 0);

    let icon = '';
    let name = 'アイテムなし';
    if (d.roll > 0) {
      const icons = ['🦴', '🍌', '⚡', '🛡️', '🥏'];
      icon = icons[Math.floor(performance.now() / 90) % icons.length];
      name = 'ルーレット中…';
    } else if (d.item && ITEM_INFO[d.item]) {
      icon = ITEM_INFO[d.item].icon;
      name = ITEM_INFO[d.item].name;
    }
    this._set('icon', this.itemIcon, icon);
    this._set('iname', this.itemName, name);
    this.itemSlot.classList.toggle('has-item', !!d.item && d.roll <= 0);
    this.itemSlot.classList.toggle('rolling', d.roll > 0);

    this._set('net', this.net, d.netText);
    if (d.netTone !== this._last.tone) {
      this._last.tone = d.netTone;
      this.net.className = `hud-net tone-${d.netTone}`;
    }
    this.warn.hidden = !(d.wrong > 1);
    this.wetBadge.hidden = !(d.wet > 0);
    this.rainBtn.hidden = !d.rainReady;

    // タイミングブーストのリング: 残り WINDOW → SWEET で大きさ 2.6 → 1（的と同じ）、その後さらに縮む
    const tw = d.tw || 0;
    this.timing.hidden = !(tw > 0);
    if (tw > 0) {
      const scale = 1 + ((tw - TIMING.SWEET) / (TIMING.WINDOW - TIMING.SWEET)) * 1.6;
      this.timingRing.style.transform = `scale(${Math.max(0.15, scale).toFixed(2)})`;
      this.timing.classList.toggle('near', Math.abs(tw - TIMING.SWEET) <= TIMING.GOOD);
      this.timing.classList.toggle('just', Math.abs(tw - TIMING.SWEET) <= TIMING.PERFECT);
    }

    // カウントダウン
    let cd = '';
    if (d.phase === 'countdown') {
      const n = Math.ceil(-d.time);
      cd = n > 3 ? 'よーい…' : String(n);
    }
    if (cd !== this._last.cd) {
      this._last.cd = cd;
      this.cdBox.replaceChildren();
      if (cd) this.cdBox.append(h('div.hud-countdown.pop', null, cd));
    }

    this._mapTimer -= dt;
    if (this._mapTimer <= 0) {
      this._mapTimer = device.low ? 1 / 8 : 1 / 15;
      this._drawMap(d.karts);
    }
  }

  _drawMap(karts) {
    const c = this.mapCanvas;
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(this._mapBase, 0, 0);
    karts.forEach((k, i) => {
      const [px, py] = this._map(k.x, k.z);
      x.beginPath();
      x.arc(px, py, i === this.me ? 7 : 6, 0, Math.PI * 2);
      x.fillStyle = k.boss ? BOSS_COLOR : KART_COLORS[i] || '#999';
      x.fill();
      x.lineWidth = 2.5;
      x.strokeStyle = '#fff';
      x.stroke();
    });
  }

  setCameraMode(mode) {
    this.camLabel.textContent = mode === 'first' ? '一人称' : '三人称';
  }

  /** タイミングブーストの結果。q: 2 ジャスト / 1 ナイス / 0 ずれた / -1 押さなかった */
  timingResult(q) {
    this.timing.hidden = true;
    if (q === 2) this.flash('⚡ ジャスト！ブースト！', 'goal', 1300);
    else if (q === 1) this.flash('ナイス！ブースト', 'good', 1100);
    else if (q === 0) this.flash('タイミングがずれた…', 'bad', 1000);
    else this.flash('チャンスをのがした…', 'plain', 1000);
  }

  /** 雷の光 */
  thunder() {
    this.thunderEl.classList.remove('on');
    void this.thunderEl.offsetWidth; // アニメーションを最初から
    this.thunderEl.classList.add('on');
  }

  /** 中央に大きなメッセージ */
  flash(text, cls = '', ms = 1300) {
    const el = h(`div.hud-flash.${cls || 'plain'}`, { style: { '--ms': `${ms / 1000}s` } }, text);
    this.center.append(el);
    setTimeout(() => el.remove(), ms);
  }

  dispose() {
    window.removeEventListener('pointerdown', this._onTouchPointer, { capture: true });
    this.touch.destroy();
    this.root.remove();
  }
}
