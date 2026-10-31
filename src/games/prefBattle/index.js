// 都道府県県境バトル: お題の都道府県の県境を、標高で色分けした日本地図の上に描く。時間で終了。
// 「県境」は、となりの都道府県と接している陸の境だけ（海岸線・島は境ではないので含まない。北海道・沖縄県はお題に出ない）。
// 本物の県境とのずれを採点（一致率 %）し、100% に近い人の勝ち。
// 地図は国土地理院の色別標高図タイルを、拡大に合わせた細かさで読み込んで描く（tiles.js。拡大してもくっきり）。
//
// 答え合わせの演出: 「そこまで！」→ みんなが描いた地図がカードになって登場 → 中央の地図へ飛んで合体（線が重なる）
// → 本物の境が光りながら描かれる → 一致率がカウントアップ → 勝者に王冠。
//
// 計算はホスト（common2d.js）。描いた線は、遊んでいる間ときどきと、時間切れのときにホストへ送る。
// 地図: 国土地理院の色別標高図。県境: 地球地図日本（国土地理院）を加工して作成（tools/japan-map/）。

import { h } from '../../core/util.js';
import { HostedGame, fitCanvas, topbarInset, easeOut, easeInOut, gauss } from '../common2d.js';
import DATA from './japan-prefs.json';
import BASE_URL from './japan-base.jpg';
import { TileMap } from './tiles.js';
import { prefLines, tolerance, scoreDrawing, packStrokes, unpackStrokes, eraseAt, lengthKm, unitKm, resample, FULL_RATIO, OVER_LIMIT } from './score.js';

export const PREF = {
  READY: 3, // お題を見せてから描けるまで（秒）
  GRACE: 3, // 時間切れのあと、ゲストの最後の線が届くのを待つ上限（秒）
  REVEAL: 11.5, // 答え合わせの演出（秒）
  SYNC_MS: 2500, // 描いている間、線をホストへ送る間隔
};
const MAP_W = DATA.view.w;
const MAP_H = DATA.view.h;
const MAX_ZOOM = 60; // 日本全体が見える大きさの何倍まで拡大できるか
const usedCodes = []; // ホスト: この部屋で出したお題（連戦で重ならないように）

let tileMap = null; // 地図タイル（ゲームをまたいで読み込み済みのタイルを使い回す）
function getTiles() {
  tileMap ||= new TileMap(DATA.view, BASE_URL);
  return tileMap;
}

export function createGame() {
  return new PrefBattle();
}

/** 角の丸い四角（古いブラウザは普通の四角） */
function roundRect(g, R, r) {
  if (g.roundRect) g.roundRect(R.x, R.y, R.w, R.h, r);
  else g.rect(R.x, R.y, R.w, R.h);
}

const prefOf = (code) => DATA.prefs.find((p) => p.code === code && p.borders.length) || DATA.prefs[10];

/** お題になる都道府県（陸の県境があるもの。北海道・沖縄県は海に囲まれているので出ない） */
const POOL = DATA.prefs.filter((p) => p.borders.length).map((p) => p.code);

function pickCode() {
  let pool = POOL.filter((c) => !usedCodes.includes(c));
  if (!pool.length) {
    usedCodes.length = 0;
    pool = POOL;
  }
  const c = pool[Math.floor(Math.random() * pool.length)];
  usedCodes.push(c);
  return c;
}

class PrefBattle extends HostedGame {
  initState(o) {
    const n = this.n;
    return {
      t: 0,
      code: pickCode(),
      limit: [10, 15, 30, 45, 60, 90].includes(o.limit) ? o.limit : 60,
      strokes: Array.from({ length: n }, () => []), // 人ごとの線（×10 の整数。packStrokes の形）
      fin: Array.from({ length: n }, () => false), // 最後の線が届いたか
      scores: null, // [{ pct, cover, precise, dev, miss, over, T, len }]（len: 描いた線の長さ km）
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
      return { pct: num(s.pct, 0, 100), cover: num(s.cover, 0, 1), precise: num(s.precise, 0, 1), dev: num(s.dev, 0, 1e4), miss: num(s.miss, 0, 1), over: num(s.over, 0, 1e3), T: num(s.T, 0, 100), len: num(s.len, 0, 1e6) };
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

  /**
   * CPU: 時間切れの瞬間に、本物の県境を「うろ覚え」でなぞった線を出す。
   * 強さで、線のうねり（よわい 7km / ふつう 3.5km / つよい 1.4km）と、描き忘れる割合（35% / 15% / 4%）が変わる
   */
  cpuStep(i, level) {
    const s = this.s;
    if (s.revealed || s.fin[i] || s.t < PREF.READY + s.limit) return;
    const amp = { 1: 7, 2: 3.5, 3: 1.4 }[level] || 3.5;
    const skip = { 1: 0.35, 2: 0.15, 3: 0.04 }[level] || 0.15;
    const view = DATA.view;
    const out = [];
    for (const line of prefLines(prefOf(s.code))) {
      const pts = resample([line], 2, view);
      if (pts.length < 2) continue;
      const f1 = 0.08 + Math.random() * 0.1;
      const f2 = 0.25 + Math.random() * 0.2;
      const p1 = Math.random() * 6.3;
      const p2 = Math.random() * 6.3;
      let cur = [];
      pts.forEach(([x, y], k) => {
        if (k % 8 === 0 && Math.random() < skip) {
          if (cur.length > 1) out.push(cur);
          cur = [];
          this._cpuSkip = 8; // この先 8 点（約 16km）は描き忘れ
        }
        if (this._cpuSkip > 0) {
          this._cpuSkip--;
          return;
        }
        const a = pts[Math.max(0, k - 1)];
        const b = pts[Math.min(pts.length - 1, k + 1)];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = -(b[1] - a[1]) / len;
        const ny = (b[0] - a[0]) / len;
        const km = amp * (0.65 * Math.sin(k * f1 + p1) + 0.35 * Math.sin(k * f2 + p2)) + gauss() * amp * 0.12;
        const u = km / unitKm(view, y);
        cur.push([x + nx * u, y + ny * u]);
      });
      this._cpuSkip = 0;
      if (cur.length > 1) out.push(cur);
    }
    s.strokes[i] = packStrokes(out);
    s.fin[i] = true;
  }

  _judge() {
    const s = this.s;
    const pref = prefOf(s.code);
    const truth = prefLines(pref);
    const T = tolerance(pref, DATA.view);
    const r3 = (x) => Math.round(x * 1000) / 1000;
    s.scores = s.strokes.map((v) => {
      const lines = unpackStrokes(v, MAP_W, MAP_H);
      const r = scoreDrawing(truth, lines, DATA.view, T);
      return { pct: r.pct, cover: r3(r.cover), precise: r3(r.precise), dev: Math.round(r.dev * 10) / 10, miss: r3(r.miss), over: Math.round(r.over * 100) / 100, T: Math.round(T * 10) / 10, len: Math.round(lengthKm(lines, DATA.view)) };
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
      if (d.k !== 'st' || s.revealed || !(player > 0 && player < this.humans)) return;
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
    const T = tolerance(pref, DATA.view);
    const sc = s.scores || s.strokes.map(() => ({ pct: 0, cover: 0, precise: 0, dev: 0, miss: 1, over: 0, T, len: 0 }));
    const pcts = sc.map((x) => x.pct);
    const best = Math.max(...pcts);
    const tops = pcts.map((p, i) => (p === best ? i : -1)).filter((i) => i >= 0);
    const solo = this.n === 1;
    const win = tops.length === 1 && !solo ? tops[0] : -1; // ひとりモードは勝ちボーナスなし
    const rank = (i) => 1 + pcts.filter((p) => p > pcts[i]).length;
    const pts = pcts.map((p, i) => Math.round(p) + (i === win ? 20 : 0));
    const truthLen = lengthKm(prefLines(pref), DATA.view);
    const pc = (x) => `${(x * 100).toFixed(1)}%`;
    return {
      gameId: 'prefBattle',
      winner: win >= 0 ? this.who(win).slot : null,
      title: solo ? `一致率 ${best.toFixed(1)}%！` : win >= 0 ? `${this.who(win).name}の勝ち！一致率 ${best.toFixed(1)}%` : `引き分け！一致率 ${best.toFixed(1)}%`,
      course: `お題 ${pref.name}`,
      players: sc.map((x, i) => ({
        slot: this.who(i).slot,
        headline: solo ? (x.pct >= 80 ? '🗾 県境マスター！' : x.pct >= 50 ? '😺 いい感じ' : '🐶 もう少し') : i === win ? '🏆 勝ち！' : win < 0 && x.pct === best ? '🤝 引き分け' : this.n === 2 ? '負け…' : `${rank(i)}位…`,
        detail: `一致率 ${x.pct.toFixed(1)}%`,
      })),
      stats: [
        { label: '一致率', values: sc.map((x) => `${x.pct.toFixed(1)}%`) },
        { label: '① なぞれた割合（網羅）', values: sc.map((x) => pc(x.cover)) },
        { label: '② 線の正確さ', values: sc.map((x) => pc(x.precise)) },
        { label: '③ 線の量（本物 = 1）', values: sc.map((x) => (x.len ? `${x.over.toFixed(2)} 倍${x.over > OVER_LIMIT ? `（×${(OVER_LIMIT / x.over).toFixed(2)} 割引）` : ''}` : '-')) },
        { label: '描いた線の平均のずれ', values: sc.map((x) => (x.len ? `${x.dev.toFixed(1)} km` : '-')) },
        { label: '取りこぼした県境', values: sc.map((x) => pc(x.miss)) },
        { label: '描いた線の長さ', values: sc.map((x) => `約 ${x.len} km`) },
        { label: '本物の県境の長さ', text: `約 ${Math.round(truthLen)} km（となりと接している陸の境だけ）` },
        { label: '許容距離', text: `満点 ${(T * FULL_RATIO).toFixed(1)} km 以内 → ${T.toFixed(1)} km で 0 点（県境の大きさで決まる）` },
        { label: '計算式', text: `一致率 = 2×①×②÷(①+②)。③が ${OVER_LIMIT} 倍を超えると割引。距離は緯度ごとの縮尺で地上の km に直して 0.25km ごとに測定` },
        { label: 'となりの都道府県', text: pref.neighbors.map((c) => DATA.prefs.find((p) => p.code === c)?.name).filter(Boolean).join('・') },
      ],
      score: [
        { label: '🗾 一致率', values: pcts.map((p) => `${p.toFixed(1)}% → ${Math.round(p)}`) },
        { label: '🏆 勝ちボーナス', values: pcts.map((p, i) => (i === win ? '+20' : '-')) },
        { label: '今回の合計', values: pts.map((p) => `${p} pt`) },
      ],
      points: pts,
      cpu: this.cpuSlots(),
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
    this.tiles = getTiles();
    const o = this.ctx.options || {};
    const races = o.races > 1 ? `第${o.round || 1}戦 / 全${o.races}戦　` : '';
    const me = this.who(this.me);
    const tool = (id, icon, label) => h('button.pb-tool', { 'data-tool': id, onclick: () => this._setTool(id), title: label }, icon, h('small', null, label));
    const act = (icon, label, fn) => h('button.pb-tool', { onclick: fn, title: label }, icon, h('small', null, label));
    this.el = {
      round: h('div.pb-round', null, `${races}🗾 都道府県県境バトル`),
      prompt: h('div.pb-prompt', null, ''),
      sub: h('div.pb-sub', null, 'となりの都道府県と接している陸の境だけ（海岸線・島は描かない）'),
      timer: h('div.g2d-timer', null, h('div.g2d-timer-bar'), h('span.g2d-timer-num', null, '')),
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
        h('span.pb-credit', null, '地図: 国土地理院（色別標高図・地球地図日本を加工）')),
    };
    this.root.classList.add('pb');
    // 左の列（横長で低い画面のとき）にまとめる部品は .g2d-side に入れる（ふつうの画面では、上下にばらして並ぶ）
    this.root.append(h('div.g2d-side', null, h('div.g2d-top', null, h('div.pb-head', null, this.el.round, this.el.prompt, this.el.sub, this.el.timer), this.el.tools), this.el.foot), this.el.canvas);
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
    const top = Math.min(r.height * 0.3, topbarInset(this.el.canvas)); // 右上のボタンの下に収める
    const scale = Math.min(r.width / MAP_W, (r.height - top) / MAP_H) * 0.98;
    this.view = { scale, ox: (r.width - MAP_W * scale) / 2, oy: top + (r.height - top - MAP_H * scale) / 2, fit: scale };
  }

  _zoomAt(f, sx, sy) {
    const v = this.view;
    if (!v) return;
    const ns = Math.max(v.fit * 0.8, Math.min(v.fit * MAX_ZOOM, v.scale * f));
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
    this.el.timer.querySelector('.g2d-timer-num').textContent = ph === 'ready' ? `よーい… ${sec}` : ph === 'play' ? `のこり ${sec} 秒` : ph === 'judge' ? 'そこまで！ 採点中…' : '答え合わせ';
    this.el.timer.querySelector('.g2d-timer-bar').style.transform = `scaleX(${ph === 'play' ? Math.max(0, remain / s.limit) : ph === 'ready' ? 1 : 0})`;
    this.el.timer.classList.toggle('hurry', ph === 'play' && remain < 5);
    this.root.classList.toggle('is-reveal', ph === 'reveal');

    const c = this.el.canvas;
    const { w, h: hh, dpr } = fitCanvas(c);
    this._dpr = dpr;
    if (!this.view || this._vw !== w || this._vh !== hh) {
      const keep = this.view && this.view.scale !== this.view.fit;
      this._vw = w;
      this._vh = hh;
      if (!keep) this._fit();
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#2f6fc4';
    g.fillRect(0, 0, w, hh);
    if (ph === 'reveal') this._drawReveal(g, w, hh, t - (this._revealAt ?? t), pref);
    else this._drawPlay(g, w, hh, ph);
  }

  /** 地図を描く（拡大に合わせた細かさのタイル）。clip: 描く範囲（画面の画素の四角） */
  _drawMap(g, v, clip = null) {
    const c = this.el.canvas;
    this.tiles.draw(g, v.scale, v.ox, v.oy, this._vw || c.clientWidth, this._vh || c.clientHeight, this._dpr || 1, clip);
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
    const top = Math.max(hh * 0.03, Math.min(hh * 0.3, topbarInset(this.el.canvas))); // 右上のボタンの下から
    const C = { x: w * 0.04, y: top, w: w * 0.92, h: hh - top - hh * 0.03 };
    let vw = bx1 - bx0 + pad * 2;
    let vh = by1 - by0 + pad * 2;
    if (vw / vh > C.w / C.h) vh = (vw * C.h) / C.w;
    else vw = (vh * C.w) / C.h;
    const V = { x: (bx0 + bx1) / 2 - vw / 2, y: (by0 + by1) / 2 - vh / 2, w: vw, h: vh };
    const toRect = (R) => ([x, y]) => [R.x + ((x - V.x) / V.w) * R.w, R.y + ((y - V.y) / V.h) * R.h];
    const drawRegion = (R, alpha) => {
      g.save();
      g.globalAlpha = alpha;
      g.beginPath();
      roundRect(g, R, 14);
      g.clip();
      // 範囲 V が四角 R にぴったり入る拡大で、地図そのもの（タイル）を描く
      const scale = R.w / V.w;
      this._drawMap(g, { scale, ox: R.x - V.x * scale, oy: R.y - V.y * scale }, R);
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

    // 3') 採点の範囲（本物の県境から T km 以内に点がもらえる帯、濃い所は満点）。本物の境を描き終えたら出てくる
    const bandT = easeOut((rt - 5.6) / 0.8);
    if (bandT > 0) {
      const map = toRect(C);
      const T = tolerance(pref, DATA.view);
      const pxPerKm = C.w / V.w / unitKm(DATA.view, (pref.box[1] + pref.box[3]) / 2);
      g.save();
      g.beginPath();
      g.rect(C.x, C.y, C.w, C.h);
      g.clip();
      g.globalAlpha = bandT;
      this._strokeLines(g, truth, map, 'rgba(255,240,150,0.36)', 2 * T * pxPerKm);
      this._strokeLines(g, truth, map, 'rgba(255,225,90,0.5)', 2 * T * FULL_RATIO * pxPerKm);
      g.restore();
      // 凡例（地図の左下）
      g.save();
      g.globalAlpha = bandT;
      g.font = '800 12px "M PLUS Rounded 1c", sans-serif';
      const lines2 = [`🟨 濃い帯: 県境から ${(T * FULL_RATIO).toFixed(1)}km 以内 = 満点`, `🟨 うすい帯: ${T.toFixed(1)}km 以内 = 遠いほど減点（外は 0 点）`];
      const bw = Math.max(...lines2.map((x) => g.measureText(x).width)) + 16;
      const bx = C.x + 8;
      const by = C.y + C.h - 8 - lines2.length * 17 - 8;
      g.fillStyle = 'rgba(30,20,40,0.7)';
      g.beginPath();
      roundRect(g, { x: bx, y: by, w: bw, h: lines2.length * 17 + 8 }, 8);
      g.fill();
      g.fillStyle = '#fff';
      g.textAlign = 'left';
      g.textBaseline = 'top';
      lines2.forEach((x, k) => g.fillText(x, bx + 8, by + 5 + k * 17));
      g.restore();
    }

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
          const sx = s.scores[i];
          const det = h('small.pb-detail', null, `なぞれた ${(sx.cover * 100).toFixed(1)}% × 正確さ ${(sx.precise * 100).toFixed(1)}%${sx.over > OVER_LIMIT ? `・線が多すぎ ×${(OVER_LIMIT / sx.over).toFixed(2)}` : ''}・平均のずれ ${sx.dev.toFixed(1)}km`);
          const el = h('div.g2d-res', { style: { '--c': p.col } }, h('span.pb-crown', null, ''), `${p.icon} ${p.name}　`, num, det);
          return { el, num, i, det };
        });
        this.el.foot.replaceChildren(h('div.g2d-results', null, this._chips.map((x) => x.el)));
      }
      for (const ch2 of this._chips) {
        const v = s.scores[ch2.i].pct * countT;
        ch2.num.textContent = `${v.toFixed(1)}%`;
        const win = done && s.scores[ch2.i].pct === best;
        ch2.el.classList.toggle('best', win);
        ch2.el.querySelector('.pb-crown').textContent = win ? '👑 ' : '';
        ch2.det.classList.toggle('on', done);
      }
      if (done && !this._fanfare) {
        this._fanfare = true;
        this.sound.play(s.scores[this.me]?.pct === best ? 'finish' : 'lose');
      }
    }
  }
}
