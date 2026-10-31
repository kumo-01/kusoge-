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
    this.slots = ctx.players; // 番号 → 部屋の席
    this.n = this.slots.length;
    this.sound = ctx.sound;
    this.paused = false;
    this.s = this.initState(ctx.options || {});
    this._rx = null; // ゲスト: 最後に受け取った時刻 { t, at }
    this.root = h('div.g2d');
    ctx.container.append(this.root);
    this.mount();
  }

  /** 番号 i の人の名前・色など */
  who(i) {
    const slot = this.slots[i] ?? i;
    return { slot, ...PLAYERS[slot], col: SLOT_COLORS[slot] || '#888' };
  }

  /** いまのゲーム内時刻（秒）。ゲストは最後に届いた時刻から、届いてからの経過を足して滑らかに進める */
  get time() {
    if (this.isHost || !this._rx) return this.s.t;
    return this._rx.t + (this.paused ? 0 : Math.min(1, (nowMs() - this._rx.at) / 1000));
  }

  update(dt) {
    if (!this.isHost || this.paused) return;
    this.s.t += dt;
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

/** 0〜1 の進み具合を、最初は速く最後はゆっくりに */
export const easeOut = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
export const easeInOut = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
