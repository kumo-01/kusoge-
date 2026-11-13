// 見た目の質感（ゴム鉄砲）: 光の当たり方が自然な材質、絵で描いた木目・木の皮・岩・布・金属の模様、武器の形。
// 模様は画像ファイルを使わず、キャンバスに描いて作る（会場ごとに作り直さず、使い回す）。

import * as THREE from 'three';
import { WEAPON } from './constants.js';

/** 光の当たり方が自然な材質（ざらざら 0.82・金属でない）。o で上書き */
export const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, metalness: 0, ...o });

const texCache = new Map();
const rnd = (() => {
  // 毎回同じ模様になるように、決まった乱数
  let s = 1234567;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
})();

/** キャンバスに描いた模様（灰色の濃淡。材質の色と掛け合わせて使う） */
function canvasTex(key, draw, size = 256) {
  if (texCache.has(key)) return texCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const x = cv.getContext('2d');
  draw(x, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
const gray = (v) => {
  const c = Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgb(${c},${c},${c})`;
};

/** 木目（板。横に流れる年輪と、板のつなぎ目） */
const woodTex = () =>
  canvasTex('wood', (x, S) => {
    x.fillStyle = gray(0.9);
    x.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y++) {
      const v = 0.82 + 0.1 * Math.sin(y * 0.35 + Math.sin(y * 0.05) * 3) + (rnd() - 0.5) * 0.05;
      x.fillStyle = gray(v);
      x.fillRect(0, y, S, 1);
    }
    x.globalAlpha = 0.35;
    for (let i = 0; i < 18; i++) {
      x.strokeStyle = gray(0.55);
      x.beginPath();
      const y0 = rnd() * S;
      x.moveTo(0, y0);
      for (let px = 0; px <= S; px += 16) x.lineTo(px, y0 + Math.sin(px * 0.04 + i) * 3);
      x.stroke();
    }
    x.globalAlpha = 1;
    x.fillStyle = gray(0.5);
    for (const y of [0, S / 2]) x.fillRect(0, y, S, 2); // 板のつなぎ目
  });

/** 木の皮（縦のすじ） */
const barkTex = () =>
  canvasTex('bark', (x, S) => {
    x.fillStyle = gray(0.75);
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      x.fillStyle = gray(0.45 + rnd() * 0.45);
      const px = rnd() * S;
      x.fillRect(px, 0, 1 + rnd() * 4, S);
    }
    for (let i = 0; i < 160; i++) {
      x.fillStyle = gray(0.35 + rnd() * 0.2);
      x.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 6, 1 + rnd() * 2);
    }
  });

/** 岩（まだらとひび） */
const rockTex = () =>
  canvasTex('rock', (x, S) => {
    x.fillStyle = gray(0.8);
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      x.fillStyle = gray(0.6 + rnd() * 0.4);
      x.beginPath();
      x.arc(rnd() * S, rnd() * S, 3 + rnd() * 16, 0, Math.PI * 2);
      x.fill();
    }
    x.strokeStyle = gray(0.45);
    for (let i = 0; i < 10; i++) {
      x.beginPath();
      let px = rnd() * S;
      let py = rnd() * S;
      x.moveTo(px, py);
      for (let k = 0; k < 5; k++) x.lineTo((px += (rnd() - 0.5) * 50), (py += (rnd() - 0.5) * 50));
      x.stroke();
    }
  });

/** 布（細かい織り目） */
const fabricTex = () =>
  canvasTex('fabric', (x, S) => {
    x.fillStyle = gray(0.9);
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 3) {
      x.fillStyle = gray(0.8 + rnd() * 0.06);
      x.fillRect(i, 0, 1, S);
      x.fillStyle = gray(0.84 + rnd() * 0.06);
      x.fillRect(0, i, S, 1);
    }
  });

/** 葉っぱ・草（細かい濃淡） */
const leafTex = () =>
  canvasTex('leaf', (x, S) => {
    x.fillStyle = gray(0.85);
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 1400; i++) {
      x.fillStyle = gray(0.62 + rnd() * 0.45);
      x.beginPath();
      x.ellipse(rnd() * S, rnd() * S, 2 + rnd() * 4, 1 + rnd() * 2, rnd() * Math.PI, 0, Math.PI * 2);
      x.fill();
    }
  });

/** 金属（細い横の線） */
const metalTex = () =>
  canvasTex('metal', (x, S) => {
    x.fillStyle = gray(0.85);
    x.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y++) {
      x.fillStyle = gray(0.8 + rnd() * 0.15);
      x.fillRect(0, y, S, 1);
    }
  });

/** 見た目の種類ごとの質感（tex: 模様、unit: 模様 1 枚の大きさ、rough: ざらざら、metal: 金属らしさ） */
const KIND_LOOK = {
  wood: { tex: woodTex, unit: 1.4, rough: 0.72 },
  step: { tex: woodTex, unit: 1.4, rough: 0.72 },
  trunk: { tex: barkTex, unit: 1.2, rough: 0.95 },
  stump: { tex: barkTex, unit: 1.2, rough: 0.95 },
  log: { tex: barkTex, unit: 1.2, rough: 0.95 },
  rock: { tex: rockTex, unit: 2, rough: 0.95 },
  tent: { tex: fabricTex, unit: 1, rough: 0.92 },
  sandbag: { tex: fabricTex, unit: 0.6, rough: 0.98 },
  umbrella: { tex: fabricTex, unit: 1.2, rough: 0.9 },
  hedge: { tex: leafTex, unit: 1.6, rough: 0.95 },
  hill: { tex: leafTex, unit: 3, rough: 0.97 },
  metal: { tex: metalTex, unit: 1, rough: 0.35, metal: 0.8 },
  car: { rough: 0.32, metal: 0.35 },
  boat: { rough: 0.45 },
  play: { rough: 0.45 },
  toy: { rough: 0.5 },
  sand: { rough: 1 },
  fire: { rough: 0.9 },
  drum: { tex: metalTex, unit: 1, rough: 0.45, metal: 0.6 },
  container: { tex: metalTex, unit: 2, rough: 0.5, metal: 0.55 },
  pipe: { tex: rockTex, unit: 2, rough: 0.95 },
  tires: { rough: 0.9 },
  hay: { tex: fabricTex, unit: 0.8, rough: 1 },
  vending: { rough: 0.35, metal: 0.25 },
  wall: { tex: rockTex, unit: 1.2, rough: 0.97 },
  shed: { tex: woodTex, unit: 1.4, rough: 0.8 },
  crates: { tex: woodTex, unit: 1.0, rough: 0.78 },
  lamp: { rough: 0.4, metal: 0.7 },
  warp: { rough: 0.35, metal: 0.1 },
};

/** 見た目の種類 kind・色 c・大きさ（横 w・縦 h）の材質。模様は大きさに合わせてくり返す */
export function kindMat(kind, c, w = 1, h = 1) {
  const L = KIND_LOOK[kind];
  if (!L) return mat(c);
  const o = { roughness: L.rough ?? 0.82, metalness: L.metal ?? 0 };
  if (L.tex) {
    const t = L.tex().clone(); // 絵は同じものを使い、くり返しの回数だけ変える
    t.repeat.set(Math.max(1, w / L.unit), Math.max(1, h / L.unit));
    t.needsUpdate = true;
    o.map = t;
  }
  return mat(c, o);
}

// ---- 武器の形（+z が前。長さ約 0.6〜1.0）。userData.band: 輪ゴム（色を変える） ----

const METAL = () => mat(0x2c3035, { roughness: 0.32, metalness: 0.85 });
const BLACK = () => mat(0x15171a, { roughness: 0.4, metalness: 0.6 });
const GLASS = () => mat(0x6fb7ff, { roughness: 0.05, metalness: 0.2, emissive: 0x123a66, emissiveIntensity: 0.6 });

function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  return o;
}
function cyl(r, len, m, x = 0, y = 0, z = 0, r2 = r, seg = 14) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, len, seg), m);
  o.rotation.x = Math.PI / 2; // 前後に寝かせる
  o.position.set(x, y, z);
  return o;
}
function band(color, len, y, z) {
  const b = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.009, 6, 16), mat(color, { roughness: 0.6 }));
  b.scale.set(1, 1, len / 0.08);
  b.position.set(0, y, z);
  b.rotation.y = Math.PI / 2;
  return b;
}
/** 引き金と、それを囲む金具 */
function trigger(m, z) {
  const g = new THREE.Group();
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 6, 14, Math.PI), m);
  guard.rotation.z = Math.PI;
  guard.position.set(0, -0.05, z);
  const t = box(0.012, 0.045, 0.012, m, 0, -0.055, z - 0.005);
  t.rotation.x = 0.3;
  g.add(guard, t);
  return g;
}

/** 輪ゴム鉄砲: 木の銃身・斜めの持ち手・洗濯ばさみの留め具・前に張った輪ゴム・くぎ */
function rubberGun(bandColor) {
  const g = new THREE.Group();
  const wood = kindMat('wood', 0xb7834f, 0.6, 0.2);
  const dark = kindMat('wood', 0x7a5230, 0.3, 0.3);
  const metal = METAL();
  const barrel = box(0.06, 0.07, 0.62, wood, 0, 0, 0.2);
  const grip = box(0.065, 0.24, 0.1, dark, 0, -0.11, -0.07);
  grip.rotation.x = -0.35;
  const pin = new THREE.Group(); // 洗濯ばさみ（輪ゴムを引っかけて、引き金で外す）
  pin.add(box(0.05, 0.022, 0.12, dark, 0, 0.05, -0.05), box(0.05, 0.022, 0.12, dark, 0, 0.078, -0.05));
  const spring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 6, 12), metal);
  spring.position.set(0, 0.064, -0.05);
  spring.rotation.y = Math.PI / 2;
  pin.add(spring);
  const notch = box(0.07, 0.03, 0.03, dark, 0, 0.04, 0.5); // 先の引っかけ
  const nails = [0.05, 0.3].map((z) => {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), metal);
    n.position.set(0.031, 0.01, z);
    return n;
  });
  const b = band(bandColor, 0.48, 0.047, 0.24);
  g.add(barrel, grip, pin, notch, ...nails, trigger(metal, 0.02), b);
  g.userData.band = b;
  return g;
}

/** スナイパー: 木の銃床・金属の長い銃身・スコープ・二脚 */
function sniperGun(bandColor) {
  const g = new THREE.Group();
  const wood = kindMat('wood', 0x8a5a33, 0.6, 0.2);
  const metal = METAL();
  const black = BLACK();
  const stock = box(0.07, 0.09, 0.42, wood, 0, -0.01, -0.05);
  const butt = box(0.075, 0.14, 0.12, wood, 0, -0.03, -0.3);
  const grip = box(0.06, 0.2, 0.08, wood, 0, -0.1, -0.08);
  grip.rotation.x = -0.3;
  const barrel = cyl(0.018, 0.62, metal, 0, 0.02, 0.45);
  const muzzle = cyl(0.026, 0.06, black, 0, 0.02, 0.77);
  // スコープ（筒・前後のふくらみ・レンズ・台）
  const scope = new THREE.Group();
  scope.add(cyl(0.026, 0.26, black, 0, 0.1, 0.06), cyl(0.036, 0.06, black, 0, 0.1, 0.2, 0.03), cyl(0.032, 0.05, black, 0, 0.1, -0.08, 0.026));
  const lens = cyl(0.03, 0.005, GLASS(), 0, 0.1, 0.232);
  scope.add(lens, box(0.02, 0.05, 0.02, black, 0, 0.065, 0.12), box(0.02, 0.05, 0.02, black, 0, 0.065, 0));
  // 二脚（たたんだ足）
  const legs = [-1, 1].map((s) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6), black);
    l.position.set(s * 0.025, -0.05, 0.42);
    l.rotation.x = 1.2;
    return l;
  });
  const b = band(bandColor, 0.5, 0.045, 0.42);
  g.add(stock, butt, grip, barrel, muzzle, scope, ...legs, trigger(metal, -0.02), b);
  g.userData.band = b;
  return g;
}

/** ライフル: 長い銃身・銃口の消炎器・大きなスコープ・ボルト（引き手）・ほおあての付いた銃床 */
function rifleGun(bandColor) {
  const g = new THREE.Group();
  const wood = kindMat('wood', 0x5e3a1f, 0.7, 0.2);
  const metal = METAL();
  const black = BLACK();
  const stock = box(0.072, 0.1, 0.5, wood, 0, -0.015, -0.02);
  const butt = box(0.08, 0.16, 0.14, wood, 0, -0.035, -0.32);
  const cheek = box(0.07, 0.04, 0.16, wood, 0, 0.06, -0.26); // ほおあて
  const grip = box(0.06, 0.2, 0.08, wood, 0, -0.1, -0.06);
  grip.rotation.x = -0.3;
  const barrel = cyl(0.02, 0.8, metal, 0, 0.025, 0.58);
  const brake = cyl(0.03, 0.08, black, 0, 0.025, 1.0); // 消炎器
  const slots = [-1, 1].map((s) => box(0.004, 0.012, 0.04, metal, s * 0.031, 0.025, 1.0));
  const receiver = box(0.06, 0.07, 0.2, metal, 0, 0.03, 0.08);
  // ボルト（右側の引き手）
  const bolt = cyl(0.008, 0.08, metal, 0.045, 0.045, 0.02);
  bolt.rotation.set(0, 0, Math.PI / 2);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), black);
  knob.position.set(0.085, 0.045, 0.02);
  // スコープ（スナイパーより大きい）
  const scope = new THREE.Group();
  scope.add(cyl(0.03, 0.3, black, 0, 0.115, 0.1), cyl(0.044, 0.08, black, 0, 0.115, 0.28, 0.034), cyl(0.038, 0.06, black, 0, 0.115, -0.07, 0.03));
  scope.add(cyl(0.038, 0.005, GLASS(), 0, 0.115, 0.322), box(0.022, 0.06, 0.022, black, 0, 0.075, 0.18), box(0.022, 0.06, 0.022, black, 0, 0.075, 0.02));
  const b = band(bandColor, 0.6, 0.05, 0.62);
  g.add(stock, butt, cheek, grip, barrel, brake, ...slots, receiver, bolt, knob, scope, trigger(metal, -0.01), b);
  g.userData.band = b;
  return g;
}

/** 武器 weapon の形 */
export function makeWeapon(weapon, bandColor = 0xf4a261) {
  if (weapon === WEAPON.SNIPER) return sniperGun(bandColor);
  if (weapon === WEAPON.RIFLE) return rifleGun(bandColor);
  return rubberGun(bandColor);
}

/** 3 つの武器をまとめた入れ物（見せるのは 1 つ）。set(weapon) で持ちかえる */
export function weaponRack(bandColor) {
  const g = new THREE.Group();
  const list = [WEAPON.NORMAL, WEAPON.SNIPER, WEAPON.RIFLE].map((w) => {
    const m = makeWeapon(w, bandColor);
    m.visible = w === WEAPON.NORMAL;
    g.add(m);
    return m;
  });
  g.userData.list = list;
  g.userData.cur = WEAPON.NORMAL;
  g.userData.set = (w) => {
    if (g.userData.cur === w) return;
    g.userData.cur = w;
    list.forEach((m, k) => (m.visible = k === w));
  };
  g.userData.band = () => list[g.userData.cur]?.userData.band;
  return g;
}

/** 犬の模型の材質（輪郭のはっきりした塗り）を、光の当たり方が自然な材質に置きかえる（その犬だけ） */
export function realisticDog(group) {
  group.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const conv = (m) => (m && m.isMeshToonMaterial ? mat(m.color.getHex(), { map: m.map || null, transparent: m.transparent, opacity: m.opacity, side: m.side, roughness: 0.9 }) : m);
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}
