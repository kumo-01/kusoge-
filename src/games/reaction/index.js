// 反応速度バトル: 画面全体の色が変わった瞬間にクリック（タップ・キー）！ 速い人の勝ち。
//
// 色が変わる時刻はホストが決める（毎回ランダム）。反応の速さは各自の端末で測る
// （色を画面に出した時刻 → 押した時刻。通信の遅れは入らないので、遠くの人も公平）。
// 色が変わる前に押すと「フライング」で失格。
// 計算はホスト（common2d.js）。ゲストは自分の結果（ミリ秒 / フライング）をホストへ送る。

import { h } from '../../core/util.js';
import { HostedGame, gauss } from '../common2d.js';

export const REACT = {
  READY: 2.2, // 「準備…」を見せる時間（秒）。このあと「まだ…」の待ちに入る
  WAIT_MIN: 1.5, // 色が変わるまでの待ち（秒。この間でランダム）
  WAIT_MAX: 5.5,
  LIMIT: 2.5, // 色が変わってから、押すのを待つ上限（秒）
  GRACE: 1.0, // 通信の遅れで届く最後の結果を待つ（秒）
  REVEAL: 5.0, // 結果発表（秒）
  MAX_MS: 2500, // これより遅いのは時間切れ
};

/** 結果: null = まだ、-1 = フライング、-2 = 時間切れ、それ以外 = 反応の速さ（ミリ秒） */
export const FOUL = -1;
export const TIMEOUT = -2;

export function createGame() {
  return new Reaction();
}

/** 1 回分のポイント（速いほど多い。150ms で 100、650ms で 0。フライング・時間切れは 0。勝った人は +20） */
export function reactionPoints(ms, win) {
  if (!(ms >= 0)) return 0;
  return Math.max(0, Math.min(100, Math.round(100 - (ms - 150) / 5))) + (win ? 20 : 0);
}

/** 反応の速さの評価 */
export function reactionRank(ms) {
  if (ms === FOUL) return '💥 フライング';
  if (!(ms >= 0)) return '⌛ 時間切れ';
  if (ms < 180) return '⚡ 神反応';
  if (ms < 230) return '🔥 超はやい';
  if (ms < 290) return '😺 はやい';
  if (ms < 380) return '🐶 ふつう';
  return '🐢 のんびり';
}

/** 色の組み合わせ（待ち → 合図）。毎回変える */
const PALETTES = [
  { wait: '#d93a4a', go: '#1fbf6a', name: 'みどり' },
  { wait: '#2a3a8f', go: '#ffd23f', name: 'きいろ' },
  { wait: '#5b2a86', go: '#25c7d9', name: 'みずいろ' },
  { wait: '#3d3d3d', go: '#ff7a1a', name: 'オレンジ' },
];

const fmtMs = (ms) => (ms === FOUL ? 'フライング' : ms >= 0 ? `${Math.round(ms)} ms` : '時間切れ');

class Reaction extends HostedGame {
  initState() {
    return {
      t: 0,
      go: REACT.READY + REACT.WAIT_MIN + Math.random() * (REACT.WAIT_MAX - REACT.WAIT_MIN), // 色が変わるゲーム内時刻
      pal: Math.floor(Math.random() * PALETTES.length),
      res: Array.from({ length: this.n }, () => null),
      revealed: false,
      revealT: 0,
      done: false,
    };
  }

  sanitize(r) {
    if (!r || typeof r !== 'object') return null;
    const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return {
      t: num(r.t, 0, -10, 3600),
      go: num(r.go, 5, REACT.READY, 60),
      pal: num(r.pal, 0, 0, PALETTES.length - 1) | 0,
      res: Array.from({ length: this.n }, (_, i) => this._cleanRes(Array.isArray(r.res) ? r.res[i] : null)),
      revealed: !!r.revealed,
      revealT: num(r.revealT, 0, -10, 3600),
      done: !!r.done,
    };
  }

  _cleanRes(v) {
    if (v === FOUL || v === TIMEOUT) return v;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.min(REACT.MAX_MS, Math.round(v));
    return null;
  }

  /** 毎回配る状態。だれが押したか（速さは発表まで見せない） */
  light() {
    const s = this.s;
    return { t: s.t, go: s.go, pal: s.pal, got: s.res.map((x) => (x === null ? 0 : x === FOUL ? 2 : 1)), rv: s.revealed ? s.res : null };
  }

  mergeLight(r) {
    const s = this.s;
    if (typeof r.go === 'number' && Number.isFinite(r.go)) s.go = Math.min(60, Math.max(REACT.READY, r.go));
    if (typeof r.pal === 'number') s.pal = Math.min(PALETTES.length - 1, Math.max(0, r.pal | 0));
    if (Array.isArray(r.got)) this._got = r.got;
    if (Array.isArray(r.rv) && !s.revealed) {
      s.res = Array.from({ length: this.n }, (_, i) => this._cleanRes(r.rv[i]));
      s.revealed = true;
    }
  }

  get phase() {
    const t = this.time;
    const s = this.s;
    if (s.revealed) return 'reveal';
    if (t < REACT.READY) return 'ready';
    if (t < s.go) return 'wait';
    return 'go';
  }

  step() {
    const s = this.s;
    if (!s.revealed) {
      const all = s.res.every((x) => x !== null);
      if (all || s.t >= s.go + REACT.LIMIT + REACT.GRACE) {
        s.res = s.res.map((x) => (x === null ? TIMEOUT : x));
        s.revealed = true;
        s.revealT = s.t;
      }
    }
    if (s.revealed && !s.done && s.t >= s.revealT + REACT.REVEAL) {
      s.done = true;
      this.ctx.finish(this.result());
    }
  }

  /** CPU: 反応の速さ（平均 よわい 340ms / ふつう 265ms / つよい 205ms）。たまにフライングする */
  cpuStep(i, level) {
    const s = this.s;
    if (s.revealed || s.res[i] !== null) return;
    const plan = ((this._cpu ||= {})[i] ||= {
      ms: Math.max(150, ({ 1: 340, 2: 265, 3: 205 }[level] || 265) + gauss() * ({ 1: 60, 2: 40, 3: 22 }[level] || 40)),
      foulAt: Math.random() < ({ 1: 0.08, 2: 0.04, 3: 0.02 }[level] || 0.04) ? REACT.READY + Math.random() * (s.go - REACT.READY) : null,
    });
    if (plan.foulAt !== null && s.t >= plan.foulAt && s.t < s.go) s.res[i] = FOUL;
    else if (s.t >= s.go + plan.ms / 1000) s.res[i] = Math.round(plan.ms);
  }

  onGameMessage(d, player) {
    if (!this.isHost) return;
    const s = this.s;
    if (s.revealed || !(player >= 0 && player < this.humans) || s.res[player] !== null) return;
    const v = this._cleanRes(d.r);
    if (v !== null) s.res[player] = v;
  }

  result() {
    const s = this.s;
    const ok = s.res.map((x) => x >= 0);
    const best = Math.min(...s.res.filter((x) => x >= 0), Infinity);
    const winners = s.res.map((x, i) => (x >= 0 && x === best ? i : -1)).filter((i) => i >= 0);
    const win = winners.length === 1 && this.n > 1 ? winners[0] : -1; // ひとりモードは勝ちボーナスなし
    const sortKey = (x) => (x >= 0 ? x : 1e9);
    const order = s.res.map((x, i) => i).sort((a, b) => sortKey(s.res[a]) - sortKey(s.res[b]));
    const rank = (i) => 1 + s.res.filter((x) => sortKey(x) < sortKey(s.res[i])).length;
    const pts = s.res.map((x, i) => reactionPoints(x, i === win));
    const solo = this.n === 1;
    return {
      gameId: 'reaction',
      winner: win >= 0 ? this.who(win).slot : null,
      title: solo
        ? `${fmtMs(s.res[0])}！ ${reactionRank(s.res[0])}`
        : win >= 0
          ? `${this.who(win).name}の勝ち！ ${Math.round(best)} ms`
          : best < Infinity
            ? `引き分け！ ${Math.round(best)} ms`
            : '全員失格…',
      course: '反応速度',
      players: s.res.map((x, i) => ({
        slot: this.who(i).slot,
        headline: solo ? reactionRank(x) : i === win ? '🏆 勝ち！' : win < 0 && x === best ? '🤝 引き分け' : !ok[i] ? reactionRank(x) : this.n === 2 ? '負け…' : `${rank(i)}位…`,
        detail: fmtMs(x),
      })),
      stats: [
        { label: '反応の速さ', values: s.res.map(fmtMs) },
        { label: '評価', values: s.res.map(reactionRank) },
        solo ? null : { label: '順位', text: order.map((i, k) => `${k + 1}. ${this.who(i).name}（${fmtMs(s.res[i])}）`).join('　') },
      ].filter(Boolean),
      score: [
        { label: '⚡ 速さ', values: s.res.map((x) => (x >= 0 ? `${Math.round(x)} ms → ${reactionPoints(x, false)}` : `${fmtMs(x)} → 0`)) },
        { label: '🏆 勝ちボーナス', values: s.res.map((x, i) => (i === win ? '+20' : '-')) },
        { label: '今回の合計', values: pts.map((p) => `${p} pt`) },
      ],
      points: pts,
      cpu: this.cpuSlots(),
    };
  }

  // ---- 画面 ----
  mount() {
    this.mine = null; // 自分の結果（送ったもの）
    this._shownAt = 0; // 色を画面に出した時刻（performance.now）
    this._lastPhase = '';
    this._lastSec = -1;
    const me = this.who(this.me);
    const o = this.ctx.options || {};
    const races = o.races > 1 ? `第${o.round || 1}戦 / 全${o.races}戦　` : '';
    this.el = {
      round: h('div.g2d-round', null, `${races}⚡ 反応速度バトル`),
      prompt: h('div.g2d-prompt', null, ''),
      sub: h('div.g2d-sub', null, ''),
      big: h('div.rx-big', null, ''),
      mine: h('div.rx-mine', null, ''),
      players: h('div.rx-players', null),
      foot: h('div.g2d-foot', { style: { color: me.col } }, `${me.icon} あなた（${me.name}）: 画面のどこでもクリック / タップ / スペースキー`),
    };
    this.root.classList.add('rx');
    this.root.append(
      h('div.g2d-head', null, this.el.round, this.el.prompt, this.el.sub),
      h('div.rx-stage', null, this.el.big, this.el.mine, this.el.players),
      this.el.foot,
    );
    this._onDown = (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      this._press(e.timeStamp);
    };
    this._onKey = (e) => {
      if (e.repeat || !(e.key === ' ' || e.key === 'Enter')) return;
      e.preventDefault();
      this._press(e.timeStamp);
    };
    this.root.addEventListener('pointerdown', this._onDown);
    window.addEventListener('keydown', this._onKey);
  }

  unmount() {
    this.root.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('keydown', this._onKey);
  }

  /** 押した。stamp: 押した時刻（イベントの timeStamp。performance.now と同じ時計） */
  _press(stamp) {
    if (this.paused || this.mine !== null) return;
    const ph = this.phase;
    if (ph === 'wait') {
      this.mine = FOUL;
      this.sound.play('miss');
    } else if (ph === 'go' && this._shownAt) {
      const at = stamp > 0 && Math.abs(stamp - performance.now()) < 5000 ? stamp : performance.now();
      this.mine = Math.max(0, Math.min(REACT.MAX_MS, Math.round(at - this._shownAt)));
      this.sound.play('perfect');
    } else return;
    this.sendToHost({ r: this.mine });
  }

  draw() {
    const s = this.s;
    if (!this.isHost && !this._rx) {
      this.el.prompt.textContent = '…';
      return;
    }
    const ph = this.phase;
    const t = this.time;
    const pal = PALETTES[s.pal] || PALETTES[0];
    if (ph !== this._lastPhase) {
      if (ph === 'wait') this.sound.play('ready');
      if (ph === 'go') {
        // この描画で色を出す。押すまでの時間は、ここから測る
        this._shownAt = performance.now();
        if (this.mine === null) this.sound.play('go');
      }
      if (ph === 'reveal') this.sound.play(this._iWon() ? 'finish' : 'lose');
      this._lastPhase = ph;
    }
    // 時間切れ（色が変わってから LIMIT 秒）
    if (ph === 'go' && this.mine === null && this._shownAt && performance.now() - this._shownAt > REACT.LIMIT * 1000) {
      this.mine = TIMEOUT;
      this.sendToHost({ r: TIMEOUT });
    }
    let bg;
    let big;
    let prompt;
    let sub;
    if (ph === 'ready') {
      const sec = Math.ceil(REACT.READY - t);
      if (sec !== this._lastSec) this.sound.play('beep');
      this._lastSec = sec;
      bg = '';
      prompt = `画面が「${pal.name}」に変わったらすぐ押せ！`;
      sub = '色が変わる前に押すとフライング（失格）';
      big = `準備… ${sec}`;
    } else if (ph === 'wait') {
      bg = pal.wait;
      prompt = 'まだ…';
      sub = `${pal.name}になったら押す！`;
      big = this.mine === FOUL ? '💥 フライング！' : 'まだ押すな…';
    } else if (ph === 'go') {
      bg = pal.go;
      prompt = '今だ！';
      sub = '';
      big = this.mine === null ? '押せ！！' : this.mine >= 0 ? `${this.mine} ms` : this.mine === FOUL ? '💥 フライング！' : '⌛ 時間切れ';
    } else {
      bg = '';
      prompt = '結果発表';
      sub = this.n > 1 ? (this._iWon() ? '🏆 あなたがいちばん速い！' : '') : '';
      big = fmtMs(s.res[this.me]);
    }
    this.root.style.setProperty('--rx-bg', bg || 'transparent');
    this.root.classList.toggle('is-color', !!bg);
    this.root.classList.toggle('is-go', ph === 'go');
    this.el.prompt.textContent = prompt;
    this.el.sub.textContent = sub;
    this.el.big.textContent = big;
    this.el.mine.textContent = ph === 'reveal' ? reactionRank(s.res[this.me]) : this.mine !== null ? reactionRank(this.mine) : '';
    this._drawPlayers(ph);
  }

  _iWon() {
    const r = this.s.res;
    const best = Math.min(...r.filter((x) => x >= 0), Infinity);
    return r[this.me] >= 0 && r[this.me] === best;
  }

  /** みんなの状態（押したか）→ 結果発表では速さ */
  _drawPlayers(ph) {
    const s = this.s;
    const key = ph === 'reveal' ? `rv${s.res.join(',')}` : `p${(this.isHost ? s.res.map((x) => (x === null ? 0 : x === FOUL ? 2 : 1)) : this._got || []).join(',')}${this.mine}`;
    if (key === this._pKey) return;
    this._pKey = key;
    const best = Math.min(...s.res.filter((x) => x >= 0), Infinity);
    const chips = s.res.map((x, i) => {
      const p = this.who(i);
      if (ph === 'reveal') {
        const win = x >= 0 && x === best;
        return h(`div.g2d-res${win ? '.best' : ''}`, { style: { '--c': p.col } }, win ? '👑 ' : '', `${p.icon} ${p.name}　`, h('b', null, fmtMs(x)), h('small', null, `　${reactionRank(x)}`));
      }
      const got = i === this.me ? (this.mine === null ? 0 : this.mine === FOUL ? 2 : 1) : this.isHost ? (x === null ? 0 : x === FOUL ? 2 : 1) : (this._got || [])[i] || 0;
      return h('div.g2d-res', { style: { '--c': p.col } }, `${p.icon} ${p.name}　`, h('b', null, got === 0 ? '…' : got === 2 ? '💥' : '✅'));
    });
    this.el.players.replaceChildren(h('div.g2d-results', null, chips));
  }
}
