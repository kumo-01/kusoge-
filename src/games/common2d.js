// 2D のミニゲームの共通部分（お題 → 制限時間内に答える → 答え合わせ、の形のゲーム向け）。
//
// 計算はホストの端末（gameManager の固定ステップで update）。ゲストは操作をゲーム固有メッセージで送り、
// ホストから毎秒 30 回届く軽い状態（encodeNetSnapshot）を表示する。重いデータ（描いた線など）は
// 答え合わせのときに 1 回だけゲーム固有メッセージで配り、完全な状態（getSnapshot）にも入れて再接続で戻せるようにする。
//
// 派生クラスが実装するもの:
//   initState(options)        ホストの最初の状態（お題などを決める）。t（経過秒）を必ず持つ
//   sanitize(snap)            受け取った完全な状態を検証して返す
//   light()                   毎回配る軽い状態（t を含む）
//   mergeLight(snap)          軽い状態を自分の状態に取り込む
//   step(dt)                  ホストだけ: 1 tick 進める（フェーズの切り替え・結果の確定）
//   onGameMessage(data, player)  ホスト: ゲストの操作 / ゲスト: ホストからの配布
//   mount() / draw(dt) / unmount()  画面
//   cpuStep(i, level)         ホストだけ: CPU（番号 i）の動き（毎 tick）。ひとりモードで CPU を連れてきたときだけ呼ばれる
//
// CPU: ひとりモードの設定 cpu（0〜2 人）・cpuLevel（1 よわい / 2 ふつう / 3 つよい）。
// 人（ctx.players）のあとに、空いている席（コーギー・プードル）の CPU を並べる。CPU の番号は isCpu(i) で分かる。

import { h } from '../core/util.js';
import { PLAYERS } from '../screens/common.js';

/** 席ごとの色（赤・青・ピンク。部屋の表示と同じ） */
export const SLOT_COLORS = ['#ff4d5e', '#3d8bff', '#ff5fb0'];

const nowMs = () => performance.now();

export class HostedGame {
  start(ctx) {
    this.ctx = ctx;
    this.isHost = ctx.isHost;
    this.me = ctx.playerIndex; // 自分の番号（players の順。ホストは 0）
    // 番号 → 部屋の席。ひとりモードの CPU は、空いている席を使って人のあとに並べる
    const cpu = Math.max(0, Math.min(2, ctx.options?.cpu | 0));
    const free = [0, 1, 2].filter((x) => !ctx.players.includes(x));
    this.slots = [...ctx.players, ...free.slice(0, cpu)];
    this.humans = ctx.players.length; // 人の数（CPU は番号 humans 以降）
    this.cpuLevel = [1, 2, 3].includes(ctx.options?.cpuLevel) ? ctx.options.cpuLevel : 2;
    this.n = this.slots.length;
    this.sound = ctx.sound;
    this.paused = false;
    this.s = this.initState(ctx.options || {});
    this._rx = null; // ゲスト: 最後に受け取った時刻 { t, at }
    this.root = h('div.g2d');
    ctx.container.append(this.root);
    this.mount();
  }

  /** 番号 i が CPU か */
  isCpu(i) {
    return i >= this.humans;
  }

  /** 番号 i の人の名前・色など（CPU は名前に「（CPU）」） */
  who(i) {
    const slot = this.slots[i] ?? i;
    const p = PLAYERS[slot];
    return { slot, ...p, name: this.isCpu(i) ? `${p.name}（CPU）` : p.name, cpu: this.isCpu(i), col: SLOT_COLORS[slot] || '#888' };
  }

  /** 結果に載せる CPU の席（結果画面で「CPU」と出す） */
  cpuSlots() {
    return this.slots.filter((_, i) => this.isCpu(i));
  }

  /**
   * いまのゲーム内時刻（秒）。ゲストは最後に届いた時刻から、届いてからの経過を足して滑らかに進める。
   * 届く間隔のゆらぎで少し戻ることがあるが、戻すと「合図の直前」に逆戻りしてしまうので、戻さない（完全な状態を読み込んだときだけ戻す）
   */
  get time() {
    if (this.isHost || !this._rx) return this.s.t;
    const t = this._rx.t + (this.paused ? 0 : Math.min(1, (nowMs() - this._rx.at) / 1000));
    if (this._tMono == null || t > this._tMono) this._tMono = t;
    return this._tMono;
  }

  update(dt) {
    if (!this.isHost || this.paused) return;
    this.s.t += dt;
    if (this.cpuStep) for (let i = this.humans; i < this.n; i++) this.cpuStep(i, this.cpuLevel);
    this.step(dt);
  }

  getSnapshot() {
    return structuredClone(this.s);
  }

  loadSnapshot(snap) {
    const s = this.sanitize(snap);
    if (!s) return;
    this.s = s;
    this._rx = { t: s.t, at: nowMs() };
    this._tMono = null; // 完全な状態（再開・やり直し）のときは、その時刻に合わせ直す
    this.onState?.();
  }

  encodeNetSnapshot() {
    return this.light();
  }

  applyNetSnapshot(snap) {
    if (this.isHost || !snap || typeof snap !== 'object' || typeof snap.t !== 'number' || !Number.isFinite(snap.t)) return;
    if (this._rx && snap.t < this._rx.t - 0.001) return; // 順番が入れ替わって届いた古いもの
    this.mergeLight(snap);
    this.s.t = snap.t;
    this._rx = { t: snap.t, at: nowMs() };
    this.onState?.();
  }

  drainNetEvents() {
    return [];
  }

  onMessage(m) {
    if (m?.type === 'game_msg' && m.data && typeof m.data === 'object') this.onGameMessage(m.data, m.player);
  }

  /** 自分の操作をホストへ（ホスト自身はその場で処理する） */
  sendToHost(data) {
    if (this.isHost) this.onGameMessage(data, 0);
    else this.ctx.sendGameMessage(data);
  }

  /** ホストだけ: 全員へ配る（ホスト自身には届かないので、必要なら自分でも処理する） */
  broadcast(data) {
    if (this.isHost) this.ctx.sendGameMessage(data);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    if (this._rx) this._rx.at = nowMs();
  }

  render(alpha, dt) {
    // 右上のボタン（一時停止など。ホストは 2 段になることもある）の下端を CSS の --tb に。見出しはその下から始める
    const tb = document.querySelector('.game-topbar')?.getBoundingClientRect();
    const need = tb && tb.height ? Math.round(tb.bottom + 6) : 0;
    if (need !== this._tb) {
      this._tb = need;
      this.root.style.setProperty('--tb', `${need}px`);
    }
    this.draw(dt);
  }

  destroy() {
    this.unmount?.();
    this.root.remove();
  }
}

/** キャンバスを親要素の大きさ（端末の画素密度つき）に合わせる。戻り値: { w, h, dpr }（CSS ピクセル） */
export function fitCanvas(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr));
  const hh = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== hh) {
    canvas.width = w;
    canvas.height = hh;
  }
  return { w: r.width, h: r.height, dpr };
}

/**
 * 画面右上のボタン（一時停止・中止など。.game-topbar）がキャンバスの上に重なっている高さ（CSS ピクセル）。
 * 大事な表示（円・地図）は、この下に置く
 */
export function topbarInset(canvas) {
  const tb = document.querySelector('.game-topbar');
  if (!tb) return 0;
  const c = canvas.getBoundingClientRect();
  const t = tb.getBoundingClientRect();
  if (t.width < 1 || t.right <= c.left || t.left >= c.right || t.bottom <= c.top || t.top >= c.bottom) return 0;
  return Math.max(0, t.bottom - c.top + 6);
}

/** 平均 0・標準偏差 1 の乱数（CPU のぶれ） */
export function gauss() {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

/** CPU の強さの名前 */
export const CPU_LEVEL = { 1: 'よわい', 2: 'ふつう', 3: 'つよい' };

/** 0〜1 の進み具合を、最初は速く最後はゆっくりに */
export const easeOut = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
export const easeInOut = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
