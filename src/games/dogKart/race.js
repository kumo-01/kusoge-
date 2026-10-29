// レースの正本シミュレーション（ホストが実行）。
// 状態 this.s はシリアライズ可能なデータだけで構成し、Three.js のオブジェクトは一切持たない。
// 車は 0 = ホスト, 1 = ゲスト, 2 以降 = NPC。

import { RACE, ITEMS, IN, RAIN, TIMING, FOOD, SCORE } from './constants.js';
import { createKart, stepKart, collideKarts } from './physics.js';
import { updateItems, useItem, spinKart } from './items.js';
import { npcInput, ownerInput } from './npc.js';
import { stepTiming, pickChances } from './timing.js';
import { formatTime } from '../../core/util.js';

export const KART_NAMES = ['柴犬', 'コーギー', 'プードル', 'パグ', 'ダックス', 'ハスキー'];
export const BOSS_NAME = 'ドーベルマン';

/** 車の名前（ボス犬は台数に関係なく専用の名前） */
export const kartName = (k) => (k?.boss ? BOSS_NAME : KART_NAMES[k?.i] || '');

export class RaceSim {
  /** @param {{ npcs?: number, boss?: number }} options npcs: ふつうの NPC の台数, boss: ボス犬を出すか */
  constructor(track, options = {}) {
    this.track = track;
    this.boxPos = track.itemBoxes();
    this.events = [];
    this.boss = options.boss ? 1 : 0;
    this.npcs = Math.max(0, Math.min(RACE.MAX_NPCS - 1, options.npcs | 0)) + this.boss;
    this.prog = [];
    this.reset();
  }

  reset() {
    const t = this.track;
    const n = RACE.HUMANS + this.npcs;
    this.s = {
      v: 2,
      tick: 0,
      phase: 'countdown', // 'countdown' | 'racing' | 'finished'
      t: -RACE.COUNTDOWN, // レース時間（0 でスタート）
      endT: 0,
      winner: -1,
      karts: Array.from({ length: n }, (_, i) => createKart(i, t.startPos(i), !!this.boss && i === n - 1)),
      boxes: this.boxPos.map(() => 0),
      foods: t.foods.map(() => 0), // ドッグフードが次に出るまでの残り時間（0 なら落ちている）
      proj: [],
      bananas: [],
      nextId: 1,
      rng: (Math.random() * 4294967296) >>> 0,
      ack: 0, // 最後に適用したゲスト入力の seq
      tc: [], // タイミングブーストのチャンス地点（スタートからの走行距離）
      rain: 0, // 豪雨の残り時間
      rk: -1, // 豪雨を使った車
      houses: [], // 落ちてくる犬小屋
    };
    this.s.tc = pickChances(this.s, t.length);
  }

  /** 1 ステップ進める。inputs[0] = ホスト, inputs[1] = ゲスト（NPC の入力はここで作る） */
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
    this.prog = s.karts.map((k) => this.progressOf(k));

    s.rain = Math.max(0, s.rain - dt);
    for (let i = 0; i < s.foods.length; i++) if (s.foods[i] > 0) s.foods[i] = Math.max(0, s.foods[i] - dt);

    for (const k of s.karts) {
      let inp = k.npc ? npcInput(this, k, dt) : inputs[k.i] | 0;
      if (k.ow > 0) {
        // 飼い主モード: 飼い主が引っ張って自動で走る（操作はできない）。ゴールしたら終わり
        k.ow = active && !k.fin ? Math.max(0, k.ow - dt) : 0;
        if (k.ow > 0) {
          inp = ownerInput(this, k) | (inp & IN.TAP ? IN.TAP : 0);
          k.boost = Math.max(k.boost, 0.2);
          k.slow = 0;
          k.wet = 0;
          k.spin = 0;
        }
      }
      if (active) {
        stepTiming(k, this.prog[k.i], s.tc, !!(inp & IN.TAP), dt, ev);
      }
      if (active && inp & IN.ITEM) useItem(s, k, ev, this.prog, (u) => this.callRain(u));
      if (active && inp & IN.RESPAWN) this.respawn(k);
      const wall = stepKart(k, inp, dt, track, active);
      if (wall > 8) {
        k.stats.walls++;
        ev.push({ t: 'wall', k: k.i, x: k.x, z: k.z, s: wall });
      }
      this.updateProgress(k);
      if (active) this.collectFood(k);
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

    // 車同士の衝突（ホストが判定。全組み合わせ）
    const ks = s.karts;
    for (let i = 0; i < ks.length; i++) {
      for (let j = i + 1; j < ks.length; j++) {
        const a = ks[i];
        const b = ks[j];
        const hit = collideKarts(a, b);
        if (!hit || hit.rel <= 3) continue;
        if (a.ow > 0 !== b.ow > 0) {
          // 飼い主モードの車に触れた車ははね飛ばされる
          const ownerK = a.ow > 0 ? a : b;
          const other = a.ow > 0 ? b : a;
          if (other.bc <= 0) {
            other.bc = 0.35;
            if (spinKart(other, ITEMS.OWNER_SPIN, true)) {
              other.stats.hitBy++;
              ownerK.stats.hits++;
              ev.push({ t: 'hit', k: other.i, by: ownerK.i, x: other.x, z: other.z });
            } else {
              ev.push({ t: 'block', k: other.i, x: other.x, z: other.z });
            }
          }
          continue;
        }
        const rammer = hit.rammer === 0 ? a : b;
        const victim = hit.rammer === 0 ? b : a;
        if (rammer.bc > 0 && victim.bc > 0) continue;
        rammer.bc = victim.bc = 0.35;
        const big = hit.rel > 15;
        rammer.bump = 0.35;
        victim.bump = big ? 0.7 : 0.45;
        if (victim.gd > 0) {
          // ガード中は体当たりも 1 回防ぐ
          victim.gd = 0;
          victim.inv = Math.max(victim.inv, 0.8);
          ev.push({ t: 'block', k: victim.i, x: victim.x, z: victim.z });
        } else {
          victim.slow = Math.max(victim.slow, big ? 0.9 : 0.4);
          victim.vy = Math.max(victim.vy, big ? 7 : 2.5);
        }
        rammer.slow = Math.max(rammer.slow, 0.25);
        if (hit.rel > 8) rammer.stats.bumps++;
        ev.push({ t: 'bump', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, s: hit.rel, big, r: rammer.i, v: victim.i });
      }
    }

    updateItems(s, dt, track, this.boxPos, (i) => this.rankOf(i), ev);

    if (s.phase === 'finished') s.endT = Math.max(0, s.endT - dt);
  }

  /** ドッグフードを拾う。持てる数（FOOD.MAX）まで。いっぱいのときは通り過ぎる（他の車が拾える） */
  collectFood(k) {
    if (k.fd >= FOOD.MAX || (k.fin && !k.npc) || k.y > 1.2) return;
    const s = this.s;
    const foods = this.track.foods;
    const r2 = (FOOD.RADIUS + 0.4) ** 2;
    for (let j = 0; j < foods.length; j++) {
      if (s.foods[j] > 0) continue;
      const dx = k.x - foods[j].x;
      const dz = k.z - foods[j].z;
      if (dx * dx + dz * dz > r2) continue;
      s.foods[j] = FOOD.RESPAWN;
      k.fd++;
      k.stats.foods++;
      if (k.i < RACE.HUMANS) this.events.push({ t: 'food', k: k.i, n: k.fd, x: foods[j].x, z: foods[j].z });
      if (k.fd >= FOOD.MAX) break;
    }
  }

  /** チェックポイントと周回の判定。順番に通らないと周回数は増えない */
  updateProgress(k) {
    const s = this.s;
    const track = this.track;
    if ((k.fin && !k.npc) || s.phase !== 'racing') return;
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
        if (k.lap >= RACE.LAPS && !k.fin) {
          k.fin = 1;
          k.ft = s.t;
          // 勝敗は人間（ホスト・ゲスト）のうち先にゴールしたほう。NPC がゴールしてもレースは続く
          if (s.winner < 0 && !k.npc) {
            s.winner = k.i;
            s.phase = 'finished';
            s.endT = RACE.END_DELAY;
          }
          this.events.push({ t: 'finish', k: k.i });
        }
      }
    }
  }

  /** 豪雨を降らせる。使った車以外（ゴール済みの人間を除く）がしばらく遅くなる */
  callRain(k) {
    const s = this.s;
    s.rk = k.i;
    s.rain = RAIN.DURATION;
    for (const o of s.karts) {
      if (o === k || (o.fin && !o.npc) || o.ow > 0) continue;
      if (o.gd > 0) {
        o.gd = 0; // ガードで豪雨も 1 回防ぐ
        this.events.push({ t: 'block', k: o.i, x: o.x, z: o.z });
        continue;
      }
      o.wet = RAIN.SLOW_TIME;
    }
    this.events.push({ t: 'rain', k: k.i, x: k.x, z: k.z });
  }

  /** 最後に通過したチェックポイント付近へ復帰 */
  respawn(k) {
    if (k.rc > 0 || (k.fin && !k.npc)) return;
    const track = this.track;
    const s0 = k.lap === 0 && k.cp === 0 ? -10 : track.cpS(k.cp) + 3;
    const p = track.pointAt(s0, [5, -5, 1.5, -1.5, 8, -8][k.i] ?? 0);
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

  /** 車 i の順位（1 = 先頭）。全員（NPC 含む）の中での順位 */
  rankOf(i, prog = null) {
    const pr = prog || this.s.karts.map((k) => this.progressOf(k));
    let r = 1;
    for (let j = 0; j < pr.length; j++) if (j !== i && (pr[j] > pr[i] || (pr[j] === pr[i] && j < i))) r++;
    return r;
  }

  /** 人間 2 人のうち前にいるほう */
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

  /** 連戦のポイント: 総合順位ポイント + ドッグフード + 体当たり + アイテム命中 + ファステストラップ（人間 2 人それぞれ） */
  calcScores(prog = null) {
    const s = this.s;
    const pr = prog || s.karts.map((k) => this.progressOf(k));
    const humans = s.karts.slice(0, RACE.HUMANS);
    // ベストラップが 2 人のうち速かったほう（周回を終えている人だけ。同じタイムなら無し）
    const bests = humans.map((k) => (k.best > 0 ? k.best : Infinity));
    const fastest = bests[0] < bests[1] ? 0 : bests[1] < bests[0] ? 1 : -1;
    return humans.map((k) => {
      const rank = this.rankOf(k.i, pr);
      const rankPts = SCORE.RANK[Math.min(rank, SCORE.RANK.length) - 1] || 0;
      const foodPts = k.stats.foods * SCORE.FOOD;
      const bumpPts = k.stats.bumps * SCORE.BUMP;
      const hitPts = k.stats.hits * SCORE.HIT;
      const fastPts = fastest === k.i ? SCORE.FAST : 0;
      return { rank, rankPts, foods: k.stats.foods, foodPts, bumps: k.stats.bumps, bumpPts, hits: k.stats.hits, hitPts, fastPts, total: rankPts + foodPts + bumpPts + hitPts + fastPts };
    });
  }

  /** 結果画面用の成績 */
  buildResult() {
    const s = this.s;
    const [a, b] = s.karts;
    const winner = s.winner === 0 ? 'host' : s.winner === 1 ? 'guest' : this.leaderIndex() === 0 ? 'host' : 'guest';
    const name = { host: '柴犬', guest: 'コーギー' };
    const prog = s.karts.map((k) => this.progressOf(k));
    const total = s.karts.length;
    const winIdx = winner === 'host' ? 0 : 1;
    const line = (k) => ({
      headline: k.i === winIdx ? '🏆 勝ち！' : '負け…',
      detail: `${k.fin ? `ゴール ${formatTime(k.ft)}` : `ゴールならず（${Math.min(k.lap, RACE.LAPS)}/${RACE.LAPS}周）`}・総合 ${this.rankOf(k.i, prog)}位`,
    });
    const stat = (label, f) => ({ label, host: f(a), guest: f(b) });
    const stats = [
      stat('総合順位', (k) => `${this.rankOf(k.i, prog)}位 / ${total}台`),
      stat('走行時間', (k) => (k.fin ? formatTime(k.ft) : `${formatTime(Math.max(0, s.t))}（未ゴール）`)),
      stat('周回数', (k) => `${Math.min(k.lap, RACE.LAPS)} / ${RACE.LAPS}`),
      stat('ベストラップ', (k) => (k.best ? formatTime(k.best) : '-')),
      stat('ドッグフード', (k) => `${k.stats.foods} 個`),
      stat('体当たり成功', (k) => `${k.stats.bumps} 回`),
      stat('アイテム命中', (k) => `${k.stats.hits} 回`),
      stat('くらった回数', (k) => `${k.stats.hitBy} 回`),
      stat('使ったアイテム', (k) => `${k.stats.items} 個`),
      stat('壁ドン', (k) => `${k.stats.walls} 回`),
    ];
    if (total > 2) {
      const order = s.karts.map((k) => k.i).sort((x, y) => this.rankOf(x, prog) - this.rankOf(y, prog));
      const names = order.map((i, n) => `${n + 1}.${kartName(s.karts[i])}`);
      const half = Math.ceil(names.length / 2);
      stats.push({ label: '着順', host: names.slice(0, half).join(' '), guest: names.slice(half).join(' ') });
    }
    // ポイントの内訳
    const [ha, gu] = this.calcScores(prog);
    const row = (label, f) => ({ label, host: f(ha), guest: f(gu) });
    const score = [
      row('🏁 順位ポイント', (p) => `${p.rank}位 → ${p.rankPts}`),
      row('🍖 ドッグフード', (p) => `${p.foods}個 → ${p.foodPts}`),
      row('💥 体当たり成功', (p) => `${p.bumps}回 → ${p.bumpPts}`),
      row('🎯 アイテム命中', (p) => `${p.hits}回 → ${p.hitPts}`),
      row('⏱ ファステストラップ', (p) => (p.fastPts ? `+${p.fastPts}` : '-')),
      row('今回の合計', (p) => `${p.total} pt`),
    ];
    return {
      gameId: 'dogKart',
      winner,
      title: `${name[winner]}の勝ち！ワン！`,
      course: this.track.name,
      host: line(a),
      guest: line(b),
      stats,
      score,
      points: { host: ha.total, guest: gu.total },
    };
  }
}

// ---- 受信スナップショットの検証（不正値でクラッシュしないように） ----
const num = (v, d = 0, lo = -1e6, hi = 1e6) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const int = (v, d = 0, lo = 0, hi = 1e9) => Math.round(num(v, d, lo, hi));

function sanitizeKart(r, i, prev) {
  const k = { ...prev };
  if (!r || typeof r !== 'object') return k;
  for (const f of ['x', 'z', 'y', 'vy', 'h', 'sp', 'kx', 'kz', 'st', 'th', 'spin', 'spinDur', 'boost', 'slow', 'inv', 'bump', 'roll', 'rc', 'wrong', 'ft', 'lapStart', 'best', 'bc', 'al', 'at', 'as', 'tn']) {
    k[f] = num(r[f], prev[f] ?? 0);
  }
  k.tw = num(r.tw, 0, 0, TIMING.WINDOW);
  k.tb = int(r.tb, 0, 0, 2);
  k.wet = num(r.wet, 0, 0, RAIN.SLOW_TIME);
  k.ms = num(r.ms, 1, 0.5, 1.2);
  k.spinDur = Math.max(0.1, k.spinDur);
  k.i = i;
  k.npc = i >= RACE.HUMANS ? 1 : 0;
  k.grass = r.grass ? 1 : 0;
  k.fin = r.fin ? 1 : 0;
  k.lap = int(r.lap, 0, 0, 99);
  k.cp = int(r.cp, 0, 0, RACE.CHECKPOINTS - 1);
  k.item = int(r.item, 0, 0, ITEMS.COUNT - 1);
  k.ow = num(r.ow, 0, 0, ITEMS.OWNER_TIME);
  k.gd = num(r.gd, 0, 0, ITEMS.GUARD_TIME);
  k.fd = int(r.fd, 0, 0, FOOD.MAX);
  // stats は定期配信では省略されることがある（そのときは前回の値を使う）
  const st = r.stats && typeof r.stats === 'object' ? r.stats : prev.stats || {};
  k.stats = {};
  for (const f of ['bumps', 'hits', 'hitBy', 'walls', 'items', 'boosts', 'foods']) k.stats[f] = int(st[f], 0, 0, 1e6);
  return k;
}

/** ドッグフードの状態: 完全な状態は配列、定期配信は「取られている番号の一覧（foodTaken）」で届く */
function sanitizeFoods(r, prev) {
  const n = prev.foods?.length || 0;
  if (Array.isArray(r.foodTaken)) {
    const taken = new Set(r.foodTaken.filter((v) => Number.isInteger(v) && v >= 0 && v < n));
    return Array.from({ length: n }, (_, i) => (taken.has(i) ? 1 : 0));
  }
  return Array.from({ length: n }, (_, i) => num(Array.isArray(r.foods) ? r.foods[i] : 0, 0, 0, FOOD.RESPAWN));
}

export function sanitizeSnapshot(r, prev, boxCount) {
  const maxKarts = RACE.HUMANS + RACE.MAX_NPCS;
  if (!r || typeof r !== 'object' || !Array.isArray(r.karts) || r.karts.length < RACE.HUMANS || r.karts.length > maxKarts) return prev;
  const owner = (o) => (Number.isInteger(o) && o >= 0 && o < r.karts.length ? o : 0);
  const s = {
    v: 2,
    tick: int(r.tick, 0),
    phase: ['countdown', 'racing', 'finished'].includes(r.phase) ? r.phase : 'countdown',
    t: num(r.t, -RACE.COUNTDOWN, -10, 1e5),
    endT: num(r.endT, 0, 0, 10),
    winner: r.winner === 0 || r.winner === 1 ? r.winner : -1,
    karts: r.karts.map((rk, i) => sanitizeKart(rk, i, prev.karts[i] || createKart(i, { x: 0, z: 0, h: 0 }))),
    boxes: Array.from({ length: boxCount }, (_, i) => num(Array.isArray(r.boxes) ? r.boxes[i] : 0, 0, 0, 60)),
    foods: sanitizeFoods(r, prev),
    proj: [],
    bananas: [],
    nextId: int(r.nextId, 1),
    rng: int(r.rng, 1, 0, 4294967295) >>> 0,
    ack: int(r.ack, 0),
    tc: Array.isArray(r.tc) ? r.tc.slice(0, 2).map((v) => num(v, 0, 0, 1e5)) : prev.tc || [],
    rain: num(r.rain, 0, 0, RAIN.DURATION),
    rk: Number.isInteger(r.rk) && r.rk >= 0 && r.rk < r.karts.length ? r.rk : -1,
    houses: [],
  };
  if (Array.isArray(r.proj)) {
    for (const p of r.proj.slice(0, 32)) {
      if (!p || typeof p !== 'object') continue;
      s.proj.push({ id: int(p.id), o: owner(p.o), x: num(p.x), z: num(p.z), vx: num(p.vx, 0, -200, 200), vz: num(p.vz, 0, -200, 200), life: num(p.life, 0, 0, 10), age: num(p.age, 0, 0, 10), b: int(p.b, 0, 0, 10), f: p.f ? 1 : 0, t: Number.isInteger(p.t) && p.t >= 0 && p.t < r.karts.length ? p.t : -1, d: num(p.d, 0, 0, 1000) });
    }
  }
  if (Array.isArray(r.bananas)) {
    for (const b of r.bananas.slice(0, ITEMS.BANANA_MAX + 2)) {
      if (!b || typeof b !== 'object') continue;
      s.bananas.push({ id: int(b.id), o: owner(b.o), x: num(b.x), z: num(b.z), life: num(b.life, 0, 0, 60), age: num(b.age, 0, 0, 60) });
    }
  }
  if (Array.isArray(r.houses)) {
    const tgt = (t) => (Number.isInteger(t) && t >= 0 && t < r.karts.length ? t : 0);
    for (const h of r.houses.slice(0, ITEMS.HOUSE_MAX + 2)) {
      if (!h || typeof h !== 'object') continue;
      const age = num(h.age, 0, 0, 20);
      s.houses.push({ id: int(h.id), o: owner(h.o), t: tgt(h.t), x: num(h.x), z: num(h.z), age, hit: age >= ITEMS.HOUSE_DELAY ? 1 : 0 });
    }
  }
  return s;
}

// ---- 定期配信用のコンパクトな形式（キー名を省いて配列にする。通信量を約半分に） ----
const NET_KART_FIELDS = ['x', 'z', 'y', 'vy', 'h', 'sp', 'kx', 'kz', 'st', 'th', 'spin', 'spinDur', 'boost', 'slow', 'inv', 'bump', 'roll', 'rc', 'wrong', 'ft', 'lapStart', 'best', 'bc', 'ms', 'grass', 'fin', 'lap', 'cp', 'item', 'tw', 'tb', 'wet', 'gd', 'fd', 'ow'];
const PHASES = ['countdown', 'racing', 'finished'];

/** 定期配信用に詰める（stats や NPC の思考状態は省く） */
export function packNet(s) {
  return {
    p: 1,
    tick: s.tick,
    ph: PHASES.indexOf(s.phase),
    t: s.t,
    e: s.endT,
    w: s.winner,
    a: s.ack,
    tc: s.tc,
    rn: [s.rain, s.rk],
    k: s.karts.map((k) => NET_KART_FIELDS.map((f) => k[f])),
    b: s.boxes,
    fo: s.foods.reduce((a, t, i) => (t > 0 && a.push(i), a), []),
    pr: s.proj.map((p) => [p.id, p.o, p.x, p.z, p.vx, p.vz, p.life, p.age, p.b, p.f | 0, p.t ?? -1, p.d || 0]),
    bn: s.bananas.map((b) => [b.id, b.o, b.x, b.z, b.life, b.age]),
    hs: s.houses.map((h) => [h.id, h.o, h.t, h.x, h.z, h.age]),
  };
}

/** packNet の逆。形が崩れていても例外を出さず、検証は sanitizeSnapshot に任せる */
export function unpackNet(p) {
  if (!p || typeof p !== 'object' || p.p !== 1 || !Array.isArray(p.k)) return null;
  const row = (a, keys) => {
    const o = {};
    if (Array.isArray(a)) keys.forEach((f, i) => (o[f] = a[i]));
    return o;
  };
  return {
    tick: p.tick,
    phase: PHASES[p.ph],
    t: p.t,
    endT: p.e,
    winner: p.w,
    ack: p.a,
    tc: p.tc,
    rain: Array.isArray(p.rn) ? p.rn[0] : 0,
    rk: Array.isArray(p.rn) ? p.rn[1] : -1,
    karts: p.k.slice(0, RACE.HUMANS + RACE.MAX_NPCS).map((a) => row(a, NET_KART_FIELDS)),
    boxes: p.b,
    foodTaken: Array.isArray(p.fo) ? p.fo.slice(0, 400) : [],
    proj: Array.isArray(p.pr) ? p.pr.slice(0, 32).map((a) => row(a, ['id', 'o', 'x', 'z', 'vx', 'vz', 'life', 'age', 'b', 'f', 't', 'd'])) : [],
    houses: Array.isArray(p.hs) ? p.hs.slice(0, 8).map((a) => row(a, ['id', 'o', 't', 'x', 'z', 'age'])) : [],
    bananas: Array.isArray(p.bn) ? p.bn.slice(0, 16).map((a) => row(a, ['id', 'o', 'x', 'z', 'life', 'age'])) : [],
  };
}
