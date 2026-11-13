// ゴム鉄砲の犬（2026-11-13〜）。後ろ足で立って鉄砲を構える、本物の犬に近い形と毛並み。
// カートの犬（dogKart/dog.js）より頭を小さく、鼻先を長く、足・腕・首をつけて、毛の模様・つやのある目と鼻にした。
// 原点は足もと、+z が前。高さは当たり判定（PLAYER.HEIGHT = 1.25）に合わせる（耳の先が少し出る）。
// 動かす部品（頭・耳・足・腕・しっぽ）ごとに、動かない部品を材質ごとに 1 つにまとめて、描画の回数を減らす。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** 毛並みの模様（灰色の細い毛の線。色は材質の色と掛け合わせる） */
let furTexCache = null;
function furTex() {
  if (furTexCache) return furTexCache;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const x = cv.getContext('2d');
  x.fillStyle = '#d8d8d8';
  x.fillRect(0, 0, S, S);
  let s = 987654;
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(170 + r() * 85);
    x.strokeStyle = `rgb(${v},${v},${v})`;
    x.lineWidth = 0.6 + r() * 0.8;
    const px = r() * S;
    const py = r() * S;
    const len = 3 + r() * 6;
    const a = Math.PI / 2 + (r() - 0.5) * 0.7;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  furTexCache = t;
  return t;
}

const matCache = new Map();
/** 毛の材質（模様つき・つやなし） */
function furMat(c) {
  const k = `f${c}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: c, map: furTex(), bumpMap: furTex(), bumpScale: 0.6, roughness: 0.92 }));
  return matCache.get(k);
}
/** つやのある材質（目・鼻・肉球） */
function glossMat(c, rough = 0.18) {
  const k = `g${c}-${rough}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.05 }));
  return matCache.get(k);
}
function plainMat(c, rough = 0.7) {
  const k = `p${c}-${rough}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: rough }));
  return matCache.get(k);
}

const geoCache = new Map();
const G = (k, make) => geoCache.get(k) || (geoCache.set(k, make()), geoCache.get(k));
const SPH = () => G('sph', () => new THREE.SphereGeometry(1, 18, 12));
const SPH_LO = () => G('sphlo', () => new THREE.SphereGeometry(1, 10, 7));
const CAP = () => G('cap', () => new THREE.CapsuleGeometry(1, 1, 4, 10)); // 半径 1・まっすぐな部分 1
const CONE = () => G('cone', () => new THREE.ConeGeometry(1, 1, 10, 1));
const EAR = () =>
  G('ear', () => {
    // 立ち耳: 三角の板を少し厚くして、内側にくぼみ
    const sh = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.06, 1), new THREE.Vector2(-0.06, 1)]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
    g.translate(0, 0, -0.09);
    return g;
  });

function part(geo, material, pos, scale, rot) {
  const o = new THREE.Mesh(geo, material);
  if (pos) o.position.set(...pos);
  if (scale) o.scale.set(...(Array.isArray(scale) ? scale : [scale, scale, scale]));
  if (rot) o.rotation.set(...rot);
  return o;
}

/** グループ直下の動かない部品を、材質ごとに 1 つにまとめる（描画の回数を減らす） */
function merge(group, keep = new Set()) {
  const by = new Map();
  for (const c of group.children) {
    if (!c.isMesh || keep.has(c)) continue;
    if (!by.has(c.material)) by.set(c.material, []);
    by.get(c.material).push(c);
  }
  for (const [m, list] of by) {
    if (list.length < 2) continue;
    const geos = list.map((o) => {
      o.updateMatrix();
      const g0 = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g0.deleteAttribute?.('uv1');
      return g0.applyMatrix4(o.matrix);
    });
    const merged = mergeGeometries(geos);
    for (const g0 of geos) g0.dispose();
    if (!merged) continue;
    for (const o of list) group.remove(o);
    const mm = new THREE.Mesh(merged, m);
    mm.userData.ownGeo = true;
    group.add(mm);
  }
}

/**
 * 犬種ごとの色と形。fur: 地の色、light: 白っぽい所（胸・口元・おなか）、dark: 濃い所、
 * ears: 'up'（立ち耳）/ 'drop'（垂れ耳）/ 'fold'（折れ耳）/ 'big'（大きな立ち耳）、snout: 鼻先の長さ、tail: しっぽの形、
 * leg: 足の長さの割合、saddle: 背中の濃い色（ビーグル・ドーベルマン）、mask: 顔の白（ハスキー）、eye: 目の色
 */
const BREED = {
  shiba: { fur: 0xd9852f, light: 0xf7ead2, dark: 0xb5651d, ears: 'up', snout: 1, tail: 'curl', leg: 1 },
  corgi: { fur: 0xd77a2c, light: 0xfbf7f0, dark: 0xb35f1c, ears: 'big', snout: 1, tail: 'stub', leg: 0.78 },
  poodle: { fur: 0xf1e9e2, light: 0xfaf6f2, dark: 0xd9cfc6, ears: 'drop', snout: 1.05, tail: 'pom', leg: 1.05, curly: true },
  pug: { fur: 0xe3c9a0, light: 0xeedcbc, dark: 0x2e2622, ears: 'fold', snout: 0.45, tail: 'curl', leg: 0.9, muzzleDark: true },
  dachs: { fur: 0x8b4a1f, light: 0xa8612f, dark: 0x5e2f12, ears: 'drop', snout: 1.35, tail: 'thin', leg: 0.72 },
  doberman: { fur: 0x1f1f25, light: 0xa8642c, dark: 0x111114, ears: 'up', snout: 1.35, tail: 'stub', leg: 1.1, tan: true },
  chihuahua: { fur: 0xe2b47a, light: 0xf6e4c8, dark: 0xc08c50, ears: 'big', snout: 0.6, tail: 'thin', leg: 0.9 },
  beagle: { fur: 0xc98843, light: 0xfbf8f2, dark: 0x2a211c, ears: 'drop', snout: 1.15, tail: 'flag', leg: 0.95, saddle: true },
  golden: { fur: 0xdba650, light: 0xf0cf8f, dark: 0xc08a3a, ears: 'drop', snout: 1.15, tail: 'plume', leg: 1.05 },
  husky: { fur: 0x737c8c, light: 0xf5f6f8, dark: 0x3f4552, ears: 'up', snout: 1.1, tail: 'plume', leg: 1.05, mask: true, eye: 0x6fb7ff },
};

/** 一人称の手の色（鉄砲を持つ前足） */
export const DOG_FUR = Object.fromEntries(Object.entries(BREED).map(([k, b]) => [k, b.fur]));

/**
 * 犬を作る。@returns {{ group, animate(a), live }}
 * animate({ dt, moving, crouch, pitch, dead, stun, aim }): aim = 鉄砲を構える（腕を前へ）
 */
export function buildRealDog(kind) {
  const B = BREED[kind] || BREED.shiba;
  const fur = furMat(B.fur);
  const light = furMat(B.light);
  const dark = furMat(B.dark);
  const nose = glossMat(0x161212, 0.22);
  const eyeM = glossMat(B.eye ?? 0x2a1a10, 0.08);
  const white = glossMat(0xffffff, 0.1);
  const pad = plainMat(0x2b2422, 0.6);
  const tongueM = glossMat(0xe8737f, 0.35);
  const L = B.leg;

  const group = new THREE.Group();
  const hips = new THREE.Group(); // 上下に揺れる・伏せる
  hips.position.y = 0.42 * L;
  group.add(hips);

  // ---- 胴（少し前かがみ。胸は白っぽく） ----
  const torso = new THREE.Group();
  torso.rotation.x = 0.12;
  hips.add(torso);
  torso.add(part(CAP(), fur, [0, 0.27, 0], [0.2, 0.16, 0.17]));
  torso.add(part(SPH(), fur, [0, 0.05, -0.02], [0.21, 0.17, 0.2])); // おしり
  torso.add(part(SPH(), B.tan ? fur : light, [0, 0.3, 0.1], [0.16, 0.22, 0.12])); // 胸
  if (B.tan) torso.add(part(SPH(), light, [0, 0.12, 0.13], [0.1, 0.08, 0.06]));
  if (B.saddle) torso.add(part(SPH(), dark, [0, 0.3, -0.07], [0.19, 0.22, 0.12])); // 背中の黒
  if (B.curly) for (let i = 0; i < 6; i++) torso.add(part(SPH_LO(), fur, [Math.sin(i * 2.1) * 0.15, 0.08 + i * 0.07, Math.cos(i * 2.1) * 0.1], 0.1));
  // 首
  torso.add(part(CAP(), fur, [0, 0.52, 0.04], [0.11, 0.06, 0.1], [0.35, 0, 0]));
  torso.add(part(SPH(), B.mask || kind === 'shiba' || kind === 'corgi' ? light : fur, [0, 0.5, 0.1], [0.1, 0.1, 0.07]));

  // ---- 頭（ねらう向きに少し上下する） ----
  const head = new THREE.Group();
  head.position.set(0, 0.66, 0.08);
  torso.add(head);
  const sn = B.snout;
  head.add(part(SPH(), fur, [0, 0.03, 0], [0.15, 0.135, 0.15])); // 頭の丸み
  head.add(part(SPH(), B.mask ? light : fur, [0, -0.03, 0.06], [0.135, 0.11, 0.12])); // ほお
  // 鼻先（犬種で長さが違う）。口元は白っぽい（パグは黒）
  const mz = B.muzzleDark ? dark : B.tan || kind === 'dachs' || kind === 'golden' || kind === 'chihuahua' ? light : light;
  head.add(part(CAP(), kind === 'doberman' ? fur : mz, [0, -0.045, 0.13 + 0.05 * sn], [0.065, 0.05 * sn, 0.06], [Math.PI / 2 - 0.12, 0, 0]));
  if (kind === 'doberman') head.add(part(SPH(), light, [0, -0.08, 0.14 + 0.05 * sn], [0.055, 0.03, 0.05 * sn + 0.04]));
  head.add(part(SPH(), light, [0, -0.085, 0.1 + 0.04 * sn], [0.06, 0.03, 0.05 * sn + 0.03])); // あご
  if (B.mask) head.add(part(SPH(), dark, [0, 0.1, 0.02], [0.11, 0.06, 0.12])); // ハスキーの額の濃い色
  // 鼻（つや）
  const noseZ = 0.13 + 0.1 * sn + 0.055;
  head.add(part(SPH_LO(), nose, [0, -0.02, noseZ], [0.032, 0.024, 0.025]));
  // 目（つやのある黒目と、光の点）・まぶたの毛
  for (const sd of [-1, 1]) {
    head.add(part(SPH_LO(), eyeM, [sd * 0.062, 0.03, 0.115], [0.026, 0.027, 0.018]));
    head.add(part(SPH_LO(), white, [sd * 0.062 - 0.006, 0.04, 0.13], [0.006, 0.006, 0.004]));
    head.add(part(SPH_LO(), B.tan ? light : fur, [sd * 0.065, 0.06, 0.11], [0.03, 0.012, 0.02])); // まゆ
    if (kind === 'shiba') head.add(part(SPH_LO(), light, [sd * 0.06, 0.065, 0.112], [0.018, 0.01, 0.01])); // 麻呂眉
  }
  // 口・舌（ハアハア）
  const tongue = part(SPH_LO(), tongueM, [0, -0.1, 0.12 + 0.04 * sn], [0.03, 0.012, 0.045]);
  head.add(tongue);
  // 耳
  const ears = [];
  for (const sd of [-1, 1]) {
    const piv = new THREE.Group();
    head.add(piv);
    if (B.ears === 'up' || B.ears === 'big') {
      const s = B.ears === 'big' ? 1.45 : 1;
      piv.position.set(sd * 0.08, 0.12, -0.02);
      piv.rotation.set(-0.1, 0, -sd * 0.22);
      piv.add(part(EAR(), fur, [0, 0, 0], [0.09 * s, 0.13 * s, 0.12]));
      piv.add(part(EAR(), plainMat(0xe9a9a0, 0.8), [0, 0.012, 0.012], [0.055 * s, 0.09 * s, 0.06]));
    } else if (B.ears === 'drop') {
      const long = kind === 'dachs' || kind === 'beagle' ? 1.35 : 1;
      piv.position.set(sd * 0.13, 0.08, -0.01);
      piv.rotation.z = sd * 0.18;
      const em = kind === 'beagle' ? fur : kind === 'golden' || kind === 'poodle' ? fur : dark;
      piv.add(part(SPH(), em, [sd * 0.02, -0.09 * long, 0], [0.035, 0.11 * long, 0.075]));
      if (B.curly) for (let i = 0; i < 3; i++) piv.add(part(SPH_LO(), fur, [sd * 0.025, -0.05 - i * 0.06, 0], 0.05));
    } else {
      // 折れ耳（パグ）
      piv.position.set(sd * 0.11, 0.11, 0.0);
      piv.add(part(SPH(), dark, [sd * 0.02, -0.01, 0.03], [0.05, 0.045, 0.02], [0.4, 0, sd * 0.5]));
    }
    ears.push({ piv, sd, base: piv.rotation.x });
  }
  if (B.curly) for (const [x, y, z] of [[0, 0.15, 0], [-0.07, 0.13, 0.02], [0.07, 0.13, 0.02]]) head.add(part(SPH_LO(), fur, [x, y, z], 0.07));

  // ---- 後ろ足（太もも → すね → 足先）。歩くと交互に振る ----
  const legs = [];
  for (const sd of [-1, 1]) {
    const thigh = new THREE.Group();
    thigh.position.set(sd * 0.11, 0.0, -0.02);
    hips.add(thigh);
    thigh.add(part(CAP(), fur, [0, -0.08 * L, 0.02], [0.075, 0.09 * L, 0.085], [0.25, 0, 0]));
    const shin = new THREE.Group();
    shin.position.set(0, -0.2 * L, 0.04);
    thigh.add(shin);
    shin.add(part(CAP(), B.tan || B.saddle || kind === 'corgi' || kind === 'husky' ? light : fur, [0, -0.08 * L, -0.03], [0.045, 0.07 * L, 0.045], [-0.35, 0, 0]));
    const foot = part(SPH(), B.tan ? light : B.saddle || kind === 'corgi' || kind === 'husky' || kind === 'shiba' ? light : fur, [0, -0.2 * L + 0.005, 0.03], [0.055, 0.035, 0.09]);
    shin.add(foot);
    shin.add(part(SPH_LO(), pad, [0, -0.2 * L - 0.02, 0.02], [0.04, 0.008, 0.06]));
    legs.push({ thigh, shin, sd });
  }

  // ---- 前足（鉄砲を構える） ----
  const arms = [];
  for (const sd of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(sd * 0.15, 0.42, 0.06);
    torso.add(sh);
    sh.add(part(CAP(), fur, [0, -0.04, 0.07], [0.05, 0.08, 0.05], [1.15, 0, 0]));
    const fore = new THREE.Group();
    fore.position.set(0, -0.08, 0.16);
    sh.add(fore);
    fore.add(part(CAP(), B.tan || kind === 'husky' || kind === 'corgi' || kind === 'beagle' ? light : fur, [0, 0, 0.07], [0.04, 0.06, 0.04], [Math.PI / 2, 0, 0]));
    fore.add(part(SPH(), B.tan || kind !== 'dachs' ? light : fur, [0, 0, 0.16], [0.045, 0.04, 0.05]));
    sh.rotation.y = -sd * 0.42;
    arms.push({ sh, fore, sd });
  }

  // ---- しっぽ ----
  const tail = new THREE.Group();
  tail.position.set(0, 0.08, -0.17);
  hips.add(tail);
  if (B.tail === 'curl') {
    tail.add(part(G('curl', () => new THREE.TorusGeometry(0.09, 0.045, 8, 16, Math.PI * 1.5)), fur, [0, 0.12, -0.04], 1, [0, Math.PI / 2, 0.4]));
    tail.add(part(SPH_LO(), light, [0, 0.22, 0.0], 0.045));
  } else if (B.tail === 'plume') {
    tail.add(part(CAP(), fur, [0, 0.1, -0.12], [0.055, 0.12, 0.055], [-0.9, 0, 0]));
    tail.add(part(SPH_LO(), B.mask ? light : fur, [0, 0.2, -0.26], [0.05, 0.07, 0.05]));
  } else if (B.tail === 'flag') {
    tail.add(part(CAP(), fur, [0, 0.12, -0.08], [0.03, 0.1, 0.03], [-0.5, 0, 0]));
    tail.add(part(SPH_LO(), light, [0, 0.25, -0.15], [0.03, 0.05, 0.03]));
  } else if (B.tail === 'pom') {
    tail.add(part(CAP(), fur, [0, 0.06, -0.04], [0.02, 0.06, 0.02], [-0.6, 0, 0]));
    tail.add(part(SPH_LO(), fur, [0, 0.14, -0.1], 0.07));
  } else if (B.tail === 'thin') {
    tail.add(part(CAP(), fur, [0, 0.06, -0.12], [0.025, 0.12, 0.025], [-1.0, 0, 0]));
  } else {
    tail.add(part(SPH_LO(), fur, [0, 0.02, -0.03], [0.05, 0.045, 0.05]));
  }

  // 動かない部品をまとめる
  const keep = new Set([tongue]);
  for (const g of [torso, head, tail, ...ears.map((e) => e.piv), ...legs.flatMap((l) => [l.thigh, l.shin]), ...arms.flatMap((a) => [a.sh, a.fore])]) merge(g, keep);
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  let t = Math.random() * 10;
  let walk = 0;
  /** @param {{ dt, moving, crouch, pitch, dead, stun }} a */
  function animate(a) {
    t += a.dt;
    const mv = a.moving && !a.dead ? 1 : 0;
    walk += a.dt * (mv ? 11 : 0);
    // 歩く: 足を交互に、体が少し上下に揺れる。止まっていると、ゆっくり息をする
    const sw = Math.sin(walk) * 0.65 * mv;
    legs[0].thigh.rotation.x = sw;
    legs[1].thigh.rotation.x = -sw;
    legs[0].shin.rotation.x = Math.max(0, -Math.sin(walk)) * 0.7 * mv;
    legs[1].shin.rotation.x = Math.max(0, Math.sin(walk)) * 0.7 * mv;
    hips.position.y = 0.42 * L + Math.abs(Math.cos(walk)) * 0.025 * mv;
    torso.scale.set(1, 1 + Math.sin(t * 2.2) * 0.012, 1 + Math.sin(t * 2.2) * 0.015);
    // 頭: ねらっている上下の向きに（半分くらい）
    const pitch = Math.max(-0.6, Math.min(0.6, a.pitch || 0));
    head.rotation.x = -pitch * 0.6 + (a.dead ? 0.4 : 0);
    head.rotation.z = a.stun ? Math.sin(t * 9) * 0.25 : Math.sin(t * 0.7) * 0.03;
    // 腕: 鉄砲を前に構える（ねらう上下の向きについていく）
    for (const ar of arms) {
      ar.sh.rotation.x = -pitch * 0.8 + Math.sin(walk + ar.sd) * 0.05 * mv;
      ar.fore.rotation.x = -0.15;
    }
    // 耳: ときどきピクッと動く
    for (const e of ears) e.piv.rotation.x = e.base + (Math.sin(t * 1.3 + e.sd * 2) > 0.97 ? -0.25 : 0) - mv * 0.12;
    // しっぽを振る（倒れたら下げる）
    tail.rotation.y = a.dead ? 0 : Math.sin(t * (mv ? 16 : 9)) * 0.45;
    tail.rotation.x = a.dead ? 0.8 : 0;
    // 舌: 走っている・暑い（ハアハア）
    tongue.visible = mv > 0 || kind === 'pug' || kind === 'golden';
    tongue.position.y = -0.1 - Math.abs(Math.sin(t * 9)) * 0.008;
  }

  const live = [group, hips, torso, head, tail, tongue, ...ears.map((e) => e.piv), ...legs.flatMap((l) => [l.thigh, l.shin]), ...arms.flatMap((a) => [a.sh, a.fore])];
  return { group, animate, live, handY: 0.42 * L + 0.33 };
}
