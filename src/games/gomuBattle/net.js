// 通信の形。
// - ゲスト → ホスト: 自分の犬の位置・向き（11 バイト。操作の通り道 sendInput で、毎秒 30 回）
// - ホスト → 全員: 試合の要約（毎秒 20 回）と、起きたこと（撃った・当たった・倒れた…）

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
    ]),
    bx: s.boxes.reduce((m, t, k) => (t > 0 ? m : m | (1 << k)), 0),
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
      hp: num(a[6], 3),
      item: num(a[7]) | 0,
      g: num(a[8]) | 0,
      score: num(a[9]) | 0,
      dead: num(a[10]),
      kills: num(a[11]) | 0,
      deaths: num(a[12]) | 0,
      rs: Array.isArray(a[13]) ? a[13].map((x) => num(x) | 0) : [0, 0, 0],
      fxT: num(a[14]),
    };
  });
  return {
    round: Math.max(0, Math.min(2, num(o.r) | 0)),
    phase: ['intro', 'play', 'end', 'done'].includes(o.ph) ? o.ph : 'play',
    t: num(o.t),
    players,
    boxes: num(o.bx) | 0,
    smokes: Array.isArray(o.sm) ? o.sm.filter(Array.isArray).map((x) => ({ id: num(x[0]), x: num(x[1]), y: num(x[2]), z: num(x[3]), age: num(x[4]) })) : [],
    gums: Array.isArray(o.gm) ? o.gm.filter(Array.isArray).map((x) => ({ id: num(x[0]), x: num(x[1]), y: num(x[2]), z: num(x[3]) })) : [],
    mov: Array.isArray(o.mv) ? o.mv.slice(0, 16).map((x) => (Array.isArray(x) ? [num(x[0]), num(x[1])] : [0, 0])) : [],
  };
}
