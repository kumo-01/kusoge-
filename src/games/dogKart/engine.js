// レースの「計算役」（権威）。人間の操作を受け取り、60Hz で計算して、配信用の状態とイベントを作る。
// ブラウザ（ホストが計算するとき）と、Cloudflare のサーバー（worker/relay/game.js）の両方で、同じものを使う。
// 画面・音・Three.js には一切依存しない。

import { NET, IN } from './constants.js';
import { Track } from './track.js';
import { RaceSim, packNet } from './race.js';

export class DogKartEngine {
  /** @param {{ course?: number, npcs?: number, boss?: number, players?: number[], track?: Track }} options */
  constructor(options = {}) {
    this.track = options.track || new Track(options.course ?? 0);
    this.sim = new RaceSim(this.track, { npcs: options.npcs ?? 0, boss: options.boss ?? 0, players: options.players });
    this.gq = this._newQueues(); // 人（車の番号）ごとの入力キュー
    this.evSeq = 0;
    this.netEvents = [];
    this.finished = false;
  }

  _newQueues() {
    return Array.from({ length: this.sim.humans }, () => ({ queue: [], held: 0, lastSeq: 0, starved: true, starveTicks: 0, carry: 0 }));
  }

  /** 状態を読み込み直したあと（一時停止・巻き戻し）に、未処理の入力を捨てて、確定済みの seq から受け直す */
  resetQueues() {
    this.gq = this._newQueues();
    this.gq.forEach((g, i) => (g.lastSeq = this.sim.s.acks[i] || 0));
    this.finished = false;
    this.netEvents = [];
  }

  /** 一時停止中: 押しっぱなしを解除して、キューを空にする（再開時に古い入力が流れ込まないように） */
  clearQueues() {
    this.gq.forEach((g, i) => {
      g.queue = [];
      g.lastSeq = this.sim.s.acks[i] || 0;
      g.held = 0;
      g.starved = true;
    });
  }

  /** 人 player（車の番号）から届いた入力（直近の複数 tick 分が重なって届く） */
  receiveInput(player, seq, inputs) {
    const g = this.gq[player];
    if (!g || !Array.isArray(inputs)) return;
    const n = inputs.length;
    for (let i = 0; i < n; i++) {
      const sq = seq - n + 1 + i;
      if (sq <= g.lastSeq) continue; // 古い入力は無視
      g.queue.push({ seq: sq, bits: inputs[i] & 255 });
      g.lastSeq = sq;
    }
    if (g.queue.length > 120) g.queue.splice(0, g.queue.length - 120);
  }

  /** 人 i の入力をキューから 1 tick 分取り出す */
  _nextInput(i) {
    const g = this.gq[i];
    const q = g.queue;
    // 溜まりすぎたら古い入力を捨てて追いつく（押した瞬間の入力は引き継ぐ）
    if (q.length > NET.INPUT_BUFFER_MAX) {
      while (q.length > 2) {
        const e = q.shift();
        g.carry |= e.bits & IN.ONESHOT;
        this.sim.s.acks[i] = e.seq;
      }
    }
    if (!q.length || (g.starved && q.length < 2)) {
      g.starved = true;
      // 入力が途切れた（タブが裏に回った・通信が詰まった）ら、押しっぱなし扱いを解除する
      if (++g.starveTicks > 15) g.held = 0;
      return g.held;
    }
    g.starved = false;
    g.starveTicks = 0;
    const e = q.shift();
    g.held = e.bits & IN.HELD;
    this.sim.s.acks[i] = e.seq;
    const bits = e.bits | g.carry;
    g.carry = 0;
    return bits;
  }

  /**
   * 1 ステップ（1/60 秒）進める。
   * @param {Record<number, number>} [local] この端末で直接読んだ入力（車の番号 → ビット）。それ以外の人はキューから取る
   * @returns {object[]} このステップで起きた演出イベント（id つき）
   */
  step(dt, local = null) {
    const inputs = [];
    for (let i = 0; i < this.sim.humans; i++) inputs.push(local && local[i] !== undefined ? local[i] : this._nextInput(i));
    this.sim.step(dt, inputs);
    const ev = this.sim.drainEvents();
    // 定期配信は順不同のチャンネルで送るので、取りこぼしに備えて同じイベントを 3 回続けて載せる（受け手は id で重複を除く）
    for (const e of ev) {
      e.id = ++this.evSeq;
      this.netEvents.push({ e, n: 3 });
    }
    if (this.netEvents.length > 150) this.netEvents.splice(0, this.netEvents.length - 150);
    return ev;
  }

  drainNetEvents() {
    const out = [];
    for (const x of this.netEvents) {
      out.push(x.e);
      x.n--;
    }
    this.netEvents = this.netEvents.filter((x) => x.n > 0);
    return out;
  }

  /** 定期配信用に小さく詰めた状態 */
  encode() {
    return packNet(this.sim.s);
  }

  getSnapshot() {
    return this.sim.getSnapshot();
  }

  loadSnapshot(snap) {
    this.sim.loadSnapshot(snap);
    this.resetQueues();
  }

  /** 決着して演出時間が終わったら、結果を 1 度だけ返す（それ以外は null） */
  takeResult() {
    const s = this.sim.s;
    if (s.phase === 'finished' && s.endT <= 0 && !this.finished) {
      this.finished = true;
      return this.sim.buildResult();
    }
    return null;
  }
}
