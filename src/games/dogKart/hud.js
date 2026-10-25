// ゲーム中の HUD（DOM）。周回・順位・速度・アイテム・時間・接続状態・ミニマップ
import { h, formatTime } from '../../core/util.js';
import { ITEM_INFO } from './items.js';
import { RACE } from './constants.js';

export class Hud {
  constructor(container, track, me) {
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
    this.itemSlot = h('div.hud-item', null, this.itemIcon, this.itemName, h('div.hud-item-key', null, 'Space'));
    this.net = h('div.hud-net', null, '');
    this.center = h('div.hud-center');
    this.cdBox = h('div.hud-cd');
    this.warn = h('div.hud-warn', { hidden: true }, '⚠ 逆走してるワン！');
    this.boostEdge = h('div.hud-boost-edge');
    this.mapCanvas = h('canvas.hud-map', { width: 180, height: 180 });
    this.fallback = h('div.hud-fallback', { hidden: true }, '3D表示を開始できなかったため、簡易表示で遊んでいます');

    this.root.append(
      this.boostEdge,
      h('div.hud-tl', null, h('div.hud-rank-wrap', null, this.rank), h('div.hud-lt', null, this.lap, this.time)),
      h('div.hud-tr', null, this.net, this.mapCanvas),
      h('div.hud-bl', null, h('div.hud-speed', null, this.speed, h('span', null, 'わんkm/h')), h('div.hud-speed-bar', null, this.speedBar)),
      h('div.hud-br', null, this.itemSlot),
      h('div.hud-bc', null, 'W/↑ アクセル　S/↓ ブレーキ　A D/← → ハンドル　Space アイテム　R 復帰'),
      this.cdBox,
      this.center,
      this.warn,
      this.fallback,
    );
    container.append(this.root);
    this._buildMapBase();
    this._mapTimer = 0;
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
    this._set('lap', this.lap, `LAP ${Math.min(RACE.LAPS, d.lap + 1)}/${RACE.LAPS}`);
    this._set('time', this.time, formatTime(Math.max(0, d.time)));
    const kmh = Math.round(Math.abs(d.speed) * 3.6);
    this._set('speed', this.speed, String(kmh));
    this.speedBar.style.width = `${Math.min(100, (Math.abs(d.speed) / 40) * 100)}%`;
    this.speedBar.classList.toggle('boost', d.boost > 0);
    this.boostEdge.classList.toggle('on', d.boost > 0);

    let icon = '';
    let name = 'アイテムなし';
    if (d.roll > 0) {
      const icons = ['🦴', '🍌', '⚡'];
      icon = icons[Math.floor(performance.now() / 90) % 3];
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
    this.net.className = `hud-net tone-${d.netTone}`;
    this.warn.hidden = !(d.wrong > 1);

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
      this._mapTimer = 1 / 15;
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
      x.fillStyle = i === 0 ? '#ff4d5e' : '#3d8bff';
      x.fill();
      x.lineWidth = 2.5;
      x.strokeStyle = '#fff';
      x.stroke();
    });
  }

  /** 中央に大きなメッセージ */
  flash(text, cls = '', ms = 1300) {
    const el = h(`div.hud-flash.${cls || 'plain'}`, { style: { '--ms': `${ms / 1000}s` } }, text);
    this.center.append(el);
    setTimeout(() => el.remove(), ms);
  }

  dispose() {
    this.root.remove();
  }
}
