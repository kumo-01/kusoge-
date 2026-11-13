// 試合の正本（ホストの端末で計算する）。ラウンドの進み・体力・点数・輪ゴム・アイテム・CPU の犬。
// 人の犬の位置は、その人の端末が計算して送ってくる（setPilot）。CPU の犬はここで動かす。
// 起きたこと（撃った・当たった・倒れた・拾った…）は events に積み、ゲストへ配る。

import { ROUND, PLAYER, GUN, ITEM, ITEMS, SCORE, BAND_ITEMS, BOX_ITEMS, TREAT, FUN, EXTRA, BOT, WEAPON, WEAPONS, WEAPON_LIST, BOMB_COUNT, MODE, BOSS, HAIRBALL } from './constants.js';
import { ARENAS, segmentHit, ROOM, groundY } from './arena.js';
import { createBody, stepMove, stepBand, bandSpec, segCylinder, heightOf, aimDir, eyeOf, movableBox, shoveMovables, fits, weaponDamage, hitDamage, isHead } from './physics.js';
import { botThink } from './bot.js';

/** 決定的な乱数（状態に種を持つ） */
export function nextRandom(s) {
  let x = s.rng | 0 || 0x9e3779b9;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return s.rng / 4294967296;
}

export const PHASES = ['intro', 'play', 'end', 'done', 'pick'];

export class GomuSim {
  /** @param {{ humans: number, bots?: number, seed?: number, mode?: string, pick?: boolean }} o */
  constructor(o = {}) {
    this.humans = Math.max(1, Math.min(4, o.humans | 0 || 1));
    this.bots = Math.max(0, Math.min(BOT.MAX, o.bots | 0));
    this.mode = [MODE.TEAM, MODE.BOSS].includes(o.mode) ? o.mode : MODE.FFA;
    // チーム（番号ごと。0 = あか、1 = あお）。渡されなければ交互
    const n = this.humans + this.bots;
    this.teams = Array.from({ length: n }, (_, i) => (this.mode === MODE.TEAM ? (Array.isArray(o.teams) && (o.teams[i] === 0 || o.teams[i] === 1) ? o.teams[i] : i % 2) : -1));
    this.usePick = !!o.pick; // ラウンドの前に武器を選ぶ（ゲームでは使う。計算のテストでは飛ばす）
    this.events = [];
    this.shotLog = []; // 撃った人の端末で当たりを決める輪ゴムの記録（人ごと）
    this.clientJudge = null; // (i) => その人の輪ゴムの当たりを、その人の端末で決めるか
    this.s = {
      round: 0,
      phase: 'intro',
      t: -ROUND.INTRO,
      rng: Number.isInteger(o.seed) ? o.seed >>> 0 : (Math.random() * 4294967296) >>> 0,
      nextId: 1,
      players: Array.from({ length: this.humans + this.bots }, (_, i) => this._newPlayer(i)),
      teams: this.teams, // チーム（配信に載せる。ゲストはこれに合わせる）
      bands: [],
      boxes: [],
      gums: [],
      smokes: [],
      boss: null, // ボス戦の猫
      bossWon: [], // ラウンドごとに、猫を倒せたか
    };
    this._startRound(0);
  }

  get arena() {
    return ARENAS[this.s.round % ARENAS.length];
  }

  /** ぶつかる物すべて（家具 + 押せるもの）。押せるものは試合の状態 s.mov の箱そのもの */
  get cw() {
    if (!this._cw || this._cw.mov !== this.s.mov) this._cw = { boxes: [...this.arena.boxes, ...(this.s.mov || [])], mov: this.s.mov, water: this.arena.water, terrain: this.arena.terrain, terrainTop: this.arena.terrainTop, floorY: this.arena.floorY, pads: this.arena.pads, pipes: this.arena.pipes, geysers: this.arena.geysers };
    return this._cw;
  }

  /** a と b は敵どうしか（同じ犬・同じチーム・ボス戦の仲間は敵ではない） */
  foes(a, b) {
    if (a === b || a < 0 || b < 0) return a !== b; // 猫の毛玉（-1）は全員に当たる
    if (this.mode === MODE.BOSS) return false;
    if (this.mode === MODE.TEAM) return this.teams[a] !== this.teams[b];
    return true;
  }

  _newPlayer(i) {
    return {
      i,
      bot: i >= this.humans,
      weapon: WEAPON.NORMAL, // 武器（ラウンドの前に選ぶ）
      picked: false,
      bombs: BOMB_COUNT, // 残りの爆弾（ラウンドごとに BOMB_COUNT）
      hs: 0, // ヘッドショットの数（称号のため）
      longest: 0, // いちばん遠くから当てた距離
      treats: 0, // 拾ったおやつ
      pops: 0, // 割った風船
      bestStreak: 0, // いちばん長い連続撃破
      bombCd: 0, // 次の爆弾を投げられるまで
      ...createBody(),
      hp: PLAYER.HP,
      dead: 0, // 倒れてから復活までの残り時間
      inv: 0, // 無敵の残り
      star: 0, // 無敵スターの残り（見た目のため）
      stun: 0, // よろけの残り
      stuck: 0, // ネバネバで動けない残り
      shake: 0, // 照準ぶれの残り
      noAmmo: 0, // ゴム切れの残り
      ammo: GUN.AMMO,
      reload: 0,
      fireCd: 0,
      sp: 0, // 撃つゴムの種類（ゴムが変わるアイテム）
      spN: 0, // その残りの数
      item: 0,
      g: 0, // 復活した回数（古い位置の報告を捨てるため）
      score: 0,
      rs: Array(ROUND.COUNT).fill(0), // ラウンドごとの点
      hits: 0,
      kills: 0,
      deaths: 0,
      shots: 0,
      landed: 0, // 当たった輪ゴムの数
      moving: false,
      bot2: null, // CPU の考え
    };
  }

  /** ラウンドを始める（会場を変えて、全員を出発地点へ） */
  _startRound(r) {
    const s = this.s;
    s.round = r;
    s.phase = this.usePick ? 'pick' : 'intro';
    s.t = this.usePick ? -(ROUND.PICK + ROUND.INTRO) : -ROUND.INTRO;
    s.bands = [];
    s.gums = [];
    s.smokes = [];
    s.boxes = this.arena.items.map(() => 0);
    s.heals = (this.arena.heals || []).map(() => 0); // 回復のおやつ（0 = 出ている。正 = また出るまでの秒）
    s.drop = null; // 空からの補給箱 { x, y, z }（落ちている間は y が高い）
    s.nextDrop = FUN.DROP_FIRST;
    s.wind = { x: 0, z: 0, t: 0 }; // 突風（t: 残りの秒）
    s.nextWind = FUN.WIND_FIRST;
    s.spurt = false; // ラストスパートに入ったか
    s.firstBlood = false; // このラウンドでもう誰かが倒したか
    s.balloons = (this.arena.balloons || []).map(() => 0); // 風船の的（0 = 浮かんでいる）
    s.rain = 0; // 雨の残りの秒
    s.nextRain = EXTRA.RAIN_FIRST;
    s.decoys = []; // おとり人形 { id, o, x, y, z, yaw, hp, t }
    s.mov = (this.arena.movables || []).map(movableBox); // 押せるものはラウンドの始めの場所へ
    this.events.push({ t: 'round', r });
    // 出発地点はばらばらに
    const spots = this.arena.spawns.map((_, k) => k);
    for (let k = spots.length - 1; k > 0; k--) {
      const j = Math.floor(nextRandom(s) * (k + 1));
      [spots[k], spots[j]] = [spots[j], spots[k]];
    }
    s.players.forEach((p, k) => {
      // CPU はすぐ武器を選ぶ（ふつう 55%・スナイパー 30%・ライフル 15%）
      if (p.bot) {
        const r = nextRandom(s);
        p.weapon = r < 0.55 ? WEAPON.NORMAL : r < 0.85 ? WEAPON.SNIPER : WEAPON.RIFLE;
      }
      p.picked = p.bot || !this.usePick;
      Object.assign(p, { hp: PLAYER.HP, dead: 0, inv: 0, star: 0, stun: 0, stuck: 0, shake: 0, noAmmo: 0, ammo: WEAPONS[p.weapon].ammo, reload: 0, fireCd: 0, sp: 0, spN: 0, item: 0, bombs: BOMB_COUNT, bombCd: 0, stam: PLAYER.STAMINA, sprint: false, streak: 0, nemesis: -1, barkCd: 0, bot2: null });
      this._place(p, this.arena.spawns[spots[k % spots.length]]);
    });
    s.boss = this.mode === MODE.BOSS ? this._newBoss(r) : null;
  }

  _place(p, sp) {
    Object.assign(p, createBody(sp[0], sp[1], sp[2] ?? 0));
    p.y = groundY(this.arena, p.x, p.z); // 丘・くぼみの上
    p.g = (p.g + 1) & 255;
    this.events.push({ t: 'spawn', i: p.i, x: p.x, y: p.y, z: p.z, yaw: p.yaw, g: p.g });
  }

  /** 人の犬の位置の報告（その人の端末から）。復活のあとの古い報告は捨てる */
  setPilot(i, st) {
    const p = this.s.players[i];
    if (!p || p.bot || p.dead > 0 || st.g !== p.g) return;
    p.x = st.x;
    p.y = st.y;
    p.z = st.z;
    p.yaw = st.yaw;
    p.pitch = st.pitch;
    p.crouch = !!st.crouch;
    p.moving = !!st.moving;
    p.ground = st.ground !== false;
    shoveMovables(this.cw, p); // 押せるものに重なっていたら、押し出す（その人の端末で押した分）
  }

  /** 武器を選ぶ（ラウンドの前の選択画面で）。選び直しもできる */
  pickWeapon(i, w) {
    const p = this.s.players[i];
    if (!p || !WEAPON_LIST.includes(w) || this.s.phase !== 'pick') return false;
    p.weapon = w;
    p.picked = true;
    p.ammo = WEAPONS[w].ammo;
    p.reload = 0;
    this.events.push({ t: 'weapon', i, w });
    return true;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  get running() {
    return this.s.phase === 'play';
  }

  /** 1 tick 進める */
  step(dt) {
    this.cw.clock = this.s.t; // ギミック（間欠泉）の時刻
    const s = this.s;
    s.t += dt;
    if (s.phase === 'pick') {
      // 全員が選んだら、残りの時間を飛ばして 3・2・1 へ
      if (s.players.every((p) => p.picked)) s.t = Math.max(s.t, -ROUND.INTRO);
      if (s.t >= -ROUND.INTRO) {
        s.phase = 'intro';
        for (const p of s.players) p.picked = true;
        this.events.push({ t: 'phase', ph: 'intro' });
      }
      return;
    }
    if (s.phase === 'intro' && s.t >= 0) {
      s.phase = 'play';
      this.events.push({ t: 'phase', ph: 'play' });
    } else if (s.phase === 'play' && s.t >= ROUND.TIME) {
      s.phase = 'end';
      s.bands = [];
      this.events.push({ t: 'phase', ph: 'end' });
    } else if (s.phase === 'end' && s.t >= ROUND.TIME + ROUND.END) {
      if (s.round + 1 < ROUND.COUNT) this._startRound(s.round + 1);
      else if (s.phase !== 'done') {
        s.phase = 'done';
        this.events.push({ t: 'phase', ph: 'done' });
      }
      return;
    }
    if (s.phase !== 'play') {
      for (const p of s.players) if (p.bot) stepMove(p, {}, dt, this.cw, 0); // 着地だけ
      return;
    }
    for (const p of s.players) this._stepPlayer(p, dt);
    if (s.boss) {
      this._stepBoss(dt);
      if (s.boss.st !== 'pounce') s.boss.y = groundY(this.arena, s.boss.x, s.boss.z); // 丘・くぼみに沿って歩く
    }
    this._stepBands(dt);
    this._stepItems(dt);
    this._stepFun(dt);
  }

  _stepPlayer(p, dt) {
    for (const f of ['inv', 'star', 'stun', 'stuck', 'shake', 'noAmmo', 'fireCd', 'bombCd', 'barkCd']) p[f] = Math.max(0, (p[f] || 0) - dt);
    if (p.dead > 0) {
      p.dead = Math.max(0, p.dead - dt);
      if (p.dead === 0) this._respawn(p);
      return;
    }
    if (p.reload > 0) {
      p.reload = Math.max(0, p.reload - dt);
      if (p.reload === 0) p.ammo = WEAPONS[p.weapon].ammo;
    }
    // 1 秒に 1 ずつ回復
    if (p.hp < PLAYER.HP) {
      p.rg = (p.rg || 0) + dt * PLAYER.REGEN;
      if (p.rg >= 1) {
        const n = Math.floor(p.rg);
        p.hp = Math.min(PLAYER.HP, p.hp + n);
        p.rg -= n;
      }
    } else p.rg = 0;
    if (!p.bot) return; // 人の犬はその人の端末が動かす
    const inp = botThink(this, p, dt);
    const slow = p.stuck > 0 ? 0 : p.stun > 0 ? PLAYER.STUN_SPEED : 1;
    stepMove(p, inp, dt, this.cw, slow);
    p.moving = Math.hypot(p.vx, p.vz) > 0.5;
  }

  /** 復活: 生きている相手からいちばん遠い出発地点へ */
  _respawn(p) {
    const others = this.s.players.filter((q) => q !== p && q.dead <= 0);
    let best = this.arena.spawns[0];
    let bd = -1;
    for (const sp of this.arena.spawns) {
      if (!fits(this.cw, sp[0], 0, sp[1], PLAYER.HEIGHT)) continue; // 押せるものが置かれている
      // 敵からはできるだけ遠く。チーム戦では味方の近くを少し優先する
      const foes = others.filter((q) => this.foes(p.i, q.i));
      const allies = this.mode === MODE.TEAM ? others.filter((q) => !this.foes(p.i, q.i)) : [];
      const fd = foes.length ? Math.min(...foes.map((q) => Math.hypot(q.x - sp[0], q.z - sp[1]))) : 0;
      const ad = allies.length ? Math.min(...allies.map((q) => Math.hypot(q.x - sp[0], q.z - sp[1]))) : 0;
      const d = Math.min(fd, 40) - ad * 0.6;
      if (d > bd) {
        bd = d;
        best = sp;
      }
    }
    Object.assign(p, { hp: PLAYER.HP, inv: PLAYER.INVINCIBLE, stun: 0, stuck: 0, ammo: WEAPONS[p.weapon].ammo, reload: 0 });
    this._place(p, best);
  }

  /**
   * 爆弾を投げる（全員、1 ラウンドに BOMB_COUNT 回まで）。o: 目の位置、d: 投げる向き、cid: 投げた人の端末での番号。
   * 当たりはいつもホストが決める（爆発させる）
   */
  throwBomb(i, o, d, cid = 0) {
    const s = this.s;
    const p = s.players[i];
    if (!p || s.phase !== 'play' || p.dead > 0 || !(p.bombs > 0) || p.bombCd > 0) return false;
    if (!Array.isArray(o) || !Array.isArray(d) || ![...o, ...d].every(Number.isFinite)) return false;
    const dl = Math.hypot(d[0], d[1], d[2]);
    if (dl < 0.5) return false;
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 2.5 || Math.abs(o[1] - p.y) > 2.5) return false;
    const spec = bandSpec(0, WEAPON.BOMB);
    const v = [d[0] / dl, d[1] / dl, d[2] / dl];
    p.bombs--;
    p.bombCd = WEAPONS[WEAPON.BOMB].gap;
    const b = { id: s.nextId++, o: i, cid: cid ? cid * 4 : 0, cj: false, kind: 0, x: o[0] + v[0] * GUN.MUZZLE, y: o[1] + v[1] * GUN.MUZZLE - 0.08, z: o[2] + v[2] * GUN.MUZZLE, vx: v[0] * spec.speed, vy: v[1] * spec.speed, vz: v[2] * spec.speed, r: spec.r, w: spec.w, mul: 1, ox: o[0], oy: o[1], oz: o[2], bounce: 0, life: spec.life, g: spec.g, age: 0 };
    s.bands.push(b);
    this.events.push({ t: 'shot', id: b.id, o: i, cid: b.cid, k: 0, w: WEAPON.BOMB, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz });
    return true;
  }

  /**
   * 撃つ。o: 目の位置、d: 向き（長さ 1）、kind: 撃つゴムの種類（ゴムが変わるアイテムを持っているときだけ有効）、cid: 撃った人の端末での番号。
   * 人の弾数は本人の端末が数える（ホストは、倒れている・ゴム切れ・ラウンド外だけを断る）
   */
  fire(i, o, d, kind = 0, cid = 0) {
    const s = this.s;
    const p = s.players[i];
    if (!p || s.phase !== 'play' || p.dead > 0 || p.noAmmo > 0) return false;
    if (!Array.isArray(o) || !Array.isArray(d) || ![...o, ...d].every(Number.isFinite)) return false;
    const dl = Math.hypot(d[0], d[1], d[2]);
    if (dl < 0.5) return false;
    // 撃った場所は、報告されている位置の近くに限る（おかしな位置からは撃てない）
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 2.5 || Math.abs(o[1] - p.y) > 2.5) return false;
    let k = 0;
    if (kind && kind === p.sp && p.spN > 0) {
      k = kind;
      p.spN--;
      if (p.spN <= 0) p.sp = 0;
    }
    const dirs = k === ITEM.TRIPLE ? [-ITEMS.TRIPLE_SPREAD, 0, ITEMS.TRIPLE_SPREAD] : [0];
    const yaw = Math.atan2(d[0], d[2]);
    const pitch = Math.asin(Math.max(-1, Math.min(1, d[1] / dl)));
    const spec = bandSpec(k, p.weapon);
    // 撃った人の端末で当たりを決める輪ゴムか（遅れをなくすため。人がゲストのとき）
    const cj = !!this.clientJudge?.(i);
    p.shots++;
    dirs.forEach((off, idx) => {
      const v = aimDir(yaw + off, pitch);
      const b = {
        id: s.nextId++,
        o: i,
        cid: cid ? cid * 4 + idx : 0, // 撃った人の端末での番号（3 方向は 1 本ずつ別の番号）
        cj,
        kind: k,
        x: o[0] + v[0] * GUN.MUZZLE,
        y: o[1] + v[1] * GUN.MUZZLE - 0.08,
        z: o[2] + v[2] * GUN.MUZZLE,
        vx: v[0] * spec.speed,
        vy: v[1] * spec.speed,
        vz: v[2] * spec.speed,
        r: spec.r,
        w: spec.w,
        mul: spec.mul,
        ox: o[0], // 撃った場所（ダメージは距離で決まる）
        oy: o[1],
        oz: o[2],
        bounce: spec.bounce,
        life: spec.life,
        g: spec.g,
        age: 0,
      };
      s.bands.push(b);
      this.events.push({ t: 'shot', id: b.id, o: i, cid: b.cid, k, w: p.weapon, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz });
      if (cj && b.cid) {
        const log = (this.shotLog[i] ||= new Map());
        log.set(b.cid, { w: b.w, mul: b.mul, ox: b.ox, oy: b.oy, oz: b.oz, vx: b.vx, vz: b.vz, id: b.id, t: s.t, used: false });
        if (log.size > 40) log.delete(log.keys().next().value);
      }
    });
    if (s.bands.length > 120) s.bands.splice(0, s.bands.length - 120);
    return true;
  }

  /**
   * 撃った人の端末で「当たった」（遅れのない当たり判定）。key: 輪ゴムの番号（撃った人の端末の）、v: 当たった相手、pos: 当たった場所。
   * ホストは、その輪ゴムを本当に撃っていた・まだ使っていない・相手が近くにいる（通信の遅れの分はゆるす）ことを確かめてから当てる
   */
  remoteHit(i, key, v, pos) {
    const s = this.s;
    const rec = this.shotLog[i]?.get(key);
    const q = s.players[v];
    if (!rec || rec.used || !q || !this.foes(i, v) || s.phase !== 'play' || s.t - rec.t > 4) return false;
    if (q.dead > 0 || !Array.isArray(pos) || !pos.every(Number.isFinite)) return false;
    if (Math.hypot(pos[0] - q.x, pos[2] - q.z) > 5 || Math.abs(pos[1] - (q.y + 0.5)) > 3) return false;
    rec.used = true;
    const n = s.bands.findIndex((b) => b.id === rec.id);
    if (n >= 0) s.bands.splice(n, 1);
    this.events.push({ t: 'end', id: rec.id, x: pos[0], y: pos[1], z: pos[2], h: v });
    const head = isHead(q, pos[1]);
    const dist = Math.hypot(pos[0] - rec.ox, pos[1] - rec.oy, pos[2] - rec.oz);
    this._hit(q, { o: i, dmg: hitDamage(rec.w, dist, rec.mul, head), vx: rec.vx, vz: rec.vz, head, dist });
    return true;
  }

  /** CPU とホストのための弾数つきの発射（人の端末も同じ数え方をする） */
  tryFire(p, o, d) {
    if (p.reload > 0 || p.fireCd > 0 || p.ammo <= 0 || p.noAmmo > 0) return false;
    if (!this.fire(p.i, o, d, p.sp, 0)) return false;
    const w = WEAPONS[p.weapon];
    p.fireCd = p.bot ? Math.max(w.gap, BOT.FIRE_GAP) * (0.8 + nextRandom(this.s) * 0.6) : w.gap;
    p.ammo--;
    if (p.ammo <= 0) p.reload = w.reload;
    return true;
  }

  _target(b) {
    // 追いかけゴム: 進む向きの近くにいる、いちばん近い相手（胸の高さ）
    const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
    let best = null;
    let bd = ITEMS.HOMING_RANGE;
    const boss = this.s.boss;
    if (boss && boss.hp > 0) return { x: boss.x, y: boss.y + BOSS.HEIGHT * 0.5, z: boss.z };
    for (const q of this.s.players) {
      if (!this.foes(b.o, q.i) || q.dead > 0) continue;
      const tx = q.x - b.x;
      const ty = q.y + heightOf(q) * 0.5 - b.y;
      const tz = q.z - b.z;
      const d = Math.hypot(tx, ty, tz);
      if (d > bd || d < 0.01) continue;
      const cos = (tx * b.vx + ty * b.vy + tz * b.vz) / (d * sp);
      if (cos < Math.cos(ITEMS.HOMING_CONE)) continue;
      bd = d;
      best = { x: q.x, y: q.y + heightOf(q) * 0.5, z: q.z };
    }
    return best;
  }

  _stepBands(dt) {
    const s = this.s;
    const arena = this.cw;
    const tgt = (b) => this._target(b);
    for (let n = s.bands.length - 1; n >= 0; n--) {
      const b = s.bands[n];
      const ax = b.x;
      const ay = b.y;
      const az = b.z;
      const res = stepBand(b, dt, arena, tgt, s.wind);
      // 当たり（撃った本人には当たらない。撃った人の端末で決める輪ゴムは、ここでは当てない）
      let hit = null;
      let ht = 2;
      if (!b.cj || b.o < 0) for (const q of s.players) {
        if (!this.foes(b.o, q.i) || q.dead > 0) continue;
        const t = segCylinder(ax, ay, az, b.x, b.y, b.z, q, heightOf(q), PLAYER.HIT_RADIUS + b.r);
        if (t >= 0 && t < ht) {
          ht = t;
          hit = q;
        }
      }
      // ボス戦: 犬の輪ゴムは猫に当たる（撃った人の端末で決める輪ゴムも、猫にはホストが決める）
      const boss = s.boss;
      if (boss && boss.hp > 0 && b.o >= 0) {
        const t = segCylinder(ax, ay, az, b.x, b.y, b.z, boss, BOSS.HEIGHT, BOSS.HIT_RADIUS + b.r);
        if (t >= 0 && t < ht) {
          ht = t;
          hit = boss;
        }
      }
      // おとり人形（持ち主の敵の輪ゴムを受け止める）と、風船の的
      let hitDecoy = null;
      for (const dc of s.decoys) {
        if (b.o >= 0 && !this.foes(b.o, dc.o)) continue;
        const t = segCylinder(ax, ay, az, b.x, b.y, b.z, dc, PLAYER.HEIGHT, PLAYER.HIT_RADIUS + b.r);
        if (t >= 0 && t < ht) {
          ht = t;
          hit = null;
          hitDecoy = dc;
        }
      }
      let pop = -1;
      if (b.o >= 0) {
        (this.arena.balloons || []).forEach(([x, z, y], k) => {
          if (s.balloons[k] > 0) return;
          const t = segSphere(ax, ay, az, b.x, b.y, b.z, x, y, z, EXTRA.BALLOON_R + b.r);
          if (t >= 0 && t < ht) {
            ht = t;
            hit = null;
            hitDecoy = null;
            pop = k;
          }
        });
      }
      if (hitDecoy || pop >= 0) {
        const hx = ax + (b.x - ax) * ht;
        const hy = ay + (b.y - ay) * ht;
        const hz = az + (b.z - az) * ht;
        s.bands.splice(n, 1);
        this.events.push({ t: 'end', id: b.id, x: hx, y: hy, z: hz, h: -1 });
        if (b.w === WEAPON.BOMB) {
          this._explode(b, hx, hy, hz);
          if (s.phase !== 'play') return;
        } else if (hitDecoy) {
          hitDecoy.hp -= this._dmgOf(b, hx, hy, hz);
          this.events.push({ t: 'dhit', id: hitDecoy.id, x: hx, y: hy, z: hz });
        } else this._pop(pop, b.o);
        continue;
      }
      if (hit) {
        const hx = ax + (b.x - ax) * ht;
        const hy = ay + (b.y - ay) * ht;
        const hz = az + (b.z - az) * ht;
        s.bands.splice(n, 1);
        if (b.w === WEAPON.BOMB) {
          this.events.push({ t: 'end', id: b.id, x: hx, y: hy, z: hz, h: -1 });
          this._explode(b, hx, hy, hz);
        } else if (hit === boss) {
          this.events.push({ t: 'end', id: b.id, x: hx, y: hy, z: hz, h: -2 });
          this._bossHit(this._dmgOf(b, hx, hy, hz), b.o);
        } else {
          this.events.push({ t: 'end', id: b.id, x: hx, y: hy, z: hz, h: hit.i });
          const head = b.kind !== HAIRBALL && isHead(hit, hy);
          this._hit(hit, { o: b.o, dmg: this._dmgOf(b, hx, hy, hz, head), vx: b.vx, vz: b.vz, head, dist: b.kind === HAIRBALL ? 0 : Math.hypot(hx - b.ox, hy - b.oy, hz - b.oz) });
        }
        if (s.phase !== 'play') return; // 猫を倒した（ラウンドおわり）
        continue;
      }
      if (res === 'end') {
        s.bands.splice(n, 1);
        this.events.push({ t: 'end', id: b.id, x: b.x, y: b.y, z: b.z, h: -1 });
        if (b.w === WEAPON.BOMB) {
          this._explode(b, b.x, b.y, b.z);
          if (s.phase !== 'play') return;
        }
      }
    }
  }

  /** 輪ゴム b が (x, y, z) で当たったときのダメージ（撃った場所からの距離で決まる。毛玉は決まった値） */
  _dmgOf(b, x, y, z, head = false) {
    if (b.kind === HAIRBALL) return BOSS.SPIT_DMG;
    return hitDamage(b.w, Math.hypot(x - b.ox, y - b.oy, z - b.oz), b.mul, head);
  }

  /** 爆弾が (x, y, z) で爆発: 半径の中の相手（と猫）に、中心に近いほど大きなダメージ。物の陰にいれば当たらない */
  _explode(b, x, y, z) {
    const s = this.s;
    const W = WEAPONS[WEAPON.BOMB];
    const R = W.blast * (b.mul > 1 ? 1.25 : 1); // 極太ゴムの爆弾は少し広い
    this.events.push({ t: 'boom', x, y, z, o: b.o, r: R });
    for (const q of s.players) {
      if (!this.foes(b.o, q.i) || q.dead > 0) continue;
      const cy = Math.max(q.y, Math.min(q.y + heightOf(q), y)); // 体のいちばん近い高さ
      const d = Math.max(0, Math.hypot(q.x - x, cy - y, q.z - z) - PLAYER.RADIUS);
      if (d > R || segmentHit(this.cw, x, y + 0.05, z, q.x, cy, q.z) < 0.999) continue;
      const hl = Math.hypot(q.x - x, q.z - z) || 1;
      this._hit(q, { o: b.o, dmg: weaponDamage(WEAPON.BOMB, (d * W.blast) / R, b.mul), vx: (q.x - x) / hl, vz: (q.z - z) / hl, bomb: true });
    }
    const boss = s.boss;
    if (boss && boss.hp > 0 && b.o >= 0) {
      const d = Math.max(0, Math.hypot(boss.x - x, boss.z - z) - BOSS.RADIUS);
      if (d <= R && y < boss.y + BOSS.HEIGHT + R) this._bossHit(weaponDamage(WEAPON.BOMB, (d * W.blast) / R, b.mul), b.o);
    }
  }

  /** p が与えたダメージを点に（10 ごとに 1 点） */
  _dealt(p, dmg) {
    p.dmgAcc = (p.dmgAcc || 0) + dmg;
    const pts = Math.floor(p.dmgAcc / SCORE.DMG_PER_POINT);
    if (pts > 0) {
      p.dmgAcc -= pts * SCORE.DMG_PER_POINT;
      this._addScore(p, pts);
    }
  }

  /** 輪ゴムが q に当たった */
  _hit(q, b) {
    const s = this.s;
    const by = s.players[b.o];
    if (q.inv > 0) {
      this.events.push({ t: 'block', v: q.i, by: b.o });
      return;
    }
    const dmg = Math.min(q.hp, b.dmg);
    q.hp -= dmg;
    q.stun = PLAYER.STUN;
    const hl = Math.hypot(b.vx, b.vz) || 1;
    const kx = (b.vx / hl) * PLAYER.KNOCK;
    const kz = (b.vz / hl) * PLAYER.KNOCK;
    if (q.bot) {
      q.vx += kx;
      q.vz += kz;
    }
    if (by) {
      by.hits++;
      by.landed++;
      this._dealt(by, dmg);
      if (b.head) by.hs = (by.hs || 0) + 1;
      if (b.dist) by.longest = Math.max(by.longest || 0, b.dist);
    }
    this.events.push({ t: 'hit', v: q.i, by: b.o, d: dmg, hp: q.hp, kx, kz, ...(b.bomb ? { bm: 1 } : {}), ...(b.head ? { hs: 1 } : {}) });
    if (q.hp <= 0) {
      q.dead = PLAYER.RESPAWN;
      q.deaths++;
      q.vx = q.vz = 0;
      q.item = 0;
      q.sp = 0;
      q.spN = 0;
      q.streak = 0; // 連続撃破はここで終わり
      this.events.push({ t: 'kill', v: q.i, by: b.o });
      if (by) {
        by.kills++;
        this._addScore(by, SCORE.KILL);
        // 連続撃破
        by.streak = (by.streak || 0) + 1;
        by.bestStreak = Math.max(by.bestStreak || 0, by.streak);
        // ファーストブラッド（このラウンドでいちばん最初に倒した）
        if (!this.s.firstBlood) {
          this.s.firstBlood = true;
          this._addScore(by, EXTRA.FIRST_BLOOD);
          this.events.push({ t: 'first', i: by.i, b: EXTRA.FIRST_BLOOD });
        }
        const bonus = FUN.STREAK_BONUS[by.streak];
        if (bonus) {
          this._addScore(by, bonus);
          this.events.push({ t: 'streak', i: by.i, n: by.streak, b: bonus });
        }
        // リベンジ（自分を倒した相手を倒し返した）
        if (by.nemesis === q.i) {
          this._addScore(by, FUN.REVENGE_BONUS);
          by.nemesis = -1;
          this.events.push({ t: 'revenge', i: by.i, v: q.i, b: FUN.REVENGE_BONUS });
        }
        q.nemesis = by.i;
        // CPU はうれしいと吠える
        if (by.bot && nextRandom(this.s) < 0.5) this.bark(by.i);
      }
    }
  }

  _addScore(p, n) {
    // ラストスパート（残り 30 秒）は 2 倍
    const s = this.s;
    if (s.phase === 'play' && s.t >= ROUND.TIME - FUN.SPURT) n *= 2;
    p.score += n;
    p.rs[s.round] += n;
  }

  /** お楽しみの仕組み: ラストスパートの合図・補給箱・突風 */
  _stepFun(dt) {
    const s = this.s;
    if (s.phase !== 'play') return;
    if (!s.spurt && s.t >= ROUND.TIME - FUN.SPURT) {
      s.spurt = true;
      this.events.push({ t: 'spurt' });
    }
    // 補給箱: 決まった時間に空から落ちてきて、着いたら一番に触った犬が取る（金の輪ゴム）
    if (!s.drop && s.t >= s.nextDrop) {
      const spots = this.arena.drops || this.arena.heals || [[0, 0]];
      const [x, z] = spots[Math.floor(nextRandom(s) * spots.length)];
      s.drop = { x, z, y: FUN.DROP_HEIGHT + groundY(this.arena, x, z) };
      s.nextDrop = Infinity;
      this.events.push({ t: 'drop', x, z });
    }
    const dp = s.drop;
    if (dp) {
      const gy = groundY(this.arena, dp.x, dp.z);
      dp.y = Math.max(gy, dp.y - FUN.DROP_FALL * dt);
      if (dp.y < gy + 1.4) {
        for (const p of s.players) {
          if (p.dead > 0 || Math.hypot(p.x - dp.x, p.z - dp.z) > FUN.DROP_RADIUS || Math.abs(p.y - dp.y) > 1.6) continue;
          p.sp = ITEM.GOLD;
          p.spN = FUN.GOLD_SHOTS;
          this.events.push({ t: 'sp', i: p.i, k: ITEM.GOLD, n: p.spN });
          this.events.push({ t: 'dropget', i: p.i });
          s.drop = null;
          s.nextDrop = s.t + FUN.DROP_EVERY;
          break;
        }
      }
    }
    // 雨
    if (s.rain > 0) {
      s.rain = Math.max(0, s.rain - dt);
      if (s.rain === 0) this.events.push({ t: 'rainEnd' });
    } else if (s.t >= s.nextRain) {
      s.rain = EXTRA.RAIN_TIME;
      const [lo, hi] = EXTRA.RAIN_EVERY;
      s.nextRain = s.t + EXTRA.RAIN_TIME + lo + nextRandom(s) * (hi - lo);
      this.events.push({ t: 'rain' });
    }
    // 風船（割れたものは時間がたつとまた出る）
    s.balloons.forEach((tm, k) => {
      if (tm > 0) s.balloons[k] = Math.max(0, tm - dt);
    });
    // おとり人形（時間か体力がなくなったら消える）
    for (let k = s.decoys.length - 1; k >= 0; k--) {
      const dc = s.decoys[k];
      dc.t -= dt;
      if (dc.t <= 0 || dc.hp <= 0) {
        s.decoys.splice(k, 1);
        this.events.push({ t: 'decoyEnd', id: dc.id, x: dc.x, y: dc.y, z: dc.z });
      }
    }
    // 突風
    const w = s.wind;
    if (w.t > 0) {
      w.t = Math.max(0, w.t - dt);
      if (w.t === 0) {
        w.x = w.z = 0;
        this.events.push({ t: 'windEnd' });
      }
    } else if (s.t >= s.nextWind) {
      const a = nextRandom(s) * Math.PI * 2;
      w.x = Math.sin(a) * FUN.WIND_ACC;
      w.z = Math.cos(a) * FUN.WIND_ACC;
      w.t = FUN.WIND_TIME;
      const [lo, hi] = FUN.WIND_EVERY;
      s.nextWind = s.t + FUN.WIND_TIME + lo + nextRandom(s) * (hi - lo);
      this.events.push({ t: 'wind', x: w.x, z: w.z });
    }
  }

  /** 風船 k を犬 by が割った: +1 点、ときどきアイテム */
  _pop(k, by) {
    const s = this.s;
    const [x, z, y] = this.arena.balloons[k];
    s.balloons[k] = EXTRA.BALLOON_RESPAWN;
    const p = s.players[by];
    let item = 0;
    if (p) {
      p.pops = (p.pops || 0) + 1;
      this._addScore(p, 1);
      if (!p.item && nextRandom(s) < EXTRA.BALLOON_ITEM) {
        item = BOX_ITEMS[Math.floor(nextRandom(s) * BOX_ITEMS.length)];
        p.item = item;
      }
    }
    this.events.push({ t: 'pop', k, i: by, x, y, z, item });
  }

  /** 遠吠え（「ワン！」）。BARK_CD 秒に 1 回 */
  bark(i) {
    const p = this.s.players[i];
    if (!p || p.dead > 0 || p.barkCd > 0 || !['play', 'intro', 'pick', 'end'].includes(this.s.phase)) return false;
    p.barkCd = FUN.BARK_CD;
    this.events.push({ t: 'bark', i });
    return true;
  }

  _stepItems(dt) {
    const s = this.s;
    const arena = this.arena;
    // 箱
    s.boxes.forEach((tm, k) => {
      if (tm > 0) {
        s.boxes[k] = Math.max(0, tm - dt);
        if (s.boxes[k] === 0) this.events.push({ t: 'box', b: k, on: 1 });
        return;
      }
      const [bx, bz, by] = arena.items[k];
      for (const p of s.players) {
        if (p.dead > 0 || p.item) continue;
        if (Math.hypot(p.x - bx, p.z - bz) < ITEMS.BOX_RADIUS && Math.abs(p.y - by) < 0.9) {
          p.item = BOX_ITEMS[Math.floor(nextRandom(s) * BOX_ITEMS.length)];
          s.boxes[k] = ITEMS.BOX_RESPAWN;
          this.events.push({ t: 'pick', i: p.i, b: k, item: p.item });
          break;
        }
      }
    });
    // 回復のおやつ（体力が減っている犬が近づくと拾う）
    (s.heals || []).forEach((tm, k) => {
      if (tm > 0) {
        s.heals[k] = Math.max(0, tm - dt);
        return;
      }
      const [hx, hz, hy] = arena.heals[k];
      for (const p of s.players) {
        if (p.dead > 0 || p.hp >= PLAYER.HP) continue;
        if (Math.hypot(p.x - hx, p.z - hz) < TREAT.RADIUS && Math.abs(p.y - hy) < 1) {
          p.hp = Math.min(PLAYER.HP, p.hp + TREAT.HEAL);
          p.treats = (p.treats || 0) + 1;
          s.heals[k] = TREAT.RESPAWN;
          this.events.push({ t: 'heal', i: p.i, hp: p.hp, k });
          break;
        }
      }
    });
    // ガム（踏むと動けない。置いた本人は平気）
    for (let n = s.gums.length - 1; n >= 0; n--) {
      const g = s.gums[n];
      g.age += dt;
      let hitP = null;
      const boss = s.boss;
      if (boss && boss.hp > 0 && boss.y < 0.3 && Math.hypot(boss.x - g.x, boss.z - g.z) < ITEMS.GUM_RADIUS + BOSS.RADIUS) {
        boss.stuck = BOSS.STUCK;
        s.gums.splice(n, 1);
        this.events.push({ t: 'stuck', i: -1, id: g.id, by: g.o });
        continue;
      }
      for (const p of s.players) {
        if (!this.foes(g.o, p.i) || p.dead > 0 || p.inv > 0) continue;
        if (Math.hypot(p.x - g.x, p.z - g.z) < ITEMS.GUM_RADIUS + PLAYER.RADIUS * 0.5 && Math.abs(p.y - g.y) < 0.35) hitP = p;
      }
      if (hitP) {
        hitP.stuck = ITEMS.GUM_STUCK;
        hitP.vx = hitP.vz = 0;
        s.gums.splice(n, 1);
        this.events.push({ t: 'stuck', i: hitP.i, id: g.id, by: g.o });
      } else if (g.age >= ITEMS.GUM_TIME) {
        s.gums.splice(n, 1);
        this.events.push({ t: 'gumEnd', id: g.id });
      }
    }
    for (let n = s.smokes.length - 1; n >= 0; n--) {
      s.smokes[n].age += dt;
      if (s.smokes[n].age >= ITEMS.SMOKE_TIME) s.smokes.splice(n, 1);
    }
  }

  /**
   * アイテムを使う。o, d: 目の位置と向き（煙幕を投げる先を決める）
   */
  useItem(i, o, d) {
    const s = this.s;
    const p = s.players[i];
    if (!p || !p.item || p.dead > 0 || s.phase !== 'play') return false;
    const it = p.item;
    p.item = 0;
    this.events.push({ t: 'use', i, item: it });
    if (BAND_ITEMS.includes(it)) {
      p.sp = it;
      p.spN = ITEMS.SPECIAL_SHOTS;
      this.events.push({ t: 'sp', i, k: it, n: p.spN });
    } else if (it === ITEM.SMOKE) {
      // 狙った所（家具・壁・床に当たる所。遠すぎれば手前）に煙
      const ok = Array.isArray(o) && Array.isArray(d) && [...o, ...d].every(Number.isFinite);
      const ox = ok ? o[0] : p.x;
      const oy = ok ? o[1] : p.y + eyeOf(p);
      const oz = ok ? o[2] : p.z;
      const v = ok ? d : aimDir(p.yaw, p.pitch);
      const R = ITEMS.SMOKE_RANGE;
      const t = segmentHitSafe(this.cw, ox, oy, oz, ox + v[0] * R, oy + v[1] * R, oz + v[2] * R);
      const sm = { id: s.nextId++, o: i, x: ox + v[0] * R * t, y: Math.max(0.6, oy + v[1] * R * t), z: oz + v[2] * R * t, age: 0 };
      s.smokes.push(sm);
      this.events.push({ t: 'smoke', id: sm.id, o: i, x: sm.x, y: sm.y, z: sm.z });
    } else if ((it === ITEM.SHAKE || it === ITEM.NOAMMO) && s.boss) {
      // ボス戦: 猫がふらふらになって、しばらく攻撃しない
      s.boss.dizzy = BOSS.DIZZY;
      this.events.push({ t: 'fx', k: it, by: i, boss: 1 });
    } else if (it === ITEM.SHAKE || it === ITEM.NOAMMO) {
      for (const q of s.players) {
        if (!this.foes(i, q.i)) continue;
        if (it === ITEM.SHAKE) q.shake = ITEMS.SHAKE_TIME;
        else q.noAmmo = ITEMS.NOAMMO_TIME;
      }
      this.events.push({ t: 'fx', k: it, by: i });
    } else if (it === ITEM.HEAL) {
      p.hp = Math.min(PLAYER.HP, p.hp + ITEMS.HEAL);
      this.events.push({ t: 'heal', i, hp: p.hp });
    } else if (it === ITEM.DECOY) {
      // おとり人形: 足もとに自分そっくりの人形（自分の向きのまま）
      const dc = { id: s.nextId++, o: i, x: p.x, y: p.y, z: p.z, yaw: p.yaw, hp: EXTRA.DECOY_HP, t: EXTRA.DECOY_TIME };
      s.decoys.push(dc);
      if (s.decoys.length > 6) s.decoys.shift();
      this.events.push({ t: 'decoy', id: dc.id, o: i });
    } else if (it === ITEM.STAR) {
      p.inv = Math.max(p.inv, ITEMS.STAR_TIME);
      p.star = ITEMS.STAR_TIME;
      this.events.push({ t: 'star', i, d: ITEMS.STAR_TIME });
    } else if (it === ITEM.GUM) {
      const g = { id: s.nextId++, o: i, x: p.x, y: p.y, z: p.z, age: 0 };
      s.gums.push(g);
      if (s.gums.length > 12) s.gums.shift();
      this.events.push({ t: 'gum', id: g.id, o: i, x: g.x, y: g.y, z: g.z });
    }
    return true;
  }

  // ---- ボス戦: でけぇ猫 ----
  _newBoss(r) {
    const max = Math.round((BOSS.HP_BASE + BOSS.HP_PER * this.s.players.length) * (BOSS.ROUND_MUL[r] || 1));
    const b = { x: 0, y: 0, z: 0, yaw: 0, hp: max, max, st: 'walk', t: 0, cd: 4, sd: 3, tx: 0, tz: 0, sx: 0, sz: 0, dizzy: 0, stuck: 0, tgt: -1 };
    this.events.push({ t: 'boss', max });
    return b;
  }

  /** 犬の輪ゴムが猫に当たった */
  _bossHit(dmg, by) {
    const s = this.s;
    const b = s.boss;
    if (!b || b.hp <= 0) return;
    const d = Math.min(b.hp, dmg);
    b.hp -= d;
    const p = s.players[by];
    if (p) {
      p.hits++;
      p.landed++;
      this._dealt(p, d);
    }
    this.events.push({ t: 'bhit', by, d, hp: b.hp });
    if (b.hp <= 0) {
      b.st = 'down';
      b.t = 0;
      b.y = groundY(this.arena, b.x, b.z);
      if (p) {
        p.kills++;
        this._addScore(p, BOSS.KILL_BONUS);
      }
      s.bossWon[s.round] = true;
      this.events.push({ t: 'bdown', by });
      // 倒したらラウンドおわり
      s.phase = 'end';
      s.t = ROUND.TIME;
      s.bands = [];
      this.events.push({ t: 'phase', ph: 'end' });
    }
  }

  /** 猫が犬に当てる（ひっかき・とびかかり・毛玉） */
  _bossAttack(q, dmg, dx, dz) {
    const l = Math.hypot(dx, dz) || 1;
    this._hit(q, { o: -1, dmg, vx: dx / l, vz: dz / l });
  }

  /** 猫を 1 tick 動かす: いちばん近い犬へ歩き、近ければひっかき、離れていればとびかかり・毛玉 */
  _stepBoss(dt) {
    const s = this.s;
    const b = s.boss;
    if (b.hp <= 0) {
      b.t += dt;
      return;
    }
    b.t += dt;
    b.cd -= dt;
    b.sd -= dt;
    b.dizzy = Math.max(0, b.dizzy - dt);
    b.stuck = Math.max(0, b.stuck - dt);
    let q = null;
    let qd = Infinity;
    for (const p of s.players) {
      if (p.dead > 0) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < qd) {
        qd = d;
        q = p;
      }
    }
    b.tgt = q ? q.i : -1;
    const rnd = (a) => a[0] + nextRandom(s) * (a[1] - a[0]);
    const face = (x, z, k = 1) => {
      const want = Math.atan2(x - b.x, z - b.z);
      const dy = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
      b.yaw += Math.max(-BOSS.TURN * dt * k, Math.min(BOSS.TURN * dt * k, dy));
      return Math.abs(dy);
    };
    const lim = (v, half) => Math.max(-half + BOSS.RADIUS, Math.min(half - BOSS.RADIUS, v));
    if (b.st === 'walk') {
      if (!q) return;
      const off = face(q.x, q.z, b.dizzy > 0 ? 0.3 : 1);
      if (b.stuck <= 0 && qd > BOSS.SWIPE_RANGE * 0.75) {
        const sp = (b.dizzy > 0 ? 0.35 : 1) * BOSS.SPEED * (off > 1.2 ? 0.3 : 1);
        this._bossMove(b.x + Math.sin(b.yaw) * sp * dt, b.z + Math.cos(b.yaw) * sp * dt);
      }
      if (b.dizzy > 0) return;
      if (qd < BOSS.SWIPE_RANGE && off < 0.6) {
        b.st = 'wind';
        b.t = 0;
        this.events.push({ t: 'bact', a: 'swipe' });
      } else if (b.cd <= 0 && qd > 6 && qd < 24 && b.stuck <= 0) {
        b.st = 'crouch';
        b.t = 0;
        b.tx = q.x;
        b.tz = q.z;
        this.events.push({ t: 'bact', a: 'pounce' });
      } else if (b.sd <= 0 && qd > 7) {
        b.sd = rnd(BOSS.SPIT_EVERY);
        const ox = b.x + Math.sin(b.yaw) * BOSS.RADIUS;
        const oz = b.z + Math.cos(b.yaw) * BOSS.RADIUS;
        const oy = BOSS.HEIGHT * 0.6;
        const dx = q.x - ox;
        const dy = q.y + 0.5 - oy;
        const dz = q.z - oz;
        const l = Math.hypot(dx, dy, dz) || 1;
        // 少し上に向けて投げる（落ちる分）
        const v = [dx / l, dy / l + 0.08 * (l / 10), dz / l];
        const vl = Math.hypot(...v);
        const spec = bandSpec(HAIRBALL);
        const band = { id: s.nextId++, o: -1, cid: 0, cj: false, kind: HAIRBALL, x: ox, y: oy, z: oz, vx: (v[0] / vl) * spec.speed, vy: (v[1] / vl) * spec.speed, vz: (v[2] / vl) * spec.speed, r: spec.r, w: -1, mul: 1, bounce: 0, life: spec.life, g: spec.g, age: 0 };
        s.bands.push(band);
        this.events.push({ t: 'shot', id: band.id, o: -1, cid: 0, k: HAIRBALL, w: 0, x: band.x, y: band.y, z: band.z, vx: band.vx, vy: band.vy, vz: band.vz });
        this.events.push({ t: 'bact', a: 'spit' });
      }
    } else if (b.st === 'wind') {
      if (q) face(q.x, q.z, 0.3);
      if (b.t >= BOSS.SWIPE_WIND) {
        // ひっかき: 前の扇の中にいる犬
        for (const p of s.players) {
          if (p.dead > 0) continue;
          const dx = p.x - b.x;
          const dz = p.z - b.z;
          const d = Math.hypot(dx, dz);
          if (d > BOSS.SWIPE_RANGE + 0.4 || p.y > 2.5) continue;
          if ((dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw)) / (d || 1) < 0.15) continue;
          this._bossAttack(p, BOSS.SWIPE_DMG, dx, dz);
        }
        this.events.push({ t: 'bact', a: 'hit' });
        b.st = 'rest';
        b.t = 0;
      }
    } else if (b.st === 'crouch') {
      face(b.tx, b.tz, 1.5);
      if (b.t >= BOSS.POUNCE_WIND) {
        b.st = 'pounce';
        b.t = 0;
        b.sx = b.x;
        b.sz = b.z;
        if (q) {
          b.tx = q.x;
          b.tz = q.z;
        }
        b.tx = lim(b.tx, ROOM.W / 2);
        b.tz = lim(b.tz, ROOM.D / 2);
      }
    } else if (b.st === 'pounce') {
      const f = Math.min(1, b.t / BOSS.POUNCE_TIME);
      b.x = b.sx + (b.tx - b.sx) * f;
      b.z = b.sz + (b.tz - b.sz) * f;
      b.y = 4 * 3 * f * (1 - f) + groundY(this.arena, b.x, b.z);
      if (f >= 1) {
        b.y = groundY(this.arena, b.x, b.z);
        for (const p of s.players) {
          if (p.dead > 0) continue;
          const dx = p.x - b.x;
          const dz = p.z - b.z;
          if (Math.hypot(dx, dz) < BOSS.POUNCE_RADIUS && p.y < 2) this._bossAttack(p, BOSS.POUNCE_DMG, dx, dz);
        }
        this._bossMove(b.x, b.z); // 家具に重なっていたら押し出す
        this.events.push({ t: 'bact', a: 'land' });
        b.st = 'rest';
        b.t = 0;
        b.cd = rnd(BOSS.POUNCE_EVERY);
      }
    } else if (b.st === 'rest') {
      if (b.t >= 0.55) {
        b.st = 'walk';
        b.t = 0;
      }
    }
  }

  /** 猫を (x, z) へ（背の高い家具には入らない。低いものはまたぐ。柵の中に限る） */
  _bossMove(x, z) {
    const b = this.s.boss;
    const R = BOSS.RADIUS;
    const tall = this.arena.boxes.filter((o) => o.y1 > 1.4 && o.y0 < 2);
    const blocked = (px, pz) => tall.some((o) => px + R > o.x0 && px - R < o.x1 && pz + R > o.z0 && pz - R < o.z1);
    const half = (v, h) => Math.max(-h + R, Math.min(h - R, v));
    const nx = half(x, ROOM.W / 2);
    const nz = half(z, ROOM.D / 2);
    if (!blocked(nx, b.z)) b.x = nx;
    if (!blocked(b.x, nz)) b.z = nz;
  }

  /** 完全な状態（再接続・一時停止のとき） */
  getSnapshot() {
    return structuredClone({ ...this.s, players: this.s.players.map((p) => ({ ...p, bot2: null })) });
  }

  loadSnapshot(snap) {
    if (!snap || !Array.isArray(snap.players)) return;
    this.s = structuredClone(snap);
    this.events = [];
  }

  /** 結果（3 ラウンドの合計点の順） */
  standings() {
    return [...this.s.players].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.i - b.i);
  }
}

/** 線分 a → b が、中心 (cx, cy, cz)・半径 R の玉に最初に入る割合（入らなければ -1） */
function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, R) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const fx = ax - cx;
  const fy = ay - cy;
  const fz = az - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - R * R;
  if (c <= 0) return 0;
  if (a < 1e-12) return -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

function segmentHitSafe(arena, ax, ay, az, bx, by, bz) {
  return Math.max(0, segmentHit(arena, ax, ay, az, bx, by, bz, 0.3) - 0.02);
}
