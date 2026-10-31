// レースの「計算役」（権威）。人間の操作を受け取り、60Hz で計算して、配信用の状態とイベントを作る。
// ブラウザ（ホストが計算するとき）と、Cloudflare のサーバー（worker/relay/game.js）の両方で、同じものを使う。
// 画面・音・Three.js には一切依存しない。

import { NET, IN } from './constants.js';
import { Track } from './track.js';
import { RaceSim, packNet, packNetBin } from './race.js';

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
    return Array.from({ length: this.sim.humans }, () => ({
      queue: [],
      held: 0, // 最後にわかっている押しっぱなしの操作（届いていない tick はこれで代用する）
      lastSeq: 0, // 受け取った最新の seq
      next: null, // 次の tick に使う seq（null: まだ合わせていない）
      carry: 0, // 遅れて届いた「押した瞬間」の入力（次の tick に使う）
      minLead: Infinity, // 直近の区切りで、届いた入力がどれだけ先に届いていたか（tick）の最小
      adjN: 0,
      highN: 0, // 余裕がありすぎる区切りが続いた回数
    }));
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
      g.carry = 0;
      g.next = null;
      g.minLead = Infinity;
    });
  }

  /** 人 player（車の番号）から届いた入力（直近の複数 tick 分が重なって届く） */
  receiveInput(player, seq, inputs) {
    const g = this.gq[player];
    if (!g || !Array.isArray(inputs) || !inputs.length) return;
    const n = inputs.length;
    if (g.next === null) g.next = Math.max(g.lastSeq + 1, seq - n + 1);
    for (let i = 0; i < n; i++) {
      const sq = seq - n + 1 + i;
      if (sq <= g.lastSeq) continue; // 重なって届いた分・古い入力は無視
      g.lastSeq = sq;
      const bits = inputs[i] & 255;
      if (sq < g.next) {
        // その tick はもう計算済み（届く前に「押しっぱなし」で代用した）。押した瞬間の入力だけ次に回す
        g.carry |= bits & IN.ONESHOT;
        g.held = bits & IN.HELD;
        continue;
      }
      g.queue.push({ seq: sq, bits });
    }
    // 最新の入力は送る直前に作られたもの。それが使われるまでの余裕（tick）を測り、遅れの揺れに合わせる
    if (seq >= g.next - 60) g.minLead = Math.min(g.minLead, seq - g.next);
    if (g.queue.length > 120) g.queue.splice(0, g.queue.length - 120);
  }

  /**
   * 人 i の入力を 1 tick 分取り出す。
   * 送り手の seq と計算の tick を常に 1 対 1 で進める（届いていない tick は押しっぱなしで代用）。
   * こうすると、送り手の画面の予測とサーバーの結果が食い違わず、「進んでは戻される」動きにならない。
   * 遅れの揺れに合わせて、ときどき 1 tick だけ待つ・飛ばす。
   */
  _nextInput(i) {
    const g = this.gq[i];
    if (g.next === null) return g.held;
    if (++g.adjN >= NET.INPUT_ADJUST_TICKS) {
      const lead = g.minLead;
      g.adjN = 0;
      g.minLead = Infinity;
      g.highN = lead > NET.INPUT_LEAD_MAX && lead !== Infinity ? g.highN + 1 : 0;
      if (lead < 1) {
        // 入力が使う時刻より遅れて届いている: この tick は seq を進めずに待つ（予測とのずれは 1 tick 分だけ）
        // 大きく遅れているときは、次の判定を早める
        if (lead < -2) g.adjN = NET.INPUT_ADJUST_TICKS - 6;
        const bits = g.held | g.carry;
        g.carry = 0;
        return bits;
      }
      if (g.highN >= 4) {
        // 余裕がありすぎる状態が 2 秒続いた（操作の反映が遅い）: 1 tick 分飛ばす
        g.highN = 0;
        const e = g.queue[0]?.seq === g.next ? g.queue.shift() : null;
        if (e) {
          g.carry |= e.bits & IN.ONESHOT;
          g.held = e.bits & IN.HELD;
        }
        g.next++;
      }
    }
    // 大きく溜まった（端末が止まっていた等）ときは、一気に追いつく
    if (g.queue.length > NET.INPUT_BUFFER_MAX) {
      while (g.queue.length > 4) {
        const e = g.queue.shift();
        g.carry |= e.bits & IN.ONESHOT;
        g.held = e.bits & IN.HELD;
        g.next = e.seq + 1;
      }
    }
    while (g.queue.length && g.queue[0].seq < g.next) g.queue.shift();
    let bits;
    if (g.queue.length && g.queue[0].seq === g.next) {
      const e = g.queue.shift();
      g.held = e.bits & IN.HELD;
      bits = e.bits;
    } else {
      // まだ届いていない: 押しっぱなしで代用する。長く届かない（タブが裏に回った等）なら、押しっぱなしを解除する
      if (g.next - g.lastSeq > 40) g.held = 0;
      bits = g.held;
    }
    bits |= g.carry;
    g.carry = 0;
    this.sim.s.acks[i] = g.next;
    g.next++;
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

  /** 定期配信用のバイナリ（状態と、この配信に載せる演出イベント） */
  encodeBinary(ev) {
    return packNetBin(this.sim.s, ev);
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
