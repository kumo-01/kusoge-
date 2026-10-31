// 人間感覚角度対決: 「〇〇度までもっていけ！」のお題に、円の外周のつまみを動かして角度を作る。近いほうが勝ち。
//
// 角度は、基準線（0°）から反時計回り（左回り）に測る。制限時間の間は何度でも直せる。
// 計算はホスト（common2d.js）。ゲストは自分の角度をホストへ送り、ホストは時間切れで締め切って答え合わせを配る。

import { h } from '../../core/util.js';
import { HostedGame, fitCanvas, topbarInset, easeOut, easeInOut } from '../common2d.js';

export const ANGLE = {
  READY: 2.5, // お題を見せてから操作できるまで（秒）
  GRACE: 0.8, // 時間切れのあと、通信の遅れで届く最後の操作を待つ（秒）
  REVEAL: 7.5, // 答え合わせの演出（秒）
  SEND_MS: 80, // ドラッグ中に角度を送る間隔
};

export function createGame() {
  return new AngleDuel();
}

/** 2 つの角度（度）の差（0〜180） */
export function angleError(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

/** 1 回分のポイント（ずれが小さいほど多い。勝った人は +20） */
export function anglePoints(err, win) {
  return Math.max(0, Math.round(100 - err * 2)) + (win ? 20 : 0);
}

const norm = (a) => ((Math.round(a) % 360) + 360) % 360;

const recent = []; // ホスト: 最近のお題（連戦で似た角度が続かないように）
function pickTarget() {
  let a = 0;
  for (let k = 0; k < 50; k++) {
    a = 5 + Math.floor(Math.random() * 351); // 5〜355°
    if (recent.every((r) => angleError(r, a) >= 20)) break;
  }
  recent.push(a);
  if (recent.length > 5) recent.shift();
  return a;
}

class AngleDuel extends HostedGame {
  initState(o) {
    const limit = [5, 10, 15, 20].includes(o.limit) ? o.limit : 10;
    return {
      t: 0,
      target: pickTarget(),
      base: o.base === 1 ? Math.floor(Math.random() * 360) : 0, // 基準線の向き（画面の右 = 0）
      limit,
      ans: Array.from({ length: this.ctx.players.length }, () => 0),
      revealed: false,
      done: false,
    };
  }

  sanitize(r) {
    if (!r || typeof r !== 'object') return null;
    const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return {
      t: num(r.t, 0, -10, 3600),
      target: norm(num(r.target, 90, 0, 359)),
      base: norm(num(r.base, 0, 0, 359)),
      limit: num(r.limit, 10, 3, 60),
      ans: Array.from({ length: this.n }, (_, i) => norm(num(Array.isArray(r.ans) ? r.ans[i] : 0, 0, 0, 359))),
      revealed: !!r.revealed,
      revealT: num(r.revealT, num(r.t, 0, -10, 3600), -10, 3600),
      done: !!r.done,
    };
  }

  /** 毎回配る状態。答えは答え合わせまで配らない（ほかの人の角度は見えない） */
  light() {
    const s = this.s;
    return { t: s.t, target: s.target, base: s.base, limit: s.limit, rv: s.revealed ? s.ans : null };
  }

  mergeLight(r) {
    const s = this.s;
    const ok = (v) => typeof v === 'number' && Number.isFinite(v);
    if (ok(r.target)) s.target = norm(r.target);
    if (ok(r.base)) s.base = norm(r.base);
    if (ok(r.limit)) s.limit = Math.min(60, Math.max(3, r.limit));
    if (Array.isArray(r.rv) && !s.revealed) {
      s.ans = Array.from({ length: this.n }, (_, i) => norm(ok(r.rv[i]) ? r.rv[i] : 0));
      s.revealed = true;
      this._revealAt = this.time;
    }
  }

  get phase() {
    const t = this.time;
    const s = this.s;
    if (s.revealed) return 'reveal';
    if (t < ANGLE.READY) return 'ready';
    if (t < ANGLE.READY + s.limit) return 'play';
    return 'judge';
  }

  step() {
    const s = this.s;
    if (!s.revealed && s.t >= ANGLE.READY + s.limit + ANGLE.GRACE) {
      s.revealed = true;
      s.revealT = s.t;
      this._revealAt = s.t;
    }
    if (s.revealed && !s.done && s.t >= (s.revealT ?? s.t) + ANGLE.REVEAL) {
      s.done = true;
      this.ctx.finish(this.result());
    }
  }

  onGameMessage(d, player) {
    if (!this.isHost) return;
    const s = this.s;
    // 時間切れ（と通信の遅れの猶予）までの操作だけ受け付ける
    if (s.revealed || s.t < ANGLE.READY - 0.3 || s.t > ANGLE.READY + s.limit + ANGLE.GRACE) return;
    if (typeof d.a === 'number' && Number.isFinite(d.a) && player >= 0 && player < this.n) s.ans[player] = norm(d.a);
  }

  result() {
    const s = this.s;
    const errs = s.ans.map((a) => angleError(a, s.target));
    const best = Math.min(...errs);
    const winners = errs.map((e, i) => (e === best ? i : -1)).filter((i) => i >= 0);
    const win = winners.length === 1 ? winners[0] : -1;
    const order = errs.map((e, i) => i).sort((a, b) => errs[a] - errs[b]);
    const rank = (i) => 1 + errs.filter((e) => e < errs[i]).length;
    const pts = errs.map((e, i) => anglePoints(e, i === win));
    const players = errs.map((e, i) => ({
      slot: this.who(i).slot,
      headline: i === win ? '🏆 勝ち！' : win < 0 && e === best ? '🤝 引き分け' : this.n === 2 ? '負け…' : `${rank(i)}位…`,
      detail: `${s.ans[i]}°（ずれ ${e}°）`,
    }));
    return {
      gameId: 'angleDuel',
      winner: win >= 0 ? this.who(win).slot : null,
      title: win >= 0 ? `${this.who(win).name}の勝ち！ずれ ${best}°` : `引き分け！ずれ ${best}°`,
      course: `お題 ${s.target}°`,
      players,
      stats: [
        { label: '作った角度', values: s.ans.map((a) => `${a}°`) },
        { label: 'ずれ', values: errs.map((e) => `${e}°`) },
        { label: '順位', text: order.map((i, k) => `${k + 1}. ${this.who(i).name}（${errs[i]}°）`).join('　') },
      ],
      score: [
        { label: '🎯 ずれ', values: errs.map((e) => `${e}° → ${Math.max(0, Math.round(100 - e * 2))}`) },
        { label: '🏆 勝ちボーナス', values: errs.map((e, i) => (i === win ? '+20' : '-')) },
        { label: '今回の合計', values: pts.map((p) => `${p} pt`) },
      ],
      points: pts,
    };
  }

  // ---- 画面 ----
  mount() {
    this.myA = 0; // 自分の角度（基準線から反時計回り）
    this.touched = false;
    this._lastSent = 0;
    this._sentA = null;
    this._lastPhase = '';
    this._lastSec = -1;
    const me = this.who(this.me);
    const o = this.ctx.options || {};
    const races = o.races > 1 ? `第${o.round || 1}戦 / 全${o.races}戦　` : '';
    this.el = {
      round: h('div.ang-round', null, `${races}🎯 人間感覚角度対決`),
      prompt: h('div.ang-prompt', null, ''),
      sub: h('div.ang-sub', null, '基準線から 反時計回り（左回り）に測ります'),
      timer: h('div.g2d-timer', null, h('div.g2d-timer-bar'), h('span.g2d-timer-num', null, '')),
      canvas: h('canvas.ang-canvas'),
      foot: h('div.ang-foot', { style: { color: me.col } }, `${me.icon} あなた（${me.name}）: 外周の丸をドラッグ、または円の中をタップして動かそう`),
    };
    this.root.classList.add('ang'); // 「ad」で始まる名前は広告ブロッカーに隠されるので使わない
    // 左の列（横長で低い画面のとき）にまとめる部品は .g2d-side に入れる（ふつうの画面では、上下にばらして並ぶ）
    this.root.append(h('div.g2d-side', null, h('div.ang-head.g2d-top', null, this.el.round, this.el.prompt, this.el.sub, this.el.timer), this.el.foot), this.el.canvas);
    const c = this.el.canvas;
    this._down = false;
    this._onDown = (e) => {
      if (this.phase !== 'play') return;
      this._down = true;
      c.setPointerCapture?.(e.pointerId);
      this._aim(e);
    };
    this._onMove = (e) => this._down && this._aim(e);
    this._onUp = (e) => {
      if (!this._down) return;
      this._down = false;
      this._aim(e);
      this._send(true);
    };
    c.addEventListener('pointerdown', this._onDown);
    c.addEventListener('pointermove', this._onMove);
    c.addEventListener('pointerup', this._onUp);
    c.addEventListener('pointercancel', this._onUp);
  }

  unmount() {
    const c = this.el.canvas;
    c.removeEventListener('pointerdown', this._onDown);
    c.removeEventListener('pointermove', this._onMove);
    c.removeEventListener('pointerup', this._onUp);
    c.removeEventListener('pointercancel', this._onUp);
  }

  _aim(e) {
    if (this.phase !== 'play' || this.paused) return;
    const r = this.el.canvas.getBoundingClientRect();
    const dx = e.clientX - r.left - this._cx;
    const dy = e.clientY - r.top - this._cy;
    if (Math.hypot(dx, dy) < 6) return;
    const abs = (Math.atan2(-dy, dx) * 180) / Math.PI; // 画面の右 = 0、反時計回りが正
    const a = norm(abs - this.s.base);
    if (a !== this.myA) {
      this.myA = a;
      if (!this.touched) this.sound.play('click');
      this.touched = true;
      this._send(false);
    }
  }

  _send(force) {
    const t = performance.now();
    if (this._sentA === this.myA) return;
    if (!force && t - this._lastSent < ANGLE.SEND_MS) return;
    this._lastSent = t;
    this._sentA = this.myA;
    this.sendToHost({ a: this.myA });
  }

  draw() {
    const s = this.s;
    if (!this.isHost && !this._rx) {
      this.el.prompt.textContent = '…'; // ホストから状態が届くまで（自分で決めた仮のお題は出さない）
      return;
    }
    const ph = this.phase;
    const t = this.time;
    // 送りそびれた最後の角度
    if (ph === 'play' && !this._down) this._send(true);
    if (ph !== this._lastPhase) {
      if (ph === 'play') this.sound.play('go');
      if (ph === 'judge') this.sound.play('lap');
      if (ph === 'reveal') this._revealAt ??= t;
      this._lastPhase = ph;
    }
    // 見出し
    this.el.prompt.textContent = `${s.target}° までもっていけ！`;
    const remain = ph === 'ready' ? ANGLE.READY - t : ph === 'play' ? ANGLE.READY + s.limit - t : 0;
    const sec = Math.ceil(Math.max(0, remain));
    if (sec !== this._lastSec && (ph === 'ready' || (ph === 'play' && sec <= 3))) this.sound.play('beep');
    this._lastSec = sec;
    this.el.timer.querySelector('.g2d-timer-num').textContent = ph === 'ready' ? `よーい… ${sec}` : ph === 'play' ? `のこり ${sec} 秒` : ph === 'judge' ? 'そこまで！' : '答え合わせ';
    this.el.timer.querySelector('.g2d-timer-bar').style.transform = `scaleX(${ph === 'play' ? Math.max(0, remain / s.limit) : ph === 'ready' ? 1 : 0})`;
    this.el.timer.classList.toggle('hurry', ph === 'play' && remain < 3);
    this.root.classList.toggle('is-play', ph === 'play');

    // キャンバス
    const c = this.el.canvas;
    const { w, h: hh, dpr } = fitCanvas(c);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    // 右上のボタンに重なる所は避ける（横長の画面では、キャンバスがボタンの下まで来る）
    let top = Math.min(hh * 0.4, topbarInset(c));
    // 見出し（お題・残り時間）が何かに隠されて見えないとき（拡張機能など）は、キャンバスの上に描く
    const headHidden = ph !== 'reveal' && this.el.prompt.offsetHeight === 0;
    if (headHidden) {
      const fy = top + 8;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillStyle = '#4a3426';
      g.font = '900 26px "M PLUS Rounded 1c", sans-serif';
      g.fillText(`${s.target}° までもっていけ！`, w / 2, fy);
      g.font = '800 16px "M PLUS Rounded 1c", sans-serif';
      g.fillStyle = ph === 'play' && remain < 3 ? '#e0344a' : '#7a6152';
      g.fillText(this.el.timer.querySelector('.g2d-timer-num').textContent, w / 2, fy + 34);
      top = Math.min(hh * 0.45, fy + 60);
    }
    const ah = hh - top;
    // 答え合わせではラベルを外側に並べるので、円を少し小さく
    const R = Math.max(30, Math.min(w / 2, ah / 2) - (ph === 'reveal' ? 64 : 22));
    const cx = w / 2;
    const cy = top + ah / 2;
    this._cx = cx;
    this._R = R;
    this._cy = cy;
    const dir = (deg) => ((s.base + deg) * Math.PI) / 180; // 画面上の向き（反時計回り）
    const pt = (deg, r) => [cx + Math.cos(dir(deg)) * r, cy - Math.sin(dir(deg)) * r];

    // 円盤
    g.fillStyle = '#fffaf0';
    g.strokeStyle = '#e8d6bf';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // 回る向きの矢印（基準線の少し先）
    g.strokeStyle = 'rgba(122,97,82,0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, R * 0.22, -dir(8), -dir(70), true);
    g.stroke();
    const [ax, ay] = pt(70, R * 0.22);
    g.fillStyle = 'rgba(122,97,82,0.45)';
    g.beginPath();
    g.arc(ax, ay, 5, 0, Math.PI * 2);
    g.fill();

    const arm = (deg, col, width, knob, label, lr = R + 30) => {
      const [x, y] = pt(deg, R);
      g.strokeStyle = col;
      g.lineWidth = width;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(x, y);
      g.stroke();
      if (knob) {
        g.fillStyle = col;
        g.beginPath();
        g.arc(x, y, knob, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 3;
        g.stroke();
      }
      if (label) {
        const [lx0, ly0] = pt(deg, lr);
        const ly = Math.max(12, Math.min(hh - 12, ly0));
        g.font = '800 15px "M PLUS Rounded 1c", sans-serif';
        const tw = g.measureText(label).width / 2 + 4;
        const lx = Math.max(tw, Math.min(w - tw, lx0)); // 画面からはみ出さない
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 4;
        g.strokeStyle = '#fff';
        g.strokeText(label, lx, ly);
        g.fillStyle = col;
        g.fillText(label, lx, ly);
      }
    };
    const sector = (deg, col) => {
      if (deg <= 0) return;
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, R - 3, -dir(0), -dir(deg), true);
      g.closePath();
      g.fill();
    };

    // 基準線
    arm(0, '#7a6152', 5, 0, '');
    const [bx, by] = pt(0, R * 0.62);
    g.font = '800 13px "M PLUS Rounded 1c", sans-serif';
    g.fillStyle = '#7a6152';
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.save();
    g.translate(bx, by);
    let rot = -dir(0);
    if (Math.cos(rot) < 0) rot += Math.PI;
    g.rotate(rot);
    g.fillText('0°（ここから）', 0, -6);
    g.restore();

    if (ph !== 'reveal') {
      const me = this.who(this.me);
      if (ph !== 'ready') {
        sector(this.myA, me.col + '22');
        arm(this.myA, me.col, 6, 16, '');
      }
    } else {
      // 答え合わせ: お題の線が 0° から回って出てくる → みんなの線とずれ
      const rt = t - (this._revealAt ?? t);
      const sweep = easeInOut(rt / 1.6);
      const cur = s.target * sweep;
      sector(cur, 'rgba(255,210,63,0.30)');
      arm(cur, '#f0a500', 8, 13, `${Math.round(cur)}°`, R * 0.62);
      const errs = s.ans.map((a) => angleError(a, s.target));
      const best = Math.min(...errs);
      const labels = [];
      s.ans.forEach((a, i) => {
        const appear = easeOut((rt - 1.9 - i * 0.45) / 0.5);
        if (appear <= 0) return;
        const p = this.who(i);
        g.globalAlpha = appear;
        arm(a, p.col, 5, 11 * appear, '');
        g.globalAlpha = 1;
        const [x, y] = pt(a, R + 24);
        labels.push({ text: `${p.name} ${a}°`, col: p.col, x, y, alpha: appear });
      });
      // 名前のラベル: 画面からはみ出さず、重ならないように上下にずらす
      g.font = '800 15px "M PLUS Rounded 1c", sans-serif';
      const LH = 19;
      for (const L of labels) {
        L.hw = g.measureText(L.text).width / 2 + 4;
        L.x = Math.max(L.hw, Math.min(w - L.hw, L.x));
        L.y = Math.max(top + 10, Math.min(hh - 10, L.y));
      }
      labels.sort((a, b) => a.y - b.y);
      for (let k = 0; k < 3; k++) {
        for (let i = 1; i < labels.length; i++) {
          const A = labels[i - 1];
          const B = labels[i];
          if (B.y - A.y < LH && Math.abs(B.x - A.x) < A.hw + B.hw) B.y = A.y + LH;
        }
        const last = labels[labels.length - 1];
        if (last && last.y > hh - 10) {
          const d = last.y - (hh - 10);
          for (const L of labels) L.y -= d;
        }
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 4;
      for (const L of labels) {
        g.globalAlpha = L.alpha;
        g.strokeStyle = '#fff';
        g.strokeText(L.text, L.x, L.y);
        g.fillStyle = L.col;
        g.fillText(L.text, L.x, L.y);
      }
      g.globalAlpha = 1;
      // お題と、ずれの小さい順の結果（結果は画面下に）
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#4a3426';
      g.font = '900 22px "M PLUS Rounded 1c", sans-serif';
      g.fillText(`お題 ${s.target}°`, cx, Math.max(16, cy - R - 40));
      if (rt > 1.9 + this.n * 0.45 + 0.3 && !this._fanfare) {
        this._fanfare = true;
        this.sound.play(errs[this.me] === best ? 'finish' : 'lose');
        const lines = s.ans.map((a, i) => ({ i, e: errs[i] })).sort((x, y) => x.e - y.e);
        this.el.foot.replaceChildren(
          h('div.g2d-results', null,
            lines.map((x) => {
              const p = this.who(x.i);
              return h(`div.g2d-res${x.e === best ? '.best' : ''}`, { style: { '--c': p.col } }, x.e === best ? '👑 ' : '', `${p.name}`, h('b', null, ` ずれ ${x.e}°`), h('small', null, `（${s.ans[x.i]}°）`));
            })),
        );
      }
    }
  }
}
