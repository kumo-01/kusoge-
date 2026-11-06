// カートのモデルと見た目のアニメーション（犬が運転席に乗る）
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildDog } from './dog.js';
import { KART, ITEMS } from './constants.js';

const shared = {};
function once(key, make) {
  return shared[key] || (shared[key] = make());
}
const toon = (color, extra) => new THREE.MeshToonMaterial({ color, ...extra });

function pawTexture(color) {
  return once(`paw-${color}`, () => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#fff8e6';
    x.beginPath();
    x.arc(64, 64, 60, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = color;
    x.beginPath();
    x.ellipse(64, 78, 24, 20, 0, 0, Math.PI * 2);
    x.fill();
    for (const [px, py] of [[34, 50], [52, 34], [76, 34], [94, 50]]) {
      x.beginPath();
      x.ellipse(px, py, 10, 12, 0, 0, Math.PI * 2);
      x.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

const PALETTE = {
  0: { main: 0xff4d5e, dark: 0xc92a3e, accent: 0xffd23f, css: '#e8384f', flag: 0xffd23f },
  1: { main: 0x3d8bff, dark: 0x1f5fd1, accent: 0x7ff0c8, css: '#2f6fe0', flag: 0xffffff },
  2: { main: 0xff8fd0, dark: 0xd85fa6, accent: 0xffffff, css: '#d85fa6', flag: 0xffffff }, // NPC プードル
  3: { main: 0xffc93c, dark: 0xd99a14, accent: 0x5a3e2b, css: '#b07a00', flag: 0x5a3e2b }, // NPC パグ
  4: { main: 0x22b573, dark: 0x168a55, accent: 0xffd23f, css: '#168a55', flag: 0xffd23f }, // NPC ダックス
  5: { main: 0x8a63ff, dark: 0x6340d6, accent: 0xb8f2ff, css: '#6340d6', flag: 0xffffff }, // NPC ハスキー
  6: { main: 0x2b2b3a, dark: 0x14141c, accent: 0xff3b3b, css: '#c0182b', flag: 0xff3b3b }, // ボス犬 ドーベルマン
  // NPC を増やしたとき用（犬の種類は同じで、カートの色がちがう）
  7: { main: 0xff7a2f, dark: 0xd4561a, accent: 0xfff1c9, css: '#d4561a', flag: 0xffffff }, // 豆柴
  8: { main: 0x2ec4d6, dark: 0x1a95a6, accent: 0xffffff, css: '#1a95a6', flag: 0xffffff }, // ちびコーギー
  9: { main: 0xa0e05a, dark: 0x6fb12f, accent: 0x40305a, css: '#5f9a24', flag: 0x40305a }, // トイプードル
  10: { main: 0xb07a52, dark: 0x8a5833, accent: 0xffe0a0, css: '#8a5833', flag: 0xffe0a0 }, // ブルパグ
  11: { main: 0xe0e4ee, dark: 0x9aa2b5, accent: 0xff5c8a, css: '#7d8599', flag: 0xff5c8a }, // シベリアン
  12: { main: 0xff5fa2, dark: 0xd63d80, accent: 0xfff1c9, css: '#d63d80', flag: 0xffffff }, // チワワ
  13: { main: 0x3fb8a0, dark: 0x288a76, accent: 0xffd23f, css: '#288a76', flag: 0xffd23f }, // ビーグル
  14: { main: 0x4a5fd8, dark: 0x3344a8, accent: 0xffe066, css: '#3344a8', flag: 0xffe066 }, // ゴールデン
};
const DOG_KINDS = ['shiba', 'corgi', 'poodle', 'pug', 'dachs', 'husky', 'doberman', 'shiba', 'corgi', 'poodle', 'pug', 'husky', 'chihuahua', 'beagle', 'golden'];

/**
 * 乗り物ごとの配置（見た目だけ。速さ・当たり判定はどれも同じ）。
 * dog: 犬の位置, flames: ブーストの炎, antenna: アンテナの根元, lean: 曲がるときの傾き（マイナスは内側へ傾く）
 */
const VEH = [
  { dog: [0, 0.62, -0.45], flames: [[-0.45, 0.55, -1.9], [0.45, 0.55, -1.9]], antenna: [0.7, 1.0, -1.1], lean: 0.14, lights: [[-0.5, 0.6, 2.0], [0.5, 0.6, 2.0]] }, // カート
  { dog: [0, 0.98, -0.42], flames: [[0, 0.62, -1.7]], antenna: [0, 1.15, -1.25], lean: -0.32, lights: [[0, 1.0, 1.5]] }, // バイク
  { dog: [0, 0.98, 0.15], flames: [[-0.45, 0.4, -1.55], [0.45, 0.4, -1.55]], antenna: [0.75, 1.75, -1.25], lean: 0.08, lights: [[-0.6, 0.85, 1.25], [0.6, 0.85, 1.25]] }, // ショッピングカート（カゴに乗る）
  { dog: [0, 0.9, -0.35], flames: [[-0.5, 0.45, -1.3], [0.5, 0.45, -1.3]], antenna: [0.45, 1.0, -0.95], lean: 0.1, lights: [[0, 1.05, 1.15]] }, // 三輪車
];

/** スピン中の見た目の回転角（状態から決まるのでホストとゲストで同じ） */
export function spinAngleOf(r) {
  return r.spin > 0 ? Math.pow(1 - r.spin / Math.max(0.1, r.spinDur), 0.7) * Math.PI * 4 : 0;
}

export class KartView {
  /** index: 見た目の番号（犬とカートの色）, veh: 乗り物（0 カート / 1 バイク / 2 ショッピングカート / 3 三輪車） */
  constructor(index, veh = 0) {
    const pal = PALETTE[index] || PALETTE[0];
    this.style = index;
    this.veh = veh = VEH[veh] ? veh : 0;
    const lay = VEH[veh];
    this.lean = lay.lean;
    this.group = new THREE.Group();
    this.body = new THREE.Group(); // 傾き・跳ね用
    this.group.add(this.body);
    const main = toon(pal.main);
    const dark = toon(pal.dark);
    const accent = toon(pal.accent);
    const black = once('m-black', () => toon(0x2b2b33));
    const white = once('m-white', () => toon(0xffffff));
    const chrome = once('m-chrome', () => new THREE.MeshStandardMaterial({ color: 0xdddde6, metalness: 0.8, roughness: 0.25 }));
    this._mats = [main, dark, accent];

    const add = (geo, mat, pos, rot, parent = this.body) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(...pos);
      if (rot) o.rotation.set(...rot);
      o.castShadow = true;
      parent.add(o);
      return o;
    };

    // 動かない部品は材質ごとに 1 つのメッシュにまとめる（描画の呼び出しを減らす）
    const statics = new Map();
    const tmpM = new THREE.Matrix4();
    const tmpQ = new THREE.Quaternion();
    const tmpE = new THREE.Euler();
    const tmpV = new THREE.Vector3();
    const tmpS = new THREE.Vector3(1, 1, 1);
    const addS = (geo, mat, pos, rot) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      tmpE.set(...(rot || [0, 0, 0]));
      g.applyMatrix4(tmpM.compose(tmpV.set(...pos), tmpQ.setFromEuler(tmpE), tmpS));
      if (!statics.has(mat)) statics.set(mat, []);
      statics.get(mat).push(g);
    };

    // ハンドル（カートは丸いハンドル。ほかは見た目だけの空のもの）
    this.wheel = new THREE.Group();
    this.body.add(this.wheel);
    // タイヤ（ふつうは車に付ける。バイクは車体と一緒に傾くので車体に付ける）
    this.wheels = [];
    this.frontPivots = [];
    const tireGeo = once('g-tire', () => new THREE.CylinderGeometry(0.46, 0.46, 0.42, 16));
    const capGeo = once('g-cap', () => new THREE.CylinderGeometry(0.22, 0.22, 0.44, 12));
    const addWheel = (x, y, z, r, w, front, parent = this.group, spokes = accent) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      parent.add(pivot);
      const spin = new THREE.Group();
      spin.scale.set(w / 0.42, r / 0.46, r / 0.46);
      pivot.add(spin);
      const tire = add(tireGeo, black, [0, 0, 0], [0, 0, Math.PI / 2], spin);
      add(capGeo, white, [0, 0, 0], [0, 0, Math.PI / 2], spin);
      add(once('g-spoke', () => new THREE.BoxGeometry(0.46, 0.08, 0.5)), spokes, [0, 0, 0], null, spin);
      tire.receiveShadow = false;
      this.wheels.push(spin);
      if (front) this.frontPivots.push(pivot);
      (this._pivots ||= []).push(pivot);
      return pivot;
    };
    const tube = (len, r = 0.07) => once(`g-tube-${len}-${r}`, () => new THREE.CylinderGeometry(r, r, len, 6));
    let emblemAt = null; // 肉球のエンブレム [位置, 向き]

    if (veh === 0) {
      // ---- カート ----
      addS(once('g-chassis', () => new RoundedBoxGeometry(1.9, 0.55, 2.9, 3, 0.22)), main, [0, 0.55, 0]);
      addS(once('g-nose', () => new RoundedBoxGeometry(1.5, 0.42, 0.9, 3, 0.18)), main, [0, 0.5, 1.55]);
      addS(once('g-bumper', () => new RoundedBoxGeometry(1.7, 0.28, 0.32, 2, 0.12)), black, [0, 0.36, 2.0]);
      addS(once('g-stripe', () => new THREE.BoxGeometry(0.4, 0.05, 2.6)), accent, [0, 0.84, 0.05]);
      addS(once('g-sidepod', () => new RoundedBoxGeometry(0.35, 0.4, 1.8, 2, 0.14)), dark, [-1.02, 0.5, -0.1]);
      addS(once('g-sidepod', () => null), dark, [1.02, 0.5, -0.1]);
      emblemAt = [[0, 0.73, 1.55], [-Math.PI / 2 + 0.25, 0, 0]];
      // シート
      addS(once('g-seat', () => new RoundedBoxGeometry(1.1, 0.9, 0.3, 2, 0.12)), dark, [0, 1.1, -0.95], [-0.15, 0, 0]);
      addS(once('g-cushion', () => new RoundedBoxGeometry(1.0, 0.2, 0.9, 2, 0.08)), dark, [0, 0.86, -0.45]);
      // スポイラー
      addS(once('g-post', () => new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6)), black, [-0.55, 1.0, -1.35]);
      addS(once('g-post', () => null), black, [0.55, 1.0, -1.35]);
      addS(once('g-wing', () => new RoundedBoxGeometry(1.9, 0.1, 0.5, 2, 0.04)), accent, [0, 1.26, -1.4]);
      // マフラー
      for (const sx of [-0.45, 0.45]) addS(once('g-pipe', () => new THREE.CylinderGeometry(0.11, 0.13, 0.5, 10)), chrome, [sx, 0.55, -1.6], [Math.PI / 2, 0, 0]);
      // ライト
      for (const sx of [-0.5, 0.5]) addS(once('g-light', () => new THREE.SphereGeometry(0.14, 10, 8)), once('m-light', () => new THREE.MeshBasicMaterial({ color: 0xfff6b0 })), [sx, 0.6, 1.98]);
      // ハンドル
      addS(once('g-column', () => new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6)), black, [0, 0.95, 0.55], [0.9, 0, 0]);
      this.wheel.position.set(0, 1.08, 0.33);
      this.wheel.rotation.set(-0.65, 0, 0);
      add(once('g-steer', () => new THREE.TorusGeometry(0.3, 0.06, 8, 18)), black, [0, 0, 0], null, this.wheel);
      add(once('g-hub', () => new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8)), accent, [0, 0, 0], [Math.PI / 2, 0, 0], this.wheel);
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) addWheel(sx * 1.02, 0.46, sz * 1.02, 0.46, 0.42, sz > 0);
    } else if (veh === 1) {
      // ---- バイク（スクーター風）: 前後に大きなタイヤ。曲がるときは内側へ傾く ----
      addS(once('g-bk-body', () => new RoundedBoxGeometry(0.75, 0.55, 2.1, 3, 0.22)), main, [0, 0.72, -0.25]);
      addS(once('g-bk-tank', () => new RoundedBoxGeometry(0.85, 0.5, 0.8, 3, 0.2)), main, [0, 1.0, 0.45], [0.25, 0, 0]);
      addS(once('g-bk-stripe', () => new THREE.BoxGeometry(0.2, 0.05, 1.9)), accent, [0, 1.0, -0.3]);
      addS(once('g-bk-seat', () => new RoundedBoxGeometry(0.62, 0.18, 1.0, 2, 0.08)), dark, [0, 1.06, -0.45]);
      addS(once('g-bk-back', () => new RoundedBoxGeometry(0.62, 0.45, 0.16, 2, 0.06)), dark, [0, 1.3, -0.98], [-0.2, 0, 0]);
      addS(once('g-bk-fender', () => new THREE.CylinderGeometry(0.62, 0.62, 0.4, 14, 1, true, -Math.PI / 2, Math.PI)), dark, [0, 0.62, -1.2], [0, 0, Math.PI / 2]);
      addS(once('g-pipe', () => new THREE.CylinderGeometry(0.11, 0.13, 0.5, 10)), chrome, [0.38, 0.5, -1.3], [Math.PI / 2, 0, 0]);
      addS(once('g-light', () => new THREE.SphereGeometry(0.14, 10, 8)), once('m-light', () => new THREE.MeshBasicMaterial({ color: 0xfff6b0 })), [0, 1.0, 1.42]);
      emblemAt = [[0, 1.18, 0.62], [-Math.PI / 2 + 0.6, 0, 0]];
      // 前輪（フォーク・ハンドルごと曲がる）
      const fp = addWheel(0, 0.55, 1.15, 0.55, 0.28, true, this.body, accent);
      const fork = new THREE.Group();
      fp.add(fork);
      for (const sx of [-0.2, 0.2]) add(tube(1.0, 0.05), chrome, [sx, 0.45, -0.12], [-0.25, 0, 0], fork);
      add(once('g-bk-bar', () => new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6)), black, [0, 0.98, -0.28], [0, 0, Math.PI / 2], fork);
      for (const sx of [-0.6, 0.6]) add(once('g-bk-grip', () => new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8)), accent, [sx, 0.98, -0.28], [0, 0, Math.PI / 2], fork);
      addWheel(0, 0.55, -1.2, 0.55, 0.32, false, this.body, accent);
    } else if (veh === 2) {
      // ---- ショッピングカート: 金網のカゴに犬が乗る。後ろに持ち手、下に小さな車輪 ----
      const wire = once('m-wire', () => new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.6, roughness: 0.35 }));
      const W = 1.7; // カゴの幅
      const L = 2.3; // カゴの長さ
      const y0 = 0.78; // カゴの底
      const H = 0.95; // カゴの高さ
      // 底（板）と、縦・横の針金
      addS(once('g-sc-floor', () => new THREE.BoxGeometry(W, 0.06, L)), wire, [0, y0, 0]);
      for (let j = 0; j <= 6; j++) {
        const z = -L / 2 + (L * j) / 6;
        for (const sx of [-1, 1]) addS(tube(H, 0.03), wire, [(sx * W) / 2, y0 + H / 2, z]);
      }
      for (let j = 0; j <= 4; j++) {
        const x = -W / 2 + (W * j) / 4;
        for (const sz of [-1, 1]) addS(tube(H, 0.03), wire, [x, y0 + H / 2, (sz * L) / 2]);
      }
      for (const yy of [y0 + H * 0.5, y0 + H]) {
        for (const sx of [-1, 1]) addS(tube(L, 0.035), wire, [(sx * W) / 2, yy, 0], [Math.PI / 2, 0, 0]);
        for (const sz of [-1, 1]) addS(tube(W, 0.035), wire, [0, yy, (sz * L) / 2], [0, 0, Math.PI / 2]);
      }
      // ふち（色つきのプラスチック）と持ち手
      for (const sx of [-1, 1]) addS(once('g-sc-rim', () => new RoundedBoxGeometry(0.12, 0.12, L + 0.1, 2, 0.05)), main, [(sx * W) / 2, y0 + H, 0]);
      addS(once('g-sc-rimf', () => new RoundedBoxGeometry(W + 0.1, 0.12, 0.12, 2, 0.05)), main, [0, y0 + H, L / 2]);
      for (const sx of [-0.7, 0.7]) addS(tube(0.7, 0.05), wire, [sx, y0 + H + 0.2, -L / 2 - 0.2], [-0.6, 0, 0]);
      addS(once('g-sc-handle', () => new RoundedBoxGeometry(1.7, 0.16, 0.16, 2, 0.07)), main, [0, y0 + H + 0.42, -L / 2 - 0.42]);
      // 下の台と脚
      addS(once('g-sc-rack', () => new THREE.BoxGeometry(W - 0.3, 0.05, L - 0.4)), wire, [0, 0.3, -0.1]);
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) addS(tube(0.6, 0.05), wire, [sx * (W / 2 - 0.12), 0.55, sz * (L / 2 - 0.15)]);
      emblemAt = [[0, y0 + H * 0.5, L / 2 + 0.05], [0, 0, 0]];
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) addWheel(sx * (W / 2 - 0.12), 0.24, sz * (L / 2 - 0.15), 0.24, 0.16, sz > 0, this.group, black);
    } else {
      // ---- 三輪車: 前に大きなタイヤとペダル、後ろに小さなタイヤ 2 つ ----
      addS(tube(1.9, 0.09), main, [0, 0.72, 0.1], [Math.PI / 2 - 0.12, 0, 0]);
      addS(tube(1.3, 0.08), main, [0, 0.42, -0.9], [0, 0, Math.PI / 2]);
      addS(once('g-tr-deck', () => new RoundedBoxGeometry(1.1, 0.12, 0.5, 2, 0.05)), dark, [0, 0.5, -0.95]);
      addS(once('g-tr-seat', () => new RoundedBoxGeometry(0.75, 0.2, 0.7, 2, 0.09)), dark, [0, 1.12, -0.4]);
      addS(once('g-tr-back', () => new RoundedBoxGeometry(0.7, 0.5, 0.14, 2, 0.06)), dark, [0, 1.35, -0.78], [-0.2, 0, 0]);
      addS(tube(0.55, 0.07), main, [0, 0.85, -0.4]);
      addS(once('g-tr-bell', () => new THREE.SphereGeometry(0.13, 10, 8)), chrome, [0.32, 1.42, 0.95]);
      emblemAt = [[0, 0.98, 1.02], [-0.2, 0, 0]];
      const fp = addWheel(0, 0.68, 1.15, 0.68, 0.24, true, this.group, accent);
      const fork = new THREE.Group();
      fp.add(fork);
      for (const sx of [-0.18, 0.18]) add(tube(0.9, 0.05), chrome, [sx, 0.42, -0.06], [-0.15, 0, 0], fork);
      add(once('g-bk-bar', () => new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6)), chrome, [0, 0.82, -0.2], [0, 0, Math.PI / 2], fork);
      for (const sx of [-0.6, 0.6]) {
        add(once('g-bk-grip', () => new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8)), accent, [sx, 0.82, -0.2], [0, 0, Math.PI / 2], fork);
        add(once('g-tr-ribbon', () => new THREE.BoxGeometry(0.05, 0.4, 0.12).translate(0, -0.2, 0)), once('m-ribbon', () => toon(0xff8fd0)), [sx * 1.18, 0.82, -0.2], null, fork);
      }
      // ペダル（前輪と一緒に回る）
      const spinFront = this.wheels[this.wheels.length - 1];
      for (const sx of [-1, 1]) add(once('g-tr-pedal', () => new THREE.BoxGeometry(0.1, 0.07, 0.3)), black, [sx * 0.28, 0.33 * sx, 0], null, spinFront);
      for (const sx of [-1, 1]) addWheel(sx * 0.62, 0.36, -0.9, 0.36, 0.2, false);
    }
    if (emblemAt) {
      // 肉球のエンブレム
      const emblem = new THREE.Mesh(once('g-emblem', () => new THREE.CircleGeometry(0.32, 24)), new THREE.MeshBasicMaterial({ map: pawTexture(pal.css), transparent: true }));
      emblem.position.set(...emblemAt[0]);
      emblem.rotation.set(...emblemAt[1]);
      this.body.add(emblem);
      this._mats.push(emblem.material);
    }

    // アンテナ（先端がぶらぶら揺れる）
    this.antenna = new THREE.Group();
    this.antenna.position.set(...lay.antenna);
    this.body.add(this.antenna);
    add(once('g-ant', () => new THREE.CylinderGeometry(0.025, 0.025, 1.3, 5)), black, [0, 0.65, 0], null, this.antenna);
    add(once('g-ball', () => new THREE.SphereGeometry(0.14, 10, 8)), accent, [0, 1.35, 0], null, this.antenna);
    this._ant = { x: 0, z: 0, vx: 0, vz: 0 };

    this._geos = [];
    for (const [mat, list] of statics) {
      const merged = mergeGeometries(list);
      for (const g of list) g.dispose();
      this._geos.push(merged);
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      this.body.add(m);
    }

    // ブーストの炎
    this.flames = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this._mats.push(flameMat, coreMat);
    for (const fp of lay.flames) {
      const f = new THREE.Group();
      f.position.set(...fp);
      const outer = new THREE.Mesh(once('g-flame', () => new THREE.ConeGeometry(0.22, 1.2, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.5)), flameMat);
      const core = new THREE.Mesh(once('g-flame2', () => new THREE.ConeGeometry(0.11, 0.7, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.3)), coreMat);
      f.add(outer, core);
      f.visible = false;
      this.body.add(f);
      this.flames.push(f);
    }

    // 無敵中（復帰・スピン後）の点滅用に見た目をまとめて扱う
    // 犬
    this.dog = buildDog(DOG_KINDS[index] || 'shiba');
    this.dog.group.position.set(...lay.dog);
    this.dog.group.scale.setScalar(0.92);
    this.body.add(this.dog.group);
    this.baseScale = index === 6 ? 1.12 : 1; // ボス犬は少し大きい
    this.group.scale.setScalar(this.baseScale);
    this._scale = 1; // 巨大化の倍率（なめらかに変える）
    this._dogPos = [...lay.dog];

    // ガード中の泡
    this.shield = new THREE.Mesh(
      once('g-shield', () => new THREE.SphereGeometry(2.3, 16, 12)),
      once('m-shield', () => new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.32, depthWrite: false })),
    );
    this.shield.position.y = 1.3;
    this.shield.visible = false;
    this.group.add(this.shield);

    // 飼い主モード: 金色のオーラと、後ろをリードを持って走る飼い主
    this.aura = new THREE.Mesh(
      once('g-aura', () => new THREE.SphereGeometry(2.6, 16, 12)),
      once('m-aura', () => new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending })),
    );
    this.aura.position.y = 1.3;
    this.aura.visible = false;
    this.group.add(this.aura);
    this.owner = new THREE.Group();
    const skin = once('m-skin', () => toon(0xffd7b0));
    const shirt = once('m-shirt', () => toon(0x35a7ff));
    const pants = once('m-pants', () => toon(0x2f3a63));
    const cap = once('m-cap', () => toon(0xff4d5e));
    const leash = once('m-leash', () => toon(0xff4d5e));
    const part = (geo, mat, pos, parent = this.owner) => add(geo, mat, pos, null, parent);
    part(once('g-o-torso', () => new THREE.CapsuleGeometry(0.42, 0.7, 4, 8)), shirt, [0, 1.75, 0]);
    part(once('g-o-head', () => new THREE.SphereGeometry(0.4, 12, 10)), skin, [0, 2.75, 0]);
    part(once('g-o-cap', () => new THREE.SphereGeometry(0.43, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), cap, [0, 2.85, 0.02]);
    part(once('g-o-brim', () => new THREE.BoxGeometry(0.6, 0.06, 0.4)), cap, [0, 2.85, 0.4]);
    this.ownerLegs = [-0.2, 0.2].map((lx) => {
      const pivot = new THREE.Group();
      pivot.position.set(lx, 1.15, 0);
      part(once('g-o-leg', () => new THREE.CapsuleGeometry(0.17, 0.75, 4, 6).translate(0, -0.55, 0)), pants, [0, 0, 0], pivot);
      this.owner.add(pivot);
      return pivot;
    });
    this.ownerArms = [-0.55, 0.55].map((ax) => {
      const pivot = new THREE.Group();
      pivot.position.set(ax, 2.2, 0);
      part(once('g-o-arm', () => new THREE.CapsuleGeometry(0.13, 0.6, 4, 6).translate(0, -0.4, 0)), shirt, [0, 0, 0], pivot);
      this.owner.add(pivot);
      return pivot;
    });
    // 視界をふさがないように、車の右横を並んで走る
    const OWNER_POS = [3.1, 0, -1.1];
    this.owner.position.set(...OWNER_POS);
    this.owner.visible = false;
    this.group.add(this.owner);
    // 犬とつなぐリード
    const lg = once('g-leash', () => new THREE.BoxGeometry(0.06, 0.06, 1).translate(0, 0, 0.5));
    this.leash = new THREE.Mesh(lg, leash);
    const from = [0.35, 1.5, -0.2]; // 犬の首元
    const hand = [OWNER_POS[0] - 0.5, 1.75, OWNER_POS[2] + 0.2]; // 飼い主の手
    const dx = hand[0] - from[0];
    const dy = hand[1] - from[1];
    const dz = hand[2] - from[2];
    this.leash.position.set(...from);
    this.leash.rotation.order = 'YXZ';
    this.leash.rotation.y = Math.atan2(dx, dz);
    this.leash.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz));
    this.leash.scale.z = Math.hypot(dx, dy, dz);
    this.leash.visible = false;
    this.group.add(this.leash);

    // 足元の丸い影
    const blob = new THREE.Mesh(
      once('g-blob', () => new THREE.CircleGeometry(1.9, 24)),
      once('m-blob', () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    blob.scale.set(0.75, 1.1, 1);
    this.blob = blob;
    // 目を回したときに頭の上を回る星
    this.dizzy = new THREE.Group();
    this.dizzy.position.set(0, 2.9, -0.35);
    const starGeo = once('g-dizzy', () => {
      const sh = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 === 0 ? 0.28 : 0.12;
        const a = (i / 10) * Math.PI * 2;
        if (i === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      return new THREE.ShapeGeometry(sh);
    });
    const starMat = once('m-dizzy', () => new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide }));
    for (let i = 0; i < 4; i++) {
      const st = new THREE.Mesh(starGeo, starMat);
      const a = (i / 4) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8);
      this.dizzy.add(st);
    }
    this.dizzy.visible = false;
    this.body.add(this.dizzy);
    // 豪雨でずぶぬれのときは頭の上に小さな雨雲
    this.cloud = new THREE.Group();
    this.cloud.position.set(0, 4.2, -0.3);
    const cloudMat = once('m-raincloud', () => toon(0x6b7189));
    for (const [cx, cy, cr] of [[0, 0, 0.75], [-0.7, -0.1, 0.55], [0.7, -0.1, 0.55], [0.3, 0.3, 0.5]]) {
      add(once('g-cloudpuff', () => new THREE.IcosahedronGeometry(1, 1)), cloudMat, [cx, cy, 0], null, this.cloud).scale.setScalar(cr);
    }
    const dropMat = once('m-drop', () => new THREE.MeshBasicMaterial({ color: 0x8ec5ff }));
    this.drops = [];
    for (let i = 0; i < 5; i++) {
      const d = add(once('g-drop', () => new THREE.CylinderGeometry(0.04, 0.04, 0.5, 4)), dropMat, [(i - 2) * 0.35, -0.8, (i % 2) * 0.3 - 0.15], null, this.cloud);
      d.castShadow = false;
      this.drops.push(d);
    }
    this.cloud.visible = false;
    this.group.add(this.cloud);
    // 逆走爺: 頭の上で紫の輪がくるくる回る
    this.revRing = new THREE.Mesh(
      once('g-revring', () => new THREE.TorusGeometry(0.9, 0.12, 8, 24)),
      once('m-revring', () => new THREE.MeshBasicMaterial({ color: 0xc04cff })),
    );
    this.revRing.position.set(0, 3.4, -0.3);
    this.revRing.rotation.x = Math.PI / 2;
    this.revRing.visible = false;
    this.group.add(this.revRing);
    // 免許返納で隠す乗り物の部品（犬・目を回す星以外）
    this._vehObjs = [...this.body.children.filter((c) => c !== this.dog.group && c !== this.dizzy), ...(this._pivots || [])];
    this._lightsOn = false;
    // 影を落とすのは大きな部品だけ（小さい部品の影はほとんど見えないのに、影を描く手間は部品の数だけかかる）
    const sph = new THREE.Sphere();
    const ws = new THREE.Vector3();
    this.group.updateMatrixWorld(true);
    this.group.traverse((o) => {
      if (!o.isMesh || !o.castShadow) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      sph.copy(o.geometry.boundingSphere);
      o.getWorldScale(ws);
      o.castShadow = sph.radius * Math.max(ws.x, ws.y, ws.z) > 0.42;
    });
    this._walking = false;
    // ヘッドライト（トンネルの中で自動でつく）: 光る電球と、前へのびる光の筋
    this.headlights = new THREE.Group();
    this.headlights.visible = false;
    for (const lp of lay.lights) {
      const bulb = new THREE.Mesh(once('g-hl-bulb', () => new THREE.SphereGeometry(0.2, 10, 8)), once('m-hl-bulb', () => new THREE.MeshBasicMaterial({ color: 0xfffbe0 })));
      bulb.position.set(...lp);
      const beam = new THREE.Mesh(
        once('g-hl-beam', () => new THREE.ConeGeometry(2.4, 12, 16, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 6)),
        once('m-hl-beam', () => new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
      );
      beam.position.set(lp[0], lp[1] - 0.05, lp[2] + 0.1);
      beam.rotation.x = 0.06; // 少し下向き
      beam.renderOrder = 2;
      this.headlights.add(bulb, beam);
    }
    this.body.add(this.headlights);
    this.firstPerson = false;
    this.own = false; // 自分の車か
    this._t = 0;
  }

  /** ヘッドライトをつける・消す（トンネルの中で自動でつく。歩いている間はつかない） */
  setLights(on) {
    this._lightsOn = on;
    this.headlights.visible = on && !this._walking;
  }

  /** 一人称視点のときは自分の犬を隠す（カメラが頭の中に入らないように） */
  setFirstPerson(on) {
    if (this.firstPerson === on) return;
    this.firstPerson = on;
    this.dog.group.visible = !on;
    this.antenna.visible = !on;
  }

  /** 状態から見た目を更新する。r は描画用に補間された車の状態 */
  update(r, dt, mood) {
    this._t += dt;
    const t = this._t;
    const spinAngle = spinAngleOf(r);
    this.group.position.set(r.x, r.y, r.z);
    this.group.rotation.y = r.h + spinAngle;
    this.blob.position.set(r.x, 0.03, r.z);
    this.blob.rotation.z = -(r.h + spinAngle);
    const sh = Math.max(0.3, 1 - r.y * 0.15);
    this.blob.scale.set(0.75 * sh, 1.1 * sh, 1);

    const spRatio = Math.min(1.5, Math.abs(r.sp) / KART.MAX_SPEED);
    // 走行中の小刻みな揺れ＋衝突時の大きな揺れ
    const rumble = Math.sin(t * 38) * 0.015 * spRatio + (r.grass ? Math.sin(t * 55) * 0.03 * spRatio : 0);
    const bump = r.bump > 0 ? Math.sin(t * 45) * r.bump * 0.25 : 0;
    this.body.position.y = rumble + Math.abs(bump) * 0.4;
    // 曲がると外側へ傾く・加速で沈む（後ろが下がる）
    this.body.rotation.z = -r.st * spRatio * this.lean + bump;
    this.body.rotation.x = -r.th * 0.05 * (r.th > 0 ? 1 - spRatio * 0.6 : 1) + (r.boost > 0 ? -0.06 : 0) + bump * 0.5;
    // 着地のつぶれ
    const squash = r.vy < -2 && r.y < 0.4 ? 0.9 : 1;
    this.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));

    for (const w of this.wheels) w.rotation.x += (r.sp * dt) / 0.46;
    for (const p of this.frontPivots) p.rotation.y = r.st * 0.45;
    this.wheel.rotation.z = -r.st * 1.2;

    // アンテナのばね
    const a = this._ant;
    const ax = -r.st * spRatio * 3 + (r.bump > 0 ? Math.sin(t * 30) * 6 : 0);
    const az = -r.th * 2 - (r.boost > 0 ? 3 : 0);
    a.vx += (ax - a.x * 60) * dt - a.vx * 4 * dt;
    a.vz += (az - a.z * 60) * dt - a.vz * 4 * dt;
    a.x += a.vx * dt;
    a.z += a.vz * dt;
    this.antenna.rotation.z = Math.max(-0.8, Math.min(0.8, a.x));
    this.antenna.rotation.x = Math.max(-0.8, Math.min(0.8, a.z));

    const boosting = r.boost > 0;
    for (const f of this.flames) {
      f.visible = boosting;
      if (boosting) f.scale.set(1, 1, 0.8 + Math.random() * 0.6);
    }
    // 無敵中は点滅
    this.group.visible = !(r.inv > 0 && r.spin <= 0 && Math.floor(t * 12) % 2 === 0);

    // スピン中は頭の上で星がくるくる
    this.dizzy.visible = !this.firstPerson && r.spin > 0;
    if (this.dizzy.visible) {
      this.dizzy.rotation.y = t * 6;
      for (const st of this.dizzy.children) st.rotation.y = -this.dizzy.rotation.y;
    }
    // 自分の車の雨雲は前が見えなくなるので出さない（HUD の「ずぶぬれ」表示で知らせる）
    this.cloud.visible = !this.own && r.wet > 0;
    if (this.cloud.visible) {
      this.cloud.rotation.y = -(r.h + spinAngle) + Math.sin(t * 1.5) * 0.2; // ワールドに対してほぼ向きを固定
      this.drops.forEach((d, i) => (d.position.y = -0.6 - ((t * 3 + i * 0.37) % 1) * 2.2));
    }
    // ガード（残りわずかになったら点滅）
    this.shield.visible = r.gd > 0 && (r.gd > 3 || Math.floor(t * 8) % 2 === 0);
    if (this.shield.visible) this.shield.scale.setScalar(1 + Math.sin(t * 4) * 0.04);
    // 飼い主モード: 金色にきらめいて、横を飼い主が並んで走る
    const ow = r.ow > 0;
    this.aura.visible = ow && !this.firstPerson;
    this.owner.visible = ow;
    this.leash.visible = ow;
    if (ow) {
      this.aura.scale.setScalar(1 + Math.sin(t * 10) * 0.06);
      this.aura.material.opacity = 0.22 + 0.12 * Math.sin(t * 16);
      const ph = t * 16;
      this.ownerLegs[0].rotation.x = Math.sin(ph) * 0.9;
      this.ownerLegs[1].rotation.x = -Math.sin(ph) * 0.9;
      this.ownerArms[0].rotation.set(-0.5, 0, -1.25); // リードを持つ手（車側）は犬のほうへ
      this.ownerArms[1].rotation.x = Math.sin(ph) * 0.8;
      this.owner.position.y = Math.abs(Math.sin(ph)) * 0.18;
    }
    // 巨大化: なめらかに大きく・戻る
    const gt = r.gi > 0 ? ITEMS.GIANT_SCALE : 1;
    this._scale += (gt - this._scale) * Math.min(1, dt * 6);
    this.group.scale.setScalar(this.baseScale * this._scale);
    // つぶされた: ぺちゃんこ
    if (r.sq > 0) {
      const f = Math.min(1, r.sq / 0.3);
      this.body.scale.set(1 + 0.35 * f, 1 - 0.6 * f, 1 + 0.35 * f);
    }
    // 逆走爺
    this.revRing.visible = r.rv > 0 && !this.firstPerson;
    if (this.revRing.visible) this.revRing.rotation.z = -t * 8;
    // 免許返納: 乗り物を隠して、犬が地面をとことこ歩く
    const walking = r.wk > 0;
    if (walking !== this._walking) {
      this._walking = walking;
      for (const o of this._vehObjs) o.visible = !walking;
      this.headlights.visible = this._lightsOn && !walking;
      this.flames.forEach((f) => (f.visible = false));
    }
    if (walking) {
      const ph = t * 14;
      this.dog.group.position.set(this._dogPos[0], 0.25 + Math.abs(Math.sin(ph)) * 0.25, this._dogPos[2]);
      this.dog.group.rotation.z = Math.sin(ph) * 0.12;
    } else if (this.dog.group.position.y !== this._dogPos[1]) {
      this.dog.group.position.set(...this._dogPos);
      this.dog.group.rotation.z = 0;
    }
    this.dog.animate({ dt, speed: r.sp, steer: r.st, spin: r.spin, boost: boosting ? 1 : 0, bump: r.bump, mood });
  }

  dispose() {
    for (const m of this._mats) m.dispose();
    for (const g of this._geos) g.dispose();
    this.dog.group.traverse((o) => o.userData.ownGeo && o.geometry.dispose());
  }
}
