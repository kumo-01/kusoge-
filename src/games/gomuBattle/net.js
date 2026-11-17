// 通信の形。
// - ゲスト → ホスト: 自分の犬の位置・向き（11 バイト。操作の通り道 sendInput で、毎秒 30 回）
// - ホスト → 全員: 試合の要約（毎秒 20 回）と、起きたこと（撃った・当たった・倒れた…）

import { PLAYER } from './constants.js';

const TAU = Math.PI * 2;
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v) || 0));

/** 自分の犬の状態を 11 バイトに（x, z, y: 1/200, 向き: 1/65536 周, 上下: ±1.5 rad を ±127, 印, 復活の回数） */
export function packPilot(m) {
  const out = [];
  const i16 = (v) => {
    const x = clampInt(v, -32768, 32767) & 0xffff;
    out.push(x & 255, x >> 8);
  };
  i16(m.x * 200);
  i16(m.z * 200);
  i16(m.y * 1000);
  const yaw = clampInt((((m.yaw % TAU) + TAU) % TAU) * (65536 / TAU), 0, 65535);
  out.push(yaw & 255, yaw >> 8);
  out.push(clampInt((m.pitch / 1.5) * 127, -127, 127) & 255);
  out.push((m.crouch ? 1 : 0) | (m.moving ? 2 : 0) | (m.ground ? 4 : 0));
  out.push(m.g & 255);
  return out;
}

export function unpackPilot(a) {
  if (!Array.isArray(a) || a.length < 11) return null;
  const i16 = (k) => {
    const v = a[k] | (a[k + 1] << 8);
    return v & 0x8000 ? v - 0x10000 : v;
  };
  let yaw = ((a[6] | (a[7] << 8)) * TAU) / 65536;
  if (yaw > Math.PI) yaw -= TAU;
  const p8 = a[8] > 127 ? a[8] - 256 : a[8];
  return { x: i16(0) / 200, z: i16(2) / 200, y: i16(4) / 1000, yaw, pitch: (p8 / 127) * 1.5, crouch: !!(a[9] & 1), moving: !!(a[9] & 2), ground: !!(a[9] & 4), g: a[10] };
}

/** 状態の印 */
export const FL = { CROUCH: 1, MOVING: 2, INV: 4, STUN: 8, STUCK: 16, SHAKE: 32, NOAMMO: 64, RELOAD: 128 };

const r2 = (v) => Math.round(v * 100) / 100;

/** ホスト: 試合の要約（JSON で送れる小さな形） */
export function packState(s) {
  return {
    r: s.round,
    ph: s.phase,
    t: r2(s.t),
    p: s.players.map((p) => [
      r2(p.x),
      r2(p.y),
      r2(p.z),
      Math.round(p.yaw * 1000) / 1000,
      Math.round(p.pitch * 1000) / 1000,
      (p.crouch ? FL.CROUCH : 0) | (p.moving ? FL.MOVING : 0) | (p.inv > 0 ? FL.INV : 0) | (p.stun > 0 ? FL.STUN : 0) | (p.stuck > 0 ? FL.STUCK : 0) | (p.shake > 0 ? FL.SHAKE : 0) | (p.noAmmo > 0 ? FL.NOAMMO : 0) | (p.reload > 0 ? FL.RELOAD : 0),
      p.hp,
      p.item,
      p.g,
      p.score,
      Math.round(p.dead * 10) / 10,
      p.kills,
      p.deaths,
      p.rs,
      Math.round(Math.max(p.shake, p.noAmmo, p.stuck) * 10) / 10,
      (p.weapon | 0) | (p.picked ? 8 : 0),
      (s.teams?.[p.i] ?? -1) + 1, // チーム（ホストが決めたもの。ゲストはこれに合わせる）
      p.bombs | 0, // 残りの爆弾
      p.hs | 0,
      p.shots ? Math.round((p.landed / p.shots) * 100) : 0,
    ]),
    bw: (s.bossWon || []).map((x) => (x ? 1 : 0)),
    bo: s.boss ? [r2(s.boss.x), r2(s.boss.y), r2(s.boss.z), Math.round(s.boss.yaw * 1000) / 1000, s.boss.hp, s.boss.max, BOSS_ST.indexOf(s.boss.st), r2(s.boss.t), r2(Math.max(s.boss.dizzy, s.boss.stuck))] : null,
    bx: s.boxes.reduce((m, t, k) => (t > 0 ? m : m | (1 << k)), 0),
    hl: (s.heals || []).reduce((m, t, k) => (t > 0 ? m : m | (1 << k)), 0),
    dp: s.drop ? [r2(s.drop.x), r2(s.drop.y), r2(s.drop.z)] : null,
    wd: s.wind ? [r2(s.wind.x), r2(s.wind.z), r2(s.wind.t)] : null,
    bl: (s.balloons || []).reduce((m, t, k) => (t > 0 ? m : m | (1 << k)), 0),
    rn: Math.ceil(s.rain || 0),
    wx: s.wx | 0,
    dc: (s.decoys || []).map((d) => [d.id, d.o, r2(d.x), r2(d.y), r2(d.z), Math.round(d.yaw * 1000) / 1000]),
    sm: s.smokes.map((x) => [x.id, r2(x.x), r2(x.y), r2(x.z), r2(x.age)]),
    gm: s.gums.map((x) => [x.id, r2(x.x), r2(x.y), r2(x.z)]),
    mv: (s.mov || []).map((b) => [r2((b.x0 + b.x1) / 2), r2((b.z0 + b.z1) / 2)]), // 押せるものの位置
  };
}

/** ゲスト: 受け取った要約を読む（おかしな値は捨てる） */
export function unpackState(o, n) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.p)) return null;
  const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const players = o.p.slice(0, n).map((a, i) => {
    if (!Array.isArray(a)) a = [];
    const fl = num(a[5]) | 0;
    return {
      i,
      x: num(a[0]),
      y: num(a[1]),
      z: num(a[2]),
      yaw: num(a[3]),
      pitch: num(a[4]),
      crouch: !!(fl & FL.CROUCH),
      moving: !!(fl & FL.MOVING),
      inv: fl & FL.INV ? 1 : 0,
      stun: fl & FL.STUN ? 1 : 0,
      stuck: fl & FL.STUCK ? 1 : 0,
      shake: fl & FL.SHAKE ? 1 : 0,
      noAmmo: fl & FL.NOAMMO ? 1 : 0,
      reloading: !!(fl & FL.RELOAD),
      hp: num(a[6], PLAYER.HP),
      item: num(a[7]) | 0,
      g: num(a[8]) | 0,
      score: num(a[9]) | 0,
      dead: num(a[10]),
      kills: num(a[11]) | 0,
      deaths: num(a[12]) | 0,
      rs: Array.isArray(a[13]) ? a[13].map((x) => num(x) | 0) : [0, 0, 0],
      fxT: num(a[14]),
      weapon: (num(a[15]) | 0) & 7,
      picked: !!((num(a[15]) | 0) & 8),
      team: (num(a[16]) | 0) - 1,
      bombs: Math.max(0, num(a[17]) | 0),
      hs: num(a[18]) | 0,
      acc: num(a[19]) | 0,
    };
  });
  const bo = Array.isArray(o.bo) ? o.bo : null;
  return {
    round: Math.max(0, Math.min(2, num(o.r) | 0)),
    phase: PH.includes(o.ph) ? o.ph : 'play',
    bossWon: Array.isArray(o.bw) ? o.bw.map((x) => !!x) : [],
    boss: bo ? { x: num(bo[0]), y: num(bo[1]), z: num(bo[2]), yaw: num(bo[3]), hp: num(bo[4]), max: num(bo[5], 1), st: BOSS_ST[num(bo[6]) | 0] || 'walk', t: num(bo[7]), fx: num(bo[8]) } : null,
    t: num(o.t),
    players,
    boxes: num(o.bx) | 0,
    heals: num(o.hl) | 0,
    drop: Array.isArray(o.dp) ? { x: num(o.dp[0]), y: num(o.dp[1]), z: num(o.dp[2]) } : null,
    wind: Array.isArray(o.wd) ? { x: num(o.wd[0]), z: num(o.wd[1]), t: num(o.wd[2]) } : { x: 0, z: 0, t: 0 },
    balloons: num(o.bl) | 0,
    rain: num(o.rn),
    wx: num(o.wx) | 0,
    decoys: Array.isArray(o.dc) ? o.dc.filter(Array.isArray).slice(0, 8).map((d) => ({ id: num(d[0]), o: num(d[1]) | 0, x: num(d[2]), y: num(d[3]), z: num(d[4]), yaw: num(d[5]) })) : [],
    smokes: Array.isArray(o.sm) ? o.sm.filter(Array.isArray).map((x) => ({ id: num(x[0]), x: num(x[1]), y: num(x[2]), z: num(x[3]), age: num(x[4]) })) : [],
    gums: Array.isArray(o.gm) ? o.gm.filter(Array.isArray).map((x) => ({ id: num(x[0]), x: num(x[1]), y: num(x[2]), z: num(x[3]) })) : [],
    mov: Array.isArray(o.mv) ? o.mv.slice(0, 16).map((x) => (Array.isArray(x) ? [num(x[0]), num(x[1])] : [0, 0])) : [],
  };
}

// ---- 配信のバイト列（毎秒 40 回。JSON の約 1/4 の大きさ） ----
// 犬 1 匹 21 バイト（位置 2mm・向き・状態・体力・アイテム・点数）。
// 2026-11-13〜: 共通の差分の配信（src/core/netcodec.js。Rust）で、ゲストが受け取りを確認した前の配信との差分にして送る。
// 差分が効くように、いつも同じ長さのもの（犬・箱・天気・押せるもの・猫）を前に、数が変わるもの（おとり人形・煙・ガム・
// ラウンドごとの点・起きたこと）を後ろに並べる。止まっている犬・変わらない値は、ほぼ 0 バイトになる。
// 起きたこと（撃った・当たった…）は、数を丸めた JSON を後ろにつける（少ないので）
const BIN_V = 10;
/** 位置のバイト列の単位（1 m を 500。i16 で ±65 m まで。会場は ±39 m） */
const POS = 500;
const PH = ['intro', 'play', 'end', 'done', 'pick'];
/** 猫の動きの番号 */
const BOSS_ST = ['walk', 'wind', 'crouch', 'pounce', 'rest', 'down'];

class W {
  constructor() {
    this.b = new Uint8Array(256);
    this.dv = new DataView(this.b.buffer);
    this.n = 0;
  }
  need(k) {
    if (this.n + k <= this.b.length) return;
    const nb = new Uint8Array(Math.max(this.b.length * 2, this.n + k));
    nb.set(this.b.subarray(0, this.n));
    this.b = nb;
    this.dv = new DataView(nb.buffer);
  }
  u8(v) {
    this.need(1);
    this.dv.setUint8(this.n++, clampInt(v, 0, 255));
  }
  i8(v) {
    this.need(1);
    this.dv.setInt8(this.n++, clampInt(v, -128, 127));
  }
  u16(v) {
    this.need(2);
    this.dv.setUint16(this.n, clampInt(v, 0, 65535), true);
    this.n += 2;
  }
  i16(v) {
    this.need(2);
    this.dv.setInt16(this.n, clampInt(v, -32768, 32767), true);
    this.n += 2;
  }
  /** 0 以上の整数（小さいほど短い。1〜5 バイト） */
  vu(v) {
    let x = Math.max(0, Math.min(4294967295, Math.round(v) || 0)) >>> 0;
    for (;;) {
      this.need(1);
      if (x < 128) {
        this.b[this.n++] = x;
        return;
      }
      this.b[this.n++] = (x & 127) | 128;
      x >>>= 7;
    }
  }
  i32(v) {
    this.need(4);
    this.dv.setInt32(this.n, clampInt(v, -2147483648, 2147483647), true);
    this.n += 4;
  }
  bytes(u8) {
    this.need(u8.length);
    this.b.set(u8, this.n);
    this.n += u8.length;
  }
  out() {
    return this.b.slice(0, this.n);
  }
}

class R {
  constructor(u8) {
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.u = u8;
    this.n = 0;
  }
  u8() {
    return this.dv.getUint8(this.n++);
  }
  i8() {
    return this.dv.getInt8(this.n++);
  }
  u16() {
    const v = this.dv.getUint16(this.n, true);
    this.n += 2;
    return v;
  }
  i16() {
    const v = this.dv.getInt16(this.n, true);
    this.n += 2;
    return v;
  }
  vu() {
    let v = 0;
    let sh = 0;
    for (;;) {
      const b = this.dv.getUint8(this.n++);
      v += (b & 127) * 2 ** sh;
      if (!(b & 128)) return v;
      sh += 7;
      if (sh > 35) throw new Error('varint');
    }
  }
  i32() {
    const v = this.dv.getInt32(this.n, true);
    this.n += 4;
    return v;
  }
}

const enc8 = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const dec8 = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
/** 起きたことの JSON（数は小数 3 けたに丸める） */
const evJson = (ev) => JSON.stringify(ev, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v));

// ---- 起きたこと（2026-11-17〜 バイナリ）----
// いちばん多い「撃った」「輪ゴムが止まった」「当たった」は決まった形の数バイトで、ほかは JSON で送る（JSON の約 1/6）。
//   [u8 数] のあと 1 つずつ [u8 種類] [varint 知らせの通し番号 n] [中身]
//   1 撃った:   varint 輪ゴム id, i8 撃った犬, varint 端末での番号, u8 ゴムの種類, u8 武器, i16×3 位置, i16×3 速さ（1/100）
//   2 止まった: varint 輪ゴム id, i16×3 位置, i8 当たった犬（-1 なし・-2 猫）
//   3 当たった: u8 当てられた犬, i8 当てた犬, u16 ダメージ, u8 体力, i16×2 押される速さ（1/100）, u8 印（1 爆弾・2 頭）
//   0 そのほか: u16 長さ + JSON
const EV_KEYS = {
  shot: ['t', 'n', 'id', 'o', 'cid', 'k', 'w', 'x', 'y', 'z', 'vx', 'vy', 'vz'],
  end: ['t', 'n', 'id', 'x', 'y', 'z', 'h'],
  hit: ['t', 'n', 'v', 'by', 'd', 'hp', 'kx', 'kz', 'bm', 'hs'],
};
const fits = (e) => {
  const keys = EV_KEYS[e.t];
  if (!keys || !Number.isInteger(e.n) || e.n < 0 || (e.t !== 'hit' && !(Number.isInteger(e.id) && e.id >= 0))) return false;
  for (const k of Object.keys(e)) if (!keys.includes(k)) return false;
  return true;
};
const V = 100; // 速さの単位（1/100 m/s）

function writeEvents(w, evs) {
  const list = evs.slice(0, 255);
  w.u8(list.length);
  for (const e of list) {
    if (!fits(e)) {
      const js = enc8.encode(evJson(e));
      w.u8(0);
      w.u16(js.length);
      w.bytes(js);
      continue;
    }
    if (e.t === 'shot') {
      w.u8(1);
      w.vu(e.n);
      w.vu(e.id);
      w.i8(e.o);
      w.vu(e.cid || 0);
      w.u8(e.k || 0);
      w.u8(e.w || 0);
      for (const v of [e.x, e.y, e.z]) w.i16(v * POS);
      for (const v of [e.vx, e.vy, e.vz]) w.i16(v * V);
    } else if (e.t === 'end') {
      w.u8(2);
      w.vu(e.n);
      w.vu(e.id);
      for (const v of [e.x, e.y, e.z]) w.i16(v * POS);
      w.i8(e.h);
    } else {
      w.u8(3);
      w.vu(e.n);
      w.u8(e.v);
      w.i8(e.by);
      w.u16(e.d);
      w.u8(Math.max(0, Math.min(255, e.hp)));
      w.i16((e.kx || 0) * V);
      w.i16((e.kz || 0) * V);
      w.u8((e.bm ? 1 : 0) | (e.hs ? 2 : 0));
    }
  }
}

function readEvents(r) {
  const n = r.u8();
  const out = [];
  for (let k = 0; k < n; k++) {
    const ty = r.u8();
    if (ty === 0) {
      const len = r.u16();
      const e = JSON.parse(dec8.decode(r.u.subarray(r.n, r.n + len)));
      r.n += len;
      if (e && typeof e === 'object') out.push(e);
      continue;
    }
    const n = r.vu();
    if (ty === 1) {
      const id = r.vu();
      const e = { t: 'shot', n, id, o: r.i8(), cid: r.vu(), k: r.u8(), w: r.u8() };
      e.x = r.i16() / POS;
      e.y = r.i16() / POS;
      e.z = r.i16() / POS;
      e.vx = r.i16() / V;
      e.vy = r.i16() / V;
      e.vz = r.i16() / V;
      out.push(e);
    } else if (ty === 2) {
      const id = r.vu();
      const e = { t: 'end', n, id, x: r.i16() / POS, y: r.i16() / POS, z: r.i16() / POS, h: r.i8() };
      out.push(e);
    } else if (ty === 3) {
      const e = { t: 'hit', n, v: r.u8(), by: r.i8(), d: r.u16(), hp: r.u8(), kx: r.i16() / V, kz: r.i16() / V };
      const fl = r.u8();
      if (fl & 1) e.bm = 1;
      if (fl & 2) e.hs = 1;
      out.push(e);
    } else throw new Error('event');
  }
  return out;
}

/** ホスト: 試合の要約をバイト列に。withRs: ラウンドごとの点も載せる。ev: 起きたこと（なければ載せない） */
export function packBin(s, withRs = true, ev = null) {
  const w = new W();
  const evs = ev && ev.length ? ev : null;
  w.u8(BIN_V);
  w.u8(s.round);
  w.u8(Math.max(0, PH.indexOf(s.phase)) | (withRs ? 8 : 0) | (evs ? 16 : 0));
  w.i32(s.t * 1000);
  w.u8(s.players.length);
  for (const p of s.players) {
    w.i16(p.x * POS);
    w.i16(p.y * POS);
    w.i16(p.z * POS);
    w.u16((((p.yaw % TAU) + TAU) % TAU) * (65536 / TAU));
    w.i8((p.pitch / 1.5) * 127);
    w.u8((p.crouch ? FL.CROUCH : 0) | (p.moving ? FL.MOVING : 0) | (p.inv > 0 ? FL.INV : 0) | (p.stun > 0 ? FL.STUN : 0) | (p.stuck > 0 ? FL.STUCK : 0) | (p.shake > 0 ? FL.SHAKE : 0) | (p.noAmmo > 0 ? FL.NOAMMO : 0) | (p.reload > 0 ? FL.RELOAD : 0));
    w.u8(Math.max(0, Math.min(255, p.hp)));
    w.u8(p.item & 15);
    w.u8(p.g);
    w.u8(Math.ceil(p.dead * 20));
    w.u16(p.score);
    w.u8(p.kills);
    w.u8(p.deaths);
    w.u8(Math.ceil(Math.max(p.shake, p.noAmmo, p.stuck) * 20));
    w.u8((p.weapon | 0) | (p.picked ? 4 : 0) | ((((s.teams?.[p.i] ?? -1) + 1) & 3) << 3) | ((Math.min(7, p.bombs | 0) & 7) << 5)); // チーム（ホストが決めたもの）・残りの爆弾
    w.u8(Math.min(255, p.hs | 0)); // ヘッドショットの数
    w.u8(p.shots ? Math.round((p.landed / p.shots) * 100) : 0); // 命中率（%）
    w.u8(p.weapon | 0); // 武器（マシンガンは 4。上の 2 ビットでは足りないので別に）
  }
  w.u16(s.boxes.reduce((m, t, k) => (t > 0 ? m : m | (1 << k)), 0));
  w.u16((s.heals || []).reduce((m, t, k) => (t > 0 ? m : m | (1 << k)), 0)); // 回復のおやつ（出ているもの）
  // 補給箱（なければ 0。差分が効くように、いつも同じ長さ）と突風
  w.u8(s.drop ? 1 : 0);
  w.i16(s.drop ? s.drop.x * POS : 0);
  w.i16(s.drop ? s.drop.z * POS : 0);
  w.i16(s.drop ? s.drop.y * 100 : 0);
  const wd = s.wind || { x: 0, z: 0, t: 0 };
  w.i8(wd.x * 10);
  w.i8(wd.z * 10);
  w.u8(Math.ceil(wd.t * 10));
  // 風船（浮かんでいるもの）・雨や雪
  w.u8((s.balloons || []).reduce((m, t, k) => (t > 0 ? m : m | (1 << k)), 0));
  w.u8(Math.ceil(s.rain || 0));
  w.u8(s.wx | 0); // 天気の種類（0 なし・1 雨・2 雪）
  const mov = s.mov || [];
  w.u8(mov.length);
  for (const b of mov) {
    w.i16(((b.x0 + b.x1) / 2) * POS);
    w.i16(((b.z0 + b.z1) / 2) * POS);
  }
  // ボス戦の猫（いなければ 0）と、ラウンドごとに猫を倒せたか
  const b = s.boss;
  w.u8((b ? 1 : 0) | ((s.bossWon || []).reduce((m, x, k) => (x ? m | (2 << k) : m), 0)));
  if (b) {
    w.i16(b.x * POS);
    w.i16(b.y * POS);
    w.i16(b.z * POS);
    w.u16((((b.yaw % TAU) + TAU) % TAU) * (65536 / TAU));
    w.u16(b.hp);
    w.u16(b.max);
    w.u8(Math.max(0, BOSS_ST.indexOf(b.st)));
    w.u8(Math.min(12, b.t) * 20);
    w.u8(Math.ceil(Math.max(b.dizzy, b.stuck) * 20));
  }
  // ---- ここから下は数が変わるもの（前の配信との差分で、上の並びがずれないように後ろへ） ----
  const dcs = (s.decoys || []).slice(0, 8);
  w.u8(dcs.length);
  for (const d of dcs) {
    w.i32(d.id);
    w.u8(d.o);
    w.i16(d.x * POS);
    w.i16(d.y * POS);
    w.i16(d.z * POS);
    w.u16((((d.yaw % TAU) + TAU) % TAU) * (65536 / TAU));
  }
  w.u8(s.smokes.length);
  for (const x of s.smokes) {
    w.i32(x.id); // 番号はほかの知らせ（消えた など）と同じものを使う
    w.i16(x.x * POS);
    w.i16(x.y * POS);
    w.i16(x.z * POS);
    w.u8(x.age * 20);
  }
  w.u8(s.gums.length);
  for (const x of s.gums) {
    w.i32(x.id);
    w.i16(x.x * POS);
    w.i16(x.y * POS);
    w.i16(x.z * POS);
  }
  if (withRs) for (const p of s.players) for (let r = 0; r < 3; r++) w.u16(p.rs[r] || 0);
  if (evs) writeEvents(w, evs);
  return w.out();
}

/** ゲスト: バイト列を読む（unpackState と同じ形。ラウンドごとの点が載っていなければ prevRs を使う）。{ st, ev } */
export function unpackBin(u8, n, prevRs = null) {
  try {
    const r = new R(u8);
    if (r.u8() !== BIN_V) return null;
    const round = Math.min(2, r.u8());
    const f = r.u8();
    const phase = PH[f & 7] || 'play';
    const withRs = !!(f & 8);
    const t = r.i32() / 1000;
    const np = Math.min(r.u8(), 16);
    const all = [];
    for (let i = 0; i < np; i++) {
      const p = { i, x: r.i16() / POS, y: r.i16() / POS, z: r.i16() / POS };
      let yaw = (r.u16() * TAU) / 65536;
      if (yaw > Math.PI) yaw -= TAU;
      p.yaw = yaw;
      p.pitch = (r.i8() / 127) * 1.5;
      const fl = r.u8();
      Object.assign(p, { crouch: !!(fl & FL.CROUCH), moving: !!(fl & FL.MOVING), inv: fl & FL.INV ? 1 : 0, stun: fl & FL.STUN ? 1 : 0, stuck: fl & FL.STUCK ? 1 : 0, shake: fl & FL.SHAKE ? 1 : 0, noAmmo: fl & FL.NOAMMO ? 1 : 0, reloading: !!(fl & FL.RELOAD) });
      p.hp = r.u8();
      p.item = r.u8() & 15;
      p.g = r.u8();
      p.dead = r.u8() / 20;
      p.score = r.u16();
      p.kills = r.u8();
      p.deaths = r.u8();
      p.fxT = r.u8() / 20;
      const wb = r.u8();
      p.weapon = wb & 3;
      p.picked = !!(wb & 4);
      p.team = ((wb >> 3) & 3) - 1;
      p.bombs = (wb >> 5) & 7;
      p.hs = r.u8();
      p.acc = r.u8();
      p.weapon = r.u8();
      all.push(p);
    }
    const boxes = r.u16();
    const heals = r.u16();
    const hasDrop = r.u8();
    const dx = r.i16() / POS;
    const dz = r.i16() / POS;
    const dy = r.i16() / 100;
    const drop = hasDrop ? { x: dx, z: dz, y: dy } : null;
    const wind = { x: r.i8() / 10, z: r.i8() / 10, t: r.u8() / 10 };
    const balloons = r.u8();
    const rain = r.u8();
    const wx = r.u8();
    const mov = Array.from({ length: Math.min(r.u8(), 32) }, () => [r.i16() / POS, r.i16() / POS]);
    const bf = r.u8();
    const bossWon = [0, 1, 2].map((k) => !!(bf & (2 << k)));
    let boss = null;
    if (bf & 1) {
      boss = { x: r.i16() / POS, y: r.i16() / POS, z: r.i16() / POS };
      let yaw = (r.u16() * TAU) / 65536;
      if (yaw > Math.PI) yaw -= TAU;
      boss.yaw = yaw;
      boss.hp = r.u16();
      boss.max = Math.max(1, r.u16());
      boss.st = BOSS_ST[r.u8()] || 'walk';
      boss.t = r.u8() / 20;
      boss.fx = r.u8() / 20;
    }
    const decoys = Array.from({ length: Math.min(r.u8(), 8) }, () => ({ id: r.i32(), o: r.u8(), x: r.i16() / POS, y: r.i16() / POS, z: r.i16() / POS, yaw: (r.u16() * TAU) / 65536 }));
    const smokes = Array.from({ length: Math.min(r.u8(), 16) }, () => ({ id: r.i32(), x: r.i16() / POS, y: r.i16() / POS, z: r.i16() / POS, age: r.u8() / 20 }));
    const gums = Array.from({ length: Math.min(r.u8(), 16) }, () => ({ id: r.i32(), x: r.i16() / POS, y: r.i16() / POS, z: r.i16() / POS }));
    for (const p of all) p.rs = withRs ? [r.u16(), r.u16(), r.u16()] : prevRs?.[p.i] ? prevRs[p.i].slice() : [0, 0, 0];
    const players = all.slice(0, n);
    let ev = [];
    if (f & 16) ev = readEvents(r);
    return { st: { round, phase, t, players, boxes, heals, drop, wind, balloons, rain, wx, decoys, smokes, gums, mov, boss, bossWon }, ev };
  } catch {
    return null;
  }
}

/** 中継（文字しか通らない）で送るための base64 */
export function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
export function fromB64(str) {
  const s = atob(str);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

// ---- ゲスト → ホスト: 撃った・当たったのバイナリ（JSON の約 1/5）----
//   1 撃った:   i16×3 目の位置（1/500 m）, i16×3 向き（1/30000）, u8 ゴムの種類, varint 端末での番号
//   2 当たった: varint 輪ゴムの番号, u8 当てた犬, i16×3 当たった場所（1/500 m）
const DIR = 30000;
export function packFire(o, d, k, c) {
  const w = new W();
  w.u8(1);
  for (const v of o) w.i16(v * POS);
  for (const v of d) w.i16(v * DIR);
  w.u8(k | 0);
  w.vu(c);
  return w.out();
}
export function packRemoteHit(c, v, p) {
  const w = new W();
  w.u8(2);
  w.vu(c);
  w.u8(v);
  for (const x of p) w.i16(x * POS);
  return w.out();
}
/** ゲストからのバイナリを、JSON のメッセージと同じ形 { t: 'f', o, d, k, c } / { t: 'h', c, v, p } に。壊れていれば null */
export function unpackGameBin(u8) {
  try {
    const r = new R(u8);
    const ty = r.u8();
    if (ty === 1) {
      const o = [r.i16() / POS, r.i16() / POS, r.i16() / POS];
      const d = [r.i16() / DIR, r.i16() / DIR, r.i16() / DIR];
      return { t: 'f', o, d, k: r.u8(), c: r.vu() };
    }
    if (ty === 2) {
      const c = r.vu();
      const v = r.u8();
      return { t: 'h', c, v, p: [r.i16() / POS, r.i16() / POS, r.i16() / POS] };
    }
  } catch {
    /* 壊れている */
  }
  return null;
}
