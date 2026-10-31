// リズム刻みバトル: 「BPM 120 を刻め！」→ お手本を 4 拍聞いたら、あとは自分だけでそのテンポでクリック（タップ）し続ける。
// 指定の BPM にいちばん近く、安定して刻めた人の勝ち。ゲームが始まったら BGM は止める（刻むのを邪魔しないように）。
//
// 刻んだ時刻は各自の端末で測る（押した間隔だけを使うので、通信の遅れは入らない）。
// 計算はホスト（common2d.js）。ゲストは押した間隔（ミリ秒）の列をホストへ送る。

import { h } from '../../core/util.js';
import { HostedGame } from '../common2d.js';

export const RHY = {
  READY: 2.5, // お題を見せる時間（秒）
  GUIDE: 4, // お手本の拍の数
  GRACE: 1.2, // 通信の遅れで届く最後の結果を待つ（秒）
  REVEAL: 6.5, // 結果発表（秒）
  BPMS: [70, 90, 100, 120, 140, 160],
};

export function createGame() {
  return new Rhythm();
}

/**
 * 刻んだ間隔（ミリ秒）の列を採点する。
 * 各間隔の、お題の間隔からのずれ（%）の平均で決める。ずれ 0% で 100 点、平均 25% ずれで 0 点。
 * @returns {{ acc: number, bpm: number, dev: number, sd: number }}
 *   acc: 正確さ（0〜100、小数 1 桁）、bpm: 刻んだテンポ（平均の間隔から）、dev: 間隔の平均のずれ（%）、sd: 間隔のばらつき（ミリ秒）
 */
export function rhythmScore(iv, bpm) {
  const list = Array.isArray(iv) ? iv.filter((x) => Number.isFinite(x) && x > 0) : [];
  if (!list.length) return { acc: 0, bpm: 0, dev: 100, sd: 0 };
  const target = 60000 / bpm;
  const mean = list.reduce((a, x) => a + x, 0) / list.length;
  const dev = list.reduce((a, x) => a + Math.abs(x - target) / target, 0) / list.length;
  const sd = Math.sqrt(list.reduce((a, x) => a + (x - mean) ** 2, 0) / list.length);
  const acc = Math.max(0, Math.round((1 - dev / 0.25) * 1000) / 10);
  return { acc, bpm: Math.round((60000 / mean) * 10) / 10, dev: Math.round(dev * 1000) / 10, sd: Math.round(sd) };
}

/** 1 回分のポイント（正確さそのまま。勝った人は +20） */
export const rhythmPoints = (acc, win) => Math.round(acc) + (win ? 20 : 0);

class Rhythm extends HostedGame {
  initState(o) {
    const bpm = RHY.BPMS.includes(o.bpm) ? o.bpm : 120;
    const taps = [8, 16].includes(o.taps) ? o.taps : 8;
    return {
      t: 0,
      bpm,
      taps, // 刻む回数（間隔の数は taps - 1）
      res: Array.from({ length: this.ctx.players.length }, () => null), // 人ごとの間隔の列（ミリ秒）
      revealed: false,
      revealT: 0,
      done: false,
    };
  }

  /** お手本が終わって刻み始める時刻、刻み終わりの上限（ゲーム内時刻） */
  get beat() {
    return 60 / this.s.bpm;
  }
  get playStart() {
    return RHY.READY + RHY.GUIDE * this.beat;
  }
  get playEnd() {
    return this.playStart + this.s.taps * this.beat * 2 + 3;
  }

  sanitize(r) {
    if (!r || typeof r !== 'object') return null;
    const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return {
      t: num(r.t, 0, -10, 3600),
      bpm: RHY.BPMS.includes(r.bpm) ? r.bpm : 120,
      taps: [8, 16].includes(r.taps) ? r.taps : 8,
      res: Array.from({ length: this.n }, (_, i) => this._cleanRes(Array.isArray(r.res) ? r.res[i] : null)),
      revealed: !!r.revealed,
      revealT: num(r.revealT, 0, -10, 3600),
      done: !!r.done,
    };
  }

  _cleanRes(v) {
    if (!Array.isArray(v)) return null;
    return v
      .slice(0, 32)
      .filter((x) => typeof x === 'number' && Number.isFinite(x))
      .map((x) => Math.min(5000, Math.max(1, Math.round(x))));
  }

  light() {
    const s = this.s;
    return { t: s.t, bpm: s.bpm, taps: s.taps, got: s.res.map((x) => (x ? 1 : 0)), rv: s.revealed ? s.res : null };
  }

  mergeLight(r) {
    const s = this.s;
    if (RHY.BPMS.includes(r.bpm)) s.bpm = r.bpm;
    if ([8, 16].includes(r.taps)) s.taps = r.taps;
    if (Array.isArray(r.got)) this._got = r.got;
    if (Array.isArray(r.rv) && !s.revealed) {
      s.res = Array.from({ length: this.n }, (_, i) => this._cleanRes(r.rv[i]) || []);
      s.revealed = true;
    }
  }

  get phase() {
    const t = this.time;
    if (this.s.revealed) return 'reveal';
    if (t < RHY.READY) return 'ready';
    if (t < this.playStart) return 'listen';
    return 'play';
  }

  step() {
    const s = this.s;
    if (!s.revealed && (s.res.every(Boolean) || s.t >= this.playEnd + RHY.GRACE)) {
      s.res = s.res.map((x) => x || []);
      s.revealed = true;
      s.revealT = s.t;
    }
    if (s.revealed && !s.done && s.t >= s.revealT + RHY.REVEAL) {
      s.done = true;
      this.ctx.finish(this.result());
    }
  }

  onGameMessage(d, player) {
    if (!this.isHost) return;
    const s = this.s;
    if (s.revealed || !(player >= 0 && player < this.n) || s.res[player]) return;
    const v = this._cleanRes(d.iv);
    if (v) s.res[player] = v.slice(0, s.taps - 1);
  }

  result() {
    const s = this.s;
    const sc = s.res.map((iv) => rhythmScore(iv, s.bpm));
    const accs = sc.map((x) => x.acc);
    const best = Math.max(...accs);
    const tops = accs.map((a, i) => (a === best ? i : -1)).filter((i) => i >= 0);
    const win = tops.length === 1 && best > 0 && this.n > 1 ? tops[0] : -1; // ひとりモードは勝ちボーナスなし
    const rank = (i) => 1 + accs.filter((a) => a > accs[i]).length;
    const pts = accs.map((a, i) => rhythmPoints(a, i === win));
    const solo = this.n === 1;
    const tapped = (i) => (s.res[i] || []).length;
    return {
      gameId: 'rhythm',
      winner: win >= 0 ? this.who(win).slot : null,
      title: solo ? `正確さ ${best.toFixed(1)}%！` : win >= 0 ? `${this.who(win).name}の勝ち！正確さ ${best.toFixed(1)}%` : `引き分け！正確さ ${best.toFixed(1)}%`,
      course: `BPM ${s.bpm}`,
      players: sc.map((x, i) => ({
        slot: this.who(i).slot,
        headline: solo ? (x.acc >= 90 ? '🥁 リズムマスター' : x.acc >= 75 ? '🎵 いい感じ' : '🐶 もう少し') : i === win ? '🏆 勝ち！' : win < 0 && x.acc === best ? '🤝 引き分け' : this.n === 2 ? '負け…' : `${rank(i)}位…`,
        detail: tapped(i) ? `BPM ${x.bpm.toFixed(1)}（正確さ ${x.acc.toFixed(1)}%）` : '刻めず…',
      })),
      stats: [
        { label: 'お題', text: `BPM ${s.bpm}（1 拍 ${Math.round(60000 / s.bpm)} ms）を ${s.taps} 回` },
        { label: '刻んだテンポ', values: sc.map((x, i) => (tapped(i) ? `BPM ${x.bpm.toFixed(1)}` : '-')) },
        { label: '間隔の平均のずれ', values: sc.map((x, i) => (tapped(i) ? `${x.dev.toFixed(1)}%` : '-')) },
        { label: 'ばらつき', values: sc.map((x, i) => (tapped(i) ? `±${x.sd} ms` : '-')) },
        { label: '刻めた回数', values: s.res.map((iv) => `${(iv || []).length ? iv.length + 1 : 0} / ${s.taps} 回`) },
        { label: '計算式', text: '正確さ = 100 ×（1 − 間隔のずれの平均 ÷ 25%）。押した間隔ごとに、お題の 1 拍とのずれ（%）を測る' },
      ],
      score: [
        { label: '🥁 正確さ', values: accs.map((a) => `${a.toFixed(1)}% → ${Math.round(a)}`) },
        { label: '🏆 勝ちボーナス', values: accs.map((a, i) => (i === win ? '+20' : '-')) },
        { label: '今回の合計', values: pts.map((p) => `${p} pt`) },
      ],
      points: pts,
    };
  }

  // ---- 画面 ----
  mount() {
    this.taps = []; // 自分が押した時刻（performance.now の時計）
    this.sent = false;
    this._guided = false;
    this._lastPhase = '';
    this._lastSec = -1;
    this.ctx.music?.setHold(true); // ゲームが始まったら BGM を止める
    const me = this.who(this.me);
    const o = this.ctx.options || {};
    const races = o.races > 1 ? `第${o.round || 1}戦 / 全${o.races}戦　` : '';
    this.el = {
      round: h('div.g2d-round', null, `${races}🥁 リズム刻みバトル`),
      prompt: h('div.g2d-prompt', null, ''),
      sub: h('div.g2d-sub', null, ''),
      pad: h('div.rh-pad', null, h('div.rh-ring'), h('div.rh-label', null, '')),
      count: h('div.rh-count', null, ''),
      players: h('div.rh-players', null),
      foot: h('div.g2d-foot', { style: { color: me.col } }, `${me.icon} あなた（${me.name}）: 丸を押す（どこを押しても OK）/ スペースキー`),
    };
    this.root.classList.add('rh');
    this.root.append(
      h('div.g2d-head', null, this.el.round, this.el.prompt, this.el.sub),
      h('div.rh-stage', null, this.el.pad, this.el.count, this.el.players),
      this.el.foot,
    );
    this._onDown = (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      this._tap(e.timeStamp);
    };
    this._onKey = (e) => {
      if (e.repeat || !(e.key === ' ' || e.key === 'Enter')) return;
      e.preventDefault();
      this._tap(e.timeStamp);
    };
    this.root.addEventListener('pointerdown', this._onDown);
    window.addEventListener('keydown', this._onKey);
  }

  unmount() {
    this.root.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('keydown', this._onKey);
    this.ctx.music?.setHold(false);
  }

  _tap(stamp) {
    if (this.paused || this.sent || this.phase !== 'play') return;
    const at = stamp > 0 && Math.abs(stamp - performance.now()) < 5000 ? stamp : performance.now();
    this.taps.push(at);
    this.sound.play('tick');
    this._flashAt = performance.now();
    if (this.taps.length >= this.s.taps) this._submit();
  }

  _submit() {
    if (this.sent) return;
    this.sent = true;
    const iv = this.taps.slice(1).map((x, i) => Math.round(x - this.taps[i]));
    this.sendToHost({ iv });
  }

  draw() {
    const s = this.s;
    if (!this.isHost && !this._rx) {
      this.el.prompt.textContent = '…';
      return;
    }
    const ph = this.phase;
    const t = this.time;
    const beat = this.beat;
    if (ph !== this._lastPhase) {
      if (ph === 'listen' && !this._guided) {
        // お手本の拍を、音の時計で予約する（描画のぶれに左右されない）
        this._guided = true;
        for (let i = 0; i < RHY.GUIDE; i++) this.sound.metro(RHY.READY + i * beat - t, i === 0);
      }
      if (ph === 'play') this.sound.play('go');
      if (ph === 'reveal') this.sound.play(this._iWon() ? 'finish' : 'lose');
      this._lastPhase = ph;
    }
    // 時間切れ: 押したところまでで送る
    if (ph === 'play' && !this.sent && t > this.playEnd) this._submit();

    let prompt = `BPM ${s.bpm} を刻め！`;
    let sub = '';
    let label = '';
    let pulse = 0;
    let count = '';
    if (ph === 'ready') {
      const sec = Math.ceil(RHY.READY - t);
      if (sec !== this._lastSec) this.sound.play('beep');
      this._lastSec = sec;
      sub = `お手本を ${RHY.GUIDE} 拍聞いたら、あとは自分だけで ${s.taps} 回刻む（1 拍 ${Math.round(60000 / s.bpm)} ms）`;
      label = `よーい… ${sec}`;
    } else if (ph === 'listen') {
      const k = Math.floor((t - RHY.READY) / beat);
      const f = (t - RHY.READY) / beat - k;
      pulse = Math.max(0, 1 - f * 2.5);
      sub = '🎧 お手本をよく聞いて…（まだ押さない）';
      label = `${Math.min(RHY.GUIDE, k + 1)}`;
      count = '●'.repeat(Math.min(RHY.GUIDE, k + 1)) + '○'.repeat(Math.max(0, RHY.GUIDE - k - 1));
    } else if (ph === 'play') {
      const n = this.taps.length;
      sub = this.sent ? 'ほかの人を待っています…' : 'お手本は止まった！同じテンポで押し続けろ';
      label = this.sent ? '✅' : n === 0 ? '押せ！' : `${n}`;
      count = this.sent ? `${n} / ${s.taps} 回 おわり` : `あと ${s.taps - n} 回`;
      pulse = this._flashAt ? Math.max(0, 1 - (performance.now() - this._flashAt) / 180) : 0;
    } else {
      prompt = `お題 BPM ${s.bpm}`;
      sub = '結果発表';
    }
    this.el.prompt.textContent = prompt;
    this.el.sub.textContent = sub;
    this.el.pad.querySelector('.rh-label').textContent = label;
    this.el.pad.style.setProperty('--p', pulse.toFixed(3));
    this.root.classList.toggle('is-play', ph === 'play' && !this.sent);
    this.root.classList.toggle('is-listen', ph === 'listen');
    this.root.classList.toggle('is-reveal', ph === 'reveal');
    this.el.count.textContent = count;
    this._drawPlayers(ph);
  }

  _iWon() {
    const accs = this.s.res.map((iv) => rhythmScore(iv, this.s.bpm).acc);
    return accs[this.me] > 0 && accs[this.me] === Math.max(...accs);
  }

  /** みんなの状態 → 結果発表では、刻んだ間隔のグラフと正確さ */
  _drawPlayers(ph) {
    const s = this.s;
    const got = this.isHost ? s.res.map((x) => (x ? 1 : 0)) : this._got || [];
    const key = ph === 'reveal' ? 'rv' : `p${got.join(',')}${this.sent}`;
    if (key === this._pKey) return;
    this._pKey = key;
    if (ph !== 'reveal') {
      this.el.players.replaceChildren(h('div.g2d-results', null, s.res.map((_, i) => {
        const p = this.who(i);
        const done = i === this.me ? this.sent : got[i];
        return h('div.g2d-res', { style: { '--c': p.col } }, `${p.icon} ${p.name}　`, h('b', null, done ? '✅' : '🥁'));
      })));
      return;
    }
    const target = 60000 / s.bpm;
    const accs = s.res.map((iv) => rhythmScore(iv, s.bpm).acc);
    const best = Math.max(...accs);
    this.el.players.replaceChildren(h('div.rh-board', null, s.res.map((iv, i) => {
      const p = this.who(i);
      const sc = rhythmScore(iv, s.bpm);
      const win = sc.acc > 0 && sc.acc === best;
      return h(`div.rh-row${win ? '.best' : ''}`, { style: { '--c': p.col } },
        h('div.rh-name', null, win ? '👑 ' : '', `${p.icon} ${p.name}`),
        h('div.rh-graph', { html: graphSvg(iv || [], target) }),
        h('div.rh-num', null, h('b', null, `${sc.acc.toFixed(1)}%`), h('small', null, (iv || []).length ? `BPM ${sc.bpm.toFixed(1)}・ずれ ${sc.dev.toFixed(1)}%` : '刻めず')));
    })), h('p.rh-legend', null, `グラフ: 押した間隔（真ん中の線 = お題の 1 拍 ${Math.round(target)} ms。上は遅い・下は速い）`));
  }
}

/** 押した間隔のグラフ（SVG の文字列）。真ん中 = お題の間隔、上下 ±40% まで */
function graphSvg(iv, target) {
  const W = 160;
  const H = 44;
  const y = (x) => H / 2 - Math.max(-1, Math.min(1, (x - target) / target / 0.4)) * (H / 2 - 3);
  const xs = (i) => (iv.length > 1 ? 6 + (i * (W - 12)) / (iv.length - 1) : W / 2);
  const pts = iv.map((x, i) => `${xs(i).toFixed(1)},${y(x).toFixed(1)}`).join(' ');
  const dots = iv.map((x, i) => `<circle cx="${xs(i).toFixed(1)}" cy="${y(x).toFixed(1)}" r="2.6" fill="currentColor"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><rect x="0" y="0" width="${W}" height="${H}" rx="8" fill="#fff8ee"/><line x1="4" x2="${W - 4}" y1="${H / 2}" y2="${H / 2}" stroke="#d9c3a5" stroke-dasharray="3 3"/>${iv.length > 1 ? `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.6"/>` : ''}${dots}</svg>`;
}
