// 都道府県県境バトル: お題の都道府県の境を、標高で色分けした日本地図の上に描く。時間で終了。
// 本物の境とのずれを採点（一致率 %）し、100% に近い人の勝ち。
//
// 答え合わせの演出: 「そこまで！」→ みんなが描いた地図がカードになって登場 → 中央の地図へ飛んで合体（線が重なる）
// → 本物の境が光りながら描かれる → 一致率がカウントアップ → 勝者に王冠。
//
// 計算はホスト（common2d.js）。描いた線は、遊んでいる間ときどきと、時間切れのときにホストへ送る。
// 地図: 標高タイル・地球地図日本（国土地理院）を加工して作成（tools/japan-map/）。

import { h } from '../../core/util.js';
import { HostedGame, fitCanvas, easeOut, easeInOut } from '../common2d.js';
import DATA from './japan-prefs.json';
import MAP_URL from './japan-elev.jpg';
import { prefLines, tolerance, scoreDrawing, packStrokes, unpackStrokes, eraseAt } from './score.js';

export const PREF = {
  READY: 3, // お題を見せてから描けるまで（秒）
  GRACE: 3, // 時間切れのあと、ゲストの最後の線が届くのを待つ上限（秒）
  REVEAL: 11.5, // 答え合わせの演出（秒）
  SYNC_MS: 2500, // 描いている間、線をホストへ送る間隔
};
const MAP_K = 1.25; // 地図画像の画素 / 地図の単位
const KM_PER_UNIT = 1.6;
const MAP_W = DATA.view.w;
const MAP_H = DATA.view.h;
const usedCodes = []; // ホスト: この部屋で出したお題（連戦で重ならないように）

let mapImg = null;
function loadMap() {
  if (!mapImg) {
    mapImg = new Image();
    mapImg.decoding = 'async';
    mapImg.src = MAP_URL;
  }
  return mapImg;
}

export function createGame() {
  return new PrefBattle();
}

/** 角の丸い四角（古いブラウザは普通の四角） */
function roundRect(g, R, r) {
  if (g.roundRect) g.roundRect(R.x, R.y, R.w, R.h, r);
  else g.rect(R.x, R.y, R.w, R.h);
}

const prefOf = (code) => DATA.prefs.find((p) => p.code === code) || DATA.prefs[10];

function pickCode() {
  let pool = DATA.prefs.map((p) => p.code).filter((c) => !usedCodes.includes(c));
  if (!pool.length) {
    usedCodes.length = 0;
    pool = DATA.prefs.map((p) => p.code);
  }
  const c = pool[Math.floor(Math.random() * pool.length)];
  usedCodes.push(c);
  return c;
}

class PrefBattle extends HostedGame {
  initState(o) {
    const n = this.ctx.players.length;
    return {
      t: 0,
      code: pickCode(),
      limit: [30, 45, 60, 90].includes(o.limit) ? o.limit : 60,
      strokes: Array.from({ length: n }, () => []), // 人ごとの線（×10 の整数。packStrokes の形）
      fin: Array.from({ length: n }, () => false), // 最後の線が届いたか
      scores: null, // [{ pct, cover, precise, len }]
      revealed: false,
      revealT: 0,
      done: false,
    };
  }

  sanitize(r) {
    if (!r || typeof r !== 'object') return null;
    const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    const n = this.n;
    return {
      t: num(r.t, 0, -10, 3600),
      code: prefOf(num(r.code, 11, 1, 47) | 0).code,
      limit: num(r.limit, 60, 10, 120),
      strokes: Array.from({ length: n }, (_, i) => packStrokes(unpackStrokes(Array.isArray(r.strokes) ? r.strokes[i] : [], MAP_W, MAP_H))),
      fin: Array.from({ length: n }, (_, i) => !!(Array.isArray(r.fin) && r.fin[i])),
      scores: this._cleanScores(r.scores),
      revealed: !!r.revealed,
      revealT: num(r.revealT, 0, -10, 3600),
      done: !!r.done,
    };
  }

  _cleanScores(v) {
    if (!Array.isArray(v)) return null;
    const num = (x, lo, hi) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0);
    return Array.from({ length: this.n }, (_, i) => {
      const s = v[i] || {};
      return { pct: num(s.pct, 0, 100), cover: num(s.cover, 0, 1), precise: num(s.precise, 0, 1), len: num(s.len, 0, 1e6) };
    });
  }

  /** 毎回配る軽い状態（描いた線は配らない。答え合わせのときに別に配る） */
  light() {
    const s = this.s;
    return { t: s.t, code: s.code, limit: s.limit, sc: s.revealed ? s.scores : null };
  }

  mergeLight(r) {
    const s = this.s;
    if (typeof r.code === 'number') s.code = prefOf(r.code | 0).code;
    if (typeof r.limit === 'number' && Number.isFinite(r.limit)) s.limit = Math.min(120, Math.max(10, r.limit));
    if (r.sc && !s.revealed) {
      s.scores = this._cleanScores(r.sc);
      s.revealed = true;
      this._revealAt = this.time;
    }
  }

  /** お題の都道府県のデータ */
  get target() {
    return prefOf(this.s.code);
  }

  get phase() {
    const t = this.time;
    const s = this.s;
    if (s.revealed) return 'reveal';
    if (t < PREF.READY) return 'ready';
    if (t < PREF.READY + s.limit) return 'play';
    return 'judge';
  }

  step() {
    const s = this.s;
    const end = PREF.READY + s.limit;
    if (!s.revealed && s.t >= end) {
      if (!s.fin[0]) {
        s.strokes[0] = packStrokes(this.my);
        s.fin[0] = true;
      }
      if (s.fin.every(Boolean) || s.t >= end + PREF.GRACE) this._judge();
    }
    if (s.revealed && !s.done && s.t >= s.revealT + PREF.REVEAL) {
      s.done = true;
      this.ctx.finish(this.result());
    }
  }

  _judge() {
    const s = this.s;
    const pref = prefOf(s.code);
    const truth = prefLines(pref);
    const T = tolerance(pref);
    s.scores = s.strokes.map((v) => {
      const lines = unpackStrokes(v, MAP_W, MAP_H);
      const r = scoreDrawing(truth, lines, T);
      const len = lines.reduce((a, l) => a + l.reduce((b, p, i) => b + (i ? Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0), 0);
      return { pct: r.pct, cover: r.cover, precise: r.precise, len };
    });
    s.revealed = true;
    s.revealT = s.t;
    this._revealAt = s.t;
    // 描いた線は 1 人ずつ配る（1 通の大きさの上限に収めるため）。採点は毎回の軽い状態にも載る
    s.strokes.forEach((v, i) => this.broadcast({ k: 'rs', i, v }));
  }

  onGameMessage(d, player) {
    const s = this.s;
    if (this.isHost) {
      if (d.k !== 'st' || s.revealed || !(player > 0 && player < this.n)) return;
      if (s.t > PREF.READY + s.limit + PREF.GRACE) return;
      s.strokes[player] = packStrokes(unpackStrokes(d.v, MAP_W, MAP_H));
      if (d.fin) s.fin[player] = true;
      return;
    }
    if (d.k === 'rs' && Number.isInteger(d.i) && d.i >= 0 && d.i < this.n) {
      s.strokes[d.i] = packStrokes(unpackStrokes(d.v, MAP_W, MAP_H));
      this._linesCache = null;
    }
  }

  result() {
    const s = this.s;
    const pref = prefOf(s.code);
    const sc = s.scores || s.strokes.map(() => ({ pct: 0, cover: 0, precise: 0, len: 0 }));
    const pcts = sc.map((x) => x.pct);
    const best = Math.max(...pcts);
    const tops = pcts.map((p, i) => (p === best ? i : -1)).filter((i) => i >= 0);
    const win = tops.length === 1 ? tops[0] : -1;
    const rank = (i) => 1 + pcts.filter((p) => p > pcts[i]).length;
    const pts = pcts.map((p, i) => Math.round(p) + (i === win ? 20 : 0));
    const truthLen = prefLines(pref).reduce((a, l) => a + l.reduce((b, p, i) => b + (i ? Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0), 0);
    return {
      gameId: 'prefBattle',
      winner: win >= 0 ? this.who(win).slot : null,
      title: win >= 0 ? `${this.who(win).name}の勝ち！一致率 ${best.toFixed(1)}%` : `引き分け！一致率 ${best.toFixed(1)}%`,
      course: `お題 ${pref.name}`,
      players: sc.map((x, i) => ({
        slot: this.who(i).slot,
        headline: i === win ? '🏆 勝ち！' : win < 0 && x.pct === best ? '🤝 引き分け' : this.n === 2 ? '負け…' : `${rank(i)}位…`,
        detail: `一致率 ${x.pct.toFixed(1)}%`,
      })),
      stats: [
        { label: '一致率', values: sc.map((x) => `${x.pct.toFixed(1)}%`) },
        { label: '境をなぞれた割合', values: sc.map((x) => `${Math.round(x.cover * 100)}%`) },
        { label: '線の正確さ', values: sc.map((x) => `${Math.round(x.precise * 100)}%`) },
        { label: '描いた線の長さ', values: sc.map((x) => `約 ${Math.round(x.len * KM_PER_UNIT)} km`) },
        { label: '本物の境の長さ', text: `約 ${Math.round(truthLen * KM_PER_UNIT)} km（地図に載る島を含む）` },
      ],
      score: [
        { label: '🗾 一致率', values: pcts.map((p) => `${p.toFixed(1)}% → ${Math.round(p)}`) },
        { label: '🏆 勝ちボーナス', values: pcts.map((p, i) => (i === win ? '+20' : '-')) },
        { label: '今回の合計', values: pts.map((p) => `${p} pt`) },
      ],
      points: pts,
    };
  }

  // ---- 画面 ----
  mount() {
    this.my = []; // 自分の線（地図の単位の点の配列の配列）
    this.undo = [];
    this.tool = 'pen';
    this._myVer = 0;
    this._sentVer = -1;
    this._lastSync = 0;
    this._finalSent = false;
    this._lastPhase = '';
    this._lastSec = -1;
    this.view = null; // { scale, ox, oy }（画面の画素 / 地図の単位、地図の原点の画面位置）
    this.img = loadMap();
    const o = this.ctx.options || {};
    const races = o.races > 1 ? `第${o.round || 1}戦 / 全${o.races}戦　` : '';
    const me = this.who(this.me);
    const tool = (id, icon, label) => h('button.pb-tool', { 'data-tool': id, onclick: () => this._setTool(id), title: label }, icon, h('small', null, label));
    const act = (icon, label, fn) => h('button.pb-tool', { onclick: fn, title: label }, icon, h('small', null, label));
    this.el = {
      round: h('div.pb-round', null, `${races}🗾 都道府県県境バトル`),
      prompt: h('div.pb-prompt', null, ''),
      timer: h('div.ad-timer', null, h('div.ad-timer-bar'), h('span.ad-timer-num', null, '')),
      tools: h('div.pb-tools', null,
        tool('pen', '✏️', 'ペン'),
        tool('erase', '🧽', '消しゴム'),
        tool('move', '✋', '移動'),
        act('↩️', '戻す', () => this._undo()),
        act('🗑️', '全部リセット', () => this._reset()),
        act('➕', '拡大', () => this._zoomBy(1.5)),
        act('➖', '縮小', () => this._zoomBy(1 / 1.5)),
        act('🗾', '全体', () => this._fit())),
      canvas: h('canvas.pb-canvas'),
      foot: h('div.pb-foot', null,
        h('span', { style: { color: me.col } }, `${me.icon} あなた（${me.name}）: 線をなぞって県境を描こう。2本指でつまむと拡大・移動`),
        h('span.pb-credit', null, '地図: 国土地理院（標高タイル・地球地図日本）を加工')),
    };
    this.root.classList.add('pb');
    this.root.append(h('div.pb-head', null, this.el.round, this.el.prompt, this.el.timer), this.el.tools, this.el.canvas, this.el.foot);
    this._setTool('pen');
    const c = this.el.canvas;
    this._ptrs = new Map();
    this._onDown = (e) => this._down(e);
    this._onMove = (e) => this._move(e);
    this._onUp = (e) => this._up(e);
    this._onWheel = (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this._zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    c.addEventListener('pointerdown', this._onDown);
    c.addEventListener('pointermove', this._onMove);
    c.addEventListener('pointerup', this._onUp);
    c.addEventListener('pointercancel', this._onUp);
    c.addEventListener('wheel', this._onWheel, { passive: false });
    this._onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        this._undo();
      }
    };
    window.addEventListener('keydown', this._onKey);
  }

  unmount() {
    const c = this.el.canvas;
    c.removeEventListener('pointerdown', this._onDown);
    c.removeEventListener('pointermove', this._onMove);
    c.removeEventListener('pointerup', this._onUp);
    c.removeEventListener('pointercancel', this._onUp);
    c.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKey);
  }

  get canDraw() {
    return this.phase === 'play' && !this.paused;
  }

  _setTool(id) {
    this.tool = id;
    for (const b of this.el.tools.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === id);
    this.el.canvas.dataset.tool = id;
  }

  _pushUndo() {
    this.undo.push(this.my.map((l) => l.slice()));
    if (this.undo.length > 60) this.undo.shift();
  }

  _changed() {
    this._myVer++;
  }

  _undo() {
    if (!this.canDraw || !this.undo.length) return;
    this.my = this.undo.pop();
    this._changed();
    this.sound.play('click');
  }

  _reset() {
    if (!this.canDraw || !this.my.length) return;
    this._pushUndo();
    this.my = [];
    this._changed();
    this.sound.play('drop');
  }

  // 表示（拡大・移動）
  _fit() {
    const r = this.el.canvas.getBoundingClientRect();
    const scale = Math.min(r.width / MAP_W, r.height / MAP_H) * 0.98;
    this.view = { scale, ox: (r.width - MAP_W * scale) / 2, oy: (r.height - MAP_H * scale) / 2, fit: scale };
  }

  _zoomAt(f, sx, sy) {
    const v = this.view;
    if (!v) return;
    const ns = Math.max(v.fit * 0.8, Math.min(v.fit * 14, v.scale * f));
    const k = ns / v.scale;
    v.ox = sx - (sx - v.ox) * k;
    v.oy = sy - (sy - v.oy) * k;
    v.scale = ns;
  }

  _zoomBy(f) {
    const r = this.el.canvas.getBoundingClientRect();
    this._zoomAt(f, r.width / 2, r.height / 2);
  }

  _toMap(sx, sy) {
    const v = this.view;
    return [(sx - v.ox) / v.scale, (sy - v.oy) / v.scale];
  }

  _local(e) {
    const r = this.el.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _down(e) {
    if (!this.view) return;
    const c = this.el.canvas;
    c.setPointerCapture?.(e.pointerId);
    const p = this._local(e);
    this._ptrs.set(e.pointerId, p);
    if (this._ptrs.size === 2) {
      // 2 本指: 描きかけの線はやめて、拡大・移動にする
      if (this._drawing) {
        this._drawing = false;
        const prev = this.undo.pop();
        if (prev) this.my = prev;
        this._changed();
      }
      const [a, b] = [...this._ptrs.values()];
      this._pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
      return;
    }
    if (this._ptrs.size > 2) return;
    const tool = e.button === 1 || e.button === 2 ? 'move' : this.tool;
    this._act = tool;
    if (tool === 'move' || !this.canDraw) {
      this._act = 'move';
      this._panFrom = p;
      return;
    }
    const [x, y] = this._toMap(...p);
    this._pushUndo();
    if (tool === 'pen') {
      this._drawing = true;
      this.my.push([[x, y]]);
    } else {
      this.my = eraseAt(this.my, x, y, 14 / this.view.scale);
    }
    this._changed();
  }

  _move(e) {
    if (!this._ptrs.has(e.pointerId) || !this.view) return;
    const p = this._local(e);
    this._ptrs.set(e.pointerId, p);
    if (this._ptrs.size === 2 && this._pinch) {
      const [a, b] = [...this._ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      this.view.ox += mx - this._pinch.mx;
      this.view.oy += my - this._pinch.my;
      this._zoomAt(d / Math.max(1, this._pinch.d), mx, my);
      this._pinch = { d, mx, my };
      return;
    }
    if (this._ptrs.size !== 1) return;
    if (this._act === 'move') {
      this.view.ox += p[0] - this._panFrom[0];
      this.view.oy += p[1] - this._panFrom[1];
      this._panFrom = p;
      return;
    }
    if (!this.canDraw) return;
    const [x, y] = this._toMap(...p);
    if (this._act === 'pen' && this._drawing) {
      const l = this.my[this.my.length - 1];
      const q = l[l.length - 1];
      if (Math.hypot(x - q[0], y - q[1]) * this.view.scale >= 2.5) {
        l.push([x, y]);
        this._changed();
      }
    } else if (this._act === 'erase') {
      const next = eraseAt(this.my, x, y, 14 / this.view.scale);
      if (next !== this.my) {
        this.my = next;
        this._changed();
      }
    }
  }

  _up(e) {
    this._ptrs.delete(e.pointerId);
    if (this._ptrs.size < 2) this._pinch = null;
    if (this._ptrs.size === 0) {
      this._drawing = false;
      this._act = null;
    }
  }

  /** ゲスト: 描いた線をホストへ（変わったときだけ、ときどき。時間切れで最後の 1 回） */
  _sync(final) {
    if (this.isHost) return;
    const t = performance.now();
    if (!final && (this._myVer === this._sentVer || t - this._lastSync < PREF.SYNC_MS)) return;
    this._lastSync = t;
    this._sentVer = this._myVer;
    this.sendToHost({ k: 'st', v: packStrokes(this.my), fin: !!final });
  }

  draw() {
    const s = this.s;
    if (!this.isHost && !this._rx) {
      this.el.prompt.textContent = '…';
      return;
    }
    const ph = this.phase;
    const t = this.time;
    const pref = prefOf(s.code);
    if (ph !== this._lastPhase) {
      if (ph === 'play') this.sound.play('go');
      if (ph === 'judge' || (ph === 'reveal' && this._lastPhase === 'play')) this.sound.play('lap');
      if (this._lastPhase === 'play' && !this._finalSent) {
        this._finalSent = true;
        this._sync(true);
      }
      if (ph === 'reveal') this._revealAt ??= t;
      this._lastPhase = ph;
    }
    if (ph === 'play') this._sync(false);
    this.el.prompt.replaceChildren('「', h('b', null, pref.name), '」の県境を描け！');
    const remain = ph === 'ready' ? PREF.READY - t : ph === 'play' ? PREF.READY + s.limit - t : 0;
    const sec = Math.ceil(Math.max(0, remain));
    if (sec !== this._lastSec && (ph === 'ready' || (ph === 'play' && sec <= 5))) this.sound.play('beep');
    this._lastSec = sec;
    this.el.timer.querySelector('.ad-timer-num').textContent = ph === 'ready' ? `よーい… ${sec}` : ph === 'play' ? `のこり ${sec} 秒` : ph === 'judge' ? 'そこまで！ 採点中…' : '答え合わせ';
    this.el.timer.querySelector('.ad-timer-bar').style.transform = `scaleX(${ph === 'play' ? Math.max(0, remain / s.limit) : ph === 'ready' ? 1 : 0})`;
    this.el.timer.classList.toggle('hurry', ph === 'play' && remain < 5);
    this.root.classList.toggle('is-reveal', ph === 'reveal');

    const c = this.el.canvas;
    const { w, h: hh, dpr } = fitCanvas(c);
    if (!this.view || this._vw !== w || this._vh !== hh) {
      const keep = this.view && this.view.scale !== this.view.fit;
      this._vw = w;
      this._vh = hh;
      if (!keep) this._fit();
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#609ed4';
    g.fillRect(0, 0, w, hh);
    if (ph === 'reveal') this._drawReveal(g, w, hh, t - (this._revealAt ?? t), pref);
    else this._drawPlay(g, w, hh, ph);
  }

  _drawMap(g, v) {
    const img = this.img;
    if (img.complete && img.naturalWidth) g.drawImage(img, v.ox, v.oy, MAP_W * v.scale, MAP_H * v.scale);
    // 沖縄の枠
    const ins = DATA.view.inset;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 1.5;
    g.setLineDash([6, 4]);
    g.strokeRect(v.ox + ins.x * v.scale, v.oy + ins.y * v.scale, ins.w * v.scale, ins.h * v.scale);
    g.setLineDash([]);
    g.font = `800 ${Math.max(10, Math.min(16, 9 * v.scale))}px "M PLUS Rounded 1c", sans-serif`;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText('沖縄（拡大）', v.ox + (ins.x + 2) * v.scale, v.oy + (ins.y + ins.h + 2) * v.scale);
  }

  _strokeLines(g, lines, map, col, width) {
    g.strokeStyle = col;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const l of lines) {
      if (!l.length) continue;
      g.beginPath();
      const [x0, y0] = map(l[0]);
      g.moveTo(x0, y0);
      if (l.length === 1) g.lineTo(x0 + 0.1, y0);
      for (let i = 1; i < l.length; i++) g.lineTo(...map(l[i]));
      g.stroke();
    }
  }

  _drawPlay(g, w, hh, ph) {
    const v = this.view;
    this._drawMap(g, v);
    const me = this.who(this.me);
    const map = ([x, y]) => [v.ox + x * v.scale, v.oy + y * v.scale];
    this._strokeLines(g, this.my, map, 'rgba(255,255,255,0.9)', 6);
    this._strokeLines(g, this.my, map, me.col, 3);
    if (ph === 'ready') {
      g.fillStyle = 'rgba(40,30,60,0.35)';
      g.fillRect(0, 0, w, hh);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '900 34px "M PLUS Rounded 1c", sans-serif';
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      const txt = `${prefOf(this.s.code).name}`;
      g.strokeText(txt, w / 2, hh / 2);
      g.fillStyle = '#fff';
      g.fillText(txt, w / 2, hh / 2);
    }
    if (ph === 'judge') {
      g.fillStyle = 'rgba(40,30,60,0.25)';
      g.fillRect(0, 0, w, hh);
    }
  }

  /** 答え合わせの演出 */
  _drawReveal(g, w, hh, rt, pref) {
    const s = this.s;
    const lines = (this._linesCache ||= s.strokes.map((v) => unpackStrokes(v, MAP_W, MAP_H)));
    const truth = (this._truthCache ||= prefLines(pref));
    // 中央の地図に映す範囲: お題の県のまわり（余白つき）。描いた線が外にはみ出していても少し見えるように広め
    const [bx0, by0, bx1, by1] = pref.box;
    const pad = Math.max(18, 0.35 * Math.max(bx1 - bx0, by1 - by0));
    const C = { x: w * 0.04, y: hh * 0.03, w: w * 0.92, h: hh * 0.94 };
    let vw = bx1 - bx0 + pad * 2;
    let vh = by1 - by0 + pad * 2;
    if (vw / vh > C.w / C.h) vh = (vw * C.h) / C.w;
    else vw = (vh * C.w) / C.h;
    const V = { x: (bx0 + bx1) / 2 - vw / 2, y: (by0 + by1) / 2 - vh / 2, w: vw, h: vh };
    const toRect = (R) => ([x, y]) => [R.x + ((x - V.x) / V.w) * R.w, R.y + ((y - V.y) / V.h) * R.h];
    const drawRegion = (R, alpha) => {
      const img = this.img;
      g.save();
      g.globalAlpha = alpha;
      g.beginPath();
      roundRect(g, R, 14);
      g.clip();
      g.fillStyle = '#609ed4';
      g.fillRect(R.x, R.y, R.w, R.h);
      if (img.complete && img.naturalWidth) g.drawImage(img, V.x * MAP_K, V.y * MAP_K, V.w * MAP_K, V.h * MAP_K, R.x, R.y, R.w, R.h);
      g.restore();
    };

    // 1) 中央の地図（カードが合体するにつれて濃く）
    const merge = easeInOut((rt - 2.3) / 1.2);
    drawRegion(C, 0.35 + 0.65 * merge);
    g.fillStyle = `rgba(30,20,50,${0.45 * (1 - merge)})`;
    g.fillRect(0, 0, w, hh);

    // 2) みんなのカード: 下から登場 → 並ぶ → 中央へ飛んで合体
    const n = this.n;
    const cw = Math.min(C.w / (n + 0.4), C.h * 0.62 * (C.w / C.h));
    const ch = (cw * C.h) / C.w;
    lines.forEach((ls, i) => {
      const p = this.who(i);
      const sx = C.x + (C.w * (i + 0.5)) / n - cw / 2;
      const sy = C.y + C.h * 0.5 - ch / 2;
      const inT = easeOut((rt - 0.6 - i * 0.25) / 0.7);
      if (inT <= 0) return;
      const stage = { x: sx, y: sy + (1 - inT) * (hh - sy + 40), w: cw, h: ch };
      const R = {
        x: stage.x + (C.x - stage.x) * merge,
        y: stage.y + (C.y - stage.y) * merge,
        w: stage.w + (C.w - stage.w) * merge,
        h: stage.h + (C.h - stage.h) * merge,
      };
      if (merge < 1) {
        drawRegion(R, 1 - merge);
        g.save();
        g.globalAlpha = 1 - merge;
        g.strokeStyle = p.col;
        g.lineWidth = 4;
        g.beginPath();
        roundRect(g, R, 14);
        g.stroke();
        g.font = '900 16px "M PLUS Rounded 1c", sans-serif';
        g.textAlign = 'left';
        g.textBaseline = 'top';
        g.fillStyle = p.col;
        g.fillText(`${p.icon} ${p.name}`, R.x + 10, R.y + 8);
        g.restore();
      }
      const map = toRect(R);
      g.save();
      g.beginPath();
      g.rect(R.x, R.y, R.w, R.h);
      g.clip();
      const lw = 2 + merge * 1.5;
      this._strokeLines(g, ls, map, 'rgba(255,255,255,0.85)', lw + 3);
      this._strokeLines(g, ls, map, p.col, lw);
      g.restore();
    });

    // 3) 本物の境が光りながら描かれる
    const drawT = easeInOut((rt - 3.8) / 1.8);
    if (drawT > 0) {
      const map = toRect(C);
      const total = truth.reduce((a, l) => a + l.reduce((b, q, i) => b + (i ? Math.hypot(q[0] - l[i - 1][0], q[1] - l[i - 1][1]) : 0), 0), 0);
      let left = total * drawT;
      g.save();
      g.beginPath();
      g.rect(C.x, C.y, C.w, C.h);
      g.clip();
      g.shadowColor = 'rgba(255,215,0,0.95)';
      g.shadowBlur = 14;
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 4;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (const l of truth) {
        if (left <= 0) break;
        g.beginPath();
        g.moveTo(...map(l[0]));
        for (let i = 1; i < l.length && left > 0; i++) {
          const d = Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
          if (d <= left) {
            g.lineTo(...map(l[i]));
            left -= d;
          } else {
            const f = left / d;
            g.lineTo(...map([l[i - 1][0] + (l[i][0] - l[i - 1][0]) * f, l[i - 1][1] + (l[i][1] - l[i - 1][1]) * f]));
            left = 0;
          }
        }
        g.stroke();
      }
      g.restore();
      if (!this._sndTruth) {
        this._sndTruth = true;
        this.sound.play('boost');
      }
    }

    // 4) 「そこまで！」
    if (rt < 1.4) {
      const a = Math.min(1, rt / 0.15) * (1 - easeInOut((rt - 0.9) / 0.5));
      g.save();
      g.globalAlpha = a;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `900 ${Math.min(64, w * 0.12) * (1 + 0.15 * (1 - Math.min(1, rt / 0.3)))}px "M PLUS Rounded 1c", sans-serif`;
      g.lineWidth = 10;
      g.strokeStyle = '#4a3426';
      g.strokeText('そこまで！', w / 2, hh / 2);
      g.fillStyle = '#ffd23f';
      g.fillText('そこまで！', w / 2, hh / 2);
      g.restore();
    }
    // お題の名前（合体のあと）
    if (merge >= 1) {
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.font = '900 20px "M PLUS Rounded 1c", sans-serif';
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.strokeText(`お題: ${pref.name}`, w / 2, C.y + 8);
      g.fillStyle = '#fff';
      g.fillText(`お題: ${pref.name}`, w / 2, C.y + 8);
    }

    // 5) 一致率のカウントアップ（画面下）→ 勝者
    const countT = easeOut((rt - 5.8) / 1.5);
    if (countT > 0 && s.scores) {
      const best = Math.max(...s.scores.map((x) => x.pct));
      const done = rt > 7.5;
      if (!this._chips) {
        this._chips = s.scores.map((x, i) => {
          const p = this.who(i);
          const num = h('b', null, '0.0%');
          const el = h('div.ad-res', { style: { '--c': p.col } }, h('span.pb-crown', null, ''), `${p.icon} ${p.name}　`, num);
          return { el, num, i };
        });
        this.el.foot.replaceChildren(h('div.ad-results', null, this._chips.map((x) => x.el)));
      }
      for (const ch2 of this._chips) {
        const v = s.scores[ch2.i].pct * countT;
        ch2.num.textContent = `${v.toFixed(1)}%`;
        const win = done && s.scores[ch2.i].pct === best;
        ch2.el.classList.toggle('best', win);
        ch2.el.querySelector('.pb-crown').textContent = win ? '👑 ' : '';
      }
      if (done && !this._fanfare) {
        this._fanfare = true;
        this.sound.play(s.scores[this.me]?.pct === best ? 'finish' : 'lose');
      }
    }
  }
}
