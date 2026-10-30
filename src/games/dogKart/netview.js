// 受け取る側（サーバーやホストが計算した結果を表示する端末）の表示の計算。画面・Three.js には依存しない。
//   Predictor:   自分の車のクライアント予測（操作をすぐ反映し、確定状態との差を少しずつ直す）
//   RemoteKarts: ほかの車を、自分の車と同じ時刻まで先へ計算して表示する

import { stepKart, PHYS_KEYS } from './physics.js';
import { NET } from './constants.js';
import { lerp, lerpAngle, angleDiff } from '../../core/util.js';

const velX = (k) => Math.sin(k.h) * k.sp + k.kx;
const velZ = (k) => Math.cos(k.h) * k.sp + k.kz;

/**
 * 見た目のずれ o を 0 へ戻す。位置と向きは臨界減衰のばね（w: 固有角速度。速度もつながる）、高さは指数的に。
 * ばねは厳密な解で進めるので、端末が重くて 1 フレームが長くても発散しない。
 */
function springBack(o, w, dt) {
  const e = Math.exp(-w * dt);
  const step = (x, v) => {
    const c = v + w * x;
    return [(x + c * dt) * e, (v - w * c * dt) * e];
  };
  [o.x, o.vx] = step(o.x, o.vx);
  [o.z, o.vz] = step(o.z, o.vz);
  [o.h, o.vh] = step(o.h, o.vh);
  o.y *= Math.exp(-dt * 8);
}

/** 自分の車のクライアント予測 */
export class Predictor {
  constructor() {
    this.k = null;
    this.hist = [];
    this.off = { x: 0, z: 0, y: 0, h: 0, vx: 0, vz: 0, vh: 0 };
  }

  reset(k) {
    this.k = structuredClone(k);
    this.hist = [];
    this.off = { x: 0, z: 0, y: 0, h: 0, vx: 0, vz: 0, vh: 0 };
  }

  record(seq) {
    const e = { seq };
    for (const key of PHYS_KEYS) e[key] = this.k[key];
    this.hist.push(e);
    if (this.hist.length > 240) this.hist.shift();
  }

  /** server: ホストが確定したゲストの車, ack: そのとき適用済みだった入力 seq */
  reconcile(server, ack) {
    if (!this.k) {
      this.reset(server);
      return;
    }
    for (const f of ['lap', 'cp', 'item', 'roll', 'fin', 'ft', 'lapStart', 'best', 'stats', 'spinDur', 'wrong', 'bump', 'fd', 'ow']) this.k[f] = server[f];
    // タイミングブーストは自分の画面（予測）で進める。ホストのほうが先に進んでいたら合わせる
    if (server.tb > this.k.tb) {
      this.k.tb = server.tb;
      this.k.tw = server.tw;
    }
    while (this.hist.length && this.hist[0].seq < ack) this.hist.shift();
    const e = this.hist[0];
    if (!e || e.seq !== ack) {
      // 対応する履歴がない（再開直後など）: 大きくずれていれば合わせる
      if (Math.hypot(server.x - this.k.x, server.z - this.k.z) > NET.SNAP_DIST * 2) this.reset(server);
      return;
    }
    const dx = server.x - e.x;
    const dz = server.z - e.z;
    const dh = angleDiff(e.h, server.h);
    if (Math.hypot(dx, dz) > NET.SNAP_DIST || Math.abs(dh) > 1.5) {
      // 復帰などの瞬間移動はそのまま合わせる
      for (const key of PHYS_KEYS) this.k[key] = server[key];
      this.hist = [];
      this.off = { x: 0, z: 0, y: 0, h: 0, vx: 0, vz: 0, vh: 0 };
      return;
    }
    // 補正の前後で速度が変わる分も見た目のずれに入れて、動きの速さ・向きの変わり方がつながるようにする
    const k = this.k;
    const vx0 = velX(k);
    const vz0 = velZ(k);
    for (const key of PHYS_KEYS) {
      const d = key === 'h' ? dh : server[key] - e[key];
      if (Math.abs(d) < 1e-7) continue;
      this.k[key] += d;
      for (const h of this.hist) h[key] += d;
    }
    for (const key of ['spin', 'boost', 'slow', 'inv', 'rc']) this.k[key] = Math.max(0, this.k[key]);
    if (this.k.y < 0) this.k.y = 0;
    // 見た目は急に動かさず、補正量を少しずつ反映する
    this.off.x -= dx;
    this.off.z -= dz;
    this.off.h -= dh;
    this.off.vx += vx0 - velX(k);
    this.off.vz += vz0 - velZ(k);
  }

  decay(dt) {
    springBack(this.off, NET.OWN_SMOOTH, dt);
  }
}

/**
 * ほかの車（人・NPC）を、自分の車と同じ時刻まで先に進めて表示する。
 * 自分の車は操作がすぐ反映されるよう、サーバーの確定状態より「まだサーバーに届いていない操作の分」だけ先を走っている。
 * ほかの車をサーバーの確定状態（過去）のまま描くと、実際より後ろに見えて、当たる位置や順位が見た目と食い違う。
 * そこで、確定状態からその車の今の操作（in）のまま同じ tick 数だけ先へ計算して描く。操作が変わったときのずれは少しずつ吸収する。
 */
export class RemoteKarts {
  constructor() {
    this.reset();
  }

  reset() {
    this.g = []; // 車ごとの「今の時刻」の推定
    this.p = []; // 1 tick 前の推定（画面の更新との間を補間する）
    this.off = []; // 見た目のずれ（少しずつ 0 に戻す）
  }

  /** karts: 最新の確定状態、ahead: 自分の車がそれより何 tick 先か */
  sync(karts, me, ahead, track, active, dt) {
    for (let i = 0; i < karts.length; i++) {
      if (i === me) {
        this.g[i] = null;
        continue;
      }
      const k = { ...karts[i] };
      let prev = { x: k.x, z: k.z, y: k.y, h: k.h };
      for (let t = 0; t < ahead; t++) {
        prev = { x: k.x, z: k.z, y: k.y, h: k.h };
        stepKart(k, k.in, dt, track, active, true);
      }
      const old = this.g[i];
      const o = this.off[i] || (this.off[i] = { x: 0, z: 0, y: 0, h: 0, vx: 0, vz: 0, vh: 0 });
      if (old) {
        // 今まで描いていた位置・速度から急に変えない。差を「見た目のずれ」として持ち、ばねのように滑らかに 0 へ戻す
        // （位置だけでなく速度もつながるので、補正のたびに向きがカクッと変わらない）
        const dx = old.x + o.x - k.x;
        const dz = old.z + o.z - k.z;
        if (Math.hypot(dx, dz) > NET.SNAP_DIST * 2) {
          o.x = o.z = o.y = o.h = o.vx = o.vz = o.vh = 0; // 復帰などの瞬間移動はそのまま
        } else {
          o.vx += velX(old) - velX(k);
          o.vz += velZ(old) - velZ(k);
          o.vh += angleDiff(this.p[i]?.h ?? old.h, old.h) / dt - angleDiff(prev.h, k.h) / dt;
          o.x = dx;
          o.z = dz;
          o.y = old.y + o.y - k.y;
          o.h = angleDiff(k.h, old.h + o.h);
        }
      }
      this.g[i] = k;
      this.p[i] = prev;
    }
    this.g.length = this.p.length = karts.length;
  }

  /** 1 tick 進める（自分の車の予測と同じタイミングで） */
  step(track, active, dt) {
    for (let i = 0; i < this.g.length; i++) {
      const k = this.g[i];
      if (!k) continue;
      this.p[i] = { x: k.x, z: k.z, y: k.y, h: k.h };
      stepKart(k, k.in, dt, track, active, true);
    }
  }

  decay(dt) {
    for (const o of this.off) if (o) springBack(o, NET.REMOTE_SMOOTH, dt);
  }

  /** 描く位置（al: 直前の tick との間の割合） */
  view(i, al) {
    const k = this.g[i];
    if (!k) return null;
    const p = this.p[i] || k;
    const o = this.off[i];
    return { ...k, x: lerp(p.x, k.x, al) + o.x, z: lerp(p.z, k.z, al) + o.z, y: Math.max(0, lerp(p.y, k.y, al) + o.y), h: lerpAngle(p.h, k.h, al) + o.h };
  }
}

