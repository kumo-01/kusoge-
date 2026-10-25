// レースの正本シミュレーション（ホストが実行）。
// 状態 this.s はシリアライズ可能なデータだけで構成し、Three.js のオブジェクトは一切持たない。

import { RACE, ITEMS, IN } from './constants.js';
import { createKart, stepKart, collideKarts } from './physics.js';
import { updateItems, useItem } from './items.js';
import { formatTime } from '../../core/util.js';

export class RaceSim {
  constructor(track) {
    this.track = track;
    this.boxPos = track.itemBoxes();
    this.events = [];
    this.reset();
  }

  reset() {
    const t = this.track;
    this.s = {
      v: 1,
      tick: 0,
      phase: 'countdown', // 'countdown' | 'racing' | 'finished'
      t: -RACE.COUNTDOWN, // レース時間（0 でスタート）
      endT: 0,
      winner: -1,
      karts: [createKart(0, t.startPos(0)), createKart(1, t.startPos(1))],
      boxes: this.boxPos.map(() => 0),
      proj: [],
      bananas: [],
      nextId: 1,
      rng: (Math.random() * 4294967296) >>> 0,
      bumpCd: 0,
      ack: 0, // 最後に適用したゲスト入力の seq
    };
  }

  /** 1 ステップ進める。inputs[0] = ホスト, inputs[1] = ゲスト */
  step(dt, inputs) {
    const s = this.s;
    const ev = this.events;
    const track = this.track;
    s.tick++;
    s.t += dt;
    if (s.phase === 'countdown' && s.t >= 0) {
      s.phase = 'racing';
      for (const k of s.karts) k.lapStart = 0;
      ev.push({ t: 'go' });
    }
    const active = s.phase === 'racing';
    const leader = this.leaderIndex();

    for (const k of s.karts) {
      const inp = inputs[k.i] | 0;
      if (active && inp & IN.ITEM) useItem(s, k, ev);
      if (active && inp & IN.RESPAWN) this.respawn(k);
      const wall = stepKart(k, inp, dt, track, active);
      if (wall > 7) {
        k.stats.walls++;
        ev.push({ t: 'wall', k: k.i, x: k.x, z: k.z, s: wall });
      }
      this.updateProgress(k);
      // 安全装置: 数値が壊れた・コース外に出すぎたら復帰
      const p = track.project(k.x, k.z);
      if (!Number.isFinite(k.x + k.z + k.h + k.sp) || Math.abs(p.lat) > track.wallDist + 3) {
        k.rc = 0;
        this.respawn(k);
      }
      // 逆走判定（表示用）
      const fwd = Math.sin(k.h) * p.tx + Math.cos(k.h) * p.tz;
      k.wrong = active && fwd < -0.35 && k.sp > 3 ? k.wrong + dt : Math.max(0, k.wrong - dt * 2);
    }

    // 車同士の衝突（ホストが判定）
    s.bumpCd = Math.max(0, s.bumpCd - dt);
    const [a, b] = s.karts;
    const hit = collideKarts(a, b);
    if (hit && hit.rel > 3 && s.bumpCd <= 0) {
      s.bumpCd = 0.35;
      const big = hit.rel > 13;
      const rammer = s.karts[hit.rammer];
      const victim = s.karts[1 - hit.rammer];
      rammer.bump = 0.35;
      victim.bump = big ? 0.7 : 0.45;
      victim.slow = Math.max(victim.slow, big ? 0.9 : 0.4);
      rammer.slow = Math.max(rammer.slow, 0.25);
      if (big) victim.vy = Math.max(victim.vy, 7);
      else victim.vy = Math.max(victim.vy, 2.5);
      if (hit.rel > 7) rammer.stats.bumps++;
      ev.push({ t: 'bump', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, s: hit.rel, big, r: rammer.i, v: victim.i });
    }

    updateItems(s, dt, track, this.boxPos, leader, ev);

    if (s.phase === 'finished') s.endT = Math.max(0, s.endT - dt);
  }

  /** チェックポイントと周回の判定。順番に通らないと周回数は増えない */
  updateProgress(k) {
    const s = this.s;
    const track = this.track;
    if (k.fin || s.phase !== 'racing') return;
    const N = track.checkpoints;
    const p = track.project(k.x, k.z);
    const next = (k.cp + 1) % N;
    const ds = track.wrapDS(p.s - track.cpS(next));
    if (ds >= 0 && ds < track.length / N / 2) {
      k.cp = next;
      if (next === 0) {
        k.lap++;
        const lapTime = s.t - k.lapStart;
        k.best = k.best ? Math.min(k.best, lapTime) : lapTime;
        k.lapStart = s.t;
        this.events.push({ t: 'lap', k: k.i, lap: k.lap });
        if (k.lap >= RACE.LAPS) {
          k.fin = 1;
          k.ft = s.t;
          if (s.winner < 0) {
            s.winner = k.i;
            s.phase = 'finished';
            s.endT = RACE.END_DELAY;
          }
          this.events.push({ t: 'finish', k: k.i });
        }
      }
    }
  }

  /** 最後に通過したチェックポイント付近へ復帰 */
  respawn(k) {
    if (k.rc > 0 || k.fin) return;
    const track = this.track;
    const s0 = k.lap === 0 && k.cp === 0 ? -9 : track.cpS(k.cp) + 3;
    const p = track.pointAt(s0, k.i === 0 ? 3 : -3);
    k.x = p.x;
    k.z = p.z;
    k.h = p.h;
    k.sp = 0;
    k.kx = 0;
    k.kz = 0;
    k.y = 1.5;
    k.vy = 2;
    k.spin = 0;
    k.boost = 0;
    k.inv = 1.5;
    k.rc = 2.5;
    this.events.push({ t: 'respawn', k: k.i });
  }

  progressOf(k) {
    const track = this.track;
    if (k.fin) return RACE.LAPS * track.length + 1e5 - k.ft;
    const p = track.project(k.x, k.z);
    const seg = track.length / track.checkpoints;
    const base = track.cpS(k.cp);
    const d = Math.max(-seg, Math.min(seg * 1.5, track.wrapDS(p.s - base)));
    return k.lap * track.length + base + d;
  }

  leaderIndex() {
    const [a, b] = this.s.karts;
    return this.progressOf(a) >= this.progressOf(b) ? 0 : 1;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  getSnapshot() {
    return structuredClone(this.s);
  }

  loadSnapshot(snap) {
    this.s = sanitizeSnapshot(snap, this.s, this.boxPos.length);
  }

  /** 結果画面用の成績 */
  buildResult() {
    const s = this.s;
    const [a, b] = s.karts;
    const winner = s.winner === 0 ? 'host' : s.winner === 1 ? 'guest' : this.leaderIndex() === 0 ? 'host' : 'guest';
    const name = { host: '柴犬', guest: 'コーギー' };
    const line = (k) => {
      const won = (winner === 'host' ? 0 : 1) === k.i;
      return {
        headline: won ? '🏆 1位' : '2位',
        detail: k.fin ? `ゴール ${formatTime(k.ft)}` : `ゴールならず（${Math.min(k.lap, RACE.LAPS)}/${RACE.LAPS}周）`,
      };
    };
    const stat = (label, f) => ({ label, host: f(a), guest: f(b) });
    return {
      gameId: 'dogKart',
      winner,
      title: `${name[winner]}の勝ち！ワン！`,
      host: line(a),
      guest: line(b),
      stats: [
        stat('順位', (k) => ((winner === 'host' ? 0 : 1) === k.i ? '1位' : '2位')),
        stat('走行時間', (k) => (k.fin ? formatTime(k.ft) : `${formatTime(Math.max(0, s.t))}（未ゴール）`)),
        stat('周回数', (k) => `${Math.min(k.lap, RACE.LAPS)} / ${RACE.LAPS}`),
        stat('ベストラップ', (k) => (k.best ? formatTime(k.best) : '-')),
        stat('体当たり成功', (k) => `${k.stats.bumps} 回`),
        stat('アイテム命中', (k) => `${k.stats.hits} 回`),
        stat('くらった回数', (k) => `${k.stats.hitBy} 回`),
        stat('使ったアイテム', (k) => `${k.stats.items} 個`),
        stat('壁ドン', (k) => `${k.stats.walls} 回`),
      ],
    };
  }
}

// ---- 受信スナップショットの検証（不正値でクラッシュしないように） ----
const num = (v, d = 0, lo = -1e6, hi = 1e6) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const int = (v, d = 0, lo = 0, hi = 1e9) => Math.round(num(v, d, lo, hi));

function sanitizeKart(r, i, prev) {
  const k = { ...prev };
  if (!r || typeof r !== 'object') return k;
  for (const f of ['x', 'z', 'y', 'vy', 'h', 'sp', 'kx', 'kz', 'st', 'th', 'spin', 'spinDur', 'boost', 'slow', 'inv', 'bump', 'roll', 'rc', 'wrong', 'ft', 'lapStart', 'best']) {
    k[f] = num(r[f], prev[f]);
  }
  k.spinDur = Math.max(0.1, k.spinDur);
  k.i = i;
  k.grass = r.grass ? 1 : 0;
  k.fin = r.fin ? 1 : 0;
  k.lap = int(r.lap, 0, 0, 99);
  k.cp = int(r.cp, 0, 0, RACE.CHECKPOINTS - 1);
  k.item = int(r.item, 0, 0, 3);
  const st = r.stats && typeof r.stats === 'object' ? r.stats : {};
  k.stats = {};
  for (const f of ['bumps', 'hits', 'hitBy', 'walls', 'items', 'boosts']) k.stats[f] = int(st[f], 0, 0, 1e6);
  return k;
}

export function sanitizeSnapshot(r, prev, boxCount) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.karts) || r.karts.length !== 2) return prev;
  const s = {
    v: 1,
    tick: int(r.tick, 0),
    phase: ['countdown', 'racing', 'finished'].includes(r.phase) ? r.phase : 'countdown',
    t: num(r.t, -RACE.COUNTDOWN, -10, 1e5),
    endT: num(r.endT, 0, 0, 10),
    winner: r.winner === 0 || r.winner === 1 ? r.winner : -1,
    karts: [sanitizeKart(r.karts[0], 0, prev.karts[0]), sanitizeKart(r.karts[1], 1, prev.karts[1])],
    boxes: Array.from({ length: boxCount }, (_, i) => num(Array.isArray(r.boxes) ? r.boxes[i] : 0, 0, 0, 60)),
    proj: [],
    bananas: [],
    nextId: int(r.nextId, 1),
    rng: int(r.rng, 1, 0, 4294967295) >>> 0,
    bumpCd: num(r.bumpCd, 0, 0, 5),
    ack: int(r.ack, 0),
  };
  if (Array.isArray(r.proj)) {
    for (const p of r.proj.slice(0, 32)) {
      if (!p || typeof p !== 'object') continue;
      s.proj.push({ id: int(p.id), o: p.o === 1 ? 1 : 0, x: num(p.x), z: num(p.z), vx: num(p.vx, 0, -200, 200), vz: num(p.vz, 0, -200, 200), life: num(p.life, 0, 0, 10), age: num(p.age, 0, 0, 10), b: int(p.b, 0, 0, 10) });
    }
  }
  if (Array.isArray(r.bananas)) {
    for (const b of r.bananas.slice(0, ITEMS.BANANA_MAX + 2)) {
      if (!b || typeof b !== 'object') continue;
      s.bananas.push({ id: int(b.id), o: b.o === 1 ? 1 : 0, x: num(b.x), z: num(b.z), life: num(b.life, 0, 0, 60), age: num(b.age, 0, 0, 60) });
    }
  }
  return s;
}

